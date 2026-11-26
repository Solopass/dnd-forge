// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { setupStore, useFreshDatabase, logTexts, type StoreHook } from './storeHarness';
import { db } from '../../storage/db';
import { stubGitHub, type FakeRepo } from '../../engine/__tests__/fakeGithub';

// P2 leftovers from the packs work: unreadable files are "kept" (never "removed") and legacy repo-synced
// entries are adopted into the pack instead of leaving duplicates. Synthetic repos behind a mocked GitHub.
useFreshDatabase();
afterEach(() => vi.unstubAllGlobals());

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);
const KEPT = 'unreadable — kept';

const manifest = (id: string, version: string, content: string[] = ['items/*.json']) =>
  JSON.stringify({ format: 'dnd-forge-pack@1', id, name: `Pack ${id}`, version, license: 'CC-BY-4.0', content });
const items = (...names: string[]) => JSON.stringify(names.map((name) => ({ name, category: 'gear', entries: [`${name} text`] })));

async function stage(run: () => Promise<{ ok: boolean }>) {
  let res: { ok: boolean } | undefined;
  await act(async () => {
    res = await run();
  });
  expect(res?.ok).toBe(true);
}
async function confirm(h: StoreHook) {
  expect(h.result.current.pendingImport).not.toBeNull();
  await act(async () => {
    await h.result.current.confirmPendingImport();
  });
  expect(h.result.current.pendingImport).toBeNull();
}
const packEntities = (h: StoreHook, packId: string) => h.result.current.compendium.filter((e) => e.packId === packId);

describe('packs: unreadable files are kept, not removed', () => {
  it('a file that stops parsing keeps its entries; entries deleted from readable files are still removed', async () => {
    const h = await setupStore();
    const repos: Record<string, FakeRepo> = {
      'Someone/alpha': {
        sha: SHA_1,
        files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Alpha Lamp', 'Alpha Gone'), 'items/b.json': items('Beta Rope', 'Beta Chain') },
      },
    };
    stubGitHub(repos);
    await stage(() => h.result.current.installPack({ owner: 'Someone', repo: 'alpha' }));
    await confirm(h);
    expect(packEntities(h, 'alpha')).toHaveLength(4);
    expect(packEntities(h, 'alpha').every((e) => e.packFile !== undefined)).toBe(true);

    // b.json is half-saved, and Alpha Gone is deleted from the readable a.json
    repos['Someone/alpha'] = {
      sha: SHA_2,
      files: { 'pack.json': manifest('alpha', '1.1.0'), 'items/a.json': items('Alpha Lamp'), 'items/b.json': '[{"name": "Beta Ro' },
    };
    await stage(() => h.result.current.updatePack('alpha'));
    const pending = h.result.current.pendingImport!;
    expect(pending.label).toContain('1 removed');
    expect(pending.label).toContain(`2 ${KEPT}`);
    expect(pending.report?.keptEntries).toBe(2);
    expect(pending.report?.unreadable).toEqual(['items/b.json']);
    await confirm(h);

    expect(packEntities(h, 'alpha').map((e) => e.name).sort()).toEqual(['Alpha Lamp', 'Beta Chain', 'Beta Rope']);
    expect(await db.compendium.get('alpha:beta-rope')).toBeDefined();
    expect(await db.compendium.get('alpha:alpha-gone')).toBeUndefined();
    expect(logTexts(h).some((t) => t.includes(`2 ${KEPT}`))).toBe(true);

    // the file comes back readable: nothing is "kept" any more, and a real removal inside it is honoured
    repos['Someone/alpha'] = {
      sha: SHA_2,
      files: { 'pack.json': manifest('alpha', '1.2.0'), 'items/a.json': items('Alpha Lamp'), 'items/b.json': items('Beta Rope') },
    };
    await stage(() => h.result.current.updatePack('alpha'));
    expect(h.result.current.pendingImport?.report?.keptEntries).toBeUndefined();
    await confirm(h);
    expect(packEntities(h, 'alpha').map((e) => e.name).sort()).toEqual(['Alpha Lamp', 'Beta Rope']);
  });

  it('an explicitly listed file that disappeared is unreadable too', async () => {
    const h = await setupStore();
    const repos: Record<string, FakeRepo> = {
      'Someone/alpha': {
        sha: SHA_1,
        files: { 'pack.json': manifest('alpha', '1.0.0', ['items/a.json', 'items/b.json']), 'items/a.json': items('Alpha Lamp'), 'items/b.json': items('Beta Rope') },
      },
    };
    stubGitHub(repos);
    await stage(() => h.result.current.installPack({ owner: 'Someone', repo: 'alpha' }));
    await confirm(h);
    delete repos['Someone/alpha']!.files['items/b.json'];
    repos['Someone/alpha']!.sha = SHA_2;
    await stage(() => h.result.current.updatePack('alpha'));
    expect(h.result.current.pendingImport?.report?.unreadable).toEqual(['items/b.json']);
    await confirm(h);
    expect(packEntities(h, 'alpha').map((e) => e.name).sort()).toEqual(['Alpha Lamp', 'Beta Rope']);
  });
});

describe('packs: adopting legacy repo-synced entries', () => {
  it('custom-* entries with no provenance join the pack: one copy, and fixes / decisions / sheet items follow', async () => {
    const h = await setupStore();
    const legacy = { id: 'custom-gear-alpha-lamp', name: 'Alpha Lamp', source: 'Custom Repo', ruleset: '2014' as const, category: 'gear' as const, activities: [], entries: ['old copy'] };
    await act(async () => {
      await h.result.current.createHomebrewEntity(legacy, false);
    });
    // a hand-made entry with another source must not be swallowed, even if the pack has the same name
    await act(async () => {
      await h.result.current.createHomebrewEntity({ ...legacy, id: 'custom-gear-alpha-rope-mine', name: 'Alpha Rope', source: 'My Table', entries: ['mine'] }, false);
    });
    // things that point at the legacy copy: a content fix, a duplicate decision, a copy on the character sheet
    await act(async () => {
      const r = await h.result.current.proposeContentFix(legacy.id, { ...legacy, entries: ['fixed text'] }, 'typo', 'player');
      expect(r.ok).toBe(true);
    });
    await db.dupDecisions.put({ id: 'dup-legacy', memberIds: [legacy.id, 'srd-something'], action: 'keep-one', keepId: legacy.id, decidedAt: 'now' });
    await act(async () => {
      h.result.current.addCompendiumItemToSheet(h.result.current.compendium.find((e) => e.id === legacy.id)!);
    });
    const sheetBefore = h.result.current.rawChar.items.find((i) => i.id.startsWith(`${legacy.id}-`));
    expect(sheetBefore).toBeDefined();

    stubGitHub({ 'Someone/alpha': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Alpha Lamp', 'Alpha Rope') } } });
    await stage(() => h.result.current.installPack({ owner: 'Someone', repo: 'alpha' }));
    const pending = h.result.current.pendingImport!;
    expect(pending.report?.adopted).toBe(1);
    expect(pending.label).toContain('1 existing adopted');
    expect(pending.plan.exact.map((x) => x.incoming.name)).not.toContain('Alpha Lamp'); // not a "duplicate" of its own old copy
    await confirm(h);

    const lamps = h.result.current.compendium.filter((e) => e.name === 'Alpha Lamp');
    expect(lamps.map((e) => e.id)).toEqual(['alpha:alpha-lamp']);
    expect(lamps[0]).toMatchObject({ packId: 'alpha', packVersion: '1.0.0' });
    expect(await db.compendium.get(legacy.id)).toBeUndefined();
    expect(await db.compendium.get('custom-gear-alpha-rope-mine')).toBeDefined();
    expect(await db.compendium.get('alpha:alpha-rope')).toBeDefined();

    const fixes = await db.contentFixes.toArray();
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ entityId: 'alpha:alpha-lamp' });
    expect(fixes[0]!.orphaned).toBeUndefined();
    const decision = await db.dupDecisions.get('dup-legacy');
    expect(decision?.memberIds).toEqual(['alpha:alpha-lamp', 'srd-something']);
    expect(decision?.keepId).toBe('alpha:alpha-lamp');
    const sheetAfter = h.result.current.rawChar.items.find((i) => i.name === 'Alpha Lamp');
    expect(sheetAfter?.id).toBe(`alpha:alpha-lamp${sheetBefore!.id.slice(legacy.id.length)}`);
    expect((await db.characters.get(h.result.current.rawChar.id))?.items.some((i) => i.id.startsWith('alpha:alpha-lamp-'))).toBe(true);
    expect(logTexts(h).some((t) => t.includes('Adopted 1 existing entries into Pack alpha'))).toBe(true);
  });
});

describe('every entry point goes through the pipeline', () => {
  it('a CSV file shows repaired / rejected counts with reasons in the preview, and Import writes the repaired entities', async () => {
    const h = await setupStore();
    const before = h.result.current.compendium.length;
    const csv = 'Name,Level,School,Classes\nPipeline Glow,cantrip,Evocation,Wizard\nPipeline Doom,12,Necromancy,Wizard\nPipeline Ward,2,Abjuration,Cleric\n';
    await act(async () => {
      await h.result.current.importJsonFilePayload(csv, 'spells.csv');
    });
    const pending = h.result.current.pendingImport!;
    expect(pending.label).toBe('CSV table');
    expect(pending.report?.accepted).toBe(2);
    expect(pending.report?.repaired.map((r) => r.name)).toEqual(['Pipeline Glow']);
    expect(pending.report?.rejected).toEqual([expect.objectContaining({ reason: expect.stringContaining('spell level') })]);
    expect(h.result.current.compendium.length).toBe(before); // nothing written before Import
    await confirm(h);
    expect(h.result.current.compendium.filter((e) => e.name.startsWith('Pipeline ')).map((e) => [e.name, e.spellLevel])).toEqual(
      expect.arrayContaining([['Pipeline Glow', 0], ['Pipeline Ward', 2]])
    );
    expect(h.result.current.compendium.some((e) => e.name === 'Pipeline Doom')).toBe(false);
  });

  it('pasted odd-but-recognizable JSON is repaired on the way in (CR written as a fraction)', async () => {
    const h = await setupStore();
    await act(async () => {
      await h.result.current.importMarkdownHomebrew(JSON.stringify([{ name: 'Pasted Rat', category: 'monster', monsterMeta: { ac: '12', hp: 5, dexModifier: 2, cr: 0.25 } }]));
    });
    expect(h.result.current.pendingImport?.report?.repaired[0]?.notes.join(' ')).toContain('written as "1/4"');
    await confirm(h);
    expect(h.result.current.compendium.find((e) => e.name === 'Pasted Rat')?.monsterMeta?.cr).toBe('1/4');
  });

  it('hand-made content is cleaned too (bad dice are dropped with a note, not stored)', async () => {
    const h = await setupStore();
    await act(async () => {
      await h.result.current.createHomebrewEntity(
        { id: 'hb-odd', name: 'Odd Blade', source: 'Homebrew', ruleset: 'homebrew', category: 'weapon', entries: ['x'], activities: [{ id: 'a', name: 'Hit', type: 'attack', actionEconomy: 'action', damageFormula: 'lots' }] },
        false
      );
    });
    const stored = h.result.current.compendium.find((e) => e.id === 'hb-odd');
    expect(stored?.activities[0]?.damageFormula).toBeUndefined();
    expect(logTexts(h).some((t) => t.includes('Created homebrew "Odd Blade"') && t.includes('repaired'))).toBe(true);
  });

  it('the built-in packs install through it (counts in the log) with nothing rejected', async () => {
    const h = await setupStore();
    await act(async () => {
      await h.result.current.installContentPack('pack-srd-monsters');
    });
    expect(logTexts(h).some((t) => /Installed ".*" \(\d+ entries added to local Compendium; \d+ accepted, 0 rejected\)/.test(t))).toBe(true);
  });
});
