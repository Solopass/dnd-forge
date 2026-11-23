import { describe, expect, it } from 'vitest';
import {
  buildCharacterFromPreset,
  CLASS_DEFINITIONS,
  computeFixedMaxHp,
  syncClassResourcePools,
} from '../classes';
import { computeCharacterSheet } from '../rules-math';

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
});
