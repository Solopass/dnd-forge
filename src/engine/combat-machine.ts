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

export function advanceTurn(
  state: CombatEncounterState,
  rollD6: () => number = () => Math.floor(Math.random() * 6) + 1
): CombatEncounterState {
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
  if (expiredSummons.size > 0) {
    const removedBeforeOrAt = nextCombatants.filter(
      (c, idx) => idx <= state.activeTurnIndex && expiredSummons.has(c.id)
    ).length;
    nextCombatants = nextCombatants.filter((c) => !expiredSummons.has(c.id));
    expiredSummons.clear();
    if (nextCombatants.length === 0) {
      return {
        ...state,
        activeTurnIndex: 0,
        combatants: [],
        activeEffects: nextEffects,
        log: nextLog,
      };
    }
    nextIndex = Math.max(0, state.activeTurnIndex - removedBeforeOrAt + 1);
  }

  let nextRound = state.round;
  if (nextIndex >= nextCombatants.length) {
    nextIndex = 0;
    nextRound += 1;
  }

  const startingCombatant = nextCombatants[nextIndex];

  if (startingCombatant) {
    const updatedEffects: ActiveEffect[] = [];
    for (const eff of nextEffects) {
      let currentEff = eff;
      if (eff.sourceCombatantId === startingCombatant.id && eff.roundsRemaining !== undefined) {
        const nextRemaining = eff.roundsRemaining - 1;
        if (nextRemaining <= 0) {
          nextLog.push(makeLog(nextRound, `Effect expired (${eff.name} timer reached 0 rounds)`));
          eff.linkedSummonIds?.forEach((id) => expiredSummons.add(id));
          continue;
        }
        currentEff = { ...eff, roundsRemaining: nextRemaining };
      }

      const startsExpire =
        (currentEff.expiration === 'start_of_source_turn' &&
          currentEff.sourceCombatantId === startingCombatant.id) ||
        (currentEff.expiration === 'start_of_target_turn' &&
          currentEff.targetCombatantId === startingCombatant.id);

      if (startsExpire) {
        nextLog.push(makeLog(nextRound, `Effect expired: ${currentEff.name}`));
        currentEff.linkedSummonIds?.forEach((id) => expiredSummons.add(id));
        continue;
      }

      updatedEffects.push(currentEff);
    }
    nextEffects = updatedEffects;

    nextCombatants = nextCombatants
      .filter((c) => !expiredSummons.has(c.id))
      .map((c) => {
        if (c.id !== startingCombatant.id) return c;

        const restoredLa = c.legendaryActions
          ? { current: c.legendaryActions.max, max: c.legendaryActions.max }
          : undefined;
        if (c.legendaryActions && c.legendaryActions.current < c.legendaryActions.max) {
          nextLog.push(
            makeLog(nextRound, `${c.name}: Legendary Actions restored (${c.legendaryActions.max}/${c.legendaryActions.max})`)
          );
        }

        const nextRecharges = c.rechargeStates?.map((r) => {
          if (r.available) return r;
          const rolled = rollD6();
          const refreshed = rolled >= r.minRoll;
          nextLog.push(
            makeLog(
              nextRound,
              refreshed
                ? `${c.name}: ${r.name} recharged! (rolled ${rolled})`
                : `${c.name}: ${r.name} still recharging (rolled ${rolled}, need ${r.minRoll}+)`,
              refreshed ? 'crit' : 'info'
            )
          );
          return refreshed ? { ...r, available: true } : r;
        });

        return {
          ...c,
          legendaryActions: restoredLa,
          rechargeStates: nextRecharges,
          turnEconomyUsed: {
            action: false,
            bonus_action: false,
            reaction: false,
            free: false,
            special: false,
          },
        };
      });

    if (!expiredSummons.has(startingCombatant.id)) {
      nextLog.push(makeLog(nextRound, `Turn started: ${startingCombatant.name}`));
    }
  }

  const pinnedIndex = startingCombatant
    ? nextCombatants.findIndex((c) => c.id === startingCombatant.id)
    : -1;

  return {
    ...state,
    round: nextRound,
    activeTurnIndex:
      pinnedIndex >= 0
        ? pinnedIndex
        : Math.min(nextIndex, Math.max(0, nextCombatants.length - 1)),
    combatants: nextCombatants,
    activeEffects: nextEffects,
    log: nextLog,
  };
}

export function rollAllInitiativeOrder(
  combatants: CombatantNode[],
  rollD20: () => number = () => Math.floor(Math.random() * 20) + 1,
  surpriseRule: '2014' | '2024' = '2024'
): CombatantNode[] {
  const updated = combatants.map((c) => {
    if (c.ownerId) return c;
    const isSurprised = c.conditions.some((cond) => cond.toLowerCase() === 'surprised');
    const die =
      isSurprised && surpriseRule === '2024' ? Math.min(rollD20(), rollD20()) : rollD20();
    return {
      ...c,
      initiative: die + c.dexModifier,
    };
  });
  return sortInitiativeOrder(updated);
}
