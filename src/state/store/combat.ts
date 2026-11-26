import { useCallback } from 'react';
import { CombatEncounterState } from '../../types/combat';
import { resolveTargetAttack, resolveTargetSaves } from '../../engine/target-combat';
import { Activity, CreatureSize, MonsterStatMeta } from '../../types/compendium';
import { ActionEconomy, RollMode, WeaponMastery } from '../../types/core';
import { computeCharacterSheet } from '../../engine/rules-math';
import { evaluateDiceExpression } from '../../engine/dice';
import { normalizeCr } from '../../engine/encounter-math';
import { advanceTurn, dropConcentrationForCombatant, rollAllInitiativeOrder, sortInitiativeOrder } from '../../engine/combat-machine';
import { getCustomInitiativeSoundUrl, tabletopSoundboard } from '../../engine/soundboard';
import { db, saveEncounter } from '../../storage/db';
import type { StoreCore } from './core';
import type { useCharacterActions } from './character';

export type CombatDeps = Pick<ReturnType<typeof useCharacterActions>, 'adjustHp' | 'toggleCondition'>;

export function useCombatActions(core: StoreCore, deps: CombatDeps) {
  const {
    persistEncounter,
    appendLog,
    encounter,
    rawChar,
    setPendingConcDc,
    pendingConcDc,
    resolvedSheet,
    encounterList,
    setEncounter,
    setEncounterList,
    characterList,
    rollMode,
    houseRules,
    liveStatus,
    liveSessionRef,
    setInitiativeAlert,
  } = core;
  const { adjustHp, toggleCondition } = deps;

  const addMonsterToEncounter = useCallback(
    (
      name: string,
      ac: number,
      maxHp: number,
      dexMod = 0,
      actions?: Activity[],
      cr?: string,
      extraMeta?: MonsterStatMeta,
      notes?: string,
      portraitUrl?: string
    ) => {
      const initRoll = evaluateDiceExpression(`1d20${dexMod >= 0 ? `+${dexMod}` : dexMod}`, 'normal');
      persistEncounter((prev) => {
        const mobCount = prev.combatants.filter((c) => c.kind === 'monster').length;
        return {
          ...prev,
          combatants: sortInitiativeOrder([
            ...prev.combatants,
            {
              id: `mob-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              name,
              kind: 'monster',
              cr: cr ? normalizeCr(cr) : cr,
              size: extraMeta?.size ?? 'medium',
              portraitUrl,
              x: 12 + (mobCount % 6),
              y: 2 + Math.floor(mobCount / 6) * 2,
              tokenColor: '#f85149',
              initiative: initRoll.total,
              dexModifier: dexMod,
              ac,
              hp: { current: maxHp, max: maxHp, temp: 0 },
              conditions: [],
              actions,
              legendaryActions: extraMeta?.legendaryActionsMax
                ? { current: extraMeta.legendaryActionsMax, max: extraMeta.legendaryActionsMax }
                : undefined,
              rechargeStates: extraMeta?.rechargeAbility
                ? [{ ...extraMeta.rechargeAbility, available: true }]
                : undefined,
              monsterMeta: extraMeta,
              notes,
              turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
            },
          ]),
        };
      });
      appendLog(`Added ${name} to encounter (Init ${initRoll.total}, AC ${ac}, HP ${maxHp}).`, 'info');
    },
    [persistEncounter, appendLog]
  );

  const stepCombatTurn = useCallback(() => {
    const prevLogLen = encounter.log.length;
    const next = advanceTurn(encounter);
    persistEncounter(() => next);
    const added = next.log.slice(prevLogLen);
    for (const entry of added) {
      appendLog(
        `[Round ${next.round}] ${entry.message}`,
        entry.severity === 'warning' ? 'warn' : entry.severity === 'crit' ? 'crit' : 'info'
      );
    }
  }, [encounter, persistEncounter, appendLog]);

  const adjustCombatantHp = useCallback(
    (combatantId: string, delta: number) => {
      if (combatantId === rawChar.id) {
        adjustHp(delta);
        return;
      }
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) => {
          if (c.id !== combatantId) return c;
          if (delta < 0) {
            const dmg = Math.abs(delta);
            const absorbed = Math.min(c.hp.temp, dmg);
            const leftover = dmg - absorbed;
            return {
              ...c,
              hp: {
                ...c.hp,
                temp: c.hp.temp - absorbed,
                current: Math.max(0, c.hp.current - leftover),
              },
            };
          }
          return {
            ...c,
            hp: { ...c.hp, current: Math.min(c.hp.max, c.hp.current + delta) },
          };
        }),
      }));
    },
    [rawChar.id, adjustHp, persistEncounter]
  );

  const setCombatantInitiative = useCallback(
    (combatantId: string, initiative: number) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: sortInitiativeOrder(
          prev.combatants.map((c) => (c.id === combatantId ? { ...c, initiative } : c))
        ),
      }));
    },
    [persistEncounter]
  );

  const toggleCombatantCondition = useCallback(
    (combatantId: string, condition: string) => {
      if (combatantId === rawChar.id) {
        toggleCondition(condition);
        return;
      }
      const target = encounter.combatants.find((c) => c.id === combatantId);
      const adding = target ? !target.conditions.includes(condition) : false;
      const breaksConc =
        adding &&
        (condition === 'Incapacitated' ||
          condition === 'Paralyzed' ||
          condition === 'Stunned' ||
          condition === 'Unconscious');
      const hadConc = encounter.activeEffects.some(
        (e) => e.sourceCombatantId === combatantId && e.isConcentration
      );

      persistEncounter((prev) => {
        let updated: CombatEncounterState = {
          ...prev,
          combatants: prev.combatants.map((c) => {
            if (c.id !== combatantId) return c;
            const has = c.conditions.includes(condition);
            return {
              ...c,
              conditions: has ? c.conditions.filter((x) => x !== condition) : [...c.conditions, condition],
            };
          }),
        };
        if (
          breaksConc &&
          updated.activeEffects.some((e) => e.sourceCombatantId === combatantId && e.isConcentration)
        ) {
          updated = dropConcentrationForCombatant(
            updated,
            combatantId,
            `${condition} broke Concentration`
          );
        }
        return updated;
      });
      if (breaksConc && hadConc) {
        appendLog(`${condition} automatically ended ${target?.name ?? 'Combatant'}'s Concentration.`, 'warn');
      }
    },
    [rawChar.id, encounter.combatants, encounter.activeEffects, toggleCondition, persistEncounter, appendLog]
  );

  const toggleCombatantEconomy = useCallback(
    (combatantId: string, economy: ActionEconomy) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === combatantId
            ? {
                ...c,
                turnEconomyUsed: {
                  ...c.turnEconomyUsed,
                  [economy]: !c.turnEconomyUsed[economy],
                },
              }
            : c
        ),
      }));
    },
    [persistEncounter]
  );

  const removeCombatant = useCallback(
    (combatantId: string) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.filter((c) => c.id !== combatantId),
      }));
      appendLog('Removed combatant from encounter.', 'info');
    },
    [persistEncounter, appendLog]
  );

  const dropConcentration = useCallback(
    (sourceId: string) => {
      persistEncounter((prev) => dropConcentrationForCombatant(prev, sourceId, 'Dropped concentration'));
      setPendingConcDc(null);
      appendLog('Concentration dropped and linked summons dismissed.', 'warn');
    },
    [persistEncounter, appendLog]
  );

  const rollConcentrationSave = useCallback(
    (dc?: number) => {
      const targetDc = dc ?? pendingConcDc ?? 10;
      const conSaveMod = resolvedSheet.abilities.con.save.final;
      const sign = conSaveMod >= 0 ? '+' : '';
      const hasWarCaster = rawChar.items.some((i) => i.name.toLowerCase().includes('war caster'));
      const saveRollMode: RollMode = hasWarCaster ? 'advantage' : 'normal';
      const res = evaluateDiceExpression(`1d20${sign}${conSaveMod}`, saveRollMode);
      const passed = res.total >= targetDc;
      appendLog(
        `Concentration Save vs DC ${targetDc} (${saveRollMode}): ${res.total} -> ${passed ? 'MAINTAINED' : 'FAILED'}`,
        passed ? 'crit' : 'warn'
      );
      if (!passed) {
        persistEncounter((prev) =>
          dropConcentrationForCombatant(prev, rawChar.id, 'Failed concentration save')
        );
      }
      setPendingConcDc(null);
    },
    [pendingConcDc, resolvedSheet.abilities.con.save.final, rawChar.items, rawChar.id, persistEncounter, appendLog]
  );

  const resetEncounter = useCallback(() => {
    persistEncounter((prev) => ({
      ...prev,
      round: 1,
      activeTurnIndex: 0,
      activeEffects: [],
      combatants: prev.combatants.filter((c) => c.kind === 'pc'),
      log: [],
    }));
    setPendingConcDc(null);
    appendLog('Reset encounter to Round 1 (kept PCs).', 'info');
  }, [persistEncounter, appendLog]);

  const switchEncounter = useCallback(
    (encounterId: string) => {
      const found = encounterList.find((e) => e.id === encounterId);
      if (found) {
        setEncounter(found);
        setPendingConcDc(null);
        appendLog(`Switched encounter to "${found.name}".`, 'info');
      }
    },
    [encounterList, appendLog]
  );

  const createEncounter = useCallback(
    async (name: string) => {
      const cleanName = name.trim() || `Encounter ${encounterList.length + 1}`;
      const fresh: CombatEncounterState = {
        id: `enc-${Date.now().toString(36)}`,
        name: cleanName,
        round: 1,
        activeTurnIndex: 0,
        combatants: [],
        activeEffects: [],
        log: [],
        map: { cols: 20, rows: 12, gridFeet: 5, templates: [] },
      };
      await saveEncounter(fresh);
      setEncounterList((prev) => [...prev, fresh]);
      setEncounter(fresh);
      setPendingConcDc(null);
      appendLog(`Created encounter "${fresh.name}".`, 'info');
    },
    [encounterList.length, appendLog]
  );

  const duplicateEncounter = useCallback(async () => {
    const copy: CombatEncounterState = {
      ...structuredClone(encounter),
      id: `enc-${Date.now().toString(36)}`,
      name: `${encounter.name} (Copy)`,
    };
    await saveEncounter(copy);
    setEncounterList((prev) => [...prev, copy]);
    setEncounter(copy);
    setPendingConcDc(null);
    appendLog(`Duplicated encounter as "${copy.name}".`, 'info');
  }, [encounter, appendLog]);

  const deleteEncounter = useCallback(
    async (encounterId: string) => {
      if (encounterList.length <= 1) {
        appendLog('Cannot delete the only remaining encounter.', 'warn');
        return;
      }
      await db.encounters.delete(encounterId);
      const remaining = encounterList.filter((e) => e.id !== encounterId);
      setEncounterList(remaining);
      if (encounter.id === encounterId && remaining[0]) {
        setEncounter(remaining[0]);
        setPendingConcDc(null);
      }
      appendLog('Deleted encounter from local storage.', 'warn');
    },
    [encounterList, encounter.id, appendLog]
  );

  const addPartyToEncounter = useCallback(() => {
    let addedCount = 0;
    persistEncounter((prev) => {
      const existingIds = new Set(prev.combatants.map((c) => c.id));
      const newNodes = characterList
        .filter((pc) => !existingIds.has(pc.id))
        .map((pc, idx) => {
          const sheet = computeCharacterSheet(pc);
          const initMod = sheet.initiative.final;
          const sign = initMod >= 0 ? '+' : '';
          const roll = evaluateDiceExpression(`1d20${sign}${initMod}`, rollMode);
          addedCount += 1;
          return {
            id: pc.id,
            name: pc.name,
            kind: 'pc' as const,
            characterId: pc.id,
            x: 1,
            y: 1 + idx * 2,
            tokenColor: '#58a6ff',
            portraitUrl: pc.avatarUrl,
            initiative: roll.total,
            dexModifier: sheet.abilities.dex.modifier,
            ac: sheet.ac.final,
            hp: { ...pc.hp },
            conditions: [...pc.conditions],
            turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
          };
        });
      if (newNodes.length === 0) return prev;
      return { ...prev, combatants: sortInitiativeOrder([...prev.combatants, ...newNodes]) };
    });
    appendLog(
      addedCount > 0 ? `Added ${addedCount} party member(s) to encounter.` : 'All saved PCs are already in this encounter.',
      'info'
    );
  }, [characterList, rollMode, persistEncounter, appendLog]);

  const addTimedCombatEffect = useCallback(
    (name: string, rounds: number, sourceCombatantId?: string) => {
      const clean = name.trim();
      const safeRounds = Math.max(1, Math.round(rounds));
      if (!clean) return;
      const sourceId =
        sourceCombatantId ??
        encounter.combatants[encounter.activeTurnIndex]?.id ??
        rawChar.id;
      persistEncounter((prev) => ({
        ...prev,
        activeEffects: [
          ...prev.activeEffects,
          {
            id: `eff-${Date.now().toString(36)}`,
            name: clean,
            sourceCombatantId: sourceId,
            targetCombatantId: sourceId,
            isConcentration: false,
            expiration: 'rounds_remaining',
            roundsRemaining: safeRounds,
          },
        ],
      }));
      appendLog(`Started timed effect "${clean}" (${safeRounds} rounds).`, 'info');
    },
    [encounter.combatants, encounter.activeTurnIndex, rawChar.id, persistEncounter, appendLog]
  );

  const rollAllInitiative = useCallback(() => {
    const surprisedNames = encounter.combatants
      .filter((c) => c.conditions.some((cond) => cond.toLowerCase() === 'surprised'))
      .map((c) => c.name);
    persistEncounter((prev) => ({
      ...prev,
      round: 1,
      activeTurnIndex: 0,
      combatants: rollAllInitiativeOrder(prev.combatants, undefined, houseRules.surpriseRule),
    }));
    const surpriseNote =
      surprisedNames.length > 0
        ? houseRules.surpriseRule === '2024'
          ? ` (2024 Surprised Disadvantage: ${surprisedNames.join(', ')})`
          : ` (2014 Surprised — skips Turn 1: ${surprisedNames.join(', ')})`
        : '';
    appendLog(`Rolled Initiative for all combatants (Reset to Round 1).${surpriseNote}`, 'roll');
  }, [encounter.combatants, houseRules.surpriseRule, persistEncounter, appendLog]);

  const moveCombatantOrder = useCallback(
    (combatantId: string, delta: -1 | 1) => {
      persistEncounter((prev) => {
        const idx = prev.combatants.findIndex((c) => c.id === combatantId);
        const targetIdx = idx + delta;
        if (idx < 0 || targetIdx < 0 || targetIdx >= prev.combatants.length) return prev;
        const next = [...prev.combatants];
        const [moved] = next.splice(idx, 1);
        if (!moved) return prev;
        next.splice(targetIdx, 0, moved);
        const activeId = prev.combatants[prev.activeTurnIndex]?.id;
        const nextActive = activeId ? Math.max(0, next.findIndex((c) => c.id === activeId)) : prev.activeTurnIndex;
        return { ...prev, combatants: next, activeTurnIndex: nextActive };
      });
    },
    [persistEncounter]
  );

  const toggleCombatantHidden = useCallback(
    (combatantId: string) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === combatantId ? { ...c, hidden: !c.hidden } : c
        ),
      }));
    },
    [persistEncounter]
  );

  const setCombatantSize = useCallback(
    (combatantId: string, size: CreatureSize) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) => (c.id === combatantId ? { ...c, size } : c)),
      }));
    },
    [persistEncounter]
  );

  const adjustLegendaryActions = useCallback(
    (combatantId: string, delta: number) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) => {
          if (c.id !== combatantId || !c.legendaryActions) return c;
          return {
            ...c,
            legendaryActions: {
              ...c.legendaryActions,
              current: Math.max(0, Math.min(c.legendaryActions.max, c.legendaryActions.current + delta)),
            },
          };
        }),
      }));
    },
    [persistEncounter]
  );

  const toggleOrRollRecharge = useCallback(
    (combatantId: string, abilityName: string, forceSpend = false) => {
      const target = encounter.combatants.find((c) => c.id === combatantId);
      const entry = target?.rechargeStates?.find((r) => r.name === abilityName);
      if (!target || !entry) return;

      if (entry.available || forceSpend) {
        persistEncounter((prev) => ({
          ...prev,
          combatants: prev.combatants.map((c) =>
            c.id === combatantId
              ? {
                  ...c,
                  rechargeStates: c.rechargeStates?.map((r) =>
                    r.name === abilityName ? { ...r, available: false } : r
                  ),
                }
              : c
          ),
        }));
        appendLog(`${target.name} spent ${abilityName}.`, 'info');
        return;
      }

      const roll = evaluateDiceExpression('1d6', 'normal').total;
      const recharged = roll >= entry.minRoll;
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === combatantId
            ? {
                ...c,
                rechargeStates: c.rechargeStates?.map((r) =>
                  r.name === abilityName ? { ...r, available: recharged } : r
                ),
              }
            : c
        ),
      }));
      appendLog(
        `${target.name} Recharge roll for ${abilityName}: ${roll} (${recharged ? 'RECHARGED!' : `need ${entry.minRoll}+`}).`,
        recharged ? 'crit' : 'roll'
      );
    },
    [encounter.combatants, persistEncounter, appendLog]
  );

  const targetAttackCombatants = useCallback(
    (
      attackerName: string,
      targetIds: string[],
      activity: Activity,
      customBonus?: number,
      weaponMastery?: WeaponMastery,
      attackerAbilityMod = 3
    ) => {
      if (targetIds.length === 0) {
        appendLog('Select one or more targets first.', 'warn');
        return;
      }
      const targets = encounter.combatants.filter((c) => targetIds.includes(c.id));
      if (targets.length === 0) return;

      if (liveStatus.role === 'player') {
        const session = liveSessionRef.current;
        if (session) {
          session.broadcast({
            type: 'target_attack',
            senderId: session.senderId,
            senderName: rawChar.name,
            attackerName,
            targetIds,
            activity,
            customBonus,
            weaponMastery,
            attackerAbilityMod,
          });
        }
      }

      const outcomes = targets.map((t) =>
        resolveTargetAttack(
          activity,
          t,
          rollMode,
          customBonus,
          undefined,
          weaponMastery,
          attackerAbilityMod,
          houseRules.critRule
        )
      );
      const hpUpdates = new Map(
        outcomes.filter((o) => o.targetId !== rawChar.id).map((o) => [o.targetId, o.nextHp])
      );
      const proneTargets = new Set<string>();
      const toppleDc = 8 + resolvedSheet.proficiencyBonus.final + attackerAbilityMod;

      for (const o of outcomes) {
        if (o.hit && weaponMastery === 'Topple') {
          const tNode = targets.find((t) => t.id === o.targetId);
          const conMatch = tNode?.monsterMeta?.saves?.match(/Con\s*([+-]\d+)/i);
          const conBonus = conMatch?.[1] ? Number.parseInt(conMatch[1], 10) : 0;
          const conSign = conBonus >= 0 ? '+' : '';
          const saveRoll = evaluateDiceExpression(`1d20${conSign}${conBonus}`, 'normal');
          if (saveRoll.total < toppleDc) {
            proneTargets.add(o.targetId);
            appendLog(
              `Topple: ${o.targetName} CON save ${saveRoll.total} vs DC ${toppleDc} — FAILED (knocked Prone).`,
              'warn'
            );
          } else {
            appendLog(
              `Topple: ${o.targetName} CON save ${saveRoll.total} vs DC ${toppleDc} — resisted.`,
              'info'
            );
          }
        }
      }

      if (hpUpdates.size > 0 || proneTargets.size > 0) {
        persistEncounter((prev) => ({
          ...prev,
          combatants: prev.combatants.map((c) => {
            const nextHp = hpUpdates.get(c.id);
            const addProne = proneTargets.has(c.id) && !c.conditions.includes('Prone');
            if (nextHp === undefined && !addProne) return c;
            return {
              ...c,
              hp: nextHp !== undefined ? { ...c.hp, current: nextHp } : c.hp,
              conditions: addProne ? [...c.conditions, 'Prone'] : c.conditions,
            };
          }),
        }));
      }

      for (const o of outcomes) {
        if (!o.hit) {
          if (o.appliedDamage > 0 && o.masteryNote) {
            appendLog(
              `${attackerName} → ${o.targetName} (${activity.name}): Rolled ${o.attackTotal} vs AC — MISS, ${o.masteryNote} (HP -> ${o.nextHp}).`,
              'roll'
            );
          } else {
            appendLog(
              `${attackerName} → ${o.targetName} (${activity.name}): Rolled ${o.attackTotal} vs AC — MISS${o.isFumble ? ' [FUMBLE]' : ''}.`,
              'info'
            );
          }
        } else {
          const noteStr = [o.modifierNote, o.masteryNote].filter(Boolean).join(' • ');
          const badge = noteStr ? ` [${noteStr}]` : '';
          appendLog(
            `${attackerName} → ${o.targetName} (${activity.name}): ${o.isCrit ? 'CRIT ' : 'HIT '} (${o.attackTotal}) for ${o.appliedDamage} dmg${badge} (HP -> ${o.nextHp}).`,
            o.isCrit ? 'crit' : 'roll'
          );
          if (o.targetId === rawChar.id) {
            adjustHp(-o.appliedDamage);
          } else if (
            o.concentrationDc &&
            encounter.activeEffects.some(
              (eff) => eff.sourceCombatantId === o.targetId && eff.isConcentration
            )
          ) {
            appendLog(
              `Concentration Check: ${o.targetName} (DC ${o.concentrationDc} CON save).`,
              'warn'
            );
          }
        }
      }
    },
    [encounter.combatants, encounter.activeEffects, rollMode, persistEncounter, appendLog, rawChar.id, adjustHp, resolvedSheet.proficiencyBonus.final]
  );

  const targetSaveCombatants = useCallback(
    (attackerName: string, targetIds: string[], activity: Activity, explicitDc?: number) => {
      if (targetIds.length === 0) {
        appendLog('Select one or more targets first.', 'warn');
        return;
      }
      const targets = encounter.combatants.filter((c) => targetIds.includes(c.id));
      if (targets.length === 0) return;

      if (liveStatus.role === 'player') {
        const session = liveSessionRef.current;
        if (session) {
          session.broadcast({
            type: 'target_save',
            senderId: session.senderId,
            senderName: rawChar.name,
            attackerName,
            targetIds,
            activity,
            explicitDc,
          });
        }
      }

      const outcomes = resolveTargetSaves(activity, targets, explicitDc);
      const hpUpdates = new Map(
        outcomes.filter((o) => o.targetId !== rawChar.id).map((o) => [o.targetId, o.nextHp])
      );

      if (hpUpdates.size > 0) {
        persistEncounter((prev) => ({
          ...prev,
          combatants: prev.combatants.map((c) => {
            const nextHp = hpUpdates.get(c.id);
            return nextHp !== undefined ? { ...c, hp: { ...c.hp, current: nextHp } } : c;
          }),
        }));
      }

      for (const o of outcomes) {
        const noteStr = o.modifierNote ? ` [${o.modifierNote}]` : '';
        appendLog(
          `${attackerName} → ${o.targetName} (${activity.name} DC ${o.saveDc}): Save ${o.saveRoll} (${o.passed ? 'PASS ½' : 'FAIL'}) for ${o.appliedDamage} dmg${noteStr} (HP -> ${o.nextHp}).`,
          o.passed ? 'info' : 'roll'
        );
        if (o.targetId === rawChar.id) {
          adjustHp(-o.appliedDamage);
        } else if (
          o.concentrationDc &&
          encounter.activeEffects.some(
            (eff) => eff.sourceCombatantId === o.targetId && eff.isConcentration
          )
        ) {
          appendLog(
            `Concentration Check: ${o.targetName} (DC ${o.concentrationDc} CON save).`,
            'warn'
          );
        }
      }
    },
    [encounter.combatants, encounter.activeEffects, persistEncounter, appendLog, rawChar.id, adjustHp]
  );

  const dismissInitiativeAlert = useCallback(() => {
    setInitiativeAlert(null);
  }, []);

  const startEncounterAlert = useCallback(() => {
    const customUrl = getCustomInitiativeSoundUrl();
    tabletopSoundboard.playInitiativeAlertSound(customUrl || undefined);
    const alertPayload = {
      senderName: rawChar.name || 'DM',
      encounterName: encounter.name,
      timestamp: Date.now(),
    };
    setInitiativeAlert(alertPayload);
    appendLog(`Encounter started — ROLL INITIATIVE for "${encounter.name}"!`, 'warn');
    const session = liveSessionRef.current;
    if (session && session.getState().role === 'host') {
      session.broadcast({
        type: 'initiative_alert',
        senderId: session.senderId,
        senderName: alertPayload.senderName,
        encounterName: alertPayload.encounterName,
        soundUrl: customUrl || undefined,
        timestamp: alertPayload.timestamp,
      });
    }
  }, [rawChar.name, encounter.name, appendLog]);

  return {
    addMonsterToEncounter,
    stepCombatTurn,
    adjustCombatantHp,
    setCombatantInitiative,
    toggleCombatantCondition,
    toggleCombatantEconomy,
    removeCombatant,
    dropConcentration,
    rollConcentrationSave,
    resetEncounter,
    switchEncounter,
    createEncounter,
    duplicateEncounter,
    deleteEncounter,
    addPartyToEncounter,
    addTimedCombatEffect,
    rollAllInitiative,
    moveCombatantOrder,
    toggleCombatantHidden,
    setCombatantSize,
    adjustLegendaryActions,
    toggleOrRollRecharge,
    targetAttackCombatants,
    targetSaveCombatants,
    dismissInitiativeAlert,
    startEncounterAlert,
  };
}
