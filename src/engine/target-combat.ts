import { Activity } from '../types/compendium';
import { CombatantNode } from '../types/combat';
import { RollMode, WeaponMastery } from '../types/core';
import { doubleDiceForCrit, evaluateDiceExpression } from './dice';

export interface TargetAttackOutcome {
  targetId: string;
  targetName: string;
  attackTotal: number;
  isCrit: boolean;
  isFumble: boolean;
  hit: boolean;
  rawDamage: number;
  appliedDamage: number;
  modifierNote: string;
  masteryNote: string;
  nextHp: number;
  concentrationDc: number | null;
}

export interface TargetSaveOutcome {
  targetId: string;
  targetName: string;
  saveRoll: number;
  saveDc: number;
  passed: boolean;
  rawDamage: number;
  appliedDamage: number;
  modifierNote: string;
  nextHp: number;
  concentrationDc: number | null;
}

export function adjustDamageForTargetDefenses(
  rawDamage: number,
  damageType: string | undefined,
  target: CombatantNode
): { appliedDamage: number; note: string } {
  const cleanType = (damageType ?? '').toLowerCase().trim();
  const immunities = target.monsterMeta?.immunities ?? [];
  const resistances = target.monsterMeta?.resistances ?? [];
  const vulnerabilities = target.monsterMeta?.vulnerabilities ?? [];

  const matches = (list: string[]) =>
    cleanType.length > 0 &&
    list.some((item) => cleanType.includes(item.toLowerCase()) || item.toLowerCase().includes(cleanType));

  if (matches(immunities)) {
    return { appliedDamage: 0, note: `Immune (${damageType})` };
  }
  if (matches(resistances)) {
    return { appliedDamage: Math.floor(rawDamage / 2), note: `Resistant (${damageType}) ½` };
  }
  if (matches(vulnerabilities)) {
    return { appliedDamage: rawDamage * 2, note: `Vulnerable (${damageType}) ×2` };
  }
  return { appliedDamage: rawDamage, note: '' };
}

function applyDamageToHp(hp: CombatantNode['hp'], damage: number): number {
  const absorbed = Math.min(hp.temp, damage);
  const rem = Math.max(0, damage - absorbed);
  return Math.max(0, hp.current - rem);
}

const MASTERY_HIT_NOTES: Record<WeaponMastery, string> = {
  Cleave: 'Cleave: Free attack on adjacent enemy',
  Graze: 'Graze',
  Nick: 'Nick: Extra Light attack in Attack action',
  Push: 'Push: Target pushed up to 10 ft',
  Sap: 'Sap: Target has Disadvantage on next attack',
  Slow: 'Slow: Target Speed reduced by 10 ft',
  Topple: 'Topple: CON Save or Prone',
  Vex: 'Vex: Advantage on your next attack vs target',
};

export function resolveTargetAttack(
  activity: Activity,
  target: CombatantNode,
  rollMode: RollMode = 'normal',
  customAttackBonus?: number,
  diceRoller: (expr: string, mode: RollMode) => { total: number; isCrit: boolean; isFumble: boolean } = evaluateDiceExpression,
  weaponMastery?: WeaponMastery,
  attackerAbilityMod = 3
): TargetAttackOutcome {
  const bonus =
    customAttackBonus ??
    (activity.attackBonusFormula ? Number.parseInt(activity.attackBonusFormula, 10) || 0 : 0);
  const signStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
  const atkRes = diceRoller(`1d20${signStr}`, rollMode);
  const hit = !atkRes.isFumble && (atkRes.isCrit || atkRes.total >= target.ac);

  let rawDamage = 0;
  let appliedDamage = 0;
  let modifierNote = '';
  let masteryNote = '';

  if (hit && activity.damageFormula) {
    const dmgExpr = atkRes.isCrit ? doubleDiceForCrit(activity.damageFormula) : activity.damageFormula;
    rawDamage = Math.max(0, diceRoller(dmgExpr, 'normal').total);
    const adjusted = adjustDamageForTargetDefenses(rawDamage, activity.damageType, target);
    appliedDamage = adjusted.appliedDamage;
    modifierNote = adjusted.note;
    if (weaponMastery && weaponMastery !== 'Graze') {
      masteryNote = MASTERY_HIT_NOTES[weaponMastery];
    }
  } else if (!hit && weaponMastery === 'Graze') {
    rawDamage = Math.max(1, attackerAbilityMod);
    const adjusted = adjustDamageForTargetDefenses(rawDamage, activity.damageType, target);
    appliedDamage = adjusted.appliedDamage;
    modifierNote = adjusted.note;
    masteryNote = `Graze: Dealt ${appliedDamage} miss dmg`;
  }

  const nextHp = appliedDamage > 0 ? applyDamageToHp(target.hp, appliedDamage) : target.hp.current;
  const concentrationDc =
    appliedDamage > 0 ? Math.max(10, Math.floor(appliedDamage / 2)) : null;

  return {
    targetId: target.id,
    targetName: target.name,
    attackTotal: atkRes.total,
    isCrit: atkRes.isCrit,
    isFumble: atkRes.isFumble,
    hit,
    rawDamage,
    appliedDamage,
    modifierNote,
    masteryNote,
    nextHp,
    concentrationDc,
  };
}

export function resolveTargetSaves(
  activity: Activity,
  targets: CombatantNode[],
  explicitDc?: number,
  diceRoller: (expr: string, mode: RollMode) => { total: number } = evaluateDiceExpression
): TargetSaveOutcome[] {
  const saveDc =
    explicitDc ??
    (activity.saveDcFormula ? Number.parseInt(activity.saveDcFormula, 10) || 13 : 13);
  const baseDmg = activity.damageFormula ? Math.max(0, diceRoller(activity.damageFormula, 'normal').total) : 0;

  return targets.map((target) => {
    const saveMod = target.dexModifier ?? 0;
    const modStr = saveMod >= 0 ? `+${saveMod}` : `${saveMod}`;
    const saveRoll = diceRoller(`1d20${modStr}`, 'normal').total;
    const passed = saveRoll >= saveDc;
    const rawDamage = passed ? Math.floor(baseDmg / 2) : baseDmg;
    const adjusted = adjustDamageForTargetDefenses(rawDamage, activity.damageType, target);
    const nextHp = applyDamageToHp(target.hp, adjusted.appliedDamage);
    const concentrationDc =
      adjusted.appliedDamage > 0 ? Math.max(10, Math.floor(adjusted.appliedDamage / 2)) : null;

    return {
      targetId: target.id,
      targetName: target.name,
      saveRoll,
      saveDc,
      passed,
      rawDamage,
      appliedDamage: adjusted.appliedDamage,
      modifierNote: adjusted.note,
      nextHp,
      concentrationDc,
    };
  });
}
