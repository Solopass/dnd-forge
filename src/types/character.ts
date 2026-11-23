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
  conditions: string[];
  resources: ResourcePool[];
  items: CompendiumEntity[];
  overrides: CharacterOverrides;
}

export interface ResolvedActivity extends Activity {
  parentItemId: string;
  parentItemName: string;
  concentration: boolean;
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
  };
  hp: RawCharacterState['hp'];
  deathSaves: RawCharacterState['deathSaves'];
  exhaustion: number;
  conditions: string[];
  resources: ResourcePool[];
  actionsByEconomy: Record<ActionEconomy, ResolvedActivity[]>;
}
