import { useCallback } from 'react';
import { ResolvedActivity } from '../../types/character';
import { resolveConditionRollMode } from '../../engine/conditions';
import { Activity } from '../../types/compendium';
import { ActiveBuffState, RollMode } from '../../types/core';
import { resolveResourcePoolForCost } from '../../engine/rules-math';
import { doubleDiceForCrit, evaluateDiceExpression, scaleDiceForUpcast } from '../../engine/dice';
import { applyEffectWithConcentrationCheck, sortInitiativeOrder, spawnLinkedSummon } from '../../engine/combat-machine';
import type { StoreCore } from './core';

export function useActivitiesActions(core: StoreCore) {
  const {
    resolvedSheet,
    rollMode,
    persistEncounter,
    rawChar,
    appendLog,
    houseRules,
    persistCharacter,
    activeBuffs,
    liveStatus,
    liveSessionRef,
    encounter,
    setActiveBuffs,
  } = core;

  const rollCharacterInitiative = useCallback(() => {
    const initMod = resolvedSheet.initiative.final;
    const sign = initMod >= 0 ? '+' : '';
    const roll = evaluateDiceExpression(`1d20${sign}${initMod}`, rollMode);
    persistEncounter((prev) => {
      const exists = prev.combatants.some((c) => c.id === rawChar.id);
      const updated = exists
        ? prev.combatants.map((c) =>
            c.id === rawChar.id
              ? { ...c, name: rawChar.name, ac: resolvedSheet.ac.final, hp: { ...rawChar.hp }, initiative: roll.total }
              : c
          )
        : [
            ...prev.combatants,
            {
              id: rawChar.id,
              name: rawChar.name,
              kind: 'pc' as const,
              initiative: roll.total,
              dexModifier: resolvedSheet.abilities.dex.modifier,
              ac: resolvedSheet.ac.final,
              hp: { ...rawChar.hp },
              conditions: [...rawChar.conditions],
              turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
            },
          ];
      return { ...prev, combatants: sortInitiativeOrder(updated) };
    });
    appendLog(`${rawChar.name} rolled Initiative: ${roll.total} (${roll.mode}).`, 'roll');
  }, [rawChar, resolvedSheet, rollMode, persistEncounter, appendLog]);

  const rollInlineExpression = useCallback(
    (label: string, expression: string) => {
      const res = evaluateDiceExpression(expression, rollMode);
      const tag = res.isCrit ? ' [CRIT!]' : res.isFumble ? ' [FUMBLE]' : '';
      appendLog(
        `${label} (${expression}, ${res.mode}): ${res.total}${tag} [${res.terms.map((t) => t.kept.join(',')).join('+')}]`,
        res.isCrit ? 'crit' : 'roll'
      );
    },
    [rollMode, appendLog]
  );

  const triggerCombatantActivity = useCallback(
    (combatantName: string, act: Activity) => {
      let attackIsCrit = false;
      if (act.attackBonusFormula) {
        const sign = act.attackBonusFormula.startsWith('+') || act.attackBonusFormula.startsWith('-') ? '' : '+';
        const atk = evaluateDiceExpression(`1d20${sign}${act.attackBonusFormula}`, rollMode);
        attackIsCrit = atk.isCrit;
        const tag = atk.isCrit ? ' [CRIT!]' : atk.isFumble ? ' [FUMBLE]' : '';
        appendLog(
          `${combatantName} — ${act.name} Attack: ${atk.total}${tag}`,
          atk.isCrit ? 'crit' : 'roll'
        );
      }
      if (act.damageFormula) {
        const dmgExpr = attackIsCrit
          ? doubleDiceForCrit(act.damageFormula, houseRules.critRule)
          : act.damageFormula;
        const dmg = evaluateDiceExpression(dmgExpr, 'normal');
        const critTag = attackIsCrit ? ' [CRIT DICE DOUBLED]' : '';
        appendLog(
          `${combatantName} — ${act.name} Damage: ${dmg.total} ${act.damageType ?? ''}${critTag}`,
          attackIsCrit ? 'crit' : 'roll'
        );
      }
    },
    [rollMode, appendLog]
  );

  const triggerActivity = useCallback(
    (activity: ResolvedActivity, slotLevelOverride?: number, asRitual = false, targetIds: string[] = []) => {
      let spentNote = '';
      const baseSlotMatch = activity.resourceCost?.poolId.match(/^spell_slot_(\d+)$/);
      const baseSpellLevel = baseSlotMatch?.[1] ? Number.parseInt(baseSlotMatch[1], 10) : 0;
      let effectiveSlotLevel = baseSpellLevel > 0 ? baseSpellLevel : activity.resourceCost?.amount ?? 4;

      if (asRitual && activity.ritual) {
        spentNote = ' (Ritual — 10 min, no slot spent)';
      } else if (activity.resourceCost) {
        const requestedPoolId =
          baseSpellLevel > 0 && slotLevelOverride && slotLevelOverride > baseSpellLevel
            ? `spell_slot_${slotLevelOverride}`
            : activity.resourceCost.poolId;

        const resolution = resolveResourcePoolForCost(
          rawChar.resources,
          rawChar.classes,
          requestedPoolId,
          activity.resourceCost.amount
        );
        if ('error' in resolution) {
          appendLog(`${resolution.error} (${activity.name})`, 'warn');
          return;
        }
        if (resolution.note) {
          spentNote = ` (${resolution.note})`;
        } else if (
          baseSpellLevel > 0 &&
          slotLevelOverride &&
          slotLevelOverride > baseSpellLevel &&
          resolution.poolId === `spell_slot_${slotLevelOverride}`
        ) {
          spentNote = ` (upcast Level ${slotLevelOverride} slot)`;
        }
        const slotMatch = resolution.poolId.match(/^spell_slot_(\d+)$/);
        if (slotMatch && slotMatch[1]) {
          effectiveSlotLevel = Number.parseInt(slotMatch[1], 10);
        } else if (resolution.poolId === 'pact_slot') {
          const pactLevel = rawChar.classes
            .filter((c) => c.casterProgression === 'pact')
            .reduce((sum, c) => sum + c.level, 0);
          effectiveSlotLevel = Math.min(5, Math.ceil(pactLevel / 2));
        }

        const hasPool = rawChar.resources.some((r) => r.id === resolution.poolId);
        if (hasPool) {
          persistCharacter((prev) => ({
            ...prev,
            resources: prev.resources.map((r) =>
              r.id === resolution.poolId
                ? { ...r, current: Math.max(0, r.current - (activity.resourceCost?.amount ?? 1)) }
                : r
            ),
          }));
        }
      }

      if (
        !asRitual &&
        (activity.actionEconomy === 'action' ||
          activity.actionEconomy === 'bonus_action' ||
          activity.actionEconomy === 'reaction')
      ) {
        persistEncounter((prev) => ({
          ...prev,
          combatants: prev.combatants.map((c) =>
            c.id === rawChar.id
              ? {
                  ...c,
                  turnEconomyUsed: {
                    ...c.turnEconomyUsed,
                    [activity.actionEconomy]: true,
                  },
                }
              : c
          ),
        }));
      }

      let attackIsCrit = false;
      if (activity.computedAttackBonus !== null) {
        const condRoll = resolveConditionRollMode(rawChar.conditions, 'attack', undefined, rollMode);
        const flankAdv = activeBuffs.flanking && houseRules.flankingRule === 'advantage';
        const flankBonus = activeBuffs.flanking && houseRules.flankingRule === 'plus2' ? '+2' : '';
        const effectiveAtkMode: RollMode =
          flankAdv && condRoll.mode === 'disadvantage'
            ? 'normal'
            : flankAdv
              ? 'advantage'
              : condRoll.mode;
        const sign = activity.computedAttackBonus >= 0 ? '+' : '';
        const blessTerm = activeBuffs.bless ? '+1d4' : '';
        const atk = evaluateDiceExpression(
          `1d20${sign}${activity.computedAttackBonus}${blessTerm}${flankBonus}`,
          effectiveAtkMode,
          resolvedSheet.critThreshold
        );
        attackIsCrit = atk.isCrit;
        const tag = atk.isCrit
          ? resolvedSheet.critThreshold < 20
            ? ` [CRIT ${resolvedSheet.critThreshold}-20!]`
            : ' [CRIT!]'
          : atk.isFumble
          ? ' [FUMBLE]'
          : '';
        const condTag = condRoll.reasons.length > 0 ? ` [${condRoll.reasons.join(', ')}]` : '';
        const flankTag =
          activeBuffs.flanking && houseRules.flankingRule !== 'off'
            ? houseRules.flankingRule === 'advantage'
              ? ' [Flanking ADV]'
              : ' [Flanking +2]'
            : '';
        const masteryTag = activity.weaponMastery ? ` [Mastery: ${activity.weaponMastery}]` : '';
        const blessTag = activeBuffs.bless ? ' [+Bless 1d4]' : '';
        appendLog(
          `${activity.name}${spentNote} Attack (${atk.mode}): ${atk.total}${tag}${condTag}${flankTag}${blessTag}${masteryTag} [${atk.terms.map((t) => t.kept.join(',')).join('+')}]`,
          atk.isCrit ? 'crit' : 'roll'
        );
      }

      if (activity.computedDamage) {
        const extraLevels = baseSpellLevel > 0 ? Math.max(0, effectiveSlotLevel - baseSpellLevel) : 0;
        let upcastFormula = scaleDiceForUpcast(
          activity.computedDamage,
          activity.upcastDicePerLevel,
          extraLevels
        );
        const buffNotes: string[] = [];
        if (activity.type === 'attack' && activeBuffs.rage) {
          upcastFormula = `${upcastFormula} + 2`;
          buffNotes.push('Rage +2');
        }
        if (activity.type === 'attack' && activeBuffs.sneakAttack) {
          const sneakDice = Math.max(1, Math.ceil(resolvedSheet.totalLevel / 2));
          upcastFormula = `${upcastFormula} + ${sneakDice}d6`;
          buffNotes.push(`Sneak +${sneakDice}d6`);
        }
        const dmgExpr = attackIsCrit
          ? doubleDiceForCrit(upcastFormula, houseRules.critRule)
          : upcastFormula;
        const dmg = evaluateDiceExpression(dmgExpr, 'normal');
        const critTag = attackIsCrit ? ' [CRIT DICE DOUBLED]' : '';
        const upcastTag = extraLevels > 0 && activity.upcastDicePerLevel ? ` [UPCAST +${extraLevels}]` : '';
        const buffTag = buffNotes.length > 0 ? ` [${buffNotes.join(', ')}]` : '';
        const kindLabel = activity.type === 'heal' ? 'Healing' : 'Damage';
        appendLog(
          `${activity.name}${activity.computedAttackBonus === null ? spentNote : ''} ${kindLabel}: ${dmg.total} ${activity.damageType ?? ''} (${dmgExpr})${upcastTag}${buffTag}${critTag}`,
          attackIsCrit ? 'crit' : 'roll'
        );

        if (activity.type === 'heal' && dmg.total > 0) {
          const healAmount = dmg.total;
          if (targetIds.length > 0) {
            const healedNames: string[] = [];
            persistEncounter((prev) => ({
              ...prev,
              combatants: prev.combatants.map((c) => {
                if (!targetIds.includes(c.id)) return c;
                healedNames.push(c.name);
                return {
                  ...c,
                  hp: { ...c.hp, current: Math.min(c.hp.max, c.hp.current + healAmount) },
                };
              }),
            }));
            if (targetIds.includes(rawChar.id)) {
              persistCharacter((prev) => ({
                ...prev,
                hp: { ...prev.hp, current: Math.min(prev.hp.max, prev.hp.current + healAmount) },
              }));
            }
            if (healedNames.length > 0) {
              appendLog(`Applied +${healAmount} HP healing to: ${healedNames.join(', ')}.`, 'info');
            }
            if (liveStatus.role === 'player' && liveSessionRef.current) {
              liveSessionRef.current.broadcast({
                type: 'target_heal',
                senderId: liveSessionRef.current.senderId,
                senderName: rawChar.name,
                targetIds,
                amount: healAmount,
                sourceName: activity.name,
              });
            }
          } else {
            persistCharacter((prev) => ({
              ...prev,
              hp: { ...prev.hp, current: Math.min(prev.hp.max, prev.hp.current + healAmount) },
            }));
          }
        }
      } else if (spentNote) {
        appendLog(`Cast ${activity.name}${spentNote}.`, 'info');
      }

      if (activity.computedSaveDc !== null && activity.saveAbility) {
        appendLog(
          `${activity.name}${spentNote}: Target makes DC ${activity.computedSaveDc} ${activity.saveAbility.toUpperCase()} saving throw.`,
          'info'
        );
      }

      if (activity.concentration || activity.type === 'summon' || (activity.type === 'utility' && targetIds.length > 0)) {
        const concId = `eff-${Date.now()}`;
        const durLow = activity.spellMeta?.duration?.toLowerCase() ?? '';
        let durationRounds: number | undefined;
        if (durLow.includes('1 min')) durationRounds = 10;
        else if (durLow.includes('10 min')) durationRounds = 100;
        else if (durLow.includes('1 hr') || durLow.includes('1 hour')) durationRounds = 600;
        else if (durLow.includes('1 round')) durationRounds = 1;

        const effectTargets =
          targetIds.length > 0 && activity.type !== 'summon' ? targetIds : [rawChar.id];
        const targetNames = encounter.combatants
          .filter((c) => effectTargets.includes(c.id))
          .map((c) => c.name);

        persistEncounter((prev) => {
          let updated = prev;
          effectTargets.forEach((tid, idx) => {
            updated = applyEffectWithConcentrationCheck(updated, {
              id: `${concId}-${idx}`,
              name: activity.parentItemName || activity.name,
              sourceCombatantId: rawChar.id,
              targetCombatantId: tid,
              isConcentration: activity.concentration && idx === 0,
              expiration: activity.concentration ? 'concentration' : durationRounds ? 'rounds_remaining' : 'indefinite',
              roundsRemaining: durationRounds,
            });
          });
          if (targetIds.length > 0 && activity.type !== 'summon' && targetNames.length > 0) {
            appendLog(`Applied ${activity.parentItemName || activity.name} to: ${targetNames.join(', ')}.`, 'info');
          }
          if (liveStatus.role === 'player' && targetIds.length > 0 && activity.type !== 'summon' && liveSessionRef.current) {
            liveSessionRef.current.broadcast({
              type: 'target_buff',
              senderId: liveSessionRef.current.senderId,
              senderName: rawChar.name,
              targetIds,
              effectName: activity.parentItemName || activity.name,
              sourceCombatantId: rawChar.id,
              isConcentration: activity.concentration,
              durationRounds,
            });
          }

          if (activity.type === 'summon') {
            updated = spawnLinkedSummon(
              updated,
              {
                id: `sum-${Date.now()}`,
                name: `${activity.parentItemName} Construct`,
                ownerId: rawChar.id,
                initiative: 0,
                dexModifier: 0,
                ac: 13 + effectiveSlotLevel,
                hp: { current: 40, max: 40, temp: 0 },
                conditions: [],
                actions: [
                  {
                    id: `sum-slam-${Date.now()}`,
                    name: 'Slam',
                    type: 'attack',
                    actionEconomy: 'action',
                    attackBonusFormula: `+${resolvedSheet.spellcasting.attackBonus.final}`,
                    damageFormula: `1d8+4+${effectiveSlotLevel}`,
                    damageType: 'bludgeoning',
                  },
                ],
              },
              activity.concentration ? concId : undefined
            );
          }
          return updated;
        });
        appendLog(`Active effect started: ${activity.parentItemName}${spentNote}`, 'info');
      }
    },
    [
      rawChar,
      resolvedSheet.spellcasting.attackBonus.final,
      resolvedSheet.critThreshold,
      resolvedSheet.totalLevel,
      rollMode,
      activeBuffs,
      houseRules,
      persistCharacter,
      persistEncounter,
      appendLog,
    ]
  );

  const toggleBuff = useCallback((key: keyof ActiveBuffState) => {
    setActiveBuffs((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const divineSmite = useCallback(
    (slotLevel: number) => {
      const res = resolveResourcePoolForCost(
        rawChar.resources,
        rawChar.classes,
        `spell_slot_${slotLevel}`,
        1
      );
      if ('error' in res) {
        appendLog(`${res.error} (Divine Smite)`, 'warn');
        return;
      }
      persistCharacter((prev) => ({
        ...prev,
        resources: prev.resources.map((r) =>
          r.id === res.poolId ? { ...r, current: Math.max(0, r.current - 1) } : r
        ),
      }));
      const diceCount = Math.min(5, 1 + slotLevel);
      const dmg = evaluateDiceExpression(`${diceCount}d8`, 'normal');
      appendLog(`Divine Smite (L${slotLevel} slot): ${dmg.total} radiant damage (${diceCount}d8)!`, 'crit');
    },
    [rawChar.resources, rawChar.classes, persistCharacter, appendLog]
  );

  return {
    rollCharacterInitiative,
    rollInlineExpression,
    triggerCombatantActivity,
    triggerActivity,
    toggleBuff,
    divineSmite,
  };
}
