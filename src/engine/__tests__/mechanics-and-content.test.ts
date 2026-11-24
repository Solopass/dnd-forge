import { describe, expect, it, vi } from 'vitest';
import { computeCharacterSheet, createBlankCharacter } from '../rules-math';
import { evaluateDiceExpression, scaleDiceForUpcast } from '../dice';
import {
  buildCharacterFromPreset,
  buildSubclassGrantEntities,
  computeFixedMaxHp,
  syncClassResourcePools,
} from '../classes';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { CompendiumEntity } from '../../types/compendium';

function findPackEntity(id: string): CompendiumEntity {
  const found = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).find((e) => e.id === id);
  if (!found) throw new Error(`Missing entity ${id}`);
  return structuredClone(found);
}

describe('Bucket 1 & 2: Core 5e Mechanics & Content Depth', () => {
  it('scales spell damage dice and flat bonuses cleanly when upcast', () => {
    expect(scaleDiceForUpcast('8d6', '1d6', 2)).toBe('10d6');
    expect(scaleDiceForUpcast('3d4 + 3', '1d4 + 1', 2)).toBe('5d4 + 5');
    expect(scaleDiceForUpcast('1d4 + 4', '1d4', 1)).toBe('2d4 + 4');
    expect(scaleDiceForUpcast('10d6 + 40', '3d6', 1)).toBe('13d6 + 40');
    expect(scaleDiceForUpcast('8d6', '1d6', 0)).toBe('8d6');
  });

  it('supports Champion Fighter expanded crit threshold (19-20 at Lv3, 18-20 at Lv15)', () => {
    const champ = buildCharacterFromPreset({
      id: 'champ-1',
      name: 'Champion',
      className: 'Fighter',
      level: 3,
      speciesName: 'Human',
      backgroundName: 'Soldier',
      ruleset: '2014',
    });
    champ.classes[0]!.subclassName = 'Champion';
    expect(computeCharacterSheet(champ).critThreshold).toBe(19);

    champ.classes[0]!.level = 15;
    expect(computeCharacterSheet(champ).critThreshold).toBe(18);

    // Deterministic d20 = 19 (floor(0.9 * 20) + 1 = 19)
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const normalRoll = evaluateDiceExpression('1d20+5', 'normal', 20);
      expect(normalRoll.isCrit).toBe(false);
      const champRoll = evaluateDiceExpression('1d20+5', 'normal', 19);
      expect(champRoll.isCrit).toBe(true);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('enforces conditional modifiers for Defense, Bracers of Defense, Archery, and Dueling', () => {
    const fighter = buildCharacterFromPreset({
      id: 'styles-1',
      name: 'Tactician',
      className: 'Fighter',
      level: 5,
      speciesName: 'Human',
      backgroundName: 'Soldier',
      ruleset: '2024',
    });

    const defense = findPackEntity('srd-style-defense');
    const archery = findPackEntity('srd-style-archery');
    const dueling = findPackEntity('srd-style-dueling');
    const longbow = findPackEntity('srd-wpn-longbow');
    longbow.equipped = true;
    const greatsword = findPackEntity('srd-wpn-greatsword');
    greatsword.equipped = true;

    fighter.items.push(defense, archery, dueling, longbow, greatsword);

    // Fighter preset starts with Chain Mail (16) + Shield (+2) + Defense (+1 while armored) = 19
    const armoredSheet = computeCharacterSheet(fighter);
    expect(armoredSheet.ac.final).toBe(19);

    const actions = armoredSheet.actionsByEconomy.action;
    const bowAct = actions.find((a) => a.name === 'Longbow')!;
    const swordAct = actions.find((a) => a.name === 'Longsword')!;
    const greatAct = actions.find((a) => a.name === 'Greatsword')!;

    // Longbow has DEX (+2) + Prof (+3) + Archery (+2) = +7
    expect(bowAct.computedAttackBonus).toBe(7);
    // Longsword gets Dueling (+2 dmg): 1d8 + STR(+3) + 2 = 1d8 + 5
    expect(swordAct.computedDamage).toBe('1d8 + 5');
    // Greatsword is Two-Handed so Dueling does NOT apply: 2d6 + 3
    expect(greatAct.computedDamage).toBe('2d6 + 3');

    // Remove armor and shield, equip Bracers of Defense (+2 AC unarmored with no shield)
    fighter.items = fighter.items.filter((i) => i.category !== 'armor' && i.category !== 'shield');
    const bracers = findPackEntity('srd-item-bracers-of-defense');
    bracers.equipped = true;
    bracers.attuned = true;
    fighter.items.push(bracers);

    const unarmoredSheet = computeCharacterSheet(fighter);
    // Unarmored 10 + DEX(2) = 12, Defense does NOT apply (not wearing armor), Bracers (+2) applies => 14
    expect(unarmoredSheet.ac.final).toBe(14);
  });

  it('applies species starting resistances, Draconic HP/AC, Gloom Stalker Init, Battle Master dice, and subclass grants', () => {
    const dwarf = buildCharacterFromPreset({
      id: 'dwarf-1',
      name: 'Thorin',
      className: 'Cleric',
      level: 3,
      speciesName: 'Dwarf',
      backgroundName: 'Acolyte',
      ruleset: '2014',
    });
    expect(computeCharacterSheet(dwarf).defenses.resistances).toContain('poison');

    const lifeGrants = buildSubclassGrantEntities('Cleric', 'Life Domain', '2014');
    expect(lifeGrants.some((e) => e.id === 'srd-sub-disciple-of-life')).toBe(true);
    expect(lifeGrants.every((e) => e.category !== 'spell' || e.alwaysPrepared)).toBe(true);

    // Draconic Sorcerer Lv4 with CON 14 (+2): Base 6+2 + 3*(4+2) + 4*1 = 8 + 18 + 4 = 30 HP
    const sorcClasses = [{ className: 'Sorcerer', subclassName: 'Draconic Bloodline', level: 4, hitDie: 6 as const, casterProgression: 'full' as const }];
    expect(computeFixedMaxHp(sorcClasses, 14)).toBe(30);

    const sorc = createBlankCharacter('sorc-1', 'Pyra');
    sorc.classes = sorcClasses;
    sorc.baseAbilities = { str: 8, dex: 16, con: 14, int: 10, wis: 10, cha: 16 };
    sorc.skillProficiencies.arcana = 0.5;
    const resolvedSorc = computeCharacterSheet(sorc);
    // Unarmored AC 13 + DEX(+3) = 16; Lv4 PB=2 -> half-proficiency adds floor(2 * 0.5) = +1
    expect(resolvedSorc.ac.final).toBe(16);
    expect(resolvedSorc.ac.activeFormulaSource).toContain('Draconic');
    expect(resolvedSorc.skills.arcana.final).toBe(1);

    // Battle Master Superiority Dice & Gloom Stalker +WIS to Init
    const bmPools = syncClassResourcePools(
      [{ className: 'Fighter', subclassName: 'Battle Master', level: 3, hitDie: 10, casterProgression: 'none' }],
      []
    );
    expect(bmPools.find((p) => p.id === 'auto_class_superiority_dice')?.max).toBe(4);

    const gloom = createBlankCharacter('gloom-1', 'Shade');
    gloom.classes = [{ className: 'Ranger', subclassName: 'Gloom Stalker', level: 3, hitDie: 10, casterProgression: 'half' }];
    gloom.baseAbilities.dex = 16; // +3
    gloom.baseAbilities.wis = 16; // +3
    expect(computeCharacterSheet(gloom).initiative.final).toBe(6);
  });

  it('produces conditionWarnings and includes new magic items, styles, 2024 origins, and monsters', () => {
    const pc = createBlankCharacter('warn-1', 'Hero');
    pc.ruleset = '2024';
    pc.conditions = ['Paralyzed', 'Prone'];
    pc.exhaustion = 2;
    const sheet = computeCharacterSheet(pc);
    expect(sheet.conditionWarnings.some((w) => w.startsWith('Paralyzed:'))).toBe(true);
    expect(sheet.conditionWarnings.some((w) => w.startsWith('Exhaustion 2:'))).toBe(true);

    const packIds = BUILTIN_CONTENT_PACKS.map((p) => p.id);
    expect(packIds).toContain('pack-srd-magic-items');
    expect(packIds).toContain('pack-srd-styles-origins');

    const all = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    expect(all.some((e) => e.name === 'Potion of Healing')).toBe(true);
    expect(all.some((e) => e.name === 'Flame Tongue Greatsword')).toBe(true);
    expect(all.some((e) => e.name === 'Magic Initiate (2024 Origin)')).toBe(true);
    expect(all.some((e) => e.category === 'monster' && e.name === 'Lich')).toBe(true);
    expect(all.some((e) => e.category === 'monster' && e.name === 'Hill Giant')).toBe(true);
  });
});
