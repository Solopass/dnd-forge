// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useSheetStore } from '../useSheetStore';
import { SEED_CHARACTER, SEED_ENCOUNTER } from '../seed';
import { createElement } from 'react';
import { setupStore, useFreshDatabase, logTexts } from './storeHarness';
import { db } from '../../storage/db';
import { findNearDuplicates } from '../../engine/compendium-dedupe';
import { DuplicatesReview } from '../../components/DuplicatesReview';
import type { CompendiumEntity } from '../../types/compendium';

useFreshDatabase();

const spell = (id: string, name: string, source: string, extra: Partial<CompendiumEntity> = {}): CompendiumEntity => ({
  id,
  name,
  source,
  ruleset: '2014',
  category: 'spell',
  spellLevel: 2,
  activities: [],
  entries: ['Synthetic test text.'],
  ...extra,
});

async function importEntities(h: Awaited<ReturnType<typeof setupStore>>, entities: CompendiumEntity[]) {
  await act(async () => {
    await h.result.current.importJsonFilePayload(JSON.stringify(entities));
  });
  return h.result.current.pendingImport;
}

describe('import preview + duplicates review (store level)', () => {
  it('previews first, writes only on Import, and Cancel writes nothing', async () => {
    const h = await setupStore();
    const before = h.result.current.compendium.length;
    const pending = await importEntities(h, [
      spell('t-1', 'Synthetic Spark', 'Test Book'),
      spell('t-2', 'Synthetic Spark', 'Test Book Copy'), // exact duplicate inside the same import
      spell('t-3', "Melf's Acid Arrow", 'Test Book'), // near duplicate of the SRD arrow (level 2)
    ]);
    expect(pending?.plan.newItems.map((e) => e.id)).toEqual(['t-1']);
    expect(pending?.plan.exact).toHaveLength(1);
    expect(pending?.plan.near.map((n) => n.incoming.id)).toEqual(['t-3']);
    expect(pending?.plan.summary).toMatch(/^\d+ new, 1 exact duplicate \(will fold into Test Book[^)]*\), \d+ possible duplicates? \(review\)$/);
    expect(h.result.current.compendium.length).toBe(before);
    act(() => h.result.current.cancelPendingImport());
    expect(h.result.current.pendingImport).toBeNull();
    expect(h.result.current.compendium.length).toBe(before);
    expect(await db.compendium.get('t-1')).toBeUndefined();

    await importEntities(h, [spell('t-1', 'Synthetic Spark', 'Test Book')]);
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    expect(await db.compendium.get('t-1')).toBeDefined();
    expect(logTexts(h).some((t) => t.startsWith('Imported 1 custom entity'))).toBe(true);
  });

  it('a Mine copy of an SRD spell folds the SRD one (search shows the Mine copy with "also in")', async () => {
    const h = await setupStore();
    await importEntities(h, [spell('mine-fb', 'Fireball', 'My Campaign', { spellLevel: 3 })]);
    expect(h.result.current.pendingImport?.plan.exact).toHaveLength(1);
    expect(h.result.current.pendingImport?.plan.foldTargets).toEqual(['My Campaign']);
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    const hits = h.result.current.searchCompendium('fireball').filter((e) => e.category === 'spell' && e.ruleset === '2014' && e.name === 'Fireball');
    expect(hits.map((e) => e.id)).toEqual(['mine-fb']);
    expect(hits[0]!.alsoIn).toContain('SRD 5.1');
  });

  it('a decision persists in Dexie, survives a remount, and Undo brings the group back', async () => {
    const h = await setupStore();
    await act(async () => {
      await h.result.current.importJsonFilePayload(
        JSON.stringify([spell('t-a', "Tasha's Synthetic Burst", 'Test Book'), spell('t-b', 'Synthetic Burst', 'Other Book')])
      );
    });
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    const groups = findNearDuplicates(h.result.current.compendium, h.result.current.sourcePriority);
    const group = groups.find((g) => g.members.some((m) => m.id === 't-a'));
    expect(group?.members).toHaveLength(2);
    await act(async () => {
      await h.result.current.resolveDuplicateGroup(group!, 'keep-one', 't-b');
    });
    expect(await db.dupDecisions.count()).toBe(1);
    const names = (q: string) => h.result.current.searchCompendium(q).map((e) => e.id);
    expect(names('synthetic burst')).toEqual(['t-b']);

    // remount: decisions load again from Dexie
    cleanup();
    const again = renderHook(() => useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER));
    await waitFor(() => expect(again.result.current.dupDecisions.map((d) => d.id)).toEqual([group!.id]), { timeout: 20_000 });
    await waitFor(() => expect(again.result.current.compendium.some((e) => e.id === 't-a')).toBe(true), { timeout: 20_000 });

    await act(async () => {
      await again.result.current.undoDuplicateDecision(group!.id);
    });
    expect(await db.dupDecisions.count()).toBe(0);
    expect(again.result.current.searchCompendium('synthetic burst').map((e) => e.id).sort()).toEqual(['t-a', 't-b']);
  });
});

describe('DuplicatesReview component', () => {
  it('lists a group, resolves it, hides it, and Show resolved reveals it for undo', () => {
    const entities = [spell('a', "Melf's Acid Arrow", 'SRD 5.1'), spell('b', 'Acid Arrow', 'My Book')];
    const calls: string[] = [];
    const decisions: Array<{ id: string; memberIds: string[]; action: 'keep-both'; decidedAt: string }> = [];
    const view = (d: typeof decisions) =>
      createElement(DuplicatesReview, {
        entities,
        priority: ['mine', 'srd2024', 'srd2014', 'free5e'],
        decisions: d,
        onResolve: (g, action, keep) => void calls.push(`${action}:${keep ?? ''}:${g.members.length}`),
        onUndo: (id) => void calls.push(`undo:${id}`),
      });
    const { rerender } = render(view(decisions));
    expect(screen.getAllByTestId('dup-group')).toHaveLength(1);
    fireEvent.click(screen.getByText('Keep one (selected)'));
    expect(calls).toEqual(['keep-one:b:2']); // the highest-priority member (Mine) is pre-selected
    rerender(view([{ id: 'a|b', memberIds: ['a', 'b'], action: 'keep-both', decidedAt: 'x' }]));
    expect(screen.queryAllByTestId('dup-group')).toHaveLength(0);
    fireEvent.click(screen.getByText('Show resolved'));
    fireEvent.click(screen.getByText('Undo'));
    expect(calls[1]).toBe('undo:a|b');
  });
});
