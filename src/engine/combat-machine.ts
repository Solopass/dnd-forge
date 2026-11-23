import {
  ActiveEffect,
  CombatantNode,
  CombatEncounterState,
  CombatLogEntry,
} from '../types/combat';

function makeLog(
  round: number,
  message: string,
  severity: CombatLogEntry['severity'] = 'info'
): CombatLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    round,
    timestamp: Date.now(),
    message,
    severity,
  };
}

export function sortInitiativeOrder(combatants: CombatantNode[]): CombatantNode[] {
  const primaries = combatants
    .filter((c) => !c.ownerId)
    .sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return b.dexModifier - a.dexModifier;
    });

  const summonsByOwner = new Map<string, CombatantNode[]>();
  for (const c of combatants) {
    if (!c.ownerId) continue;
    const list = summonsByOwner.get(c.ownerId) ?? [];
    list.push(c);
    summonsByOwner.set(c.ownerId, list);
  }

  const ordered: CombatantNode[] = [];
  for (const primary of primaries) {
    ordered.push(primary);
    const owned = summonsByOwner.get(primary.id);
    if (owned) {
      ordered.push(...owned);
      summonsByOwner.delete(primary.id);
    }
  }

  for (const leftovers of summonsByOwner.values()) {
    ordered.push(...leftovers);
  }

  return ordered;
}

export function spawnLinkedSummon(
  state: CombatEncounterState,
  summon: Omit<CombatantNode, 'kind' | 'turnEconomyUsed'>,
  concentrationEffectId?: string
): CombatEncounterState {
  const node: CombatantNode = {
    ...summon,
    kind: 'summon',
    turnEconomyUsed: {
      action: false,
      bonus_action: false,
      reaction: false,
      free: false,
      special: false,
    },
  };

  const nextCombatants = sortInitiativeOrder([...state.combatants, node]);
  const nextEffects = state.activeEffects.map((eff) =>
    eff.id === concentrationEffectId
      ? { ...eff, linkedSummonIds: [...(eff.linkedSummonIds ?? []), node.id] }
      : eff
  );

  return {
    ...state,
    combatants: nextCombatants,
    activeEffects: nextEffects,
    log: [
      ...state.log,
      makeLog(state.round, `Summoned ${node.name} (HP ${node.hp.max}, AC ${node.ac})`),
    ],
  };
}

export function dropConcentrationForCombatant(
  state: CombatEncounterState,
  combatantId: string,
  reason = 'Concentration ended'
): CombatEncounterState {
  const activeConc = state.activeEffects.filter(
    (e) => e.sourceCombatantId === combatantId && e.isConcentration
  );
  if (activeConc.length === 0) return state;

  const dropSummonIds = new Set<string>();
  const nextLog = [...state.log];

  for (const eff of activeConc) {
    nextLog.push(makeLog(state.round, `${reason}: ${eff.name}`, 'warning'));
    eff.linkedSummonIds?.forEach((id) => dropSummonIds.add(id));
  }

  const nextCombatants = state.combatants.filter((c) => !dropSummonIds.has(c.id));
  if (dropSummonIds.size > 0) {
    nextLog.push(makeLog(state.round, `Dismissed ${dropSummonIds.size} linked summon(s)`, 'warning'));
  }

  return {
    ...state,
    combatants: nextCombatants,
    activeEffects: state.activeEffects.filter(
      (e) => !(e.sourceCombatantId === combatantId && e.isConcentration)
    ),
    log: nextLog,
  };
}

export function applyEffectWithConcentrationCheck(
  state: CombatEncounterState,
  newEffect: ActiveEffect
): CombatEncounterState {
  let working = state;
  if (newEffect.isConcentration) {
    working = dropConcentrationForCombatant(
      working,
      newEffect.sourceCombatantId,
      `Concentration replaced by ${newEffect.name}`
    );
  }

  return {
    ...working,
    activeEffects: [...working.activeEffects, newEffect],
    log: [...working.log, makeLog(working.round, `Applied effect: ${newEffect.name}`)],
  };
}

export function advanceTurn(state: CombatEncounterState): CombatEncounterState {
  if (state.combatants.length === 0) return state;

  const endingCombatant = state.combatants[state.activeTurnIndex];
  let nextEffects = [...state.activeEffects];
  let nextCombatants = [...state.combatants];
  const nextLog = [...state.log];
  const expiredSummons = new Set<string>();

  if (endingCombatant) {
    nextEffects = nextEffects.filter((eff) => {
      const expiresNow =
        (eff.expiration === 'end_of_source_turn' && eff.sourceCombatantId === endingCombatant.id) ||
        (eff.expiration === 'end_of_target_turn' && eff.targetCombatantId === endingCombatant.id);

      if (expiresNow) {
        nextLog.push(makeLog(state.round, `Effect expired: ${eff.name}`));
        eff.linkedSummonIds?.forEach((id) => expiredSummons.add(id));
        return false;
      }
      return true;
    });
  }

  let nextIndex = state.activeTurnIndex + 1;
  let nextRound = state.round;
  if (nextIndex >= nextCombatants.length) {
    nextIndex = 0;
    nextRound += 1;
  }

  const startingCombatant = nextCombatants[nextIndex];

  if (startingCombatant) {
    nextEffects = nextEffects.filter((eff) => {
      if (
        eff.expiration === 'rounds_remaining' &&
        eff.sourceCombatantId === startingCombatant.id &&
        eff.roundsRemaining !== undefined
      ) {
        eff.roundsRemaining -= 1;
        if (eff.roundsRemaining <= 0) {
          nextLog.push(makeLog(nextRound, `Effect expired: ${eff.name}`));
          eff.linkedSummonIds?.forEach((id) => expiredSummons.add(id));
          return false;
        }
      }

      const startsExpire =
        (eff.expiration === 'start_of_source_turn' &&
          eff.sourceCombatantId === startingCombatant.id) ||
        (eff.expiration === 'start_of_target_turn' &&
          eff.targetCombatantId === startingCombatant.id);

      if (startsExpire) {
        nextLog.push(makeLog(nextRound, `Effect expired: ${eff.name}`));
        eff.linkedSummonIds?.forEach((id) => expiredSummons.add(id));
        return false;
      }

      return true;
    });

    nextCombatants = nextCombatants
      .filter((c) => !expiredSummons.has(c.id))
      .map((c) =>
        c.id === startingCombatant.id
          ? {
              ...c,
              turnEconomyUsed: {
                action: false,
                bonus_action: false,
                reaction: false,
                free: false,
                special: false,
              },
            }
          : c
      );

    nextLog.push(makeLog(nextRound, `Turn started: ${startingCombatant.name}`));
  }

  return {
    ...state,
    round: nextRound,
    activeTurnIndex: Math.min(nextIndex, Math.max(0, nextCombatants.length - 1)),
    combatants: nextCombatants,
    activeEffects: nextEffects,
    log: nextLog,
  };
}
