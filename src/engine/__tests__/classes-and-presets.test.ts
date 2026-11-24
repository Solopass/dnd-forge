import { describe, expect, it } from 'vitest';
import {
  buildCharacterFromPreset,
  CLASS_DEFINITIONS,
  computeFixedMaxHp,
  syncClassResourcePools,
} from '../classes';
import { computeCharacterSheet, syncSpellSlotPools } from '../rules-math';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';

describe('D&D Forge Class Definitions & Character Presets', () => {
  it('builds valid playable sheets for all 14 classes at level 5', () => {
    expect(CLASS_DEFINITIONS.length).toBe(14);

    for (const def of CLASS_DEFINITIONS) {
      const raw = buildCharacterFromPreset({
        id: `test-${def.className}`,
        name: `Test ${def.className}`,
        className: def.className,
        level: 5,
        speciesName: 'Human',
        backgroundName: 'Soldier',
        ruleset: '2014',
      });
      const resolved = computeCharacterSheet(raw);
      expect(resolved.totalLevel).toBe(5);
      expect(resolved.proficiencyBonus.final).toBe(3);
      expect(resolved.hp.max).toBeGreaterThan(15);
      expect(resolved.resources.some((r) => r.id === 'hit_dice' && r.max === 5)).toBe(true);
      expect(raw.items.length).toBeGreaterThan(0);
    }
  });

  it('computes Barbarian and Monk Unarmored Defense accurately', () => {
    const barb = buildCharacterFromPreset({
      id: 'barb-1',
      name: 'Grog',
      className: 'Barbarian',
      level: 3,
      speciesName: 'Half-Orc',
      backgroundName: 'Outlander',
      ruleset: '2014',
    });
    const resolvedBarb = computeCharacterSheet(barb);
    // Half-Orc (+2 STR, +1 CON) on Barbarian array (DEX 13 -> +1, CON 14+1=15 -> +2) => 10 + 1 + 2 = 13
    expect(resolvedBarb.ac.activeFormulaSource).toBe('Unarmored Defense (CON)');
    expect(resolvedBarb.ac.final).toBe(13);

    const monk = buildCharacterFromPreset({
      id: 'monk-1',
      name: 'Li',
      className: 'Monk',
      level: 5,
      speciesName: 'Elf',
      backgroundName: 'Acolyte',
      ruleset: '2014',
    });
    const resolvedMonk = computeCharacterSheet(monk);
    // Elf (+2 DEX) on Monk array (DEX 15+2=17 -> +3, WIS 14 -> +2) => 10 + 3 + 2 = 15
    expect(resolvedMonk.ac.activeFormulaSource).toBe('Unarmored Defense (WIS)');
    expect(resolvedMonk.ac.final).toBe(15);
    expect(resolvedMonk.resources.find((r) => r.id === 'auto_class_ki')?.max).toBe(5);
  });

  it('computes Warlock Pact Slots and Paladin Lay on Hands scaling', () => {
    const warlock = buildCharacterFromPreset({
      id: 'lock-1',
      name: 'Hexer',
      className: 'Warlock',
      level: 5,
      speciesName: 'Tiefling',
      backgroundName: 'Sage',
      ruleset: '2014',
    });
    const pact = warlock.resources.find((r) => r.id === 'pact_slot');
    expect(pact?.max).toBe(2);
    expect(pact?.name).toContain('Lvl 3');
    expect(pact?.recovery).toBe('short_rest');

    const paladin = buildCharacterFromPreset({
      id: 'pal-1',
      name: 'Vael',
      className: 'Paladin',
      level: 4,
      speciesName: 'Dragonborn',
      backgroundName: 'Noble',
      ruleset: '2014',
    });
    expect(paladin.resources.find((r) => r.id === 'auto_class_lay_on_hands')?.max).toBe(20);
  });

  it('scales fixed HP and preserves spent pools on level up', () => {
    const hp = computeFixedMaxHp(
      [{ className: 'Fighter', level: 5, hitDie: 10, casterProgression: 'none' }],
      14
    );
    // Lvl 1: 10+2=12; Lvl 2-5: 4 * (6+2) = 32; total = 44
    expect(hp).toBe(44);

    const synced = syncClassResourcePools(
      [{ className: 'Monk', level: 6, hitDie: 8, casterProgression: 'none' }],
      [{ id: 'auto_class_ki', name: 'Focus / Ki Points', current: 2, max: 5, recovery: 'short_rest', isAutoClassPool: true }]
    );
    expect(synced.find((r) => r.id === 'auto_class_ki')?.current).toBe(2);
    expect(synced.find((r) => r.id === 'auto_class_ki')?.max).toBe(6);
  });

  it('resolves @spell, @cantrip, @lvl, Alert, Tough, and 2024 Exhaustion properly', () => {
    const cleric = buildCharacterFromPreset({
      id: 'clr-5',
      name: 'Aldous',
      className: 'Cleric',
      level: 5,
      speciesName: 'Human',
      backgroundName: 'Acolyte',
      ruleset: '2014',
    });
    const resolvedCleric = computeCharacterSheet(cleric);
    // Cleric WIS 15+1=16 (+3), Prof +3 => Save DC 14, Sacred Flame 2d8, Healing Word 1d4+3
    expect(resolvedCleric.spellcasting.primaryAbility).toBe('wis');
    expect(resolvedCleric.spellcasting.saveDc.final).toBe(14);
    const sacredFlame = resolvedCleric.actionsByEconomy.action.find((a) => a.name === 'Sacred Flame');
    expect(sacredFlame?.computedSaveDc).toBe(14);
    expect(sacredFlame?.computedDamage).toBe('2d8');
    const healingWord = resolvedCleric.actionsByEconomy.bonus_action.find((a) => a.name.includes('Healing Word'));
    expect(healingWord?.computedDamage).toBe('1d4 + 3');

    const warlock = buildCharacterFromPreset({
      id: 'wlk-5',
      name: 'Kael',
      className: 'Warlock',
      level: 5,
      speciesName: 'Tiefling',
      backgroundName: 'Sage',
      ruleset: '2014',
    });
    const resolvedWarlock = computeCharacterSheet(warlock);
    // Warlock CHA 15+2=17 (+3), Prof +3 => Eldritch Blast +6
    expect(resolvedWarlock.spellcasting.primaryAbility).toBe('cha');
    const eb = resolvedWarlock.actionsByEconomy.action.find((a) => a.name === 'Eldritch Blast');
    expect(eb?.computedAttackBonus).toBe(6);

    const fighter = buildCharacterFromPreset({
      id: 'ftr-5',
      name: 'Bryn',
      className: 'Fighter',
      level: 5,
      speciesName: 'Human',
      backgroundName: 'Soldier',
      ruleset: '2024',
    });
    const allPackEntities = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const alertFeat = allPackEntities.find((e) => e.id === 'srd-feat-alert')!;
    const toughFeat = allPackEntities.find((e) => e.id === 'srd-feat-tough')!;
    fighter.items.push(structuredClone(alertFeat), structuredClone(toughFeat));
    fighter.exhaustion = 2;

    const resolvedFighter = computeCharacterSheet(fighter);
    const secondWind = resolvedFighter.actionsByEconomy.bonus_action.find((a) => a.name === 'Second Wind');
    expect(secondWind?.computedDamage).toBe('1d10 + 5');
    // Alert +5 on DEX 13+1=14 (+2) => Init +7
    expect(resolvedFighter.initiative.final).toBe(7);
    // 2024 Exhaustion 2 => -4 to skills & saves
    expect(resolvedFighter.abilities.str.save.modifiers.some((m) => m.id === 'exhaustion-2024' && m.value === -4)).toBe(true);
    // Tough adds +2 * 5 = +10 HP on Fighter Lvl 5 (CON 14+1=15 (+2) => 44 + 10 = 54)
    const toughHp = computeFixedMaxHp(fighter.classes, fighter.baseAbilities.con + fighter.bonusAbilities.con, fighter.items);
    expect(toughHp).toBe(54);
  });

  it('preserves decremented Pact Slots and spell slots when syncing class and slot pools', () => {
    const warlock = buildCharacterFromPreset({
      id: 'wlk-sync',
      name: 'Vex',
      className: 'Warlock',
      level: 5,
      speciesName: 'Tiefling',
      backgroundName: 'Sage',
      ruleset: '2014',
    });
    const spentWarlockPools = warlock.resources.map((r) =>
      r.id === 'pact_slot' ? { ...r, current: r.current - 1 } : r
    );
    const afterClassSync = syncClassResourcePools(warlock.classes, spentWarlockPools);
    const afterSlotSync = syncSpellSlotPools(warlock.classes, afterClassSync);
    expect(afterSlotSync.find((r) => r.id === 'pact_slot')?.current).toBe(1);
    expect(afterSlotSync.find((r) => r.id === 'pact_slot')?.max).toBe(2);

    const wizard = buildCharacterFromPreset({
      id: 'wiz-sync',
      name: 'Lyra',
      className: 'Wizard',
      level: 3,
      speciesName: 'Elf',
      backgroundName: 'Sage',
      ruleset: '2014',
    });
    const spentWizardPools = wizard.resources.map((r) =>
      r.id === 'spell_slot_1' ? { ...r, current: 2 } : r
    );
    const wizClassSync = syncClassResourcePools(wizard.classes, spentWizardPools);
    const wizSlotSync = syncSpellSlotPools(wizard.classes, wizClassSync);
    expect(wizSlotSync.find((r) => r.id === 'spell_slot_1')?.current).toBe(2);
    expect(wizSlotSync.find((r) => r.id === 'spell_slot_1')?.max).toBe(4);
  });
});
