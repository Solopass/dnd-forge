import { useCallback, useEffect, useMemo, useState } from 'react';
import { RawCharacterState, ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { CombatEncounterState, CombatLogEntry } from '../types/combat';
import { Activity, CompendiumEntity } from '../types/compendium';
import { RecoveryTrigger, RollMode } from '../types/core';
import {
  applyRestRecovery,
  computeCharacterSheet,
  createBlankCharacter,
  resolveResourcePoolForCost,
  syncSpellSlotPools,
} from '../engine/rules-math';
import { doubleDiceForCrit, evaluateDiceExpression } from '../engine/dice';
import {
  advanceTurn,
  applyEffectWithConcentrationCheck,
  dropConcentrationForCombatant,
  sortInitiativeOrder,
  spawnLinkedSummon,
} from '../engine/combat-machine';
import { parseHomebrewMarkdownBlock } from '../engine/statblock-parser';
import { adapt5eToolsPayload } from '../engine/five-tools-adapter';
import { parseDndBeyondPdfBuffer } from '../engine/ddb-pdf-importer';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import {
  buildCharacterFromPreset,
  NewCharacterPresetInput,
  syncClassResourcePools,
} from '../engine/classes';
import {
  buildSearchTokens,
  db,
  importBackupBundle,
  saveCharacter,
  saveEncounter,
  upsertCompendiumEntities,
} from '../storage/db';

export interface ConsoleLine {
  id: string;
  timestamp: string;
  text: string;
  tone: 'info' | 'roll' | 'warn' | 'crit';
}

export function useSheetStore(initialCharacter: RawCharacterState, initialEncounter: CombatEncounterState) {
  const [rawChar, setRawChar] = useState<RawCharacterState>(initialCharacter);
  const [characterList, setCharacterList] = useState<RawCharacterState[]>([initialCharacter]);
  const [encounter, setEncounter] = useState<CombatEncounterState>(initialEncounter);
  const [encounterList, setEncounterList] = useState<CombatEncounterState[]>([initialEncounter]);
  const [compendium, setCompendium] = useState<CompendiumEntity[]>(initialCharacter.items);
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [pendingConcDc, setPendingConcDc] = useState<number | null>(null);
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      text: 'D&D Forge v0.6 ready. Press Ctrl+K for Compendium Packs, D&D Beyond PDF Import, or JSON/Markdown ingestion.',
      tone: 'info',
    },
  ]);

  const appendLog = useCallback((text: string, tone: ConsoleLine['tone'] = 'info') => {
    setConsoleLines((prev) => [
      {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        text,
        tone,
      },
      ...prev.slice(0, 89),
    ]);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [allSaved, savedEncounters] = await Promise.all([
          db.characters.toArray(),
          db.encounters.toArray(),
        ]);
        if (active && allSaved.length > 0) {
          setCharacterList(allSaved);
          setRawChar(allSaved[0]!);
        } else {
          await saveCharacter(initialCharacter);
          await upsertCompendiumEntities(initialCharacter.items);
        }
        if (active && savedEncounters.length > 0) {
          setEncounterList(savedEncounters);
          const primary =
            savedEncounters.find((e) => e.id === initialEncounter.id) ?? savedEncounters[0]!;
          setEncounter(primary);
        } else {
          await saveEncounter(initialEncounter);
          if (active) setEncounterList([initialEncounter]);
        }
        const basePackEntities = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
        await upsertCompendiumEntities(basePackEntities);
        const refreshed = await db.compendium.toArray();
        if (active && refreshed.length > 0) {
          setCompendium(refreshed);
        }
      } catch (err) {
        appendLog(`Storage hydration warning: ${String(err)}`, 'warn');
      }
    })();
    return () => {
      active = false;
    };
  }, [initialCharacter, initialEncounter, appendLog]);

  const resolvedSheet: ResolvedCharacterSheet = useMemo(
    () => computeCharacterSheet(rawChar),
    [rawChar]
  );

  const persistCharacter = useCallback((updater: (prev: RawCharacterState) => RawCharacterState) => {
    setRawChar((prev) => {
      const drafted = updater(prev);
      const totalAbilities = {
        str: drafted.baseAbilities.str + drafted.bonusAbilities.str,
        dex: drafted.baseAbilities.dex + drafted.bonusAbilities.dex,
        con: drafted.baseAbilities.con + drafted.bonusAbilities.con,
        int: drafted.baseAbilities.int + drafted.bonusAbilities.int,
        wis: drafted.baseAbilities.wis + drafted.bonusAbilities.wis,
        cha: drafted.baseAbilities.cha + drafted.bonusAbilities.cha,
      };
      const withClassPools = syncClassResourcePools(drafted.classes, drafted.resources, totalAbilities);
      const syncedResources = syncSpellSlotPools(drafted.classes, withClassPools);
      const next = { ...drafted, resources: syncedResources };
      void saveCharacter(next);
      setCharacterList((list) =>
        list.some((c) => c.id === next.id)
          ? list.map((c) => (c.id === next.id ? next : c))
          : [...list, next]
      );
      return next;
    });
  }, []);

  const persistEncounter = useCallback((updater: (prev: CombatEncounterState) => CombatEncounterState) => {
    setEncounter((prev) => {
      const next = updater(prev);
      void saveEncounter(next);
      setEncounterList((list) =>
        list.some((e) => e.id === next.id)
          ? list.map((e) => (e.id === next.id ? next : e))
          : [...list, next]
      );
      return next;
    });
  }, []);

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
      const fresh = buildCharacterFromPreset({ ...input, id });
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

  const duplicateCharacter = useCallback(async () => {
    const id = `char-${Date.now().toString(36)}`;
    const copy: RawCharacterState = {
      ...structuredClone(rawChar),
      id,
      name: `${rawChar.name} (Copy)`,
    };
    await saveCharacter(copy);
    setCharacterList((prev) => [...prev, copy]);
    setRawChar(copy);
    setPendingConcDc(null);
    appendLog(`Duplicated character as "${copy.name}".`, 'info');
  }, [rawChar, appendLog]);

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
        const hasActiveConc = encounter.activeEffects.some(
          (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
        );
        if (hasActiveConc) {
          setPendingConcDc(dc);
          appendLog(
            `Concentration Check required: DC ${dc} CON save! (took ${Math.abs(delta)} damage)`,
            'warn'
          );
        }
      }
      appendLog(`HP adjusted by ${delta >= 0 ? `+${delta}` : delta}.`, 'info');
    },
    [rawChar.hp, rawChar.id, encounter.activeEffects, persistCharacter, persistEncounter, appendLog]
  );

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

  const clearConsoleLog = useCallback(() => {
    setConsoleLines([]);
  }, []);

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
      persistCharacter((prev) => {
        const exists = prev.conditions.includes(condition);
        const nextConditions = exists
          ? prev.conditions.filter((c) => c !== condition)
          : [...prev.conditions, condition];
        return { ...prev, conditions: nextConditions };
      });
      appendLog(`Toggled condition: ${condition}.`, 'info');
    },
    [persistCharacter, appendLog]
  );

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

  const addMonsterToEncounter = useCallback(
    (name: string, ac: number, maxHp: number, dexMod = 0, actions?: Activity[], cr?: string) => {
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
              cr,
              x: 12 + (mobCount % 6),
              y: 2 + Math.floor(mobCount / 6) * 2,
              tokenColor: '#f85149',
              initiative: initRoll.total,
              dexModifier: dexMod,
              ac,
              hp: { current: maxHp, max: maxHp, temp: 0 },
              conditions: [],
              actions,
              turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
            },
          ]),
        };
      });
      appendLog(`Added ${name} to encounter (Init ${initRoll.total}, AC ${ac}, HP ${maxHp}).`, 'info');
    },
    [persistEncounter, appendLog]
  );

  const addCompendiumItemToSheet = useCallback(
    (entity: CompendiumEntity) => {
      if (entity.category === 'monster' && entity.monsterMeta) {
        addMonsterToEncounter(
          entity.name,
          entity.monsterMeta.ac,
          entity.monsterMeta.hp,
          entity.monsterMeta.dexModifier,
          entity.activities,
          entity.monsterMeta.cr
        );
        return;
      }

      persistCharacter((prev) => {
        const clone: CompendiumEntity = {
          ...structuredClone(entity),
          id: `${entity.id}-${Date.now().toString(36)}`,
          equipped: true,
          prepared: true,
        };
        return { ...prev, items: [clone, ...prev.items] };
      });
      appendLog(`Added "${entity.name}" (${entity.category}) to character sheet.`, 'info');
    },
    [persistCharacter, addMonsterToEncounter, appendLog]
  );

  const installContentPack = useCallback(
    async (packId: string) => {
      const pack = BUILTIN_CONTENT_PACKS.find((p) => p.id === packId);
      if (!pack) return;
      await upsertCompendiumEntities(pack.entities);
      const refreshed = await db.compendium.toArray();
      setCompendium(refreshed);
      appendLog(`Installed "${pack.name}" (${pack.entities.length} entries added to local Compendium).`, 'info');
    },
    [appendLog]
  );

  const importDdbPdfFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const result = await parseDndBeyondPdfBuffer(buffer, file.name);
        await saveCharacter(result.character);
        if (result.character.items.length > 0) {
          await upsertCompendiumEntities(result.character.items);
          const refreshed = await db.compendium.toArray();
          setCompendium(refreshed);
        }
        setCharacterList((prev) => [...prev, result.character]);
        setRawChar(result.character);
        appendLog(
          `Imported D&D Beyond PDF "${result.character.name}" (${result.extractedFieldsCount} PDF form fields read, ${result.character.items.length} weapons/spells).`,
          result.warnings.length > 0 ? 'warn' : 'info'
        );
        result.warnings.forEach((w) => appendLog(`  PDF Warning: ${w}`, 'warn'));
      } catch (err) {
        appendLog(`PDF import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog]
  );

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
        const dmgExpr = attackIsCrit ? doubleDiceForCrit(act.damageFormula) : act.damageFormula;
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
    (activity: ResolvedActivity) => {
      let spentNote = '';
      let effectiveSlotLevel = activity.resourceCost?.amount ?? 4;

      if (activity.resourceCost) {
        const resolution = resolveResourcePoolForCost(
          rawChar.resources,
          rawChar.classes,
          activity.resourceCost.poolId,
          activity.resourceCost.amount
        );
        if ('error' in resolution) {
          appendLog(`${resolution.error} (${activity.name})`, 'warn');
          return;
        }
        if (resolution.note) {
          spentNote = ` (${resolution.note})`;
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

      let attackIsCrit = false;
      if (activity.computedAttackBonus !== null) {
        const sign = activity.computedAttackBonus >= 0 ? '+' : '';
        const atk = evaluateDiceExpression(`1d20${sign}${activity.computedAttackBonus}`, rollMode);
        attackIsCrit = atk.isCrit;
        const tag = atk.isCrit ? ' [CRIT!]' : atk.isFumble ? ' [FUMBLE]' : '';
        appendLog(
          `${activity.name}${spentNote} Attack (${atk.mode}): ${atk.total}${tag} [${atk.terms.map((t) => t.kept.join(',')).join('+')}]`,
          atk.isCrit ? 'crit' : 'roll'
        );
      }

      if (activity.computedDamage) {
        const dmgExpr = attackIsCrit ? doubleDiceForCrit(activity.computedDamage) : activity.computedDamage;
        const dmg = evaluateDiceExpression(dmgExpr, 'normal');
        const critTag = attackIsCrit ? ' [CRIT DICE DOUBLED]' : '';
        const kindLabel = activity.type === 'heal' ? 'Healing' : 'Damage';
        appendLog(
          `${activity.name}${activity.computedAttackBonus === null ? spentNote : ''} ${kindLabel}: ${dmg.total} ${activity.damageType ?? ''} (${dmgExpr})${critTag}`,
          attackIsCrit ? 'crit' : 'roll'
        );
      } else if (spentNote) {
        appendLog(`Cast ${activity.name}${spentNote}.`, 'info');
      }

      if (activity.computedSaveDc !== null && activity.saveAbility) {
        appendLog(
          `${activity.name}${spentNote}: Target makes DC ${activity.computedSaveDc} ${activity.saveAbility.toUpperCase()} saving throw.`,
          'info'
        );
      }

      if (activity.concentration || activity.type === 'summon') {
        const concId = `eff-${Date.now()}`;
        persistEncounter((prev) => {
          let updated = applyEffectWithConcentrationCheck(prev, {
            id: concId,
            name: activity.parentItemName,
            sourceCombatantId: rawChar.id,
            targetCombatantId: rawChar.id,
            isConcentration: activity.concentration,
            expiration: activity.concentration ? 'concentration' : 'indefinite',
          });

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
    [rawChar, resolvedSheet.spellcasting.attackBonus.final, rollMode, persistCharacter, persistEncounter, appendLog]
  );

  const stepCombatTurn = useCallback(() => {
    persistEncounter((prev) => {
      const next = advanceTurn(prev);
      const latestLog: CombatLogEntry | undefined = next.log[next.log.length - 1];
      if (latestLog) {
        appendLog(`[Round ${next.round}] ${latestLog.message}`, latestLog.severity === 'warning' ? 'warn' : 'info');
      }
      return next;
    });
  }, [persistEncounter, appendLog]);

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
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) => {
          if (c.id !== combatantId) return c;
          const has = c.conditions.includes(condition);
          return {
            ...c,
            conditions: has ? c.conditions.filter((x) => x !== condition) : [...c.conditions, condition],
          };
        }),
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

  const importMarkdownHomebrew = useCallback(
    async (rawMarkdown: string) => {
      const result = parseHomebrewMarkdownBlock(rawMarkdown);
      await upsertCompendiumEntities([result.data]);
      setCompendium((prev) => [result.data, ...prev]);

      if (result.data.category === 'monster' && result.data.monsterMeta) {
        addMonsterToEncounter(
          result.data.name,
          result.data.monsterMeta.ac,
          result.data.monsterMeta.hp,
          result.data.monsterMeta.dexModifier,
          result.data.activities,
          result.data.monsterMeta.cr
        );
      } else {
        persistCharacter((prev) => ({
          ...prev,
          items: [result.data, ...prev.items],
        }));
      }

      appendLog(
        `Imported "${result.data.name}" (${result.data.category}, ${result.confidence} confidence, ${result.warnings.length} warning(s)).`,
        result.warnings.length > 0 ? 'warn' : 'info'
      );
      result.warnings.forEach((w) =>
        appendLog(`  Line ${w.line}: ${w.reason} ("${w.raw}")`, 'warn')
      );
    },
    [persistCharacter, addMonsterToEncounter, appendLog]
  );

  const importJsonFilePayload = useCallback(
    async (rawText: string) => {
      try {
        const parsed: unknown = JSON.parse(rawText);
        if (typeof parsed === 'object' && parsed !== null && (parsed as { app?: string }).app === 'dnd-forge') {
          const summary = await importBackupBundle(parsed, 'merge');
          const [refreshedChars, refreshedCompendium, refreshedEncounters] = await Promise.all([
            db.characters.toArray(),
            db.compendium.toArray(),
            db.encounters.toArray(),
          ]);
          if (refreshedChars.length > 0) {
            setCharacterList(refreshedChars);
            setRawChar(refreshedChars[0]!);
          }
          setCompendium(refreshedCompendium);
          if (refreshedEncounters.length > 0) {
            setEncounterList(refreshedEncounters);
            setEncounter(refreshedEncounters[0]!);
          }
          appendLog(
            `Merged backup bundle: ${summary.importedCharacters} character(s), ${summary.importedEntities} compendium item(s), ${summary.importedEncounters} encounter(s).`,
            'info'
          );
          return;
        }

        const adapted = adapt5eToolsPayload(parsed);
        if (adapted.entities.length > 0) {
          await upsertCompendiumEntities(adapted.entities);
          setCompendium((prev) => [...adapted.entities, ...prev]);
          appendLog(
            `Imported ${adapted.entities.length} 5e.tools entities (${adapted.skipped} skipped).`,
            'info'
          );
        } else {
          appendLog('JSON recognized, but no spell/item/feat/monster arrays were found.', 'warn');
        }
      } catch (err) {
        appendLog(`JSON import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog]
  );

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

  const moveCombatantToken = useCallback(
    (combatantId: string, x: number, y: number) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === combatantId ? { ...c, x, y } : c
        ),
      }));
    },
    [persistEncounter]
  );

  const setEncounterMapImage = useCallback(
    (imageDataUrl: string | undefined) => {
      persistEncounter((prev) => ({
        ...prev,
        map: {
          cols: prev.map?.cols ?? 20,
          rows: prev.map?.rows ?? 12,
          gridFeet: prev.map?.gridFeet ?? 5,
          templates: prev.map?.templates ?? [],
          imageDataUrl,
        },
      }));
      appendLog(imageDataUrl ? 'Loaded custom battlemap image.' : 'Cleared custom battlemap image.', 'info');
    },
    [persistEncounter, appendLog]
  );

  const addMapTemplate = useCallback(
    (kind: 'sphere' | 'cone' | 'line' | 'cube', x: number, y: number, radiusFeet: number) => {
      const colorMap = {
        sphere: 'rgba(248, 81, 73, 0.28)',
        cone: 'rgba(210, 153, 34, 0.28)',
        line: 'rgba(88, 166, 255, 0.30)',
        cube: 'rgba(188, 140, 255, 0.28)',
      } as const;
      persistEncounter((prev) => ({
        ...prev,
        map: {
          cols: prev.map?.cols ?? 20,
          rows: prev.map?.rows ?? 12,
          gridFeet: prev.map?.gridFeet ?? 5,
          imageDataUrl: prev.map?.imageDataUrl,
          templates: [
            ...(prev.map?.templates ?? []),
            {
              id: `tpl-${Date.now().toString(36)}`,
              kind,
              x,
              y,
              radiusFeet,
              color: colorMap[kind],
            },
          ],
        },
      }));
    },
    [persistEncounter]
  );

  const clearMapTemplates = useCallback(() => {
    persistEncounter((prev) => ({
      ...prev,
      map: {
        cols: prev.map?.cols ?? 20,
        rows: prev.map?.rows ?? 12,
        gridFeet: prev.map?.gridFeet ?? 5,
        imageDataUrl: prev.map?.imageDataUrl,
        templates: [],
      },
    }));
  }, [persistEncounter]);

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

  const createHomebrewEntity = useCallback(
    async (entity: CompendiumEntity, addToSheet: boolean) => {
      await upsertCompendiumEntities([entity]);
      setCompendium((prev) => [entity, ...prev.filter((i) => i.id !== entity.id)]);
      if (addToSheet && entity.category !== 'monster') {
        persistCharacter((prev) => ({
          ...prev,
          items: [
            { ...structuredClone(entity), equipped: true, prepared: true },
            ...prev.items,
          ],
        }));
      }
      appendLog(`Created homebrew "${entity.name}" (${entity.category}).`, 'info');
    },
    [persistCharacter, appendLog]
  );

  const searchCompendium = useCallback(
    (query: string): CompendiumEntity[] => {
      const q = query.trim().toLowerCase();
      if (!q) return compendium.slice(0, 120);
      return compendium
        .filter((item) => buildSearchTokens(item).includes(q))
        .slice(0, 120);
    },
    [compendium]
  );

  return {
    rawChar,
    characterList,
    switchCharacter,
    createNewCharacter,
    createCharacterFromPreset,
    duplicateCharacter,
    deleteCharacter,
    spendHitDie,
    persistCharacter,
    resolvedSheet,
    encounter,
    encounterList,
    switchEncounter,
    createEncounter,
    duplicateEncounter,
    deleteEncounter,
    addPartyToEncounter,
    moveCombatantToken,
    setEncounterMapImage,
    addMapTemplate,
    clearMapTemplates,
    updateCurrency,
    updateItemQuantity,
    updateCharacterNotes,
    createHomebrewEntity,
    compendium,
    rollMode,
    setRollMode,
    pendingConcDc,
    consoleLines,
    appendLog,
    clearConsoleLog,
    setStatOverride,
    adjustHp,
    setTempHp,
    setExhaustion,
    updateDeathSaves,
    adjustResourcePool,
    addCustomResourcePool,
    toggleCondition,
    rollCharacterInitiative,
    takeRest,
    toggleItemEquipped,
    toggleItemPrepared,
    toggleItemAttuned,
    removeSheetItem,
    addCompendiumItemToSheet,
    installContentPack,
    importDdbPdfFile,
    rollInlineExpression,
    triggerCombatantActivity,
    triggerActivity,
    stepCombatTurn,
    adjustCombatantHp,
    setCombatantInitiative,
    toggleCombatantCondition,
    removeCombatant,
    dropConcentration,
    rollConcentrationSave,
    resetEncounter,
    addMonsterToEncounter,
    importMarkdownHomebrew,
    importJsonFilePayload,
    searchCompendium,
  };
}
