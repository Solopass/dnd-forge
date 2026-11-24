import { describe, expect, it } from 'vitest';
import { resolveConditionRollMode } from '../conditions';
import { resolveTargetAttack } from '../target-combat';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { CombatantNode } from '../../types/combat';
import { Activity } from '../../types/compendium';

describe('Condition-aware roll mode resolution', () => {
  it('grants advantage when Invisible and disadvantage when Poisoned', () => {
    const inv = resolveConditionRollMode(['Invisible'], 'attack');
    expect(inv.mode).toBe('advantage');
    expect(inv.reasons).toContain('ADV: Invisible');

    const pois = resolveConditionRollMode(['Poisoned'], 'attack');
    expect(pois.mode).toBe('disadvantage');
    expect(pois.reasons).toContain('DIS: Poisoned');
  });

  it('cancels advantage and disadvantage to normal when both apply', () => {
    const both = resolveConditionRollMode(['Invisible', 'Poisoned'], 'attack');
    expect(both.mode).toBe('normal');
    expect(both.reasons).toEqual(expect.arrayContaining(['ADV: Invisible', 'DIS: Poisoned']));
  });

  it('applies disadvantage to DEX saving throws when Restrained', () => {
    const dexSave = resolveConditionRollMode(['Restrained'], 'save', 'dex');
    expect(dexSave.mode).toBe('disadvantage');
    expect(dexSave.reasons).toContain('DIS: Restrained');

    const wisSave = resolveConditionRollMode(['Restrained'], 'save', 'wis');
    expect(wisSave.mode).toBe('normal');
  });
});

describe('2024 Weapon Mastery & Target Combat', () => {
  const sampleTarget: CombatantNode = {
    id: 'mob-1',
    name: 'Bandit',
    kind: 'monster',
    initiative: 12,
    dexModifier: 1,
    hp: { current: 11, max: 11, temp: 0 },
    ac: 18,
    conditions: [],
    turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
  };

  const greatswordActivity: Activity = {
    id: 'act-gs',
    name: 'Greatsword',
    type: 'attack',
    actionEconomy: 'action',
    damageFormula: '2d6',
    damageType: 'slashing',
    attackBonusFormula: '5',
  };

  it('deals Graze miss damage equal to attacker ability modifier on a non-fumble miss', () => {
    const outcome = resolveTargetAttack(
      greatswordActivity,
      sampleTarget,
      'normal',
      5,
      (expr) => {
        if (expr.startsWith('1d20')) return { total: 9, isCrit: false, isFumble: false }; // 9 vs AC 18 -> miss
        return { total: 7, isCrit: false, isFumble: false };
      },
      'Graze',
      4
    );
    expect(outcome.hit).toBe(false);
    expect(outcome.appliedDamage).toBe(4);
    expect(outcome.masteryNote).toContain('Graze');
  });

  it('annotates Topple mastery on hit', () => {
    const outcome = resolveTargetAttack(
      greatswordActivity,
      sampleTarget,
      'normal',
      5,
      (expr) => {
        if (expr.startsWith('1d20')) return { total: 21, isCrit: false, isFumble: false }; // 21 vs AC 18 -> hit
        return { total: 8, isCrit: false, isFumble: false };
      },
      'Topple',
      4
    );
    expect(outcome.hit).toBe(true);
    expect(outcome.appliedDamage).toBe(8);
    expect(outcome.masteryNote).toContain('Topple');
  });

  it('populates structured weaponMastery on SRD 5.2 weapons', () => {
    const allEntities = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const gs = allEntities.find((e) => e.id === 'srd24-greatsword');
    const ls = allEntities.find((e) => e.id === 'srd24-longsword');
    expect(gs?.weaponMastery).toBe('Graze');
    expect(ls?.weaponMastery).toBe('Sap');
  });
});
