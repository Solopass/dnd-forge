// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { setupStore, useFreshDatabase, type StoreHook } from './storeHarness';
import { crToXp } from '../../engine/encounter-math';
import type { ResolvedActivity } from '../../types/character';
import type { CompendiumEntity } from '../../types/compendium';

// Imported (synthetic) data must work with the features that use it.
useFreshDatabase();

async function importJson(h: StoreHook, payload: unknown) {
  await act(async () => {
    await h.result.current.importJsonFilePayload(JSON.stringify(payload));
  });
  await act(async () => {
    await h.result.current.confirmPendingImport();
  });
}

const findActivity = (h: StoreHook, name: string) =>
  Object.values(h.result.current.resolvedSheet.actionsByEconomy)
    .flat()
    .find((a: ResolvedActivity) => a.name === name);

const spell = (id: string, name: string, extra: Partial<CompendiumEntity>): CompendiumEntity => ({
  id, name, source: 'Test Book', ruleset: '2014', category: 'spell', spellLevel: 1, entries: ['Synthetic.'],
  activities: [], ...extra,
});

describe('imported spell', () => {
  it('added to the sheet, casting uses a slot and heals; a damage spell hurts a monster', async () => {
    const h = await setupStore();
    await importJson(h, [
      spell('t-mend', 'Synthetic Mend', {
        activities: [{ id: 'a-mend', name: 'Synthetic Mend', type: 'heal', actionEconomy: 'action', damageFormula: '2d4+2', resourceCost: { poolId: 'spell_slot_1', amount: 1 } }],
      }),
      spell('t-zap', 'Synthetic Zap', {
        activities: [{ id: 'a-zap', name: 'Synthetic Zap', type: 'save', actionEconomy: 'action', saveAbility: 'dex', saveDcFormula: '30', damageFormula: '3d6', damageType: 'lightning', resourceCost: { poolId: 'spell_slot_1', amount: 1 } }],
      }),
    ]);
    for (const id of ['t-mend', 't-zap']) {
      act(() => h.result.current.addCompendiumItemToSheet(h.result.current.searchCompendium('synthetic').find((e) => e.id === id)!));
    }
    expect(h.result.current.rawChar.items.some((i) => i.name === 'Synthetic Mend')).toBe(true);

    act(() => h.result.current.adjustHp(-30));
    const hpBefore = h.result.current.rawChar.hp.current;
    const slots = () => h.result.current.rawChar.resources.find((r) => r.id === 'spell_slot_1')!.current;
    const slotsBefore = slots();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // max dice
    act(() => h.result.current.triggerActivity(findActivity(h, 'Synthetic Mend')!, undefined, false, [h.result.current.rawChar.id]));
    expect(slots()).toBe(slotsBefore - 1);
    expect(h.result.current.rawChar.hp.current).toBe(hpBefore + 10); // 2d4+2 maxed

    // damage spell against an imported monster in the encounter
    await importJson(h, [{
      id: 't-dummy', name: 'Synthetic Dummy', category: 'monster', source: 'Test Book', ruleset: '2014', entries: [], activities: [],
      monsterMeta: { ac: 10, hp: 40, dexModifier: 0, cr: '1' },
    }]);
    act(() => h.result.current.addCompendiumItemToSheet(h.result.current.searchCompendium('synthetic dummy').find((e) => e.id === 't-dummy')!));
    const mob = h.result.current.encounter.combatants.find((c) => c.name === 'Synthetic Dummy')!;
    vi.spyOn(Math, 'random').mockReturnValue(0); // failed save, min dice
    act(() => h.result.current.targetSaveCombatants('Hero', [mob.id], findActivity(h, 'Synthetic Zap')!, 30));
    const after = h.result.current.encounter.combatants.find((c) => c.id === mob.id)!;
    expect(after.hp.current).toBeLessThan(40);
  });
});

describe('imported monster', () => {
  it('Markdown statblock goes to the encounter, an attack resolves, damage lands, XP comes from its CR', async () => {
    const h = await setupStore();
    const md = `### Synthetic Brute
Medium humanoid
Armor Class 11
Hit Points 30 (4d8 + 12)
Speed 30 ft.
STR DEX CON INT WIS CHA
16 (+3) 12 (+1) 16 (+3) 8 (-1) 10 (+0) 8 (-1)
Challenge 2 (450 XP)
Actions
Club. Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 8 (1d8 + 4) bludgeoning damage.`;
    await act(async () => {
      await h.result.current.importMarkdownHomebrew(md);
    });
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    const brute = h.result.current.encounter.combatants.find((c) => c.name === 'Synthetic Brute')!;
    expect(brute).toMatchObject({ kind: 'monster', ac: 11, cr: '2' });
    expect(crToXp(brute.cr)).toBe(450);
    const club = brute.actions?.find((a) => a.name === 'Club');
    expect(club).toMatchObject({ type: 'attack', damageFormula: '1d8 + 4' });
    // the monster attacks the player character: nat 20 always hits
    const pc = h.result.current.encounter.combatants.find((c) => c.kind !== 'monster')!;
    const hpBefore = pc.hp.current;
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    act(() => h.result.current.targetAttackCombatants(brute.name, [pc.id], club!, 5));
    const hpAfter = h.result.current.encounter.combatants.find((c) => c.id === pc.id)!.hp.current;
    expect(hpAfter).toBeLessThan(hpBefore);
    // and the player hits the monster back with an imported weapon-like activity
    const myHit = { id: 'x', name: 'Poke', type: 'attack' as const, actionEconomy: 'action' as const, damageFormula: '1d6', attackBonusFormula: '+9' };
    act(() => h.result.current.targetAttackCombatants('Hero', [brute.id], myHit, 9));
    expect(h.result.current.encounter.combatants.find((c) => c.id === brute.id)!.hp.current).toBeLessThan(30);
  });
});

describe('imported feature, character and folded duplicates', () => {
  it('a feature/feat shows on the sheet resolution', async () => {
    const h = await setupStore();
    await importJson(h, [{ id: 't-feat', name: 'Synthetic Grit', category: 'feat', source: 'Test Book', ruleset: '2014', entries: ['You are gritty.'], activities: [] }]);
    act(() => h.result.current.addCompendiumItemToSheet(h.result.current.searchCompendium('synthetic grit').find((e) => e.id === 't-feat')!));
    const item = h.result.current.rawChar.items.find((i) => i.name === 'Synthetic Grit');
    expect(item).toMatchObject({ category: 'feat', equipped: true });
  });

  it('an imported simple-shape character becomes active and can level up', async () => {
    const h = await setupStore();
    await importJson(h, [
      { id: 't-sword', name: 'Synthetic Sword', category: 'weapon', source: 'Test Book', entries: ['x'], activities: [] },
      {
        id: 't-hero', name: 'Synthetic Hero', ruleset: '2014', species: 'Human', background: 'Soldier',
        classes: [{ name: 'Fighter', level: 1, hitDie: 'd10' }],
        abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 }, hp: { current: 12, max: 12, temp: 0 },
        savingThrows: ['str', 'con'], skills: ['athletics'], equipment: ['t-sword'], features: [], spells: [],
      },
    ]);
    expect(h.result.current.rawChar.name).toBe('Synthetic Hero');
    expect(h.result.current.rawChar.items.map((i) => i.id)).toEqual(['t-sword']);
    act(() => h.result.current.applyLevelUpPlan({ className: 'Fighter', hitDie: 10, casterProgression: 'none', hpGain: 8 }));
    expect(h.result.current.rawChar.classes[0]!.level).toBe(2);
    expect(h.result.current.rawChar.hp.max).toBe(20);
  });

  it('a folded duplicate adds the winner (Mine) data, with the folded fields filled in', async () => {
    const h = await setupStore();
    await importJson(h, [spell('mine-cw', 'Cure Wounds', {
      source: 'My Campaign', entries: ['Homebrew healing.'], classes: undefined,
      activities: [{ id: 'a-cw', name: 'Cure Wounds', type: 'heal', actionEconomy: 'action', damageFormula: '9d8', resourceCost: { poolId: 'spell_slot_1', amount: 1 } }],
    })]);
    const hits = h.result.current.searchCompendium('cure wounds').filter((e) => e.name === 'Cure Wounds' && e.ruleset === '2014');
    expect(hits.map((e) => e.id)).toEqual(['mine-cw']);
    expect(hits[0]!.classes?.length).toBeGreaterThan(0); // filled from the folded SRD copy
    act(() => h.result.current.addCompendiumItemToSheet(hits[0]!));
    const onSheet = h.result.current.rawChar.items.find((i) => i.name === 'Cure Wounds' && i.id.startsWith('mine-cw'))!;
    expect(onSheet.activities[0]!.damageFormula).toBe('9d8');
    expect(onSheet.alsoIn).toBeUndefined();
  });
});
