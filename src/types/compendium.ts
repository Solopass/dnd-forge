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
  | 'monster';

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
  acFormula?: AcFormulaRule;
  acFlatBonus?: number;
  quantity?: number;
  weight?: number;
  container?: string;
  weaponMastery?: WeaponMastery;
  monsterMeta?: MonsterStatMeta;
  modifiers?: PassiveModifierRule[];
  activities: Activity[];
  entries: string[];
}
