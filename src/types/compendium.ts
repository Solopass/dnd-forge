import { AbilityKey, ActionEconomy, Ruleset, WeaponMastery } from './core';

export type ActivityType = 'attack' | 'save' | 'heal' | 'summon' | 'utility';

export interface ResourceCost {
  poolId: string;
  amount: number;
}

export interface Activity {
  id: string;
  name: string;
  type: ActivityType;
  actionEconomy: ActionEconomy;
  resourceCost?: ResourceCost;
  attackBonusFormula?: string;
  attackAbility?: AbilityKey;
  saveAbility?: AbilityKey;
  saveDcFormula?: string;
  damageFormula?: string;
  damageType?: string;
  upcastDicePerLevel?: string;
  summonTemplateId?: string;
  description?: string;
}

export type ItemCategory =
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'gear'
  | 'spell'
  | 'feature'
  | 'feat'
  | 'infusion'
  | 'monster'
  | 'background'
  | 'species';

export interface AcFormulaRule {
  base: number;
  dexCap: number | null;
  extraAbility?: AbilityKey;
  requiresUnarmored?: boolean;
}

export interface PassiveModifierRule {
  target: string;
  value: number;
  condition?: string;
}

export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

export interface MonsterStatMeta {
  ac: number;
  hp: number;
  dexModifier: number;
  cr?: string;
  size?: CreatureSize;
  speeds?: string;
  saves?: string;
  skills?: string;
  resistances?: string[];
  immunities?: string[];
  vulnerabilities?: string[];
  senses?: string;
  legendaryActionsMax?: number;
  rechargeAbility?: { name: string; minRoll: number };
  traits?: string[];
}

export interface CompendiumEntity {
  id: string;
  name: string;
  source: string;
  ruleset: Ruleset;
  category: ItemCategory;
  imageUrl?: string;
  equipped?: boolean;
  prepared?: boolean;
  alwaysPrepared?: boolean;
  attuned?: boolean;
  requiresAttunement?: boolean;
  concentration?: boolean;
  ritual?: boolean;
  castingTime?: string;
  range?: string;
  components?: string;
  duration?: string;
  spellLevel?: number;
  classes?: string[];
  acFormula?: AcFormulaRule;
  acFlatBonus?: number;
  quantity?: number;
  /** Sheet items only (weapon, armor, shield): +0..+3 added by the player on top of the base item. */
  magicBonus?: 0 | 1 | 2 | 3;
  /** Sheet items only: a name the player gave this copy; shown instead of the base name. */
  customName?: string;
  weight?: number;
  container?: string;
  weaponMastery?: WeaponMastery;
  monsterMeta?: MonsterStatMeta;
  modifiers?: PassiveModifierRule[];
  activities: Activity[];
  entries: string[];
  /** Derived by the duplicate folding (never stored): the other sources that carry this same entry. */
  alsoIn?: string[];
}
