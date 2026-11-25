import { ClassLevel } from '../../types/character';
import { AbilityKey } from '../../types/core';

export interface ConsoleLine {
  id: string;
  timestamp: string;
  text: string;
  tone: 'info' | 'roll' | 'warn' | 'crit';
}

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'info' | 'roll' | 'crit' | 'warn';
}

export interface LevelUpPlanInput {
  className: string;
  hitDie: 6 | 8 | 10 | 12;
  casterProgression: ClassLevel['casterProgression'];
  hpGain: number;
  subclassName?: string;
  applySubclassGrants?: boolean;
  abilityIncreases?: Partial<Record<AbilityKey, number>>;
  bonusEntityIds?: string[];
}
