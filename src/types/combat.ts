import { ActionEconomy } from './core';
import { Activity } from './compendium';

export type ExpirationTrigger =
  | 'start_of_source_turn'
  | 'end_of_source_turn'
  | 'start_of_target_turn'
  | 'end_of_target_turn'
  | 'rounds_remaining'
  | 'concentration'
  | 'indefinite';

export interface ActiveEffect {
  id: string;
  name: string;
  sourceCombatantId: string;
  targetCombatantId: string;
  isConcentration: boolean;
  expiration: ExpirationTrigger;
  roundsRemaining?: number;
  linkedSummonIds?: string[];
  notes?: string;
}

export interface CombatantNode {
  id: string;
  name: string;
  kind: 'pc' | 'npc' | 'monster' | 'summon';
  ownerId?: string;
  characterId?: string;
  initiative: number;
  dexModifier: number;
  ac: number;
  hp: {
    current: number;
    max: number;
    temp: number;
  };
  conditions: string[];
  actions?: Activity[];
  turnEconomyUsed: Record<ActionEconomy, boolean>;
}

export interface CombatLogEntry {
  id: string;
  round: number;
  timestamp: number;
  message: string;
  severity: 'info' | 'warning' | 'crit' | 'fumble';
}

export interface CombatEncounterState {
  id: string;
  name: string;
  round: number;
  activeTurnIndex: number;
  combatants: CombatantNode[];
  activeEffects: ActiveEffect[];
  log: CombatLogEntry[];
}
