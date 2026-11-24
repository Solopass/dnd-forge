import { describe, expect, it } from 'vitest';
import { CLASS_DEFINITIONS, getSubclassPresets } from '../classes';
import { evaluateEncounterDifficulty } from '../encounter-math';
import { adapt5eToolsPayload } from '../five-tools-adapter';
import { buildCharacterFromPreset } from '../classes';
import { computeCharacterSheet } from '../rules-math';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';

describe('Expanded D&D Forge Features', () => {
  it('evaluates 5e encounter difficulty thresholds across CRs and multipliers', () => {
    const fourLvl5 = [5, 5, 5, 5];

    // 1x CR 3 (Owlbear = 700 XP) vs 4x Lvl 5 (Easy=1000, Med=2000) -> Trivial
    const singleOwlbear = evaluateEncounterDifficulty(fourLvl5, ['3']);
    expect(singleOwlbear.rawXp).toBe(700);
    expect(singleOwlbear.adjustedXp).toBe(700);
    expect(singleOwlbear.rating).toBe('Trivial');

    // 2x CR 3 (1400 * 1.5 = 2100) vs Med=2000, Hard=3000 -> Medium
    const twoOwlbears = evaluateEncounterDifficulty(fourLvl5, ['3', '3']);
    expect(twoOwlbears.adjustedXp).toBe(2100);
    expect(twoOwlbears.rating).toBe('Medium');

    // 1x CR 10 (Young Red Dragon = 5900) vs Deadly=4400 -> Deadly
    const dragon = evaluateEncounterDifficulty(fourLvl5, ['10']);
    expect(dragon.adjustedXp).toBe(5900);
    expect(dragon.rating).toBe('Deadly');
  });

  it('provides high-level 6th-9th SRD spells that resolve with caster spell stat', () => {
    const highPack = BUILTIN_CONTENT_PACKS.find((p) => p.id === 'pack-srd-high-level-spells');
    expect(highPack).toBeDefined();
    expect(highPack?.entities.some((e) => e.spellLevel === 6 && e.name === 'Chain Lightning')).toBe(true);
    expect(highPack?.entities.some((e) => e.spellLevel === 9 && e.name === 'Meteor Swarm')).toBe(true);

    const wiz = buildCharacterFromPreset({
      id: 'wiz-17',
      name: 'Elminster',
      className: 'Wizard',
      level: 17,
      speciesName: 'Elf',
      backgroundName: 'Sage',
      ruleset: '2014',
    });
    const meteor = highPack!.entities.find((e) => e.name === 'Meteor Swarm')!;
    wiz.items.push(structuredClone(meteor));

    const resolved = computeCharacterSheet(wiz);
    // Elf (+1 INT) + Wizard 15 -> 16 (+3), Prof at 17 = +6 => Save DC 17
    const castMeteor = resolved.actionsByEconomy.action.find((a) => a.name.includes('Meteor Swarm'));
    expect(castMeteor?.computedSaveDc).toBe(17);
  });

  it('includes subclass presets for every supported class', () => {
    for (const def of CLASS_DEFINITIONS) {
      const presets = getSubclassPresets(def.className);
      expect(presets.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('classifies 5e.tools items (weapon/armor/shield) and extracts monster attacks', () => {
    const payload = {
      item: [
        { name: 'Flame Tongue Rapier', source: 'DMG', type: 'M', property: ['F'], dmg1: '1d8', weight: 2 },
        { name: 'Mithral Half Plate', source: 'DMG', type: 'MA', ac: 15, weight: 20 },
        { name: 'Sentinel Shield', source: 'DMG', type: 'S', ac: 2, weight: 6 },
      ],
      monster: [
        {
          name: 'Death Knight',
          source: 'MM',
          ac: [{ ac: 20 }],
          hp: { average: 180 },
          dex: 11,
          cr: '17',
          action: [
            {
              name: 'Longsword',
              entries: ['Melee Weapon Attack: {@hit 11} to hit, reach 5 ft., one target. Hit: ({@damage 1d8 + 5}) slashing damage.'],
            },
          ],
        },
      ],
    };

    const { entities, skipped } = adapt5eToolsPayload(payload);
    expect(skipped).toBe(0);
    const rapier = entities.find((e) => e.name === 'Flame Tongue Rapier');
    expect(rapier?.category).toBe('weapon');
    expect(rapier?.activities[0]?.attackAbility).toBe('dex');
    expect(rapier?.activities[0]?.damageFormula).toBe('1d8 + @dex');

    const armor = entities.find((e) => e.name === 'Mithral Half Plate');
    expect(armor?.category).toBe('armor');
    expect(armor?.acFormula).toEqual({ base: 15, dexCap: 2 });

    const shield = entities.find((e) => e.name === 'Sentinel Shield');
    expect(shield?.category).toBe('shield');
    expect(shield?.acFlatBonus).toBe(2);

    const dk = entities.find((e) => e.name === 'Death Knight');
    expect(dk?.monsterMeta?.cr).toBe('17');
    expect(dk?.activities[0]?.attackBonusFormula).toBe('+11');
    expect(dk?.activities[0]?.damageFormula).toBe('1d8 + 5');
  });
});
