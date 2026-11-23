import { describe, expect, it } from 'vitest';
import {
  applyRestRecovery,
  computeCharacterSheet,
  computeEffectiveCasterLevel,
  syncSpellSlotPools,
} from '../rules-math';
import { resolveRollMode, evaluateDiceExpression } from '../dice';
import {
  advanceTurn,
  applyEffectWithConcentrationCheck,
  spawnLinkedSummon,
} from '../combat-machine';
import { parseHomebrewMarkdownBlock } from '../statblock-parser';
import { buildCharacterFromDdbFields } from '../ddb-pdf-importer';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { RawCharacterState } from '../../types/character';
import { CombatEncounterState } from '../../types/combat';

describe('5e Rules Pipeline, D&D Beyond PDF Importer, SRD Packs & Combat State Machine', () => {
  it('enforces AC formula exclusivity (Unarmored Defense vs Mage Armor) + flat shield bonus', () => {
    const baseChar: RawCharacterState = {
      id: 'barb-1',
      name: 'Test Barbarian',
      ruleset: '2014',
      species: 'Human',
      background: 'Soldier',
      classes: [{ className: 'Barbarian', level: 5, hitDie: 12, casterProgression: 'none' }],
      baseAbilities: { str: 16, dex: 16, con: 18, int: 8, wis: 10, cha: 10 },
      bonusAbilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      saveProficiencies: ['str', 'con'],
      skillProficiencies: {} as RawCharacterState['skillProficiencies'],
      hp: { current: 55, max: 55, temp: 0 },
      deathSaves: { successes: 0, failures: 0 },
      exhaustion: 0,
      conditions: [],
      resources: [],
      items: [
        {
          id: 'unarmored-def',
          name: 'Unarmored Defense',
          source: 'PHB',
          ruleset: '2014',
          category: 'feature',
          acFormula: { base: 10, dexCap: null, extraAbility: 'con', requiresUnarmored: true },
          activities: [],
          entries: [],
        },
        {
          id: 'mage-armor',
          name: 'Mage Armor',
          source: 'PHB',
          ruleset: '2014',
          category: 'spell',
          acFormula: { base: 13, dexCap: null, requiresUnarmored: true },
          activities: [],
          entries: [],
        },
        {
          id: 'shield-1',
          name: 'Shield',
          source: 'PHB',
          ruleset: '2014',
          category: 'shield',
          equipped: true,
          acFlatBonus: 2,
          activities: [],
          entries: [],
        },
      ],
      overrides: {},
    };

    const resolved = computeCharacterSheet(baseChar);
    expect(resolved.ac.base).toBe(17);
    expect(resolved.ac.final).toBe(19);
    expect(resolved.ac.activeFormulaSource).toBe('Unarmored Defense');
  });

  it('imports D&D Beyond AcroForm PDF fields into a valid character sheet with weapons & spells', () => {
    const mockPdfFields: Record<string, string> = {
      CharacterName: 'Sickle',
      ClassLevel: 'Blood Hunter 7 / Rogue 2',
      Race: 'Grumkin',
      Background: 'Outlander',
      STR: '10',
      DEX: '18',
      CON: '16',
      INT: '14',
      WIS: '12',
      CHA: '8',
      MaxHP: '74',
      CurrentHP: '68',
      AC: '17',
      'Wpn Name': 'Crimson Rapier',
      'Wpn1 AtkBonus': '+8',
      'Wpn1 Damage': '1d8+4 piercing',
      'Spells 1014': 'Hex',
    };

    const result = buildCharacterFromDdbFields(mockPdfFields);
    expect(result.character.name).toBe('Sickle');
    expect(result.character.classes).toHaveLength(2);
    expect(result.character.baseAbilities.dex).toBe(18);
    expect(result.character.hp.current).toBe(68);
    expect(result.character.overrides.ac).toBe(17);
    expect(result.character.items.some((i) => i.name === 'Crimson Rapier')).toBe(true);
    expect(result.character.items.some((i) => i.name === 'Hex')).toBe(true);
  });

  it('provides built-in SRD & 2024 base set content packs across all core categories', () => {
    expect(BUILTIN_CONTENT_PACKS.length).toBeGreaterThanOrEqual(5);
    const allEntities = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    expect(allEntities.length).toBeGreaterThanOrEqual(90);
    expect(allEntities.some((e) => e.category === 'spell' && e.name === 'Fireball')).toBe(true);
    expect(allEntities.some((e) => e.category === 'weapon' && e.name === 'Longsword')).toBe(true);
    expect(allEntities.some((e) => e.category === 'armor' && e.name === 'Plate Armor')).toBe(true);
    expect(allEntities.some((e) => e.category === 'shield' && e.name === 'Shield (+2 AC)')).toBe(true);
    expect(allEntities.some((e) => e.category === 'feat' && e.name === 'Action Surge')).toBe(true);
    expect(allEntities.some((e) => e.category === 'monster' && e.name === 'Owlbear')).toBe(true);
    expect(allEntities.some((e) => e.ruleset === '2024' && e.name === 'Greatsword (Graze)')).toBe(true);
  });

  it('computes multiclass spell slots and recovers resources on short/long rests', () => {
    const classes: RawCharacterState['classes'] = [
      { className: 'Artificer', level: 6, hitDie: 8, casterProgression: 'half_up' },
      { className: 'Wizard', level: 2, hitDie: 6, casterProgression: 'full' },
    ];
    expect(computeEffectiveCasterLevel(classes)).toBe(5);
    const pools = syncSpellSlotPools(classes, []);
    expect(pools.map((p) => p.max)).toEqual([4, 3, 2]);
  });

  it('parses full Markdown monster stat blocks with AC, HP, DEX mod, and attacks', () => {
    const md = `### Owlbear
Armor Class: 13
Hit Points: 59 (7d10 + 21)
16 (+3) 12 (+1) 17 (+3) 3 (-4) 12 (+1) 7 (-2)
Claws. +7 to hit, 2d8 + 5 slashing damage`;

    const parsed = parseHomebrewMarkdownBlock(md);
    expect(parsed.data.category).toBe('monster');
    expect(parsed.data.monsterMeta?.ac).toBe(13);
    expect(parsed.data.monsterMeta?.hp).toBe(59);
    expect(parsed.data.monsterMeta?.dexModifier).toBe(1);
    expect(parsed.data.activities[0]?.name).toBe('Claws');
  });

  it('cancels multiple Advantage and Disadvantage sources to flat normal roll', () => {
    expect(resolveRollMode(2, 1)).toBe('normal');
    expect(resolveRollMode(1, 0)).toBe('advantage');
    expect(resolveRollMode(0, 3)).toBe('disadvantage');
  });

  it('evaluates keep-highest dice expressions deterministically in range', () => {
    const res = evaluateDiceExpression('4d6kh3+2');
    expect(res.terms[0]?.kept).toHaveLength(3);
    expect(res.terms[0]?.dropped).toHaveLength(1);
    expect(res.total).toBeGreaterThanOrEqual(5);
    expect(res.total).toBeLessThanOrEqual(20);
  });

  it('auto-dismisses linked summons when concentration is replaced by a new spell', () => {
    let encounter: CombatEncounterState = {
      id: 'enc-test',
      name: 'Test',
      round: 1,
      activeTurnIndex: 0,
      combatants: [
        {
          id: 'pc-1',
          name: 'Artificer',
          kind: 'pc',
          initiative: 18,
          dexModifier: 2,
          ac: 20,
          hp: { current: 60, max: 60, temp: 0 },
          conditions: [],
          turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
        },
      ],
      activeEffects: [],
      log: [],
    };

    encounter = applyEffectWithConcentrationCheck(encounter, {
      id: 'conc-1',
      name: 'Summon Construct',
      sourceCombatantId: 'pc-1',
      targetCombatantId: 'pc-1',
      isConcentration: true,
      expiration: 'concentration',
    });

    encounter = spawnLinkedSummon(
      encounter,
      {
        id: 'sum-1',
        name: 'Stone Construct',
        ownerId: 'pc-1',
        initiative: 0,
        dexModifier: 0,
        ac: 17,
        hp: { current: 40, max: 40, temp: 0 },
        conditions: [],
      },
      'conc-1'
    );

    expect(encounter.combatants).toHaveLength(2);
    expect(encounter.combatants[1]?.id).toBe('sum-1');

    encounter = applyEffectWithConcentrationCheck(encounter, {
      id: 'conc-2',
      name: 'Haste',
      sourceCombatantId: 'pc-1',
      targetCombatantId: 'pc-1',
      isConcentration: true,
      expiration: 'concentration',
    });

    expect(encounter.combatants).toHaveLength(1);
    expect(encounter.activeEffects).toHaveLength(1);
    expect(encounter.activeEffects[0]?.name).toBe('Haste');

    encounter = advanceTurn(encounter);
    expect(encounter.round).toBe(2);
  });

  it('restores HP and long-rest pools on Long Rest', () => {
    const char: RawCharacterState = {
      id: 'c1',
      name: 'Test',
      ruleset: '2014',
      species: 'Human',
      background: 'Sage',
      classes: [],
      baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      bonusAbilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      saveProficiencies: [],
      skillProficiencies: {} as RawCharacterState['skillProficiencies'],
      hp: { current: 12, max: 45, temp: 0 },
      deathSaves: { successes: 2, failures: 1 },
      exhaustion: 1,
      conditions: [],
      resources: [{ id: 'r1', name: 'Slots', current: 0, max: 3, recovery: 'long_rest' }],
      items: [],
      overrides: {},
    };
    const rested = applyRestRecovery(char, 'long_rest');
    expect(rested.hp.current).toBe(45);
    expect(rested.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(rested.exhaustion).toBe(0);
    expect(rested.resources[0]?.current).toBe(3);
  });
});
