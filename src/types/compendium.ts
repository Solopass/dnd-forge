import { AbilityKey, ActionEconomy, Ruleset } from './core';

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

export interface MonsterStatMeta {
  ac: number;
  hp: number;
  dexModifier: number;
  cr?: string;
}

export interface CompendiumEntity {
  id: string;
  name: string;
  source: string;
  ruleset: Ruleset;
  category: ItemCategory;
  equipped?: boolean;
  prepared?: boolean;
  alwaysPrepared?: boolean;
  attuned?: boolean;
  requiresAttunement?: boolean;
  concentration?: boolean;
  spellLevel?: number;
  acFormula?: AcFormulaRule;
  acFlatBonus?: number;
  monsterMeta?: MonsterStatMeta;
  modifiers?: PassiveModifierRule[];
  activities: Activity[];
  entries: string[];
}
