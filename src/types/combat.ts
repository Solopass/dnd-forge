import { ActionEconomy } from './core';
import { Activity, CreatureSize, MonsterStatMeta } from './compendium';

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
  cr?: string;
  size?: CreatureSize;
  hidden?: boolean;
  x?: number;
  y?: number;
  tokenColor?: string;
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
  legendaryActions?: { current: number; max: number };
  rechargeStates?: Array<{ name: string; minRoll: number; available: boolean }>;
  monsterMeta?: MonsterStatMeta;
  notes?: string;
  turnEconomyUsed: Record<ActionEconomy, boolean>;
}

export interface TerrainCell {
  x: number;
  y: number;
  kind: 'wall' | 'difficult' | 'water';
}

export interface BattlemapTemplate {
  id: string;
  kind: 'sphere' | 'cone' | 'line' | 'cube';
  x: number;
  y: number;
  radiusFeet: number;
  color: string;
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
  map?: {
    imageDataUrl?: string;
    cols: number;
    rows: number;
    gridFeet: number;
    templates: BattlemapTemplate[];
    fogCells?: string[];
    terrainCells?: TerrainCell[];
    gridOpacity?: number;
    imageScale?: number;
    imageOffsetX?: number;
    imageOffsetY?: number;
  };
}
