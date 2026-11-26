// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { setupStore, useFreshDatabase, logTexts, type StoreHook } from './storeHarness';
import { db } from '../../storage/db';
import { stubGitHub, type FakeRepo } from '../../engine/__tests__/fakeGithub';

// Packs as first-class (install / update / uninstall) with synthetic repos and a mocked GitHub.
useFreshDatabase();
afterEach(() => vi.unstubAllGlobals());

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);

const manifest = (id: string, version: string) =>
  JSON.stringify({
    format: 'dnd-forge-pack@1',
    id,
    name: `Pack ${id}`,
    version,
    license: 'CC-BY-4.0',
    content: ['items/*.json'],
  });

const items = (...names: string[]) => JSON.stringify(names.map((name) => ({ name, category: 'gear', entries: [`${name} text`] })));

async function stage(_h: StoreHook, run: () => Promise<{ ok: boolean }>) {
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
const install = async (h: StoreHook, owner: string, repo: string) => {
  await stage(h, () => h.result.current.installPack({ owner, repo }));
  await confirm(h);
};
const packEntities = (h: StoreHook, packId: string) => h.result.current.compendium.filter((e) => e.packId === packId);

describe('packs (store level)', () => {
  it('install stages a preview, then writes entities with provenance and records the pack', async () => {
    const h = await setupStore();
    const before = h.result.current.compendium.length;
    stubGitHub({ 'Someone/alpha': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Alpha Lamp', 'Alpha Rope') } } });

    await stage(h, () => h.result.current.installPack({ owner: 'Someone', repo: 'alpha' }));
    // nothing is written before the preview is confirmed
    expect(h.result.current.compendium.length).toBe(before);
    expect(h.result.current.packs).toHaveLength(0);
    expect(h.result.current.pendingImport?.plan.newItems).toHaveLength(2);
    await confirm(h);

    const mine = packEntities(h, 'alpha');
    expect(mine.map((e) => e.id).sort()).toEqual(['alpha:alpha-lamp', 'alpha:alpha-rope']);
    expect(mine.every((e) => e.packVersion === '1.0.0' && e.packRef === SHA_1)).toBe(true);
    expect((await db.compendium.where('packId').equals('alpha').count())).toBe(2);
    const record = await db.packs.get('alpha');
    expect(record).toMatchObject({ name: 'Pack alpha', version: '1.0.0', repo: 'Someone/alpha', sha: SHA_1, license: 'CC-BY-4.0', entityCount: 2 });
    expect(h.result.current.packs.map((p) => p.id)).toEqual(['alpha']);
    // an installed pack is the "Mine" tier, so it shows up in search
    expect(h.result.current.searchCompendium('alpha lamp')).toHaveLength(1);
  });

  it('update replaces changed entities, removes deleted ones, and the preview does not call its own copies duplicates', async () => {
    const h = await setupStore();
    const repos: Record<string, FakeRepo> = {
      'Someone/alpha': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Alpha Lamp', 'Alpha Rope', 'Alpha Gone') } },
    };
    stubGitHub(repos);
    await install(h, 'Someone', 'alpha');
    expect(packEntities(h, 'alpha')).toHaveLength(3);

    // the repo moves on: Lamp text changed, Gone deleted, Fresh added
    repos['Someone/alpha'] = {
      sha: SHA_2,
      files: {
        'pack.json': manifest('alpha', '1.1.0'),
        'items/a.json': JSON.stringify([
          { name: 'Alpha Lamp', category: 'gear', entries: ['Alpha Lamp CHANGED'] },
          { name: 'Alpha Rope', category: 'gear', entries: ['Alpha Rope text'] },
          { name: 'Alpha Fresh', category: 'gear', entries: ['new'] },
        ]),
      },
    };
    let status = '';
    await act(async () => {
      status = await h.result.current.checkPackUpdate('alpha');
    });
    expect(status).toBe('available');

    await stage(h, () => h.result.current.updatePack('alpha'));
    const pending = h.result.current.pendingImport!;
    expect(pending.label).toContain('1 new, 1 changed, 1 removed');
    expect(pending.plan.exact).toHaveLength(0);
    await confirm(h);

    const after = packEntities(h, 'alpha');
    expect(after.map((e) => e.name).sort()).toEqual(['Alpha Fresh', 'Alpha Lamp', 'Alpha Rope']);
    expect(after.find((e) => e.name === 'Alpha Lamp')!.entries).toEqual(['Alpha Lamp CHANGED']);
    expect(after.every((e) => e.packVersion === '1.1.0' && e.packRef === SHA_2)).toBe(true);
    expect(await db.compendium.get('alpha:alpha-gone')).toBeUndefined();
    expect((await db.packs.get('alpha'))!.sha).toBe(SHA_2);
    expect(h.result.current.packs).toHaveLength(1);

    await act(async () => {
      status = await h.result.current.checkPackUpdate('alpha');
    });
    expect(status).toBe('current');
  });

  it('uninstall removes exactly that pack and keeps its fixes / duplicate decisions, marked orphaned', async () => {
    const h = await setupStore();
    stubGitHub({
      'Someone/alpha': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Alpha Lamp') } },
      'Someone/beta': { sha: SHA_1, files: { 'pack.json': manifest('beta', '2.0.0'), 'items/b.json': items('Beta Lamp') } },
    });
    await install(h, 'Someone', 'alpha');
    await install(h, 'Someone', 'beta');
    const total = h.result.current.compendium.length;
    const lamp = packEntities(h, 'alpha')[0]!;

    await act(async () => {
      const r = await h.result.current.proposeContentFix(lamp.id, { ...lamp, entries: ['A better lamp text'] }, 'typo', 'player');
      expect(r.ok).toBe(true);
    });
    expect(h.result.current.contentFixes).toHaveLength(1);
    await db.dupDecisions.put({ id: 'dup-1', memberIds: [lamp.id, 'beta:beta-lamp'], action: 'keep-both', decidedAt: 'now' });

    await act(async () => {
      const r = await h.result.current.uninstallPack('alpha');
      expect(r.ok).toBe(true);
    });

    expect(h.result.current.compendium.length).toBe(total - 1);
    expect(packEntities(h, 'alpha')).toHaveLength(0);
    expect(packEntities(h, 'beta')).toHaveLength(1); // the other pack is untouched
    expect(await db.compendium.get(lamp.id)).toBeUndefined();
    expect(await db.compendium.get('beta:beta-lamp')).toBeDefined();
    expect(await db.packs.get('alpha')).toBeUndefined();
    expect(h.result.current.packs.map((p) => p.id)).toEqual(['beta']);
    // fixes and decisions are kept, flagged
    const fixes = await db.contentFixes.toArray();
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.orphaned).toBe(true);
    expect((await db.dupDecisions.get('dup-1'))!.orphaned).toBe(true);
    expect(h.result.current.contentFixes[0]!.orphaned).toBe(true);
    expect(logTexts(h).some((t) => t.includes('Uninstalled pack "Pack alpha"'))).toBe(true);

    // reinstalling brings the entry back and clears the flags
    await install(h, 'Someone', 'alpha');
    expect((await db.contentFixes.toArray())[0]!.orphaned).toBeUndefined();
    expect((await db.dupDecisions.get('dup-1'))!.orphaned).toBeUndefined();
  });

  it('two packs with the same entry name both install without overwriting each other', async () => {
    const h = await setupStore();
    stubGitHub({
      'Someone/alpha': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Shared Lantern') } },
      'Someone/beta': { sha: SHA_1, files: { 'pack.json': manifest('beta', '1.0.0'), 'items/b.json': items('Shared Lantern') } },
    });
    await install(h, 'Someone', 'alpha');
    await install(h, 'Someone', 'beta');
    expect(await db.compendium.get('alpha:shared-lantern')).toBeDefined();
    expect(await db.compendium.get('beta:shared-lantern')).toBeDefined();
    await act(async () => {
      await h.result.current.uninstallPack('alpha');
    });
    expect(await db.compendium.get('beta:shared-lantern')).toBeDefined();
  });

  it('refuses a pack whose id is already installed from another repo, and reports a bad pack.json', async () => {
    const h = await setupStore();
    stubGitHub({
      'Someone/alpha': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '1.0.0'), 'items/a.json': items('Alpha Lamp') } },
      'Other/alpha-fork': { sha: SHA_1, files: { 'pack.json': manifest('alpha', '9.9.9'), 'items/a.json': items('Fork Lamp') } },
      'Someone/bad': { sha: SHA_1, files: { 'pack.json': JSON.stringify({ format: 'dnd-forge-pack@1', id: 'bad' }) } },
    });
    await install(h, 'Someone', 'alpha');
    let res: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      res = await h.result.current.installPack({ owner: 'Other', repo: 'alpha-fork' });
    });
    expect(res).toMatchObject({ ok: false });
    expect(res?.error).toContain('already installed from Someone/alpha');
    expect(h.result.current.pendingImport).toBeNull();
    await act(async () => {
      res = await h.result.current.installPack({ owner: 'Someone', repo: 'bad' });
    });
    expect(res?.ok).toBe(false);
    expect(res?.error).toContain('"name" is required');
    await act(async () => {
      res = await h.result.current.installPack({ owner: '', repo: '' });
    });
    expect(res?.ok).toBe(false);
  });

  it('the campaign repo sync still works and now installs the repo as a pack', async () => {
    const h = await setupStore();
    stubGitHub({
      'Someone/old-campaign': {
        sha: SHA_1,
        files: {
          'campaign-pack.json': JSON.stringify({ name: 'Old Campaign', entities: [{ path: 'items/rope.json', category: 'gear' }] }),
          'items/rope.json': JSON.stringify([{ name: 'Old Rope' }]),
        },
      },
    });
    await act(async () => {
      await h.result.current.syncCampaignExternalRepo({ owner: 'Someone', repo: 'old-campaign' });
    });
    await confirm(h);
    expect(packEntities(h, 'old-campaign').map((e) => e.name)).toEqual(['Old Rope']);
    expect(h.result.current.packs.map((p) => p.id)).toContain('old-campaign');
    expect(h.result.current.campaign.externalRepo?.repo).toBe('old-campaign');
    expect(logTexts(h).some((t) => t.includes('Synced Someone/old-campaign: 1 entities'))).toBe(true);
  });
});
