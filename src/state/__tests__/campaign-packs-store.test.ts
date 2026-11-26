// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSheetStore } from '../useSheetStore';
import { SEED_CHARACTER, SEED_ENCOUNTER } from '../seed';
import { setupStore, useFreshDatabase, logTexts, type StoreHook } from './storeHarness';
import { db } from '../../storage/db';
import { setStoredGithubPat } from '../../engine/campaign-repo-sync';
import { createDefaultCampaign } from '../../engine/dm-tools';
import { stubVersionedGitHub, type VersionedHub } from '../../engine/__tests__/fakeVersionedGithub';
import type { CampaignRecord } from '../../types/campaign';

// Host + player: two store hooks joined by a fake BroadcastChannel (no real network, synthetic repos).
useFreshDatabase();

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);
const SHA_S = 'a'.repeat(40);
const SHA_M = 'b'.repeat(40);

/** Same-name channels deliver to each other (not to themselves), like the real thing. */
class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  static log: Array<{ channel: string; data: Record<string, unknown> }> = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    const set = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>();
    set.add(this);
    FakeBroadcastChannel.channels.set(name, set);
  }
  postMessage(data: unknown) {
    FakeBroadcastChannel.log.push({ channel: this.name, data: structuredClone(data) as Record<string, unknown> });
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) setTimeout(() => peer.onmessage?.({ data: structuredClone(data) }), 0);
    }
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}
type SentPacks = { packs: Array<{ owner: string; repo: string; sha: string }>; campaignId: string };
const sentPackMessages = () => FakeBroadcastChannel.log.filter((m) => m.data.type === 'campaign_packs').map((m) => m.data as unknown as SentPacks);

const manifest = (id: string, version: string) =>
  JSON.stringify({ format: 'dnd-forge-pack@1', id, name: `Pack ${id}`, version, license: 'CC-BY-4.0', content: ['items/*.json'] });
const items = (...names: string[]) => JSON.stringify(names.map((name) => ({ name, category: 'gear', entries: [`${name} text`] })));
const version = (id: string, v: string, ...names: string[]) => ({ 'pack.json': manifest(id, v), 'items/a.json': items(...names) });

let hub: VersionedHub;
beforeEach(() => {
  FakeBroadcastChannel.channels.clear();
  FakeBroadcastChannel.log = [];
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  hub = stubVersionedGitHub({
    'Someone/alpha': { head: SHA_1, versions: { [SHA_1]: version('alpha', '1.0.0', 'Alpha Lamp', 'Alpha Rope'), [SHA_2]: version('alpha', '1.1.0', 'Alpha Lamp', 'Alpha Torch') } },
    'Someone/secret': { head: SHA_S, private: true, versions: { [SHA_S]: version('secret', '1.0.0', 'Secret Key') } },
    'Someone/mine': { head: SHA_M, versions: { [SHA_M]: version('mine', '0.1.0', 'Mine Pebble') } },
  });
});
afterEach(() => {
  setStoredGithubPat('');
  vi.unstubAllGlobals();
});

async function secondStore(): Promise<StoreHook> {
  const hook = renderHook(() => useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER));
  const size = await db.compendium.count();
  await waitFor(() => expect(hook.result.current.compendium.length).toBe(size), { timeout: 20_000 });
  return hook;
}
async function table(room = 'TEST') {
  const host = await setupStore();
  const player = await secondStore();
  await act(async () => {
    host.result.current.hostLocalTable(room);
  });
  return { host, player, join: () => act(async () => void player.result.current.joinLocalTable(room)) };
}
const entities = (h: StoreHook, packId: string) => h.result.current.compendium.filter((e) => e.packId === packId);
const link = (h: StoreHook, repo: string) => act(async () => void (await h.result.current.linkCampaignPack({ owner: 'Someone', repo })));

describe('campaign packs sync (host + player at a Live Table)', () => {
  it('a pack the DM links reaches a joining player at the pinned sha, without a preview dialog', async () => {
    const { host, player, join } = await table();
    await link(host, 'alpha');
    expect(host.result.current.campaign.packs).toEqual([{ owner: 'Someone', repo: 'alpha', ref: 'main', sha: SHA_1, enabled: true }]);
    expect(player.result.current.packs).toHaveLength(0);

    await join();
    await waitFor(() => expect(player.result.current.packs.map((p) => p.id)).toEqual(['alpha']), { timeout: 10_000 });
    expect(player.result.current.pendingImport).toBeNull();
    expect(player.result.current.packs[0]).toMatchObject({ sha: SHA_1, version: '1.0.0', managedByCampaign: true });
    expect(entities(player, 'alpha').map((e) => e.id).sort()).toEqual(['alpha:alpha-lamp', 'alpha:alpha-rope']);
    expect(entities(player, 'alpha').every((e) => e.packRef === SHA_1)).toBe(true);
    expect(player.result.current.toasts.map((t) => t.text)).toContain('Synced 1 pack: Pack alpha v1.0.0');
    expect(player.result.current.tablePackSync?.results).toEqual([expect.objectContaining({ sha: SHA_1, name: 'Pack alpha', version: '1.0.0' })]);
    expect(hub.urls.some((u) => u.includes(`/${SHA_1}/pack.json`))).toBe(true);
    expect(host.result.current.packs).toHaveLength(0);
  });

  it('the DM updating the pin updates the player; a disabled pack is not sent', async () => {
    const { host, player, join } = await table();
    await link(host, 'alpha');
    await join();
    await waitFor(() => expect(player.result.current.packs[0]?.sha).toBe(SHA_1), { timeout: 10_000 });

    hub.repos['Someone/alpha']!.head = SHA_2;
    let note = '';
    await act(async () => {
      const r = await host.result.current.updateCampaignPack('someone/alpha');
      expect(r.ok).toBe(true);
      if (r.ok) note = r.note ?? '';
    });
    expect(note).toContain('2222222');
    expect(host.result.current.campaign.packs[0]?.sha).toBe(SHA_2);

    await waitFor(() => expect(player.result.current.packs[0]?.sha).toBe(SHA_2), { timeout: 10_000 });
    expect(player.result.current.packs[0]).toMatchObject({ version: '1.1.0', managedByCampaign: true });
    expect(entities(player, 'alpha').map((e) => e.id).sort()).toEqual(['alpha:alpha-lamp', 'alpha:alpha-torch']);
    expect(player.result.current.toasts.map((t) => t.text)).toContain('Synced 1 pack: Pack alpha v1.1.0');

    const before = sentPackMessages().length;
    await act(async () => host.result.current.setCampaignPackOn('someone/alpha', false));
    await waitFor(() => expect(sentPackMessages().length).toBeGreaterThan(before));
    expect(sentPackMessages().at(-1)?.packs).toEqual([]);
  });

  it('a private repo without access is reported per pack ("needs access"), and Retry works once a token is set', async () => {
    setStoredGithubPat('dm-token');
    const { host, player, join } = await table();
    await link(host, 'secret');
    expect(host.result.current.campaign.packs[0]?.sha).toBe(SHA_S);
    setStoredGithubPat('');

    await join();
    await waitFor(() => expect(player.result.current.tablePackSync?.results[0]?.status).toBe('needs-access'), { timeout: 10_000 });
    const msg = 'Pack Someone/secret needs access — ask the DM or add a GitHub token in Settings';
    expect(player.result.current.toasts.map((t) => t.text)).toContain(msg);
    expect(logTexts(player).some((t) => t.includes(msg))).toBe(true);
    expect(player.result.current.packs).toHaveLength(0);

    setStoredGithubPat('player-token');
    await act(async () => player.result.current.retryTablePackSync());
    await waitFor(() => expect(player.result.current.packs.map((p) => p.id)).toEqual(['secret']), { timeout: 10_000 });
    expect(player.result.current.tablePackSync?.results[0]?.status).toBe('synced');
  });

  it('a network error is reported (not "needs access") and Retry installs once the connection is back', async () => {
    const { host, player, join } = await table();
    await link(host, 'alpha');
    hub.down = true;
    await join();
    await waitFor(() => expect(player.result.current.tablePackSync?.results[0]?.status).toBe('network'), { timeout: 10_000 });
    expect(player.result.current.toasts.some((t) => t.text.includes('Could not reach GitHub for pack Someone/alpha'))).toBe(true);
    expect(player.result.current.packs).toHaveLength(0);
    hub.down = false;
    await act(async () => player.result.current.retryTablePackSync());
    await waitFor(() => expect(player.result.current.packs.map((p) => p.id)).toEqual(['alpha']), { timeout: 10_000 });
  });

  it("a player's own pack is never sent to the table and is left alone by the sync", async () => {
    const { host, player, join } = await table();
    await act(async () => void (await player.result.current.installPack({ owner: 'Someone', repo: 'mine' })));
    await act(async () => player.result.current.confirmPendingImport());
    expect(player.result.current.packs.map((p) => p.id)).toEqual(['mine']);
    expect(player.result.current.packs[0]?.managedByCampaign).toBeUndefined();

    await link(host, 'alpha');
    await join();
    await waitFor(() => expect(player.result.current.packs.map((p) => p.id).sort()).toEqual(['alpha', 'mine']), { timeout: 10_000 });
    const mine = player.result.current.packs.find((p) => p.id === 'mine');
    expect(mine).toMatchObject({ sha: SHA_M });
    expect(mine?.managedByCampaign).toBeUndefined();
    expect(entities(player, 'mine')).toHaveLength(1);
    const sent = sentPackMessages();
    expect(sent.length).toBeGreaterThan(0);
    for (const m of sent) expect(m.packs.map((p) => p.repo)).not.toContain('mine');
    expect(host.result.current.campaign.packs.map((p) => p.repo)).toEqual(['alpha']);
  });
});

describe('campaign packs: migration of the old single repo link', () => {
  const withoutPacks = (c: CampaignRecord): Partial<CampaignRecord> => {
    const { packs: _gone, ...rest } = c;
    return rest;
  };

  it('an older campaign with only externalRepo gets packs[0] on load, and keeps externalRepo', async () => {
    const old = { ...withoutPacks(createDefaultCampaign('camp-old', 'Old Campaign')), externalRepo: { owner: 'Someone', repo: 'old-camp', branch: 'dev', packPath: 'campaign-pack.json' } };
    await db.campaigns.put(old as CampaignRecord);
    const h = await setupStore();
    const want = [{ owner: 'Someone', repo: 'old-camp', ref: 'dev', sha: '', enabled: true }];
    expect(h.result.current.campaign.id).toBe('camp-old');
    expect(h.result.current.campaign.packs).toEqual(want);
    expect(h.result.current.campaign.externalRepo?.repo).toBe('old-camp');
    expect((await db.campaigns.get('camp-old'))?.packs).toEqual(want);
  });

  it('an old backup (campaign without packs) is migrated when it is merged in', async () => {
    const h = await setupStore();
    const oldCampaign = { ...withoutPacks(createDefaultCampaign('camp-bk', 'Backup Campaign')), externalRepo: { owner: 'Someone', repo: 'bk-camp' } };
    const bundle = { app: 'dnd-forge', schemaVersion: 6, exportedAt: '2026-01-01T00:00:00Z', characters: [], compendium: [], encounters: [], campaigns: [oldCampaign], scenes: [], dupDecisions: [], contentFixes: [], packs: [] };
    await act(async () => {
      await h.result.current.importJsonFilePayload(JSON.stringify(bundle));
    });
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    const migrated = h.result.current.campaignList.find((c) => c.id === 'camp-bk');
    expect(migrated?.packs).toEqual([{ owner: 'Someone', repo: 'bk-camp', ref: 'main', sha: '', enabled: true }]);
  });
});
