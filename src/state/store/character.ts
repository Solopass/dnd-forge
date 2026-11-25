import { useCallback } from 'react';
import { ClassLevel, RawCharacterState, WildShapeForm } from '../../types/character';
import { CombatEncounterState } from '../../types/combat';
import { CompendiumEntity } from '../../types/compendium';
import { AbilityKey, RecoveryTrigger } from '../../types/core';
import { applyRestRecovery, createBlankCharacter } from '../../engine/rules-math';
import { evaluateDiceExpression } from '../../engine/dice';
import { dropConcentrationForCombatant } from '../../engine/combat-machine';
import { BUILTIN_CONTENT_PACKS } from '../../engine/srd-packs';
import { buildCharacterFromPreset, buildSubclassGrantEntities, NewCharacterPresetInput } from '../../engine/classes';
import { playTableSound } from '../../engine/sound';
import { db, saveCharacter } from '../../storage/db';
import type { LevelUpPlanInput } from './types';
import type { StoreCore } from './core';

export function useCharacterActions(core: StoreCore) {
  const {
    characterList,
    setRawChar,
    setPendingConcDc,
    appendLog,
    setCharacterList,
    compendium,
    rawChar,
    persistCharacter,
    encounter,
    pushToast,
    persistEncounter,
    resolvedSheet,
  } = core;

  const switchCharacter = useCallback(
    async (characterId: string) => {
      const found = characterList.find((c) => c.id === characterId) ?? (await db.characters.get(characterId));
      if (found) {
        setRawChar(found);
        setPendingConcDc(null);
        appendLog(`Switched active sheet to ${found.name}.`, 'info');
      }
    },
    [characterList, appendLog]
  );

  const createNewCharacter = useCallback(
    async (name: string) => {
      const id = `char-${Date.now().toString(36)}`;
      const fresh = createBlankCharacter(id, name.trim() || 'New Hero');
      await saveCharacter(fresh);
      setCharacterList((prev) => [...prev, fresh]);
      setRawChar(fresh);
      setPendingConcDc(null);
      appendLog(`Created new character "${fresh.name}".`, 'info');
    },
    [appendLog]
  );

  const createCharacterFromPreset = useCallback(
    async (input: Omit<NewCharacterPresetInput, 'id'>) => {
      const id = `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      const fresh = buildCharacterFromPreset({ ...input, id }, compendium);
      await saveCharacter(fresh);
      setCharacterList((prev) => [...prev, fresh]);
      setRawChar(fresh);
      setPendingConcDc(null);
      appendLog(
        `Created Lvl ${input.level} ${input.speciesName} ${input.className} "${fresh.name}".`,
        'info'
      );
    },
    [appendLog]
  );

  const duplicateCharacter = useCallback(async (targetId?: string) => {
    const sourceChar = (targetId ? characterList.find((c) => c.id === targetId) : null) ?? rawChar;
    const id = `char-${Date.now().toString(36)}`;
    const copy: RawCharacterState = {
      ...structuredClone(sourceChar),
      id,
      name: `${sourceChar.name} (Copy)`,
    };
    await saveCharacter(copy);
    setCharacterList((prev) => [...prev, copy]);
    setRawChar(copy);
    setPendingConcDc(null);
    appendLog(`Duplicated character as "${copy.name}".`, 'info');
  }, [characterList, rawChar, appendLog]);

  const deleteCharacter = useCallback(
    async (characterId: string) => {
      if (characterList.length <= 1) {
        appendLog('Cannot delete the only remaining character.', 'warn');
        return;
      }
      await db.characters.delete(characterId);
      const remaining = characterList.filter((c) => c.id !== characterId);
      setCharacterList(remaining);
      if (rawChar.id === characterId && remaining[0]) {
        setRawChar(remaining[0]);
        setPendingConcDc(null);
      }
      appendLog('Deleted character from local storage.', 'warn');
    },
    [characterList, rawChar.id, appendLog]
  );

  const setStatOverride = useCallback(
    (field: 'ac' | 'initiative' | 'speed', value: number | null) => {
      persistCharacter((prev) => ({
        ...prev,
        overrides: { ...prev.overrides, [field]: value },
      }));
      appendLog(
        value === null
          ? `Cleared manual override on ${field.toUpperCase()}.`
          : `Set manual override ${field.toUpperCase()} = ${value}.`,
        'info'
      );
    },
    [persistCharacter, appendLog]
  );

  const adjustHp = useCallback(
    (delta: number) => {
      if (rawChar.wildShapeForm) {
        const beast = rawChar.wildShapeForm;
        if (delta < 0) {
          const dmg = Math.abs(delta);
          const beastAbsorb = Math.min(beast.hp.current, dmg);
          const leftover = dmg - beastAbsorb;
          const nextBeastHp = beast.hp.current - beastAbsorb;
          const reverted = nextBeastHp <= 0;

          let nextHumanHp = rawChar.hp;
          if (reverted && leftover > 0) {
            const absorbedTemp = Math.min(rawChar.hp.temp, leftover);
            nextHumanHp = {
              ...rawChar.hp,
              temp: rawChar.hp.temp - absorbedTemp,
              current: Math.max(0, rawChar.hp.current - (leftover - absorbedTemp)),
            };
          }

          persistCharacter((prev) => ({
            ...prev,
            wildShapeForm: reverted ? null : { ...beast, hp: { ...beast.hp, current: nextBeastHp } },
            hp: reverted ? nextHumanHp : prev.hp,
            deathSaves: reverted && nextHumanHp.current > 0 ? { successes: 0, failures: 0 } : prev.deathSaves,
          }));

          const dc = Math.max(10, Math.floor(dmg / 2));
          const hasActiveConc =
            encounter.activeEffects.some(
              (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
            ) || rawChar.conditions.some((c) => c.toLowerCase() === 'concentrating');
          if (hasActiveConc) {
            setPendingConcDc(dc);
            appendLog(
              `Concentration Check required: DC ${dc} CON save! (took ${dmg} damage)`,
              'warn'
            );
          }

          if (reverted) {
            appendLog(
              `${beast.name} dropped to 0 HP — reverted!${leftover > 0 ? ` Carry-over damage: ${leftover}.` : ''}`,
              'warn'
            );
            pushToast(`Wild Shape (${beast.name}) ended!`, 'warn');
          } else {
            appendLog(`Wild Shape (${beast.name}) took ${dmg} damage (${nextBeastHp}/${beast.hp.max} HP).`, 'info');
          }
          return;
        }

        const healedBeastHp = Math.min(beast.hp.max, beast.hp.current + delta);
        persistCharacter((prev) => ({
          ...prev,
          wildShapeForm: prev.wildShapeForm
            ? { ...prev.wildShapeForm, hp: { ...prev.wildShapeForm.hp, current: healedBeastHp } }
            : null,
        }));
        playTableSound('heal');
        appendLog(`Wild Shape (${beast.name}) healed +${delta} (${healedBeastHp}/${beast.hp.max} HP).`, 'info');
        return;
      }

      const computeAdjusted = (hp: RawCharacterState['hp']) => {
        let nextTemp = hp.temp;
        let nextCurrent = hp.current;
        if (delta < 0) {
          const dmg = Math.abs(delta);
          const absorbed = Math.min(nextTemp, dmg);
          nextTemp -= absorbed;
          nextCurrent = Math.max(0, nextCurrent - (dmg - absorbed));
        } else {
          nextCurrent = Math.min(hp.max, nextCurrent + delta);
        }
        return { ...hp, current: nextCurrent, temp: nextTemp };
      };

      const nextHp = computeAdjusted(rawChar.hp);
      persistCharacter((prev) => {
        const updated = computeAdjusted(prev.hp);
        return {
          ...prev,
          hp: updated,
          deathSaves: updated.current > 0 ? { successes: 0, failures: 0 } : prev.deathSaves,
        };
      });

      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === rawChar.id
            ? { ...c, hp: { ...c.hp, current: nextHp.current, temp: nextHp.temp } }
            : c
        ),
      }));

      if (delta < 0) {
        const dc = Math.max(10, Math.floor(Math.abs(delta) / 2));
        const hasActiveConc =
          encounter.activeEffects.some(
            (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
          ) || rawChar.conditions.some((c) => c.toLowerCase() === 'concentrating');
        if (hasActiveConc) {
          setPendingConcDc(dc);
          appendLog(
            `Concentration Check required: DC ${dc} CON save! (took ${Math.abs(delta)} damage)`,
            'warn'
          );
        }
      } else if (delta > 0) {
        playTableSound('heal');
      }
      appendLog(`HP adjusted by ${delta >= 0 ? `+${delta}` : delta}.`, 'info');
    },
    [rawChar.hp, rawChar.wildShapeForm, rawChar.id, rawChar.conditions, encounter.activeEffects, persistCharacter, persistEncounter, appendLog, pushToast]
  );

  const enterWildShape = useCallback(
    (form: WildShapeForm) => {
      const cloned: WildShapeForm = structuredClone(form);
      persistCharacter((prev) => {
        const wsPool = prev.resources.find((r) => r.id === 'auto_class_wild_shape');
        const nextResources =
          wsPool && wsPool.current > 0
            ? prev.resources.map((r) =>
                r.id === 'auto_class_wild_shape' ? { ...r, current: r.current - 1 } : r
              )
            : prev.resources;
        return {
          ...prev,
          wildShapeForm: cloned,
          resources: nextResources,
        };
      });
      appendLog(`Shifted into Wild Shape: ${form.name} (AC ${form.ac}, ${form.hp.max} HP, ${form.speed} ft).`, 'info');
      pushToast(`Wild Shape: ${form.name} (${form.hp.max} HP)`, 'info');
    },
    [persistCharacter, appendLog, pushToast]
  );

  const revertWildShape = useCallback(() => {
    persistCharacter((prev) => ({ ...prev, wildShapeForm: null }));
    appendLog(`${rawChar.name} reverted from Wild Shape.`, 'info');
  }, [rawChar.name, persistCharacter, appendLog]);

  const setTempHp = useCallback(
    (temp: number) => {
      const clamped = Math.max(0, temp);
      persistCharacter((prev) => ({
        ...prev,
        hp: { ...prev.hp, temp: clamped },
      }));
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === rawChar.id ? { ...c, hp: { ...c.hp, temp: clamped } } : c
        ),
      }));
      appendLog(`Set Temp HP to ${clamped}.`, 'info');
    },
    [rawChar.id, persistCharacter, persistEncounter, appendLog]
  );

  const setExhaustion = useCallback(
    (level: number) => {
      const clamped = Math.max(0, Math.min(6, level));
      persistCharacter((prev) => ({ ...prev, exhaustion: clamped }));
      appendLog(`Set Exhaustion level to ${clamped}.`, clamped > 0 ? 'warn' : 'info');
    },
    [persistCharacter, appendLog]
  );

  const updateDeathSaves = useCallback(
    (kind: 'successes' | 'failures', count: number) => {
      const clamped = Math.max(0, Math.min(3, count));
      persistCharacter((prev) => ({
        ...prev,
        deathSaves: { ...prev.deathSaves, [kind]: clamped },
      }));
    },
    [persistCharacter]
  );

  const rollDeathSave = useCallback(() => {
    const roll = evaluateDiceExpression('1d20', 'normal');
    const d20 = roll.total;
    if (d20 === 20) {
      persistCharacter((prev) => ({
        ...prev,
        hp: { ...prev.hp, current: 1 },
        deathSaves: { successes: 0, failures: 0 },
      }));
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === rawChar.id ? { ...c, hp: { ...c.hp, current: 1 } } : c
        ),
      }));
      appendLog(
        `Death Save: Natural 20! ${rawChar.name} regains 1 HP and resets Death Saves.`,
        'crit'
      );
      return;
    }
    if (d20 === 1) {
      const nextFail = Math.min(3, rawChar.deathSaves.failures + 2);
      persistCharacter((prev) => ({
        ...prev,
        deathSaves: { ...prev.deathSaves, failures: Math.min(3, prev.deathSaves.failures + 2) },
      }));
      appendLog(`Death Save: Natural 1! +2 Failures (${nextFail}/3).`, 'warn');
      return;
    }
    if (d20 >= 10) {
      const nextSucc = Math.min(3, rawChar.deathSaves.successes + 1);
      persistCharacter((prev) => ({
        ...prev,
        deathSaves: { ...prev.deathSaves, successes: Math.min(3, prev.deathSaves.successes + 1) },
      }));
      appendLog(
        `Death Save: ${d20} — Success (${nextSucc}/3)${nextSucc >= 3 ? ' (Stabilized)' : '.'}`,
        'info'
      );
      return;
    }
    const nextFail = Math.min(3, rawChar.deathSaves.failures + 1);
    persistCharacter((prev) => ({
      ...prev,
      deathSaves: { ...prev.deathSaves, failures: Math.min(3, prev.deathSaves.failures + 1) },
    }));
    appendLog(`Death Save: ${d20} — Failure (${nextFail}/3).`, 'warn');
  }, [
    rawChar.id,
    rawChar.name,
    rawChar.deathSaves.successes,
    rawChar.deathSaves.failures,
    persistCharacter,
    persistEncounter,
    appendLog,
  ]);

  const toggleInspiration = useCallback(() => {
    persistCharacter((prev) => ({ ...prev, inspiration: !prev.inspiration }));
    appendLog(
      rawChar.inspiration
        ? `${rawChar.name} used Heroic Inspiration.`
        : `${rawChar.name} gained Heroic Inspiration!`,
      'info'
    );
  }, [rawChar.inspiration, rawChar.name, persistCharacter, appendLog]);

  const toggleDefense = useCallback(
    (kind: 'resistances' | 'immunities' | 'vulnerabilities', damageType: string) => {
      const clean = damageType.trim().toLowerCase();
      if (!clean) return;
      persistCharacter((prev) => {
        const current = prev.defenses ?? { resistances: [], immunities: [], vulnerabilities: [] };
        const list = current[kind];
        const exists = list.includes(clean);
        return {
          ...prev,
          defenses: {
            ...current,
            [kind]: exists ? list.filter((d) => d !== clean) : [...list, clean],
          },
        };
      });
      appendLog(`Toggled ${kind.slice(0, -1)}: ${clean}.`, 'info');
    },
    [persistCharacter, appendLog]
  );

  const applySubclassGrants = useCallback(
    (className: string, subclassName: string) => {
      const grants = buildSubclassGrantEntities(className, subclassName, rawChar.ruleset);
      if (grants.length === 0) {
        appendLog(`No automatic SRD grants matched "${subclassName}" for ${className}.`, 'info');
        return 0;
      }
      persistCharacter((prev) => {
        const existingIds = new Set(prev.items.map((i) => i.id));
        const existingNames = new Set(prev.items.map((i) => i.name.toLowerCase()));
        const toAdd = grants.filter(
          (g) => !existingIds.has(g.id) && !existingNames.has(g.name.toLowerCase())
        );
        if (toAdd.length === 0) return prev;
        return { ...prev, items: [...prev.items, ...toAdd] };
      });
      appendLog(`Applied ${grants.length} ${subclassName} feature/spell grant(s).`, 'info');
      return grants.length;
    },
    [rawChar.ruleset, persistCharacter, appendLog]
  );

  const adjustResourcePool = useCallback(
    (poolId: string, delta: number) => {
      persistCharacter((prev) => ({
        ...prev,
        resources: prev.resources.map((r) =>
          r.id === poolId
            ? { ...r, current: Math.max(0, Math.min(r.max, r.current + delta)) }
            : r
        ),
      }));
    },
    [persistCharacter]
  );

  const addCustomResourcePool = useCallback(
    (name: string, max: number, recovery: RecoveryTrigger) => {
      const cleanName = name.trim();
      if (!cleanName) return;
      const safeMax = Math.max(1, max);
      persistCharacter((prev) => ({
        ...prev,
        resources: [
          ...prev.resources,
          {
            id: `pool-${Date.now().toString(36)}`,
            name: cleanName,
            current: safeMax,
            max: safeMax,
            recovery,
          },
        ],
      }));
      appendLog(`Added resource pool "${cleanName}" (${safeMax}/${safeMax}).`, 'info');
    },
    [persistCharacter, appendLog]
  );

  const toggleCondition = useCallback(
    (condition: string) => {
      const adding = !rawChar.conditions.includes(condition);
      const nextConditions = adding
        ? [...rawChar.conditions, condition]
        : rawChar.conditions.filter((c) => c !== condition);

      persistCharacter((prev) => ({
        ...prev,
        conditions: prev.conditions.includes(condition)
          ? prev.conditions.filter((c) => c !== condition)
          : [...prev.conditions, condition],
      }));

      const breaksConc =
        adding &&
        (condition === 'Incapacitated' ||
          condition === 'Paralyzed' ||
          condition === 'Stunned' ||
          condition === 'Unconscious');
      const hadConc = encounter.activeEffects.some(
        (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
      );

      persistEncounter((prev) => {
        const hasConc = prev.activeEffects.some(
          (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
        );
        let updated: CombatEncounterState = {
          ...prev,
          combatants: prev.combatants.map((c) =>
            c.id === rawChar.id ? { ...c, conditions: nextConditions } : c
          ),
        };
        if (breaksConc && hasConc) {
          updated = dropConcentrationForCombatant(
            updated,
            rawChar.id,
            `${condition} broke Concentration`
          );
        }
        return updated;
      });
      if (breaksConc && hadConc) {
        setPendingConcDc(null);
        appendLog(`${condition} automatically ended ${rawChar.name}'s Concentration.`, 'warn');
      } else {
        appendLog(`Toggled condition: ${condition}.`, 'info');
      }
    },
    [rawChar.conditions, rawChar.id, rawChar.name, encounter.activeEffects, persistCharacter, persistEncounter, appendLog]
  );

  const takeRest = useCallback(
    (restType: 'short_rest' | 'long_rest') => {
      persistCharacter((prev) => applyRestRecovery(prev, restType));
      appendLog(
        restType === 'long_rest'
          ? 'Completed Long Rest: restored full HP, spell slots, long-rest pools, and reduced exhaustion.'
          : 'Completed Short Rest: restored short-rest & Pact Magic pools.',
        'info'
      );
    },
    [persistCharacter, appendLog]
  );

  const spendHitDie = useCallback(() => {
    const hitDicePool = rawChar.resources.find((r) => r.id === 'hit_dice');
    if (!hitDicePool || hitDicePool.current <= 0) {
      appendLog('No Hit Dice remaining.', 'warn');
      return;
    }
    const primaryDie = rawChar.classes[0]?.hitDie ?? 8;
    const conMod = resolvedSheet.abilities.con.modifier;
    const sign = conMod >= 0 ? '+' : '';
    const roll = evaluateDiceExpression(`1d${primaryDie}${sign}${conMod}`, 'normal');
    const healed = Math.max(1, roll.total);
    persistCharacter((prev) => ({
      ...prev,
      hp: {
        ...prev.hp,
        current: Math.min(prev.hp.max, prev.hp.current + healed),
      },
      resources: prev.resources.map((r) =>
        r.id === 'hit_dice' ? { ...r, current: Math.max(0, r.current - 1) } : r
      ),
    }));
    appendLog(`Spent Hit Die (1d${primaryDie}${sign}${conMod}): healed ${healed} HP.`, 'roll');
  }, [rawChar.resources, rawChar.classes, resolvedSheet.abilities.con.modifier, persistCharacter, appendLog]);

  const spendHitDiceBulk = useCallback(
    (count: number, dieSize?: 6 | 8 | 10 | 12) => {
      const hitDicePool = rawChar.resources.find((r) => r.id === 'hit_dice');
      const available = hitDicePool?.current ?? 0;
      const toSpend = Math.min(available, Math.max(0, Math.floor(count)));
      if (toSpend <= 0) return;
      const die = dieSize ?? rawChar.classes[0]?.hitDie ?? 8;
      const conMod = resolvedSheet.abilities.con.modifier;
      const sign = conMod >= 0 ? '+' : '';
      let totalHealed = 0;
      const rolls: number[] = [];
      for (let i = 0; i < toSpend; i += 1) {
        const r = evaluateDiceExpression(`1d${die}${sign}${conMod}`, 'normal');
        const val = Math.max(1, r.total);
        rolls.push(val);
        totalHealed += val;
      }
      persistCharacter((prev) => ({
        ...prev,
        hp: {
          ...prev.hp,
          current: Math.min(prev.hp.max, prev.hp.current + totalHealed),
        },
        resources: prev.resources.map((r) =>
          r.id === 'hit_dice' ? { ...r, current: Math.max(0, r.current - toSpend) } : r
        ),
      }));
      appendLog(
        `Short Rest Hit Dice (${toSpend}×d${die}${sign}${conMod} = [${rolls.join(', ')}]): healed ${totalHealed} HP.`,
        'roll'
      );
    },
    [rawChar.resources, rawChar.classes, resolvedSheet.abilities.con.modifier, persistCharacter, appendLog]
  );

  const toggleItemEquipped = useCallback(
    (itemId: string) => {
      persistCharacter((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, equipped: !it.equipped } : it
        ),
      }));
    },
    [persistCharacter]
  );

  const toggleItemPrepared = useCallback(
    (itemId: string) => {
      persistCharacter((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, prepared: !(it.prepared ?? true) } : it
        ),
      }));
    },
    [persistCharacter]
  );

  const toggleItemAttuned = useCallback(
    (itemId: string) => {
      const currentAttuned = rawChar.items.filter((i) => i.requiresAttunement && i.attuned).length;
      const target = rawChar.items.find((i) => i.id === itemId);
      if (target && !target.attuned && currentAttuned >= 3) {
        appendLog('Attunement limit reached (3/3 items). Unattune an item first.', 'warn');
        return;
      }
      persistCharacter((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, attuned: !it.attuned } : it
        ),
      }));
    },
    [rawChar.items, persistCharacter, appendLog]
  );

  const removeSheetItem = useCallback(
    (itemId: string) => {
      persistCharacter((prev) => ({
        ...prev,
        items: prev.items.filter((it) => it.id !== itemId),
      }));
      appendLog('Removed item/spell from character sheet.', 'info');
    },
    [persistCharacter, appendLog]
  );

  const updateCurrency = useCallback(
    (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => {
      const safe = Math.max(0, Math.floor(value) || 0);
      persistCharacter((prev) => ({
        ...prev,
        currency: {
          cp: prev.currency?.cp ?? 0,
          sp: prev.currency?.sp ?? 0,
          ep: prev.currency?.ep ?? 0,
          gp: prev.currency?.gp ?? 0,
          pp: prev.currency?.pp ?? 0,
          [coin]: safe,
        },
      }));
    },
    [persistCharacter]
  );

  const updateItemQuantity = useCallback(
    (itemId: string, delta: number) => {
      persistCharacter((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId
            ? { ...it, quantity: Math.max(0, (it.quantity ?? 1) + delta) }
            : it
        ),
      }));
    },
    [persistCharacter]
  );

  const updateCharacterNotes = useCallback(
    (patch: Partial<NonNullable<RawCharacterState['notes']>>) => {
      persistCharacter((prev) => ({
        ...prev,
        notes: {
          bio: prev.notes?.bio ?? '',
          campaign: prev.notes?.campaign ?? '',
          proficiencies: prev.notes?.proficiencies ?? '',
          ...patch,
        },
      }));
    },
    [persistCharacter]
  );

  const updateSenses = useCallback(
    (patch: Partial<NonNullable<RawCharacterState['senses']>>) => {
      persistCharacter((prev) => ({
        ...prev,
        senses: {
          darkvision: prev.senses?.darkvision ?? 0,
          blindsight: prev.senses?.blindsight ?? 0,
          tremorsense: prev.senses?.tremorsense ?? 0,
          truesight: prev.senses?.truesight ?? 0,
          ...patch,
        },
      }));
    },
    [persistCharacter]
  );

  const updateSpeeds = useCallback(
    (patch: Partial<NonNullable<RawCharacterState['speeds']>>) => {
      persistCharacter((prev) => ({
        ...prev,
        speeds: {
          walk: prev.speeds?.walk ?? 30,
          fly: prev.speeds?.fly ?? 0,
          swim: prev.speeds?.swim ?? 0,
          climb: prev.speeds?.climb ?? 0,
          burrow: prev.speeds?.burrow ?? 0,
          ...patch,
        },
      }));
    },
    [persistCharacter]
  );

  const updateStructuredProficiencies = useCallback(
    (patch: Partial<NonNullable<RawCharacterState['structuredProficiencies']>>) => {
      persistCharacter((prev) => ({
        ...prev,
        structuredProficiencies: {
          armor: prev.structuredProficiencies?.armor ?? [],
          weapons: prev.structuredProficiencies?.weapons ?? [],
          tools: prev.structuredProficiencies?.tools ?? [],
          languages: prev.structuredProficiencies?.languages ?? [],
          ...patch,
        },
      }));
    },
    [persistCharacter]
  );

  const updateDetails = useCallback(
    (patch: Partial<NonNullable<RawCharacterState['details']>>) => {
      persistCharacter((prev) => ({
        ...prev,
        details: {
          ...(prev.details ?? {}),
          ...patch,
        },
      }));
    },
    [persistCharacter]
  );

  const updateItemContainer = useCallback(
    (itemId: string, container: string) => {
      persistCharacter((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, container: container || undefined } : it
        ),
      }));
    },
    [persistCharacter]
  );

  const simplifyCurrency = useCallback(() => {
    persistCharacter((prev) => {
      const c = prev.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      const totalCp = c.cp + c.sp * 10 + c.ep * 50 + c.gp * 100 + c.pp * 1000;
      const pp = Math.floor(totalCp / 1000);
      const remAfterPp = totalCp % 1000;
      const gp = Math.floor(remAfterPp / 100);
      const remAfterGp = remAfterPp % 100;
      const sp = Math.floor(remAfterGp / 10);
      const cp = remAfterGp % 10;
      return {
        ...prev,
        currency: { cp, sp, ep: 0, gp, pp },
      };
    });
    appendLog('Converted currency to optimal denominations (PP/GP/SP/CP).', 'info');
  }, [persistCharacter, appendLog]);

  const applyLevelUpPlan = useCallback(
    (input: LevelUpPlanInput) => {
      const allPackEntities = new Map<string, CompendiumEntity>(
        [...BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities), ...compendium].map((e) => [e.id, e])
      );

      persistCharacter((prev) => {
        const exists = prev.classes.some(
          (c) => c.className.toLowerCase() === input.className.toLowerCase()
        );
        const nextClasses: ClassLevel[] = exists
          ? prev.classes.map((c) =>
              c.className.toLowerCase() === input.className.toLowerCase()
                ? {
                    ...c,
                    level: Math.min(20, c.level + 1),
                    subclassName: input.subclassName?.trim() || c.subclassName,
                  }
                : c
            )
          : [
              ...prev.classes,
              {
                className: input.className,
                subclassName: input.subclassName?.trim() || undefined,
                level: 1,
                hitDie: input.hitDie,
                casterProgression: input.casterProgression,
              },
            ];

        const nextBonusAbilities = { ...prev.bonusAbilities };
        if (input.abilityIncreases) {
          (Object.entries(input.abilityIncreases) as Array<[AbilityKey, number | undefined]>).forEach(
            ([key, delta]) => {
              if (delta && delta !== 0) {
                nextBonusAbilities[key] = (nextBonusAbilities[key] ?? 0) + delta;
              }
            }
          );
        }

        const existingIds = new Set(prev.items.map((i) => i.id));
        const existingNames = new Set(prev.items.map((i) => i.name.toLowerCase()));
        const additions: CompendiumEntity[] = [];

        for (const eid of input.bonusEntityIds ?? []) {
          const found = allPackEntities.get(eid);
          if (!found || existingIds.has(found.id) || existingNames.has(found.name.toLowerCase())) continue;
          const clone = structuredClone(found);
          clone.ruleset = prev.ruleset;
          clone.prepared = true;
          clone.equipped = true;
          additions.push(clone);
          existingIds.add(clone.id);
          existingNames.add(clone.name.toLowerCase());
        }

        if (input.applySubclassGrants && input.subclassName) {
          const grants = buildSubclassGrantEntities(input.className, input.subclassName, prev.ruleset);
          for (const g of grants) {
            if (existingIds.has(g.id) || existingNames.has(g.name.toLowerCase())) continue;
            additions.push(g);
            existingIds.add(g.id);
            existingNames.add(g.name.toLowerCase());
          }
        }

        const hpDelta = Math.max(1, Math.round(input.hpGain));
        return {
          ...prev,
          classes: nextClasses,
          bonusAbilities: nextBonusAbilities,
          hp: {
            ...prev.hp,
            max: prev.hp.max + hpDelta,
            current: Math.min(prev.hp.max + hpDelta, prev.hp.current + hpDelta),
          },
          items: [...prev.items, ...additions],
        };
      });

      appendLog(`Leveled up ${input.className} (+${Math.max(1, Math.round(input.hpGain))} HP).`, 'info');
      pushToast(`${rawChar.name}: ${input.className} level up (+${Math.max(1, Math.round(input.hpGain))} HP)!`, 'info');
    },
    [rawChar.name, persistCharacter, appendLog, pushToast]
  );

  const setCharacterAvatar = useCallback(
    (avatarUrl: string | undefined) => {
      persistCharacter((prev) => ({ ...prev, avatarUrl }));
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === rawChar.id ? { ...c, portraitUrl: avatarUrl } : c
        ),
      }));
      appendLog(avatarUrl ? 'Updated character portrait.' : 'Cleared character portrait.', 'info');
    },
    [persistCharacter, persistEncounter, rawChar.id, appendLog]
  );

  return {
    switchCharacter,
    createNewCharacter,
    createCharacterFromPreset,
    duplicateCharacter,
    deleteCharacter,
    setStatOverride,
    adjustHp,
    enterWildShape,
    revertWildShape,
    setTempHp,
    setExhaustion,
    updateDeathSaves,
    rollDeathSave,
    toggleInspiration,
    toggleDefense,
    applySubclassGrants,
    adjustResourcePool,
    addCustomResourcePool,
    toggleCondition,
    takeRest,
    spendHitDie,
    spendHitDiceBulk,
    toggleItemEquipped,
    toggleItemPrepared,
    toggleItemAttuned,
    removeSheetItem,
    updateCurrency,
    updateItemQuantity,
    updateCharacterNotes,
    updateSenses,
    updateSpeeds,
    updateStructuredProficiencies,
    updateDetails,
    updateItemContainer,
    simplifyCurrency,
    applyLevelUpPlan,
    setCharacterAvatar,
  };
}
