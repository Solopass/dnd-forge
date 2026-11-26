// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useSheetStore } from '../useSheetStore';
import { SEED_CHARACTER, SEED_ENCOUNTER } from '../seed';
import { setupStore, useFreshDatabase, type StoreHook } from './storeHarness';
import { db, buildSearchTokens } from '../../storage/db';
import { fixState } from '../../engine/content-fixes';
import type { ResolvedActivity } from '../../types/character';
import type { CompendiumEntity } from '../../types/compendium';

// Feature test for "flag it, fix it, review it" with synthetic data only.
useFreshDatabase();

const BOLT: CompendiumEntity = {
  id: 'fx-bolt',
  name: 'Synthetic Fixbolt',
  source: 'Test Book',
  ruleset: '2014',
  category: 'spell',
  spellLevel: 1,
  entries: ['A bolt of synthetic light.'],
  activities: [
    {
      id: 'fx-bolt-a',
      name: 'Synthetic Fixbolt',
      type: 'save',
      actionEconomy: 'action',
      saveAbility: 'dex',
      saveDcFormula: '30',
      damageFormula: '1d6',
      damageType: 'radiant',
      resourceCost: { poolId: 'spell_slot_1', amount: 1 },
    },
  ],
};

async function importBolt(h: StoreHook) {
  await act(async () => {
    await h.result.current.importJsonFilePayload(JSON.stringify([BOLT]));
  });
  await act(async () => {
    await h.result.current.confirmPendingImport();
  });
}

const bolt = (h: StoreHook) => h.result.current.searchCompendium('synthetic fixbolt').find((e) => e.id === 'fx-bolt')!;
const findActivity = (h: StoreHook, name: string) =>
  Object.values(h.result.current.resolvedSheet.actionsByEconomy)
    .flat()
    .find((a: ResolvedActivity) => a.name === name);

describe('content fixes (store level)', () => {
  it('proposed is not applied; approved is, on the sheet and in a cast; a resync flags it needs re-review', async () => {
    const h = await setupStore();
    await importBolt(h);
    expect(bolt(h).activities[0]!.damageFormula).toBe('1d6');

    // a player proposes a damage fix
    const edited = structuredClone(bolt(h));
    edited.activities[0]!.damageFormula = '4d6';
    let proposed = '';
    await act(async () => {
      const r = await h.result.current.proposeContentFix('fx-bolt', edited, 'Wrong dice, should be 4d6', 'player');
      expect(r.ok).toBe(true);
      if (r.ok) proposed = r.fix.id;
    });
    const fix = () => h.result.current.contentFixes.find((f) => f.id === proposed)!;
    expect(fix()).toMatchObject({ status: 'proposed', author: 'Player', patch: { 'activities.fx-bolt-a.damageFormula': '4d6' } });
    expect(await db.contentFixes.count()).toBe(1);
    expect(bolt(h).activities[0]!.damageFormula).toBe('1d6'); // not applied while proposed

    // a note is required, an unchanged entry is refused
    await act(async () => {
      expect((await h.result.current.proposeContentFix('fx-bolt', edited, '  ', 'player')).ok).toBe(false);
      expect((await h.result.current.proposeContentFix('fx-bolt', structuredClone(BOLT), 'x', 'player')).ok).toBe(false);
    });

    // players cannot approve; the DM can
    await act(async () => {
      expect((await h.result.current.reviewContentFix(proposed, 'approved', 'player')).ok).toBe(false);
    });
    expect(fix().status).toBe('proposed');
    await act(async () => {
      expect((await h.result.current.reviewContentFix(proposed, 'approved', 'dm')).ok).toBe(true);
    });
    expect(bolt(h).activities[0]!.damageFormula).toBe('4d6');
    expect(bolt(h).fixedBy).toEqual([proposed]);
    expect((await db.compendium.get('fx-bolt'))!.activities[0]!.damageFormula).toBe('1d6'); // stored original untouched

    // adding it to the sheet and casting uses the fixed damage
    act(() => h.result.current.addCompendiumItemToSheet(bolt(h)));
    expect(h.result.current.rawChar.items.find((i) => i.name === 'Synthetic Fixbolt')?.fixedBy).toBeUndefined();
    expect(findActivity(h, 'Synthetic Fixbolt')?.computedDamage).toBe('4d6');
    const mobHp = 40;
    await act(async () => {
      await h.result.current.importJsonFilePayload(
        JSON.stringify([{ id: 'fx-dummy', name: 'Synthetic Fixdummy', category: 'monster', source: 'Test Book', ruleset: '2014', entries: [], activities: [], monsterMeta: { ac: 10, hp: mobHp, dexModifier: 0, cr: '1' } }])
      );
    });
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    act(() => h.result.current.addCompendiumItemToSheet(h.result.current.searchCompendium('synthetic fixdummy').find((e) => e.id === 'fx-dummy')!));
    const mob = h.result.current.encounter.combatants.find((c) => c.name === 'Synthetic Fixdummy')!;
    vi.spyOn(Math, 'random').mockReturnValue(0); // failed save, every die rolls 1
    act(() => h.result.current.targetSaveCombatants('Hero', [mob.id], findActivity(h, 'Synthetic Fixbolt')!, 30));
    const hpAfter = h.result.current.encounter.combatants.find((c) => c.id === mob.id)!.hp.current;
    expect(mobHp - hpAfter).toBe(4); // 4d6 at all ones; the original 1d6 would deal 1
    vi.restoreAllMocks();

    // the source entry changes (a resync): the fix is kept but flagged, and no longer applied
    cleanup();
    await db.compendium.put({ ...BOLT, entries: ['A resynced description.'], searchTokens: buildSearchTokens(BOLT) });
    const again = renderHook(() => useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER));
    await waitFor(() => expect(again.result.current.contentFixes.map((f) => f.id)).toEqual([proposed]), { timeout: 20_000 });
    await waitFor(() => expect(again.result.current.compendium.find((e) => e.id === 'fx-bolt')?.entries[0]).toBe('A resynced description.'), { timeout: 20_000 });
    const stored = again.result.current.compendium.find((e) => e.id === 'fx-bolt');
    expect(fixState(again.result.current.contentFixes[0]!, stored)).toBe('needs-re-review');
    expect(again.result.current.searchCompendium('synthetic fixbolt').find((e) => e.id === 'fx-bolt')!.activities[0]!.damageFormula).toBe('1d6');
    expect(await db.contentFixes.count()).toBe(1); // the sync did not remove the fix

    // the DM re-approves it against the new text: applied again
    await act(async () => {
      await again.result.current.reviewContentFix(proposed, 'approved', 'dm');
    });
    expect(fixState(again.result.current.contentFixes[0]!, stored)).toBe('approved');
    expect(again.result.current.searchCompendium('synthetic fixbolt').find((e) => e.id === 'fx-bolt')!.activities[0]!.damageFormula).toBe('4d6');

    // revert to original = delete the fix (DM only)
    await act(async () => {
      expect(await again.result.current.deleteContentFix(proposed, 'player')).toBe(false);
      expect(await again.result.current.deleteContentFix(proposed, 'dm')).toBe(true);
    });
    expect(again.result.current.searchCompendium('synthetic fixbolt').find((e) => e.id === 'fx-bolt')!.activities[0]!.damageFormula).toBe('1d6');
    expect(await db.contentFixes.count()).toBe(0);
  });

  it('exports fixes and re-imports them as proposed', async () => {
    const h = await setupStore();
    await importBolt(h);
    const edited = structuredClone(bolt(h));
    edited.name = 'Synthetic Fixbolt II';
    await act(async () => {
      await h.result.current.proposeContentFix('fx-bolt', edited, 'Renamed', 'dm');
    });
    const file = h.result.current.exportContentFixes();
    expect(file.fixes[0]).toMatchObject({ entityName: 'Synthetic Fixbolt', entitySource: 'Test Book', status: 'proposed' });
    // approve it, export again, wipe, import: it comes back as proposed
    await act(async () => {
      await h.result.current.reviewContentFix(file.fixes[0]!.id, 'approved', 'dm');
    });
    const approvedFile = JSON.stringify(h.result.current.exportContentFixes());
    await act(async () => {
      await h.result.current.deleteContentFix(file.fixes[0]!.id, 'dm');
    });
    let res = { imported: 0, skipped: [] as string[] };
    await act(async () => {
      res = await h.result.current.importContentFixes(approvedFile);
    });
    expect(res.imported).toBe(1);
    expect(h.result.current.contentFixes.map((f) => f.status)).toEqual(['proposed']);
    expect(bolt(h).name).toBe('Synthetic Fixbolt'); // not applied until reviewed
    await act(async () => {
      expect((await h.result.current.importContentFixes('not json')).imported).toBe(0);
    });
  });
});

describe('Live Table', () => {
  it('a player proposal reaches the host review queue as proposed', async () => {
    if (typeof BroadcastChannel === 'undefined') return; // transport missing in this environment
    const host = await setupStore();
    await importBolt(host);
    const player = renderHook(() => useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER));
    await waitFor(() => expect(player.result.current.compendium.some((e) => e.id === 'fx-bolt')).toBe(true), { timeout: 20_000 });
    act(() => {
      host.result.current.hostLocalTable('FIXRM');
      player.result.current.joinLocalTable('FIXRM');
    });
    await waitFor(() => expect(host.result.current.liveStatus.role).toBe('host'));
    await waitFor(() => expect(player.result.current.liveStatus.role).toBe('player'));
    const edited = structuredClone(player.result.current.searchCompendium('synthetic fixbolt').find((e) => e.id === 'fx-bolt')!);
    edited.activities[0]!.damageFormula = '4d6';
    await act(async () => {
      expect((await player.result.current.proposeContentFix('fx-bolt', edited, 'wrong dice', 'player')).ok).toBe(true);
    });
    await waitFor(() => expect(host.result.current.contentFixes).toHaveLength(1));
    expect(host.result.current.contentFixes[0]).toMatchObject({ entityId: 'fx-bolt', status: 'proposed', author: 'Player' });
    // proposed only: the host's entry is unchanged until the DM approves
    expect(host.result.current.searchCompendium('synthetic fixbolt').find((e) => e.id === 'fx-bolt')!.activities[0]!.damageFormula).toBe('1d6');
    act(() => {
      host.result.current.disconnectLiveTable();
      player.result.current.disconnectLiveTable();
    });
  });
});

