export type Ruleset = '2014' | '2024' | 'homebrew';

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type SkillKey =
  | 'acrobatics'
  | 'animal_handling'
  | 'arcana'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleight_of_hand'
  | 'stealth'
  | 'survival';

export type ActionEconomy = 'action' | 'bonus_action' | 'reaction' | 'free' | 'special';

export type RecoveryTrigger = 'short_rest' | 'long_rest' | 'dawn' | 'turn_start' | 'manual';

export interface StatModifier {
  id: string;
  source: string;
  value: number;
}

export interface OverridableStat<T> {
  base: T;
  modifiers: StatModifier[];
  override: T | null;
  final: T;
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export type WeaponMastery =
  | 'Cleave'
  | 'Graze'
  | 'Nick'
  | 'Push'
  | 'Sap'
  | 'Slow'
  | 'Topple'
  | 'Vex';

export interface ActiveBuffState {
  bless: boolean;
  rage: boolean;
  sneakAttack: boolean;
}

export const STANDARD_CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const;
