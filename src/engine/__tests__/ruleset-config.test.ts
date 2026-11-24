import { describe, expect, it } from 'vitest';
import {
  detectRulesetPreset,
  RULESET_2014_DEFAULTS,
  RULESET_2024_DEFAULTS,
} from '../ruleset-config';
import { computeCharacterSheet, createBlankCharacter } from '../rules-math';
import { doubleDiceForCrit } from '../dice';
import { rollAllInitiativeOrder } from '../combat-machine';
import { CombatantNode } from '../../types/combat';

describe('Custom Ruleset & House Rules Engine', () => {
  it('detects 2014, 2024, and custom mix presets accurately', () => {
    expect(detectRulesetPreset(RULESET_2014_DEFAULTS)).toBe('2014');
    expect(detectRulesetPreset(RULESET_2024_DEFAULTS)).toBe('2024');
    expect(
      detectRulesetPreset({
        ...RULESET_2014_DEFAULTS,
        potionAction: 'bonus_action',
      })
    ).toBe('custom');
  });

  it('applies custom potion action, weapon mastery toggle, and exhaustion rules to computed sheets', () => {
    const pc = createBlankCharacter('char-test', 'Test Hero');
    pc.exhaustion = 2;
    pc.items.push(
      {
        id: 'pot-1',
        name: 'Potion of Healing',
        source: 'SRD 5.1',
        ruleset: '2014',
        category: 'gear',
        equipped: true,
        activities: [
          {
            id: 'act-pot',
            name: 'Potion of Healing',
            type: 'heal',
            actionEconomy: 'action',
            damageFormula: '2d4+2',
          },
        ],
        entries: [],
      },
      {
        id: 'wpn-1',
        name: 'Greatsword (Graze)',
        source: 'SRD 5.2',
        ruleset: '2024',
        category: 'weapon',
        equipped: true,
        weaponMastery: 'Graze',
        activities: [
          {
            id: 'act-gs',
            name: 'Greatsword',
            type: 'attack',
            actionEconomy: 'action',
            attackAbility: 'str',
            attackBonusFormula: '@mod+@prof',
            damageFormula: '2d6+@mod',
          },
        ],
        entries: [],
      }
    );

    const sheet2014 = computeCharacterSheet(pc, RULESET_2014_DEFAULTS);
    expect(sheet2014.actionsByEconomy.action.some((a) => a.name === 'Potion of Healing')).toBe(true);
    expect(sheet2014.actionsByEconomy.bonus_action.some((a) => a.name === 'Potion of Healing')).toBe(false);
    expect(sheet2014.actionsByEconomy.action.find((a) => a.name === 'Greatsword')?.weaponMastery).toBeUndefined();
    const baseSave = sheet2014.abilities.str.save.final;

    const customMix = computeCharacterSheet(pc, {
      ...RULESET_2014_DEFAULTS,
      exhaustionRule: '2024',
      potionAction: 'bonus_action',
      weaponMastery: 'enabled',
    });
    expect(customMix.actionsByEconomy.bonus_action.some((a) => a.name === 'Potion of Healing')).toBe(true);
    expect(customMix.actionsByEconomy.action.find((a) => a.name === 'Greatsword')?.weaponMastery).toBe('Graze');
    expect(customMix.abilities.str.save.final).toBe(baseSave - 4);
  });

  it('supports crunchy crits and 2024 Surprised initiative disadvantage', () => {
    expect(doubleDiceForCrit('2d6+4', 'standard')).toBe('4d6+4');
    expect(doubleDiceForCrit('2d6+4', 'crunchy')).toBe('2d6+12+4');

    const mob: CombatantNode = {
      id: 'm1',
      name: 'Ambush Goblin',
      kind: 'monster',
      initiative: 0,
      dexModifier: 2,
      hp: { current: 7, max: 7, temp: 0 },
      ac: 15,
      conditions: ['Surprised'],
      turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
    };

    let idx = 0;
    const seq = [18, 4]; // 2024 Disadvantage takes min(18, 4) = 4 -> +2 = 6
    const res2024 = rollAllInitiativeOrder([mob], () => seq[idx++] ?? 10, '2024');
    expect(res2024[0]?.initiative).toBe(6);

    const res2014 = rollAllInitiativeOrder([mob], () => 18, '2014');
    expect(res2014[0]?.initiative).toBe(20);
  });
});
