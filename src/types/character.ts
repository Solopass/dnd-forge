import {
  AbilityKey,
  ActionEconomy,
  OverridableStat,
  RecoveryTrigger,
  Ruleset,
  SkillKey,
} from './core';
import { Activity, CompendiumEntity } from './compendium';

export interface ClassLevel {
  className: string;
  subclassName?: string;
  level: number;
  hitDie: 6 | 8 | 10 | 12;
  casterProgression: 'full' | 'half' | 'half_up' | 'third' | 'pact' | 'none';
}

export interface ResourcePool {
  id: string;
  name: string;
  current: number;
  max: number;
  recovery: RecoveryTrigger;
  isAutoSpellSlot?: boolean;
  isAutoClassPool?: boolean;
}

export interface WildShapeForm {
  id: string;
  name: string;
  ac: number;
  hp: {
    current: number;
    max: number;
  };
  speed: number;
  attacks: Activity[];
}

export interface CharacterOverrides {
  abilities?: Partial<Record<AbilityKey, number>>;
  ac?: number | null;
  initiative?: number | null;
  speed?: number | null;
  proficiencyBonus?: number | null;
  spellSaveDc?: number | null;
  spellAttackBonus?: number | null;
  skills?: Partial<Record<SkillKey, number | null>>;
  saves?: Partial<Record<AbilityKey, number | null>>;
}

export interface RawCharacterState {
  id: string;
  name: string;
  ruleset: Ruleset;
  species: string;
  background: string;
  xp?: number;
  avatarUrl?: string;
  classes: ClassLevel[];
  baseAbilities: Record<AbilityKey, number>;
  bonusAbilities: Record<AbilityKey, number>;
  saveProficiencies: AbilityKey[];
  skillProficiencies: Record<SkillKey, 0 | 0.5 | 1 | 2>;
  hp: {
    current: number;
    max: number;
    temp: number;
  };
  deathSaves: {
    successes: number;
    failures: number;
  };
  exhaustion: number;
  inspiration?: boolean;
  conditions: string[];
  defenses?: {
    resistances: string[];
    immunities: string[];
    vulnerabilities: string[];
  };
  resources: ResourcePool[];
  items: CompendiumEntity[];
  overrides: CharacterOverrides;
  wildShapeForm?: WildShapeForm | null;
  currency?: {
    cp: number;
    sp: number;
    ep: number;
    gp: number;
    pp: number;
  };
  notes?: {
    bio: string;
    campaign: string;
    proficiencies: string;
  };
}

export interface ResolvedActivity extends Activity {
  parentItemId: string;
  parentItemName: string;
  concentration: boolean;
  ritual?: boolean;
  spellMeta?: {
    castingTime?: string;
    range?: string;
    components?: string;
    duration?: string;
  };
  computedAttackBonus: number | null;
  computedSaveDc: number | null;
  computedDamage: string | null;
  resolvedDescription?: string;
}

export interface ResolvedCharacterSheet {
  id: string;
  name: string;
  ruleset: Ruleset;
  totalLevel: number;
  proficiencyBonus: OverridableStat<number>;
  abilities: Record<
    AbilityKey,
    {
      score: OverridableStat<number>;
      modifier: number;
      save: OverridableStat<number>;
    }
  >;
  skills: Record<SkillKey, OverridableStat<number>>;
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;
  ac: OverridableStat<number> & { activeFormulaSource: string };
  initiative: OverridableStat<number>;
  speed: OverridableStat<number>;
  attunementCount: number;
  spellcasting: {
    primaryAbility: AbilityKey | null;
    effectiveCasterLevel: number;
    saveDc: OverridableStat<number>;
    attackBonus: OverridableStat<number>;
    preparedCount: number;
    maxPrepared: number | null;
  };
  wildShapeForm: WildShapeForm | null;
  hp: RawCharacterState['hp'];
  deathSaves: RawCharacterState['deathSaves'];
  exhaustion: number;
  inspiration: boolean;
  critThreshold: number;
  conditions: string[];
  defenses: {
    resistances: string[];
    immunities: string[];
    vulnerabilities: string[];
  };
  conditionWarnings: string[];
  resources: ResourcePool[];
  actionsByEconomy: Record<ActionEconomy, ResolvedActivity[]>;
}
