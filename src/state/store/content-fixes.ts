import { useCallback } from 'react';
import type { CompendiumEntity } from '../../types/compendium';
import type { ContentFix, ContentFixPatch } from '../../types/content-fix';
import {
  applyPatch,
  buildPatch,
  createFix,
  exportFixesFile,
  hashEntity,
  parseFixesFile,
  type FixFile,
} from '../../engine/content-fixes';
import { deleteContentFix, saveContentFix, saveContentFixes } from '../../storage/db';
import type { StoreCore } from './core';

export type TableRole = 'dm' | 'player';

export type FixResult = { ok: true; fix: ContentFix } | { ok: false; error: string };

/**
 * "Flag it, fix it, review it": propose a correction to a compendium entry, review it (DM only),
 * export / import fixes. Fixes live in their own table and layer on top of the stored entries.
 */
export function useContentFixActions(core: StoreCore) {
  const { compendium, effectiveCompendium, contentFixes, setContentFixes, appendLog, pushToast } = core;

  const authorLabel = (role: TableRole) => (role === 'player' ? 'Player' : 'DM');

  const putFix = useCallback(
    async (fix: ContentFix) => {
      await saveContentFix(fix);
      setContentFixes((prev) => [...prev.filter((f) => f.id !== fix.id), fix]);
    },
    [setContentFixes]
  );

  /** Saves a proposed fix: `edited` is the entry as the editor left it, prefilled from the effective entry. */
  const proposeContentFix = useCallback(
    async (entityId: string, edited: CompendiumEntity, note: string, role: TableRole): Promise<FixResult> => {
      const base = compendium.find((e) => e.id === entityId);
      if (!base) return { ok: false, error: 'That entry is not in the compendium any more.' };
      const shown = effectiveCompendium.find((e) => e.id === entityId) ?? base;
      const made = createFix({ base, shown, edited: { ...edited, id: base.id }, note, author: authorLabel(role) });
      if ('error' in made) return { ok: false, error: made.error };
      await putFix(made.fix);
      appendLog(`Fix proposed for "${base.name}" by ${made.fix.author}: ${made.fix.note}`, 'info');
      pushToast(`Fix proposed for ${base.name}`, 'info');
      return { ok: true, fix: made.fix };
    },
    [compendium, effectiveCompendium, putFix, appendLog, pushToast]
  );

  /**
   * Approve or reject. Only the DM may; a player's call is refused. Approving a fix whose entry changed
   * since (needs re-review) re-bases it on the current entry, so the DM has looked at it again.
   * `patch` replaces the fix's changes (edit, then approve).
   */
  const reviewContentFix = useCallback(
    async (
      fixId: string,
      decision: 'approved' | 'rejected',
      role: TableRole,
      patch?: ContentFixPatch
    ): Promise<FixResult> => {
      if (role !== 'dm') return { ok: false, error: 'Only the DM can approve or reject fixes.' };
      const fix = contentFixes.find((f) => f.id === fixId);
      if (!fix) return { ok: false, error: 'Fix not found.' };
      const base = compendium.find((e) => e.id === fix.entityId);
      const next: ContentFix = {
        ...fix,
        status: decision,
        reviewedAt: new Date().toISOString(),
        ...(patch && Object.keys(patch).length > 0 ? { patch: structuredClone(patch) } : {}),
        ...(decision === 'approved' && base ? { baseSnapshotHash: hashEntity(base) } : {}),
      };
      await putFix(next);
      appendLog(`Fix ${decision} for "${base?.name ?? fix.entityId}".`, 'info');
      return { ok: true, fix: next };
    },
    [contentFixes, compendium, putFix, appendLog]
  );

  /** "Revert to original": removes the fix. DM only. */
  const deleteFix = useCallback(
    async (fixId: string, role: TableRole): Promise<boolean> => {
      if (role !== 'dm') return false;
      await deleteContentFix(fixId);
      setContentFixes((prev) => prev.filter((f) => f.id !== fixId));
      appendLog('Fix removed (entry is back to the original).', 'info');
      return true;
    },
    [setContentFixes, appendLog]
  );

  const exportContentFixes = useCallback(
    (): FixFile => exportFixesFile(contentFixes, compendium),
    [contentFixes, compendium]
  );

  /** Imported fixes always arrive as proposed and go through the same review. */
  const importContentFixes = useCallback(
    async (text: string): Promise<{ imported: number; skipped: string[] }> => {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return { imported: 0, skipped: ['Not valid JSON.'] };
      }
      const { fixes, skipped } = parseFixesFile(raw, new Set(contentFixes.map((f) => f.id)));
      await saveContentFixes(fixes);
      setContentFixes((prev) => [...prev, ...fixes]);
      if (fixes.length > 0) {
        appendLog(`Imported ${fixes.length} fix(es) for review.`, 'info');
        pushToast(`Imported ${fixes.length} fix(es) for review`, 'info');
      }
      return { imported: fixes.length, skipped };
    },
    [contentFixes, setContentFixes, appendLog, pushToast]
  );

  /** For the editor's "Edit then approve": the patch that turns the original into `edited`. */
  const patchAgainstOriginal = useCallback(
    (entityId: string, edited: CompendiumEntity): ContentFixPatch => {
      const base = compendium.find((e) => e.id === entityId);
      return base ? buildPatch(base, { ...edited, id: base.id }) : {};
    },
    [compendium]
  );

  /** The entry with a fix's patch applied to the stored original (for before/after and edit forms). */
  const previewFix = useCallback(
    (fix: ContentFix): { base: CompendiumEntity; after: CompendiumEntity } | null => {
      const base = compendium.find((e) => e.id === fix.entityId);
      return base ? { base, after: applyPatch(base, fix.patch) } : null;
    },
    [compendium]
  );

  return {
    proposeContentFix,
    reviewContentFix,
    deleteContentFix: deleteFix,
    exportContentFixes,
    importContentFixes,
    patchAgainstOriginal,
    previewFix,
  };
}
