import { useCallback, useEffect, useMemo, useState } from 'react';
import { RawCharacterState, ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { CombatEncounterState, CombatLogEntry } from '../types/combat';
import { Activity, CompendiumEntity } from '../types/compendium';
import { RecoveryTrigger, RollMode } from '../types/core';
import {
  applyRestRecovery,
  computeCharacterSheet,
  createBlankCharacter,
  syncSpellSlotPools,
} from '../engine/rules-math';
import { evaluateDiceExpression } from '../engine/dice';
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
  const [compendium, setCompendium] = useState<CompendiumEntity[]>(initialCharacter.items);
  const [rollMode, setRollMode] = useState<RollMode>('normal');
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
        const [allSaved, savedEncounter] = await Promise.all([
          db.characters.toArray(),
          db.encounters.get(initialEncounter.id),
        ]);
        if (active && allSaved.length > 0) {
          setCharacterList(allSaved);
          setRawChar(allSaved[0]!);
        } else {
          await saveCharacter(initialCharacter);
          await upsertCompendiumEntities(initialCharacter.items);
        }
        if (active && savedEncounter) {
          setEncounter(savedEncounter);
        } else {
          await saveEncounter(initialEncounter);
        }
        const storedItems = await db.compendium.toArray();
        if (active && storedItems.length > 0) {
          setCompendium(storedItems);
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
      const syncedResources = syncSpellSlotPools(drafted.classes, drafted.resources);
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
      return next;
    });
  }, []);

  const switchCharacter = useCallback(
    async (characterId: string) => {
      const found = characterList.find((c) => c.id === characterId) ?? (await db.characters.get(characterId));
      if (found) {
        setRawChar(found);
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
      appendLog(`Created new character "${fresh.name}".`, 'info');
    },
    [appendLog]
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
      persistCharacter((prev) => {
        let remainingDelta = delta;
        let nextTemp = prev.hp.temp;
        let nextCurrent = prev.hp.current;

        if (remainingDelta < 0) {
          const dmg = Math.abs(remainingDelta);
          const absorbed = Math.min(nextTemp, dmg);
          nextTemp -= absorbed;
          const leftover = dmg - absorbed;
          nextCurrent = Math.max(0, nextCurrent - leftover);
        } else {
          nextCurrent = Math.min(prev.hp.max, nextCurrent + remainingDelta);
        }

        return {
          ...prev,
          hp: { ...prev.hp, current: nextCurrent, temp: nextTemp },
          deathSaves: nextCurrent > 0 ? { successes: 0, failures: 0 } : prev.deathSaves,
        };
      });

      if (delta < 0) {
        const dc = Math.max(10, Math.floor(Math.abs(delta) / 2));
        const hasActiveConc = encounter.activeEffects.some(
          (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
        );
        if (hasActiveConc) {
          appendLog(
            `Took ${Math.abs(delta)} damage while concentrating -> Roll DC ${dc} CON Save!`,
            'warn'
          );
        }
      }
      appendLog(`HP adjusted by ${delta >= 0 ? `+${delta}` : delta}.`, 'info');
    },
    [persistCharacter, encounter.activeEffects, rawChar.id, appendLog]
  );

  const setTempHp = useCallback(
    (temp: number) => {
      const clamped = Math.max(0, temp);
      persistCharacter((prev) => ({
        ...prev,
        hp: { ...prev.hp, temp: clamped },
      }));
      appendLog(`Set Temp HP to ${clamped}.`, 'info');
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
    (name: string, ac: number, maxHp: number, dexMod = 0, actions?: Activity[]) => {
      const initRoll = evaluateDiceExpression(`1d20${dexMod >= 0 ? `+${dexMod}` : dexMod}`, 'normal');
      persistEncounter((prev) => ({
        ...prev,
        combatants: sortInitiativeOrder([
          ...prev.combatants,
          {
            id: `mob-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            name,
            kind: 'monster',
            initiative: initRoll.total,
            dexModifier: dexMod,
            ac,
            hp: { current: maxHp, max: maxHp, temp: 0 },
            conditions: [],
            actions,
            turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
          },
        ]),
      }));
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
          entity.activities
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
      if (act.attackBonusFormula) {
        const sign = act.attackBonusFormula.startsWith('+') || act.attackBonusFormula.startsWith('-') ? '' : '+';
        const atk = evaluateDiceExpression(`1d20${sign}${act.attackBonusFormula}`, rollMode);
        const tag = atk.isCrit ? ' [CRIT!]' : atk.isFumble ? ' [FUMBLE]' : '';
        appendLog(
          `${combatantName} — ${act.name} Attack: ${atk.total}${tag}`,
          atk.isCrit ? 'crit' : 'roll'
        );
      }
      if (act.damageFormula) {
        const dmg = evaluateDiceExpression(act.damageFormula, 'normal');
        appendLog(
          `${combatantName} — ${act.name} Damage: ${dmg.total} ${act.damageType ?? ''}`,
          'roll'
        );
      }
    },
    [rollMode, appendLog]
  );

  const triggerActivity = useCallback(
    (activity: ResolvedActivity) => {
      if (activity.resourceCost) {
        const pool = rawChar.resources.find((r) => r.id === activity.resourceCost?.poolId);
        if (pool && pool.current < activity.resourceCost.amount) {
          appendLog(`Insufficient ${pool.name} to use ${activity.name}.`, 'warn');
          return;
        }
        if (pool) {
          persistCharacter((prev) => ({
            ...prev,
            resources: prev.resources.map((r) =>
              r.id === pool.id
                ? { ...r, current: Math.max(0, r.current - (activity.resourceCost?.amount ?? 1)) }
                : r
            ),
          }));
        }
      }

      if (activity.computedAttackBonus !== null) {
        const sign = activity.computedAttackBonus >= 0 ? '+' : '';
        const atk = evaluateDiceExpression(`1d20${sign}${activity.computedAttackBonus}`, rollMode);
        const tag = atk.isCrit ? ' [CRIT!]' : atk.isFumble ? ' [FUMBLE]' : '';
        appendLog(
          `${activity.name} Attack (${atk.mode}): ${atk.total}${tag} [${atk.terms.map((t) => t.kept.join(',')).join('+')}]`,
          atk.isCrit ? 'crit' : 'roll'
        );
      }

      if (activity.computedDamage) {
        const dmg = evaluateDiceExpression(activity.computedDamage, 'normal');
        appendLog(
          `${activity.name} Damage: ${dmg.total} ${activity.damageType ?? ''} (${activity.computedDamage})`,
          'roll'
        );
      }

      if (activity.computedSaveDc !== null && activity.saveAbility) {
        appendLog(
          `${activity.name}: Target makes DC ${activity.computedSaveDc} ${activity.saveAbility.toUpperCase()} saving throw.`,
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
                ac: 13 + (activity.resourceCost?.amount ?? 4),
                hp: { current: 40, max: 40, temp: 0 },
                conditions: [],
                actions: [
                  {
                    id: `sum-slam-${Date.now()}`,
                    name: 'Slam',
                    type: 'attack',
                    actionEconomy: 'action',
                    attackBonusFormula: `+${resolvedSheet.spellcasting.attackBonus.final}`,
                    damageFormula: `1d8+4+${activity.resourceCost?.amount ?? 4}`,
                    damageType: 'bludgeoning',
                  },
                ],
              },
              activity.concentration ? concId : undefined
            );
          }
          return updated;
        });
        appendLog(`Active effect started: ${activity.parentItemName}`, 'info');
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
    [persistEncounter]
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
      appendLog('Concentration dropped and linked summons dismissed.', 'warn');
    },
    [persistEncounter, appendLog]
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
          result.data.activities
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
          const [refreshedChars, refreshedCompendium] = await Promise.all([
            db.characters.toArray(),
            db.compendium.toArray(),
          ]);
          if (refreshedChars.length > 0) {
            setCharacterList(refreshedChars);
            setRawChar(refreshedChars[0]!);
          }
          setCompendium(refreshedCompendium);
          appendLog(
            `Merged backup bundle: ${summary.importedCharacters} character(s), ${summary.importedEntities} compendium item(s).`,
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

  const searchCompendium = useCallback(
    (query: string): CompendiumEntity[] => {
      const q = query.trim().toLowerCase();
      if (!q) return compendium.slice(0, 30);
      return compendium
        .filter((item) => buildSearchTokens(item).includes(q))
        .slice(0, 30);
    },
    [compendium]
  );

  return {
    rawChar,
    characterList,
    switchCharacter,
    createNewCharacter,
    persistCharacter,
    resolvedSheet,
    encounter,
    compendium,
    rollMode,
    setRollMode,
    consoleLines,
    appendLog,
    setStatOverride,
    adjustHp,
    setTempHp,
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
    resetEncounter,
    addMonsterToEncounter,
    importMarkdownHomebrew,
    importJsonFilePayload,
    searchCompendium,
  };
}
