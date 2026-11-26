import { useMemo, useRef, useState } from 'react';
import type { CompendiumEntity } from '../types/compendium';
import type { ContentFix, ContentFixPatch } from '../types/content-fix';
import { applyPatch, diffEntities, fixState, type EffectiveFixState, type FixFile } from '../engine/content-fixes';
import { ContentFixEditor } from './ContentFixEditor';

export type FixOutcome = { ok: true } | { ok: false; error: string };

/** What the compendium dialog needs from the store to flag, fix and review entries. */
export interface ContentFixApi {
  role: 'dm' | 'player';
  /** Every fix, whatever its status. */
  fixes: readonly ContentFix[];
  /** The stored entries (without fixes applied). */
  entities: readonly CompendiumEntity[];
  /** The entry with approved fixes applied. */
  getEffective: (entityId: string) => CompendiumEntity | undefined;
  propose: (entityId: string, edited: CompendiumEntity, note: string) => Promise<FixOutcome>;
  review: (fixId: string, decision: 'approved' | 'rejected', patch?: ContentFixPatch) => Promise<FixOutcome>;
  remove: (fixId: string) => Promise<boolean>;
  patchAgainstOriginal: (entityId: string, edited: CompendiumEntity) => ContentFixPatch;
  exportFile: () => FixFile;
  importText: (text: string) => Promise<{ imported: number; skipped: string[] }>;
}

type Filter = 'all' | EffectiveFixState;

const STATE_LABEL: Record<EffectiveFixState, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  rejected: 'Rejected',
  'needs-re-review': 'Needs re-review',
};

function show(v: unknown): string {
  if (v === undefined || v === null) return '(none)';
  if (Array.isArray(v)) return v.join(' / ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The Fixes tab of the Packs dialog: every fix with its before/after, and the review buttons for the DM. */
export function ContentFixesReview({ api }: { api: ContentFixApi }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<ContentFix | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(api.entities.map((e) => [e.id, e])), [api.entities]);
  const isDm = api.role === 'dm';

  const rows = useMemo(
    () =>
      [...api.fixes]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((fix) => {
          const base = byId.get(fix.entityId);
          return {
            fix,
            base,
            state: fixState(fix, base),
            changes: base ? diffEntities(base, applyPatch(base, fix.patch)) : [],
          };
        }),
    [api.fixes, byId]
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.state] = (c[r.state] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = rows.filter((r) => filter === 'all' || r.state === filter);

  const editingBase = editing ? byId.get(editing.entityId) : undefined;
  if (editing && editingBase) {
    const base = editingBase;
    return (
      <ContentFixEditor
        entity={applyPatch(base, editing.patch)}
        title={`Edit fix: ${base.name}`}
        initialNote={editing.note}
        submitLabel="Save and approve"
        onSubmit={async (edited) => {
          const patch = api.patchAgainstOriginal(editing.entityId, edited);
          if (Object.keys(patch).length === 0) return 'The edit leaves the entry unchanged; reject the fix instead.';
          const r = await api.review(editing.id, 'approved', patch);
          if (!r.ok) return r.error;
          setEditing(null);
          return null;
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const act = async (p: Promise<FixOutcome | boolean>) => {
    const r = await p;
    if (typeof r === 'object' && !r.ok) setMessage(r.error);
    else setMessage(null);
  };

  return (
    <div className="forge-stack" data-testid="fixes-review">
      <div className="forge-row-between wrap gap-2">
        <div className="forge-muted">
          Corrections to compendium entries, kept next to the original data. {isDm ? 'Approve, reject or edit them here.' : 'The DM approves or rejects what you propose.'}
        </div>
        <div className="forge-row gap-2 wrap">
          <button type="button" className="btn text-sm" onClick={() => downloadJson('sidereroll-fixes.json', api.exportFile())} disabled={api.fixes.length === 0}>
            Export fixes
          </button>
          <button type="button" className="btn text-sm" onClick={() => fileRef.current?.click()}>
            Import fixes
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="fix-form__file"
            aria-label="Import fixes file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const res = await api.importText(await file.text());
              setMessage(
                `Imported ${res.imported} fix(es) as proposed${res.skipped.length > 0 ? `; skipped ${res.skipped.length}: ${res.skipped.slice(0, 3).join('; ')}` : ''}.`
              );
            }}
          />
        </div>
      </div>

      <div className="pill-row">
        {(['all', 'proposed', 'needs-re-review', 'approved', 'rejected'] as Filter[]).map((f) => (
          <button key={f} type="button" className={`pill ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? `All (${rows.length})` : `${STATE_LABEL[f]} (${counts[f] ?? 0})`}
          </button>
        ))}
      </div>
      {message && <div className="forge-muted text-sm" role="status">{message}</div>}
      {shown.length === 0 && <div className="forge-muted">No fixes here yet. Use "Report / fix" on a compendium entry.</div>}

      {shown.map(({ fix, base, state, changes }) => (
        <div key={fix.id} className="card forge-stack" data-testid="fix-card">
          <div className="forge-row-between wrap gap-2">
            <div>
              <strong>{base?.name ?? fix.entityId}</strong>{' '}
              <span className={`badge fix-state fix-state--${state}`}>{STATE_LABEL[state]}</span>
              <div className="forge-muted text-sm">
                {fix.author} · {fix.createdAt.slice(0, 10)}
                {base ? ` · ${base.source}` : ' · entry no longer in the compendium'}
              </div>
            </div>
            {isDm && base && (
              <div className="forge-row gap-2 wrap">
                {fix.status !== 'approved' || state === 'needs-re-review' ? (
                  <button type="button" className="btn btn-primary text-sm" onClick={() => void act(api.review(fix.id, 'approved'))}>
                    Approve
                  </button>
                ) : null}
                {fix.status !== 'rejected' && (
                  <button type="button" className="btn text-sm" onClick={() => void act(api.review(fix.id, 'rejected'))}>
                    Reject
                  </button>
                )}
                <button type="button" className="btn text-sm" onClick={() => setEditing(fix)}>
                  Edit, then approve
                </button>
              </div>
            )}
            {isDm && (
              <button type="button" className="btn text-sm" onClick={() => void act(api.remove(fix.id))} title="Delete the fix; the entry goes back to the original">
                {fix.status === 'approved' ? 'Revert to original' : 'Delete'}
              </button>
            )}
          </div>
          <div className="text-sm">Note: {fix.note || '(none)'}</div>
          {state === 'needs-re-review' && (
            <div className="fix-form__error text-sm">
              The original entry changed after this fix was made (for example a resync), so it is not applied. Check the changes below against the current entry, then approve it again or reject it.
            </div>
          )}
          {changes.length > 0 ? (
            <table className="fix-diff">
              <tbody>
                {changes.map((c) => (
                  <tr key={c.path}>
                    <th scope="row">{c.label}</th>
                    <td className="fix-diff__before">{show(c.before)}</td>
                    <td className="fix-diff__after">{show(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="forge-muted text-sm">No visible difference against the current entry.</div>
          )}
        </div>
      ))}
    </div>
  );
}
