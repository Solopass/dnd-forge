import { describe, expect, it } from 'vitest';
import {
  advanceWorldClock,
  createDefaultCampaign,
  DM_SCREEN_SECTIONS,
  formatWorldClock,
  generateShopInventory,
  getQualitativeHealthLabel,
  getXpForNextLevel,
  LEVEL_XP_THRESHOLDS,
  rollTreasure,
  sizeToGridCells,
} from '../dm-tools';
import {
  advanceTurn,
  rollAllInitiativeOrder,
  spawnLinkedSummon,
} from '../combat-machine';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { CombatEncounterState } from '../../types/combat';

describe('DM Hub & Session Prep Tools', () => {
  it('computes 5e XP thresholds, world clock progression, and timer expiration', () => {
    expect(LEVEL_XP_THRESHOLDS[1]).toBe(0);
    expect(LEVEL_XP_THRESHOLDS[2]).toBe(300);
    expect(getXpForNextLevel(1)).toBe(300);
    expect(getXpForNextLevel(5)).toBe(14000);
    expect(getXpForNextLevel(20)).toBeNull();

    const campaign = createDefaultCampaign('camp-strahd', 'Curse of Strahd');
    const withTorch = {
      ...campaign.clock,
      activeTimers: [{ id: 't1', label: 'Torch', remainingMinutes: 60 }],
    };

    const after30 = advanceWorldClock(withTorch, 30);
    expect(after30.expiredTimers).toEqual([]);
    expect(after30.clock.activeTimers[0]?.remainingMinutes).toBe(30);

    const after60 = advanceWorldClock(after30.clock, 30);
    expect(after60.expiredTimers).toContain('Torch');
    expect(after60.clock.activeTimers).toEqual([]);
    expect(formatWorldClock(after60.clock)).toContain('Day 1');

    const overnight = advanceWorldClock({ ...after60.clock, hour: 23, minute: 30 }, 60);
    expect(overnight.clock.day).toBe(2);
    expect(overnight.clock.hour).toBe(0);
    expect(overnight.clock.minute).toBe(30);
  });

  it('rolls SRD individual & hoard treasure across CR tiers and generates tiered shop inventory', () => {
    const lowIndiv = rollTreasure('0-4', 'individual');
    expect(lowIndiv.coins.gp).toBeGreaterThanOrEqual(2);
    expect(lowIndiv.totalGpValue).toBeGreaterThan(0);

    const highHoard = rollTreasure('17+', 'hoard');
    expect(highHoard.totalGpValue).toBeGreaterThan(1000);
    expect(highHoard.valuables.length).toBeGreaterThan(0);
    expect(highHoard.magicItems.length).toBeGreaterThan(0);

    const villageShop = generateShopInventory('village');
    const cityShop = generateShopInventory('city');
    expect(villageShop.length).toBeGreaterThan(0);
    expect(cityShop.length).toBeGreaterThan(villageShop.length);
    expect(cityShop.every((item) => item.priceGp > 0 && item.name.length > 0)).toBe(true);
    expect(DM_SCREEN_SECTIONS.length).toBeGreaterThanOrEqual(5);
  });

  it('maps qualitative health states and multi-size token footprints', () => {
    expect(getQualitativeHealthLabel(20, 20)).toBe('Healthy');
    expect(getQualitativeHealthLabel(14, 20)).toBe('Wounded');
    expect(getQualitativeHealthLabel(10, 20)).toBe('Bloodied');
    expect(getQualitativeHealthLabel(4, 20)).toBe('Critical');
    expect(getQualitativeHealthLabel(0, 20)).toBe('Down');

    expect(sizeToGridCells('tiny')).toBe(1);
    expect(sizeToGridCells('small')).toBe(1);
    expect(sizeToGridCells('medium')).toBe(1);
    expect(sizeToGridCells('large')).toBe(2);
    expect(sizeToGridCells('huge')).toBe(3);
    expect(sizeToGridCells('gargantuan')).toBe(4);
  });
});

describe('DM-Grade VTT & Monster Combat Automation', () => {
  it('rolls all initiative in descending order with DEX tie-breakers', () => {
    const encounter: CombatEncounterState = {
      id: 'enc-init',
      name: 'Ambush',
      round: 1,
      activeTurnIndex: 0,
      combatants: [
        {
          id: 'slow',
          name: 'Ogre',
          kind: 'monster',
          initiative: 0,
          dexModifier: -1,
          ac: 11,
          hp: { current: 59, max: 59, temp: 0 },
          conditions: [],
          turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
        },
        {
          id: 'fast',
          name: 'Rogue',
          kind: 'pc',
          initiative: 0,
          dexModifier: 4,
          ac: 16,
          hp: { current: 35, max: 35, temp: 0 },
          conditions: [],
          turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
        },
      ],
      activeEffects: [],
      log: [],
    };

    const sorted = rollAllInitiativeOrder(encounter.combatants, () => 10);
    expect(sorted[0]?.id).toBe('fast');
    expect(sorted[0]?.initiative).toBe(14);
    expect(sorted[1]?.id).toBe('slow');
    expect(sorted[1]?.initiative).toBe(9);
  });

  it('resets Legendary Actions, evaluates deterministic Recharge 5-6, and expires round timers + linked summons', () => {
    let encounter: CombatEncounterState = {
      id: 'enc-boss',
      name: 'Dragon Lair',
      round: 1,
      activeTurnIndex: 0,
      combatants: [
        {
          id: 'pc-1',
          name: 'Wizard',
          kind: 'pc',
          initiative: 20,
          dexModifier: 2,
          ac: 15,
          hp: { current: 42, max: 42, temp: 0 },
          conditions: [],
          turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
        },
        {
          id: 'dragon-1',
          name: 'Adult Black Dragon',
          kind: 'monster',
          size: 'huge',
          initiative: 15,
          dexModifier: 2,
          ac: 19,
          hp: { current: 195, max: 195, temp: 0 },
          conditions: [],
          turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
          legendaryActions: { current: 0, max: 3 },
          rechargeStates: [{ name: 'Acid Breath (Recharge 5-6)', minRoll: 5, available: false }],
        },
      ],
      activeEffects: [
        {
          id: 'eff-mirror',
          name: 'Summon Elemental',
          sourceCombatantId: 'pc-1',
          targetCombatantId: 'pc-1',
          isConcentration: false,
          expiration: 'rounds_remaining',
          roundsRemaining: 1,
        },
      ],
      log: [],
    };

    encounter = spawnLinkedSummon(
      encounter,
      {
        id: 'elem-1',
        name: 'Air Elemental',
        ownerId: 'pc-1',
        initiative: 19,
        dexModifier: 5,
        ac: 15,
        hp: { current: 90, max: 90, temp: 0 },
        conditions: [],
      },
      'eff-mirror'
    );

    // Step 1: pc-1 -> elem-1
    encounter = advanceTurn(encounter, () => 4);
    expect(encounter.combatants[encounter.activeTurnIndex]?.id).toBe('elem-1');

    // Step 2: elem-1 -> dragon-1 (d6=4 fails Recharge 5-6, Legendary Actions reset to 3)
    encounter = advanceTurn(encounter, () => 4);
    let dragon = encounter.combatants.find((c) => c.id === 'dragon-1');
    expect(encounter.combatants[encounter.activeTurnIndex]?.id).toBe('dragon-1');
    expect(dragon?.legendaryActions?.current).toBe(3);
    expect(dragon?.rechargeStates?.[0]?.available).toBe(false);

    // Step 3: dragon-1 -> pc-1 (Round 2): eff-mirror hits 0 rounds, expires, auto-dismisses elem-1
    encounter = advanceTurn(encounter, () => 2);
    expect(encounter.round).toBe(2);
    expect(encounter.combatants[encounter.activeTurnIndex]?.id).toBe('pc-1');
    expect(encounter.activeEffects.find((e) => e.id === 'eff-mirror')).toBeUndefined();
    expect(encounter.combatants.find((c) => c.id === 'elem-1')).toBeUndefined();

    // Step 4: pc-1 -> dragon-1 (d6=5 recharges Acid Breath)
    encounter = advanceTurn(encounter, () => 5);
    dragon = encounter.combatants.find((c) => c.id === 'dragon-1');
    expect(encounter.combatants[encounter.activeTurnIndex]?.id).toBe('dragon-1');
    expect(dragon?.rechargeStates?.[0]?.available).toBe(true);
  });

  it('includes enriched SRD boss metadata (size, legendary actions, recharge, immunities) on monsters', () => {
    const monsterPack = BUILTIN_CONTENT_PACKS.find((p) =>
      p.entities.some((e) => e.name === 'Adult Black Dragon')
    );
    expect(monsterPack).toBeDefined();

    const allEntities = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const dragon = allEntities.find((e) => e.name === 'Adult Black Dragon');
    const lich = allEntities.find((e) => e.name === 'Lich');

    expect(dragon?.monsterMeta?.size).toBe('huge');
    expect(dragon?.monsterMeta?.legendaryActionsMax).toBe(3);
    expect(dragon?.monsterMeta?.rechargeAbility).toEqual({
      name: 'Acid Breath (Recharge 5-6)',
      minRoll: 5,
    });
    expect(dragon?.monsterMeta?.immunities).toContain('acid');

    expect(lich?.monsterMeta?.legendaryActionsMax).toBe(3);
    expect(lich?.monsterMeta?.immunities).toContain('poison');
  });
});
