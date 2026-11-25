import {
  AbilityKey,
  ActionEconomy,
  OverridableStat,
  SkillKey,
  StatModifier,
} from '../types/core';
import type { HouseRulesConfig } from './ruleset-config';
import {
  AcFormulaRule,
  Activity,
  CompendiumEntity,
} from '../types/compendium';
import {
  ClassLevel,
  RawCharacterState,
  ResolvedActivity,
  ResolvedCharacterSheet,
  ResourcePool,
} from '../types/character';

export const SKILL_ABILITY_MAP: Record<SkillKey, AbilityKey> = {
  acrobatics: 'dex',
  animal_handling: 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  sleight_of_hand: 'dex',
  stealth: 'dex',
  survival: 'wis',
};

const ALL_ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const MULTICLASS_SLOT_TABLE: Record<number, number[]> = {
  0: [],
  1: [2],
  2: [3],
  3: [4, 2],
  4: [4, 3],
  5: [4, 3, 2],
  6: [4, 3, 3],
  7: [4, 3, 3, 1],
  8: [4, 3, 3, 2],
  9: [4, 3, 3, 3, 1],
  10: [4, 3, 3, 3, 2],
  11: [4, 3, 3, 3, 2, 1],
  12: [4, 3, 3, 3, 2, 1],
  13: [4, 3, 3, 3, 2, 1, 1],
  14: [4, 3, 3, 3, 2, 1, 1],
  15: [4, 3, 3, 3, 2, 1, 1, 1],
  16: [4, 3, 3, 3, 2, 1, 1, 1],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

export function createBlankCharacter(id: string, name: string): RawCharacterState {
  return {
    id,
    name,
    ruleset: '2014',
    species: 'Human',
    background: 'Adventurer',
    classes: [{ className: 'Fighter', level: 1, hitDie: 10, casterProgression: 'none' }],
    baseAbilities: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    bonusAbilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    saveProficiencies: ['str', 'con'],
    skillProficiencies: {
      acrobatics: 0, animal_handling: 0, arcana: 0, athletics: 1, deception: 0,
      history: 0, insight: 0, intimidation: 0, investigation: 0, medicine: 0,
      nature: 0, perception: 1, performance: 0, persuasion: 0, religion: 0,
      sleight_of_hand: 0, stealth: 0, survival: 0,
    },
    hp: { current: 12, max: 12, temp: 0 },
    deathSaves: { successes: 0, failures: 0 },
    exhaustion: 0,
    inspiration: false,
    conditions: [],
    defenses: { resistances: [], immunities: [], vulnerabilities: [] },
    resources: [{ id: 'second_wind', name: 'Second Wind', current: 1, max: 1, recovery: 'short_rest' }],
    items: [],
    overrides: {},
  };
}

export function computeEffectiveCasterLevel(classes: ClassLevel[]): number {
  const nonPactClasses = classes.filter((c) => c.casterProgression !== 'pact' && c.casterProgression !== 'none');
  if (nonPactClasses.length === 1) {
    const single = nonPactClasses[0]!;
    if (single.casterProgression === 'full') return single.level;
    if (single.casterProgression === 'half_up') return Math.ceil(single.level / 2);
    if (single.casterProgression === 'half') return single.level >= 2 ? Math.ceil(single.level / 2) : 0;
    if (single.casterProgression === 'third') return single.level >= 3 ? Math.ceil(single.level / 3) : 0;
  }

  let total = 0;
  for (const cls of nonPactClasses) {
    if (cls.casterProgression === 'full') total += cls.level;
    else if (cls.casterProgression === 'half_up') total += Math.ceil(cls.level / 2);
    else if (cls.casterProgression === 'half') total += Math.floor(cls.level / 2);
    else if (cls.casterProgression === 'third') total += Math.floor(cls.level / 3);
  }
  return Math.min(20, total);
}

export function syncSpellSlotPools(classes: ClassLevel[], existingPools: ResourcePool[]): ResourcePool[] {
  const casterLevel = computeEffectiveCasterLevel(classes);
  const slotCounts = MULTICLASS_SLOT_TABLE[casterLevel] ?? [];
  const preservedCustom = existingPools.filter((p) => !p.isAutoSpellSlot);
  const previousSlotMap = new Map(
    existingPools.filter((p) => p.isAutoSpellSlot).map((p) => [p.id, p])
  );

  const generatedSlots: ResourcePool[] = slotCounts.map((maxCount, idx) => {
    const level = idx + 1;
    const id = `spell_slot_${level}`;
    const prev = previousSlotMap.get(id);
    const ordinal = level === 1 ? '1st' : level === 2 ? '2nd' : level === 3 ? '3rd' : `${level}th`;
    return {
      id,
      name: `${ordinal}-Level Slots`,
      current: prev ? Math.min(maxCount, prev.current) : maxCount,
      max: maxCount,
      recovery: 'long_rest',
      isAutoSpellSlot: true,
    };
  });

  const pactLevel = classes
    .filter((c) => c.casterProgression === 'pact')
    .reduce((sum, c) => sum + c.level, 0);

  if (pactLevel > 0) {
    const pactCount = pactLevel >= 17 ? 4 : pactLevel >= 11 ? 3 : pactLevel >= 2 ? 2 : 1;
    const pactSlotRank = Math.min(5, Math.ceil(pactLevel / 2));
    const prevPact = previousSlotMap.get('pact_slot');
    generatedSlots.push({
      id: 'pact_slot',
      name: `Pact Slots (Lvl ${pactSlotRank})`,
      current: prevPact ? Math.min(pactCount, prevPact.current) : pactCount,
      max: pactCount,
      recovery: 'short_rest',
      isAutoSpellSlot: true,
    });
  }

  return [...generatedSlots, ...preservedCustom];
}

export function resolveResourcePoolForCost(
  resources: ResourcePool[],
  classes: ClassLevel[],
  requestedPoolId: string,
  amount: number
): { poolId: string; note?: string } | { error: string } {
  const spellMatch = requestedPoolId.match(/^spell_slot_(\d+)$/);
  if (spellMatch && spellMatch[1]) {
    const levelNeeded = Number.parseInt(spellMatch[1], 10);
    const exact = resources.find((r) => r.id === requestedPoolId);
    if (exact && exact.current >= amount) {
      return { poolId: exact.id };
    }

    const pactLevel = classes
      .filter((c) => c.casterProgression === 'pact')
      .reduce((sum, c) => sum + c.level, 0);
    const pactSlotRank = pactLevel > 0 ? Math.min(5, Math.ceil(pactLevel / 2)) : 0;
    const pactPool = resources.find((r) => r.id === 'pact_slot');
    if (pactPool && pactSlotRank >= levelNeeded && pactPool.current >= amount) {
      return { poolId: pactPool.id, note: `via Pact Slot Lvl ${pactSlotRank}` };
    }

    for (let lvl = levelNeeded + 1; lvl <= 9; lvl++) {
      const upcast = resources.find((r) => r.id === `spell_slot_${lvl}`);
      if (upcast && upcast.current >= amount) {
        return { poolId: upcast.id, note: `upcast with Level ${lvl} slot` };
      }
    }

    return { error: `No Level ${levelNeeded}+ spell slot or Pact Slot remaining.` };
  }

  const pool = resources.find((r) => r.id === requestedPoolId);
  if (pool && pool.current < amount) {
    return { error: `Insufficient ${pool.name}.` };
  }
  return { poolId: requestedPoolId };
}

export function applyRestRecovery(
  raw: RawCharacterState,
  restType: 'short_rest' | 'long_rest'
): RawCharacterState {
  const nextHp =
    restType === 'long_rest'
      ? { ...raw.hp, current: raw.hp.max }
      : raw.hp;

  const nextExhaustion =
    restType === 'long_rest' && raw.exhaustion > 0
      ? raw.exhaustion - 1
      : raw.exhaustion;

  const nextResources = raw.resources.map((pool) => {
    const recovers =
      pool.recovery === 'short_rest' ||
      (restType === 'long_rest' && (pool.recovery === 'long_rest' || pool.recovery === 'dawn'));
    return recovers ? { ...pool, current: pool.max } : pool;
  });

  return {
    ...raw,
    hp: nextHp,
    deathSaves: { successes: 0, failures: 0 },
    exhaustion: nextExhaustion,
    resources: nextResources,
  };
}

export function computeAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function computeProficiencyBonus(totalLevel: number): number {
  if (totalLevel < 1) return 2;
  return Math.floor((totalLevel - 1) / 4) + 2;
}

function buildOverridable(
  base: number,
  modifiers: StatModifier[],
  override: number | null | undefined
): OverridableStat<number> {
  const modSum = modifiers.reduce((sum, m) => sum + m.value, 0);
  const computed = base + modSum;
  const resolvedOverride = override ?? null;
  return {
    base,
    modifiers,
    override: resolvedOverride,
    final: resolvedOverride !== null ? resolvedOverride : computed,
  };
}

function evaluateAcFormula(
  rule: AcFormulaRule,
  abilityMods: Record<AbilityKey, number>
): number {
  const rawDex = abilityMods.dex;
  const cappedDex =
    rule.dexCap === null ? rawDex : Math.min(rawDex, rule.dexCap);
  const extraMod = rule.extraAbility ? abilityMods[rule.extraAbility] : 0;
  return rule.base + cappedDex + extraMod;
}

export function isEntityActive(item: CompendiumEntity): boolean {
  if (item.category === 'armor' || item.category === 'shield' || item.category === 'weapon') {
    return Boolean(item.equipped);
  }
  if (item.category === 'spell' && (item.spellLevel ?? 0) > 0) {
    if (!item.alwaysPrepared && item.prepared === false) {
      return false;
    }
  }
  if (item.requiresAttunement && !item.attuned) {
    return false;
  }
  return item.equipped !== false;
}

export function computeCantripDiceTier(totalLevel: number): number {
  if (totalLevel >= 17) return 4;
  if (totalLevel >= 11) return 3;
  if (totalLevel >= 5) return 2;
  return 1;
}

export function resolveFormulaVariables(
  formula: string,
  abilityMods: Record<AbilityKey, number>,
  profBonus: number,
  attackAbility?: AbilityKey,
  castingMod = 0,
  totalLevel = 1
): string {
  const modVal = attackAbility ? abilityMods[attackAbility] : 0;
  const cantripDice = computeCantripDiceTier(totalLevel);
  return formula
    .replace(/(?<!\{)@prof/gi, String(profBonus))
    .replace(/(?<!\{)@mod/gi, String(modVal))
    .replace(/(?<!\{)@spell/gi, String(castingMod))
    .replace(/(?<!\{)@lvl/gi, String(totalLevel))
    .replace(/(?<!\{)@cantrip/gi, String(cantripDice))
    .replace(/(?<!\{)@str/gi, String(abilityMods.str))
    .replace(/(?<!\{)@dex/gi, String(abilityMods.dex))
    .replace(/(?<!\{)@con/gi, String(abilityMods.con))
    .replace(/(?<!\{)@int/gi, String(abilityMods.int))
    .replace(/(?<!\{)@wis/gi, String(abilityMods.wis))
    .replace(/(?<!\{)@cha/gi, String(abilityMods.cha));
}

function evaluateSimpleMath(expr: string): number {
  const tokens = expr.replace(/\s+/g, '').match(/[+-]?\d+/g);
  if (!tokens) return 0;
  return tokens.reduce((sum, tok) => sum + Number.parseInt(tok, 10), 0);
}

export function computeCharacterSheet(
  raw: RawCharacterState,
  houseRules?: HouseRulesConfig
): ResolvedCharacterSheet {
  const effectiveExhaustionRule = houseRules?.exhaustionRule ?? raw.ruleset;
  const effectiveWeaponMastery = houseRules?.weaponMastery ?? 'enabled';
  const effectivePotionAction = houseRules?.potionAction;
  const totalLevel = raw.classes.reduce((sum, cls) => sum + cls.level, 0);
  const profStat = buildOverridable(
    computeProficiencyBonus(totalLevel),
    [],
    raw.overrides.proficiencyBonus
  );

  const abilityModifiers = {} as Record<AbilityKey, number>;
  const resolvedAbilities = {} as ResolvedCharacterSheet['abilities'];

  for (const key of ALL_ABILITIES) {
    const base = raw.baseAbilities[key];
    const mods: StatModifier[] = [];
    if (raw.bonusAbilities[key] !== 0) {
      mods.push({
        id: `asi-${key}`,
        source: 'Species / ASI / Feats',
        value: raw.bonusAbilities[key],
      });
    }
    const scoreStat = buildOverridable(base, mods, raw.overrides.abilities?.[key]);
    const mod = computeAbilityModifier(scoreStat.final);
    abilityModifiers[key] = mod;
    resolvedAbilities[key] = {
      score: scoreStat,
      modifier: mod,
      save: buildOverridable(mod, [], null),
    };
  }

  const activeItems = raw.items.filter(isEntityActive);
  const attunementCount = raw.items.filter((i) => i.requiresAttunement && i.attuned).length;
  const wearingArmor = activeItems.some((item) => item.category === 'armor');
  const wearingShield = activeItems.some((item) => item.category === 'shield');

  let bestFormulaAc = 10 + abilityModifiers.dex;
  let bestFormulaSource = 'Unarmored (10 + DEX)';

  if (
    !wearingArmor &&
    raw.classes.some(
      (c) =>
        c.className.toLowerCase() === 'sorcerer' &&
        (c.subclassName ?? '').toLowerCase().includes('draconic')
    )
  ) {
    const draconicAc = 13 + abilityModifiers.dex;
    if (draconicAc > bestFormulaAc) {
      bestFormulaAc = draconicAc;
      bestFormulaSource = 'Draconic Resilience (13 + DEX)';
    }
  }

  for (const item of activeItems) {
    if (!item.acFormula) continue;
    if (item.acFormula.requiresUnarmored && wearingArmor) continue;
    const candidateAc = evaluateAcFormula(item.acFormula, abilityModifiers);
    if (candidateAc > bestFormulaAc) {
      bestFormulaAc = candidateAc;
      bestFormulaSource = item.name;
    }
  }

  const acFlatModifiers: StatModifier[] = [];
  const saveAllModifiers: StatModifier[] = [];
  const speedModifiers: StatModifier[] = [];
  const initiativeModifiers: StatModifier[] = [];
  let attackAllBonus = 0;
  let attackRangedBonus = 0;
  let damageMeleeBonus = 0;
  let spellAttackItemBonus = 0;
  let critThreshold = 20;

  if (
    raw.classes.some(
      (c) =>
        c.className.toLowerCase() === 'fighter' &&
        c.level >= 3 &&
        (c.subclassName ?? '').toLowerCase().includes('champion')
    )
  ) {
    const hasSuperiorCrit = raw.classes.some(
      (c) =>
        c.className.toLowerCase() === 'fighter' &&
        c.level >= 15 &&
        (c.subclassName ?? '').toLowerCase().includes('champion')
    );
    critThreshold = Math.min(critThreshold, hasSuperiorCrit ? 18 : 19);
  }

  if (
    raw.classes.some(
      (c) =>
        c.className.toLowerCase() === 'ranger' &&
        c.level >= 3 &&
        (c.subclassName ?? '').toLowerCase().includes('gloom')
    )
  ) {
    const wisInitBonus = Math.max(0, abilityModifiers.wis);
    if (wisInitBonus > 0) {
      initiativeModifiers.push({
        id: 'gloom-stalker-dread-ambusher',
        source: 'Dread Ambusher (WIS)',
        value: wisInitBonus,
      });
    }
  }

  for (const item of activeItems) {
    if (item.acFlatBonus && item.acFlatBonus !== 0) {
      acFlatModifiers.push({
        id: `ac-flat-${item.id}`,
        source: item.name,
        value: item.acFlatBonus,
      });
    }
    for (const mod of item.modifiers ?? []) {
      if (mod.condition === 'wearing_armor' && !wearingArmor) continue;
      if (mod.condition === 'unarmored_no_shield' && (wearingArmor || wearingShield)) continue;

      if (mod.target === 'ac.bonus') {
        acFlatModifiers.push({ id: `mod-${item.id}-ac`, source: item.name, value: mod.value });
      } else if (mod.target === 'save.all') {
        saveAllModifiers.push({ id: `mod-${item.id}-save`, source: item.name, value: mod.value });
      } else if (mod.target === 'speed.walk') {
        speedModifiers.push({ id: `mod-${item.id}-speed`, source: item.name, value: mod.value });
      } else if (mod.target === 'initiative') {
        initiativeModifiers.push({ id: `mod-${item.id}-init`, source: item.name, value: mod.value });
      } else if (mod.target === 'attack.all') {
        attackAllBonus += mod.value;
      } else if (mod.target === 'attack.ranged') {
        attackRangedBonus += mod.value;
      } else if (mod.target === 'damage.melee') {
        damageMeleeBonus += mod.value;
      } else if (mod.target === 'spell.attack') {
        spellAttackItemBonus += mod.value;
      } else if (mod.target === 'crit.threshold') {
        critThreshold = Math.min(critThreshold, mod.value);
      }
    }
  }

  const exhaustion2024Penalty =
    effectiveExhaustionRule === '2024' && raw.exhaustion > 0 ? -2 * raw.exhaustion : 0;

  const acStat = {
    ...buildOverridable(bestFormulaAc, acFlatModifiers, raw.overrides.ac),
    activeFormulaSource: bestFormulaSource,
  };

  for (const key of ALL_ABILITIES) {
    const isProf = raw.saveProficiencies.includes(key);
    const saveMods: StatModifier[] = [...saveAllModifiers];
    if (isProf) {
      saveMods.push({
        id: `save-prof-${key}`,
        source: 'Proficiency',
        value: profStat.final,
      });
    }
    if (exhaustion2024Penalty !== 0) {
      saveMods.push({
        id: 'exhaustion-2024',
        source: `Exhaustion (${raw.exhaustion})`,
        value: exhaustion2024Penalty,
      });
    }
    resolvedAbilities[key].save = buildOverridable(
      abilityModifiers[key],
      saveMods,
      raw.overrides.saves?.[key]
    );
  }

  const resolvedSkills = {} as Record<SkillKey, OverridableStat<number>>;
  (Object.keys(SKILL_ABILITY_MAP) as SkillKey[]).forEach((skillKey) => {
    const abilityKey = SKILL_ABILITY_MAP[skillKey];
    const profMultiplier = raw.skillProficiencies[skillKey] ?? 0;
    const skillMods: StatModifier[] = [];
    if (profMultiplier > 0) {
      skillMods.push({
        id: `skill-prof-${skillKey}`,
        source: profMultiplier === 2 ? 'Expertise' : profMultiplier === 0.5 ? 'Half-Proficiency' : 'Proficiency',
        value: Math.floor(profStat.final * profMultiplier),
      });
    }
    if (exhaustion2024Penalty !== 0) {
      skillMods.push({
        id: 'exhaustion-2024',
        source: `Exhaustion (${raw.exhaustion})`,
        value: exhaustion2024Penalty,
      });
    }
    resolvedSkills[skillKey] = buildOverridable(
      abilityModifiers[abilityKey],
      skillMods,
      raw.overrides.skills?.[skillKey]
    );
  });

  const primaryCastingAbility: AbilityKey | null =
    raw.classes.some((c) => c.className.toLowerCase() === 'artificer' || c.className.toLowerCase() === 'wizard')
      ? 'int'
      : raw.classes.some((c) => ['cleric', 'druid', 'ranger'].includes(c.className.toLowerCase()))
      ? 'wis'
      : raw.classes.some((c) => ['bard', 'paladin', 'sorcerer', 'warlock'].includes(c.className.toLowerCase()))
      ? 'cha'
      : null;

  const castingMod = primaryCastingAbility ? abilityModifiers[primaryCastingAbility] : 0;
  const effectiveLevel = Math.max(1, totalLevel);

  const actionsByEconomy: Record<ActionEconomy, ResolvedActivity[]> = {
    action: [],
    bonus_action: [],
    reaction: [],
    free: [],
    special: [],
  };

  const isRangedWeaponItem = (item: CompendiumEntity, act: Activity): boolean => {
    const text = `${item.name} ${act.description ?? ''} ${item.entries.join(' ')}`.toLowerCase();
    return (
      text.includes('ammunition') ||
      text.includes('ranged weapon attack') ||
      ['shortbow', 'longbow', 'light crossbow', 'heavy crossbow', 'hand crossbow', 'sling', 'blowgun', 'dart'].some(
        (kw) => item.name.toLowerCase().includes(kw)
      )
    );
  };

  const isTwoHandedWeapon = (item: CompendiumEntity, act: Activity): boolean => {
    const text = `${act.description ?? ''} ${item.entries.join(' ')}`.toLowerCase();
    return text.includes('two-handed');
  };

  const appendFlatBonus = (formula: string, bonus: number): string => {
    if (bonus === 0) return formula;
    if (/([+-])\s*(\d+)\s*$/.test(formula)) {
      return formula
        .replace(/([+-])\s*(\d+)\s*$/, (_m, signChar: string, numStr: string) => {
          const current = (signChar === '-' ? -1 : 1) * Number.parseInt(numStr, 10);
          const next = current + bonus;
          if (next === 0) return '';
          return next > 0 ? `+ ${next}` : `- ${Math.abs(next)}`;
        })
        .trim();
    }
    return `${formula} ${bonus > 0 ? `+ ${bonus}` : `- ${Math.abs(bonus)}`}`;
  };

  for (const item of activeItems) {
    for (const act of item.activities) {
      const isWeaponAttack = item.category === 'weapon' && act.type === 'attack';
      const isRanged = isRangedWeaponItem(item, act);
      const isMeleeOneHanded = isWeaponAttack && !isRanged && !isTwoHandedWeapon(item, act);

      const baseAttack = act.attackBonusFormula
        ? evaluateSimpleMath(
            resolveFormulaVariables(
              act.attackBonusFormula,
              abilityModifiers,
              profStat.final,
              act.attackAbility,
              castingMod,
              effectiveLevel
            )
          )
        : null;
      const weaponAttackBonus = isWeaponAttack
        ? attackAllBonus + (isRanged ? attackRangedBonus : 0)
        : item.category === 'spell' && act.type === 'attack'
        ? spellAttackItemBonus
        : 0;
      const resolvedAttack =
        baseAttack !== null ? baseAttack + weaponAttackBonus + exhaustion2024Penalty : null;

      const baseDc = act.saveDcFormula
        ? evaluateSimpleMath(
            resolveFormulaVariables(
              act.saveDcFormula,
              abilityModifiers,
              profStat.final,
              act.attackAbility,
              castingMod,
              effectiveLevel
            )
          )
        : null;
      const resolvedDc =
        baseDc !== null ? baseDc + exhaustion2024Penalty : null;

      const rawResolvedDamage = act.damageFormula
        ? resolveFormulaVariables(
            act.damageFormula,
            abilityModifiers,
            profStat.final,
            act.attackAbility,
            castingMod,
            effectiveLevel
          )
        : null;
      const resolvedDamage =
        rawResolvedDamage && isMeleeOneHanded && damageMeleeBonus !== 0
          ? appendFlatBonus(rawResolvedDamage, damageMeleeBonus)
          : rawResolvedDamage;

      const resolvedDescription = act.description
        ? resolveFormulaVariables(
            act.description,
            abilityModifiers,
            profStat.final,
            act.attackAbility,
            castingMod,
            effectiveLevel
          )
        : undefined;

      const spellMeta =
        item.category === 'spell' &&
        (item.castingTime || item.range || item.components || item.duration)
          ? {
              castingTime: item.castingTime,
              range: item.range,
              components: item.components,
              duration: item.duration,
            }
          : undefined;

      const isHealingPotion =
        item.name.toLowerCase().includes('potion of') && item.name.toLowerCase().includes('healing');
      const inferredSpellEconomy: ActionEconomy =
        item.category === 'spell' && act.actionEconomy === 'action' && item.castingTime
          ? item.castingTime.toLowerCase().includes('bonus')
            ? 'bonus_action'
            : item.castingTime.toLowerCase().includes('reaction')
              ? 'reaction'
              : 'action'
          : act.actionEconomy;
      const targetEconomy: ActionEconomy =
        isHealingPotion && effectivePotionAction ? effectivePotionAction : inferredSpellEconomy;

      actionsByEconomy[targetEconomy].push({
        ...act,
        actionEconomy: targetEconomy,
        parentItemId: item.id,
        parentItemName: item.name,
        weaponMastery: effectiveWeaponMastery === 'enabled' ? item.weaponMastery : undefined,
        concentration: Boolean(item.concentration),
        ritual: Boolean(item.ritual),
        spellMeta,
        computedAttackBonus: resolvedAttack,
        computedSaveDc: resolvedDc,
        computedDamage: resolvedDamage,
        resolvedDescription,
      });
    }
  }

  if (raw.wildShapeForm) {
    const beast = raw.wildShapeForm;
    const wildActions: ResolvedActivity[] = beast.attacks.map((atk) => ({
      ...atk,
      parentItemId: 'wild-shape',
      parentItemName: beast.name,
      concentration: false,
      ritual: false,
      computedAttackBonus: atk.attackBonusFormula
        ? evaluateSimpleMath(atk.attackBonusFormula.replace(/^\+/, ''))
        : null,
      computedSaveDc: atk.saveDcFormula ? evaluateSimpleMath(atk.saveDcFormula) : null,
      computedDamage: atk.damageFormula ?? null,
      resolvedDescription: atk.description,
    }));
    actionsByEconomy.action = [...wildActions, ...actionsByEconomy.action];
  }

  const baseWalkSpeed = raw.speeds?.walk ?? 30;
  if (raw.exhaustion > 0) {
    if (effectiveExhaustionRule === '2024') {
      speedModifiers.push({
        id: 'exhaustion-speed-2024',
        source: `Exhaustion (${raw.exhaustion})`,
        value: -5 * raw.exhaustion,
      });
    } else if (raw.exhaustion >= 2) {
      const preExhaustionWalk =
        baseWalkSpeed + speedModifiers.reduce((acc, m) => acc + m.value, 0);
      speedModifiers.push({
        id: 'exhaustion-speed-2014',
        source: `Exhaustion (${raw.exhaustion})`,
        value: -Math.ceil(preExhaustionWalk / 2),
      });
    }
  }

  const finalAcStat = raw.wildShapeForm
    ? {
        ...buildOverridable(raw.wildShapeForm.ac, [], raw.overrides.ac),
        activeFormulaSource: `Wild Shape: ${raw.wildShapeForm.name}`,
      }
    : acStat;
  const rawSpeedStat = raw.wildShapeForm
    ? buildOverridable(raw.wildShapeForm.speed, [], raw.overrides.speed)
    : buildOverridable(baseWalkSpeed, speedModifiers, raw.overrides.speed);
  const finalSpeedStat = {
    ...rawSpeedStat,
    final: Math.max(0, rawSpeedStat.final),
  };

  const PREPARED_CASTER_MAP: Record<string, { ability: AbilityKey; half: boolean }> = {
    cleric: { ability: 'wis', half: false },
    druid: { ability: 'wis', half: false },
    wizard: { ability: 'int', half: false },
    paladin: { ability: 'cha', half: true },
    artificer: { ability: 'int', half: true },
  };
  let hasPreparedCaster = false;
  let maxPreparedTotal = 0;
  for (const cls of raw.classes) {
    const rule = PREPARED_CASTER_MAP[cls.className.toLowerCase()];
    if (!rule) continue;
    hasPreparedCaster = true;
    const mod = abilityModifiers[rule.ability];
    const effective = rule.half ? Math.floor(cls.level / 2) : cls.level;
    maxPreparedTotal += Math.max(1, effective + mod);
  }
  const maxPrepared = hasPreparedCaster ? maxPreparedTotal : null;
  const preparedCount = raw.items.filter(
    (i) =>
      i.category === 'spell' &&
      (i.spellLevel ?? 0) > 0 &&
      i.prepared !== false &&
      !i.alwaysPrepared
  ).length;

  const spellExhaustionMods: StatModifier[] =
    exhaustion2024Penalty !== 0
      ? [{ id: 'exhaustion-2024', source: `Exhaustion (${raw.exhaustion})`, value: exhaustion2024Penalty }]
      : [];
  const spellAttackMods: StatModifier[] = [...spellExhaustionMods];
  if (spellAttackItemBonus !== 0) {
    spellAttackMods.push({ id: 'spell-attack-item', source: 'Items & Features', value: spellAttackItemBonus });
  }

  const CONDITION_RULE_NOTES: Record<string, string> = {
    Blinded: 'Blinded: Attack rolls have Disadvantage; attacks against you have Advantage.',
    Charmed: 'Charmed: Cannot attack or target the charmer with harmful effects.',
    Deafened: 'Deafened: Cannot hear; auto-fails hearing-based checks.',
    Frightened: 'Frightened: Disadvantage on checks & attacks while source is in sight.',
    Grappled: 'Grappled: Speed becomes 0.',
    Incapacitated: 'Incapacitated: Cannot take Actions or Reactions; breaks Concentration.',
    Invisible: 'Invisible: Attack rolls have Advantage; attacks against you have Disadvantage.',
    Paralyzed: 'Paralyzed: Incapacitated; auto-fail STR & DEX saves; hits within 5 ft are Crits.',
    Petrified: 'Petrified: Incapacitated; resistance to all damage; immune to poison/disease.',
    Poisoned: 'Poisoned: Disadvantage on attack rolls and ability checks.',
    Prone: 'Prone: Disadvantage on attacks; melee attacks within 5 ft vs you have Advantage.',
    Restrained: 'Restrained: Speed 0; Disadv. on attacks & DEX saves; attacks vs you have Advantage.',
    Stunned: 'Stunned: Incapacitated; auto-fail STR & DEX saves; breaks Concentration.',
    Unconscious: 'Unconscious: Incapacitated & Prone; auto-fail STR/DEX saves; hits within 5 ft are Crits.',
  };

  const conditionWarnings = raw.conditions
    .map((cond) => CONDITION_RULE_NOTES[cond] ?? `${cond}: Active condition.`)
    .slice();
  if (raw.exhaustion > 0) {
    if (effectiveExhaustionRule === '2024') {
      conditionWarnings.push(
        `Exhaustion ${raw.exhaustion}: ${-2 * raw.exhaustion} to d20 Tests & Save DCs; -${5 * raw.exhaustion} ft Speed.`
      );
    } else {
      conditionWarnings.push(
        `Exhaustion ${raw.exhaustion}: Disadvantage on ability checks${raw.exhaustion >= 2 ? '; Speed halved' : ''}${raw.exhaustion >= 3 ? '; Disadv. on attacks/saves' : ''}.`
      );
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    ruleset: raw.ruleset,
    totalLevel,
    proficiencyBonus: profStat,
    abilities: resolvedAbilities,
    skills: resolvedSkills,
    passivePerception: 10 + resolvedSkills.perception.final,
    passiveInvestigation: 10 + resolvedSkills.investigation.final,
    passiveInsight: 10 + resolvedSkills.insight.final,
    ac: finalAcStat,
    initiative: buildOverridable(abilityModifiers.dex, initiativeModifiers, raw.overrides.initiative),
    speed: finalSpeedStat,
    speeds: {
      walk: finalSpeedStat.final,
      fly: raw.speeds?.fly ?? 0,
      swim: raw.speeds?.swim ?? 0,
      climb: raw.speeds?.climb ?? 0,
      burrow: raw.speeds?.burrow ?? 0,
    },
    senses: {
      darkvision: raw.senses?.darkvision ?? 0,
      blindsight: raw.senses?.blindsight ?? 0,
      tremorsense: raw.senses?.tremorsense ?? 0,
      truesight: raw.senses?.truesight ?? 0,
    },
    attunementCount,
    spellcasting: {
      primaryAbility: primaryCastingAbility,
      effectiveCasterLevel: computeEffectiveCasterLevel(raw.classes),
      saveDc: buildOverridable(
        8 + profStat.final + castingMod,
        spellExhaustionMods,
        raw.overrides.spellSaveDc
      ),
      attackBonus: buildOverridable(
        profStat.final + castingMod,
        spellAttackMods,
        raw.overrides.spellAttackBonus
      ),
      preparedCount,
      maxPrepared,
    },
    wildShapeForm: raw.wildShapeForm ?? null,
    hp: raw.hp,
    deathSaves: raw.deathSaves,
    exhaustion: raw.exhaustion,
    inspiration: Boolean(raw.inspiration),
    critThreshold,
    conditions: raw.conditions,
    defenses: {
      resistances: [...(raw.defenses?.resistances ?? [])],
      immunities: [...(raw.defenses?.immunities ?? [])],
      vulnerabilities: [...(raw.defenses?.vulnerabilities ?? [])],
    },
    conditionWarnings,
    resources: raw.resources,
    actionsByEconomy,
  };
}
