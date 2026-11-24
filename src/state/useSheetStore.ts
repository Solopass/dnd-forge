import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CampaignEntry, CampaignRecord, DowntimeProject, SharedHandoutPayload, WorldMapPin } from '../types/campaign';
import { ClassLevel, RawCharacterState, ResolvedActivity, ResolvedCharacterSheet, WildShapeForm } from '../types/character';
import { BattlemapScene, CombatEncounterState, MapPingEvent, MapSketchStroke } from '../types/combat';
import { computeVisibleCells } from '../engine/vtt-vision';
import { resolveConditionRollMode } from '../engine/conditions';
import { resolveTargetAttack, resolveTargetSaves } from '../engine/target-combat';
import { Activity, CompendiumEntity, CreatureSize, MonsterStatMeta } from '../types/compendium';
import { AbilityKey, ActionEconomy, ActiveBuffState, RecoveryTrigger, RollMode, WeaponMastery } from '../types/core';
import {
  applyRestRecovery,
  computeCharacterSheet,
  createBlankCharacter,
  resolveResourcePoolForCost,
  syncSpellSlotPools,
} from '../engine/rules-math';
import { doubleDiceForCrit, evaluateDiceExpression, scaleDiceForUpcast } from '../engine/dice';
import {
  advanceTurn,
  applyEffectWithConcentrationCheck,
  dropConcentrationForCombatant,
  rollAllInitiativeOrder,
  sortInitiativeOrder,
  spawnLinkedSummon,
} from '../engine/combat-machine';
import { parseHomebrewMarkdownBlock } from '../engine/statblock-parser';
import { adapt5eToolsPayload } from '../engine/five-tools-adapter';
import { parseDndBeyondPdfBuffer } from '../engine/ddb-pdf-importer';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import {
  buildCharacterFromPreset,
  buildSubclassGrantEntities,
  computeFixedMaxHp,
  NewCharacterPresetInput,
  syncClassResourcePools,
} from '../engine/classes';
import {
  advanceWorldClock,
  createDefaultCampaign,
  getXpForNextLevel,
  ShopItem,
} from '../engine/dm-tools';
import {
  decodeCharacterShareCode,
  LivePeerInfo,
  LiveTableMessage,
  LiveTableRole,
  LiveTableSession,
} from '../engine/live-sync';
import { playTableSound } from '../engine/sound';
import {
  buildSearchTokens,
  db,
  deleteSceneRecord,
  importBackupBundle,
  normalizeSearchQuery,
  saveCampaign,
  saveCharacter,
  saveEncounter,
  saveScene,
  upsertCompendiumEntities,
} from '../storage/db';

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

export function useSheetStore(initialCharacter: RawCharacterState, initialEncounter: CombatEncounterState) {
  const defaultCampaign = useMemo(() => createDefaultCampaign(), []);
  const [rawChar, setRawChar] = useState<RawCharacterState>(initialCharacter);
  const [characterList, setCharacterList] = useState<RawCharacterState[]>([initialCharacter]);
  const [encounter, setEncounter] = useState<CombatEncounterState>(initialEncounter);
  const [encounterList, setEncounterList] = useState<CombatEncounterState[]>([initialEncounter]);
  const [campaign, setCampaign] = useState<CampaignRecord>(defaultCampaign);
  const [campaignList, setCampaignList] = useState<CampaignRecord[]>([defaultCampaign]);
  const [scenes, setScenes] = useState<BattlemapScene[]>([]);
  const [activePings, setActivePings] = useState<MapPingEvent[]>([]);
  const [activeSharedHandout, setActiveSharedHandout] = useState<SharedHandoutPayload | null>(null);
  const [activeBuffs, setActiveBuffs] = useState<ActiveBuffState>({
    bless: false,
    rage: false,
    sneakAttack: false,
  });
  const [pendingRollRequest, setPendingRollRequest] = useState<{
    id: string;
    senderName: string;
    label: string;
    kind: 'check' | 'save';
    abilityOrSkill: string;
    dc?: number;
  } | null>(null);
  const [compendium, setCompendium] = useState<CompendiumEntity[]>(initialCharacter.items);
  const [rollMode, setRollMode] = useState<RollMode>('normal');
  const [pendingConcDc, setPendingConcDc] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [liveStatus, setLiveStatus] = useState<{
    role: LiveTableRole;
    roomCode: string;
    peers: LivePeerInfo[];
  }>({ role: 'idle', roomCode: '', peers: [] });
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      text: 'D&D Forge v0.6 ready. Press Ctrl+K for Compendium Packs, D&D Beyond PDF Import, or JSON/Markdown ingestion.',
      tone: 'info',
    },
  ]);

  const rawCharRef = useRef(rawChar);
  rawCharRef.current = rawChar;
  const encounterRef = useRef(encounter);
  encounterRef.current = encounter;
  const pastRef = useRef<Array<{ rawChar: RawCharacterState; encounter: CombatEncounterState }>>([]);
  const futureRef = useRef<Array<{ rawChar: RawCharacterState; encounter: CombatEncounterState }>>([]);
  const lastSnapshotTsRef = useRef(0);
  const isApplyingHistoryRef = useRef(false);
  const isApplyingRemoteRef = useRef(false);
  const lastBroadcastDigestRef = useRef('');
  const liveSessionRef = useRef<LiveTableSession | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [{ id, text, tone }, ...prev.slice(0, 2)]);
  }, []);

  const appendLog = useCallback(
    (text: string, tone: ConsoleLine['tone'] = 'info') => {
      setConsoleLines((prev) => [
        {
          id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString(),
          text,
          tone,
        },
        ...prev.slice(0, 89),
      ]);

      if (!text.startsWith('[LIVE')) {
        if (tone === 'roll' || tone === 'crit') {
          const snd = text.includes('[FUMBLE]') ? 'fumble' : tone === 'crit' ? 'crit' : 'roll';
          playTableSound(snd);
          pushToast(text, tone);
        }
        const session = liveSessionRef.current;
        if (session && session.getState().role !== 'idle' && (tone === 'roll' || tone === 'crit')) {
          session.broadcast({
            type: 'roll',
            senderId: session.senderId,
            senderName: rawCharRef.current.name,
            text,
            tone,
            timestamp: Date.now(),
          });
        }
      }
    },
    [pushToast]
  );

  const recordUndoSnapshot = useCallback(() => {
    if (isApplyingHistoryRef.current || isApplyingRemoteRef.current) return;
    const now = Date.now();
    if (now - lastSnapshotTsRef.current < 180 && pastRef.current.length > 0) {
      return;
    }
    lastSnapshotTsRef.current = now;
    pastRef.current = [
      ...pastRef.current.slice(-24),
      {
        rawChar: structuredClone(rawCharRef.current),
        encounter: structuredClone(encounterRef.current),
      },
    ];
    futureRef.current = [];
    setHistoryCounts({ past: pastRef.current.length, future: 0 });
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [allSaved, savedEncounters, savedCampaigns, savedScenes] = await Promise.all([
          db.characters.toArray(),
          db.encounters.toArray(),
          db.campaigns.toArray(),
          db.scenes.toArray(),
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
        if (active && savedCampaigns.length > 0) {
          setCampaignList(savedCampaigns);
          setCampaign(savedCampaigns[0]!);
        } else {
          await saveCampaign(defaultCampaign);
          if (active) setCampaignList([defaultCampaign]);
        }
        if (active && savedScenes.length > 0) {
          setScenes(savedScenes);
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
  }, [initialCharacter, initialEncounter, defaultCampaign, appendLog]);

  const resolvedSheet: ResolvedCharacterSheet = useMemo(
    () => computeCharacterSheet(rawChar),
    [rawChar]
  );

  const persistCharacter = useCallback(
    (updater: (prev: RawCharacterState) => RawCharacterState) => {
      recordUndoSnapshot();
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
    },
    [recordUndoSnapshot]
  );

  const persistEncounter = useCallback(
    (updater: (prev: CombatEncounterState) => CombatEncounterState) => {
      recordUndoSnapshot();
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
    },
    [recordUndoSnapshot]
  );

  const undo = useCallback(() => {
    const prevSnapshot = pastRef.current[pastRef.current.length - 1];
    if (!prevSnapshot) return;
    isApplyingHistoryRef.current = true;
    try {
      pastRef.current = pastRef.current.slice(0, -1);
      futureRef.current = [
        ...futureRef.current.slice(-24),
        {
          rawChar: structuredClone(rawCharRef.current),
          encounter: structuredClone(encounterRef.current),
        },
      ];
      setRawChar(prevSnapshot.rawChar);
      setEncounter(prevSnapshot.encounter);
      void saveCharacter(prevSnapshot.rawChar);
      void saveEncounter(prevSnapshot.encounter);
      setCharacterList((list) =>
        list.map((c) => (c.id === prevSnapshot.rawChar.id ? prevSnapshot.rawChar : c))
      );
      setEncounterList((list) =>
        list.map((e) => (e.id === prevSnapshot.encounter.id ? prevSnapshot.encounter : e))
      );
      setHistoryCounts({ past: pastRef.current.length, future: futureRef.current.length });
      appendLog('Undid last change.', 'info');
      pushToast('Undid last change.', 'info');
    } finally {
      isApplyingHistoryRef.current = false;
    }
  }, [appendLog, pushToast]);

  const redo = useCallback(() => {
    const nextSnapshot = futureRef.current[futureRef.current.length - 1];
    if (!nextSnapshot) return;
    isApplyingHistoryRef.current = true;
    try {
      futureRef.current = futureRef.current.slice(0, -1);
      pastRef.current = [
        ...pastRef.current.slice(-24),
        {
          rawChar: structuredClone(rawCharRef.current),
          encounter: structuredClone(encounterRef.current),
        },
      ];
      setRawChar(nextSnapshot.rawChar);
      setEncounter(nextSnapshot.encounter);
      void saveCharacter(nextSnapshot.rawChar);
      void saveEncounter(nextSnapshot.encounter);
      setCharacterList((list) =>
        list.map((c) => (c.id === nextSnapshot.rawChar.id ? nextSnapshot.rawChar : c))
      );
      setEncounterList((list) =>
        list.map((e) => (e.id === nextSnapshot.encounter.id ? nextSnapshot.encounter : e))
      );
      setHistoryCounts({ past: pastRef.current.length, future: futureRef.current.length });
      appendLog('Redid change.', 'info');
      pushToast('Redid change.', 'info');
    } finally {
      isApplyingHistoryRef.current = false;
    }
  }, [appendLog, pushToast]);

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
          const hasActiveConc = encounter.activeEffects.some(
            (e) => e.sourceCombatantId === rawChar.id && e.isConcentration
          );
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
      } else if (delta > 0) {
        playTableSound('heal');
      }
      appendLog(`HP adjusted by ${delta >= 0 ? `+${delta}` : delta}.`, 'info');
    },
    [rawChar.hp, rawChar.wildShapeForm, rawChar.id, encounter.activeEffects, persistCharacter, persistEncounter, appendLog, pushToast]
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
    (
      name: string,
      ac: number,
      maxHp: number,
      dexMod = 0,
      actions?: Activity[],
      cr?: string,
      extraMeta?: MonsterStatMeta,
      notes?: string
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
              cr,
              size: extraMeta?.size ?? 'medium',
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

  const addCompendiumItemToSheet = useCallback(
    (entity: CompendiumEntity) => {
      if (entity.category === 'monster' && entity.monsterMeta) {
        addMonsterToEncounter(
          entity.name,
          entity.monsterMeta.ac,
          entity.monsterMeta.hp,
          entity.monsterMeta.dexModifier,
          entity.activities,
          entity.monsterMeta.cr,
          entity.monsterMeta,
          entity.entries.join(' ')
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
    (activity: ResolvedActivity, slotLevelOverride?: number, asRitual = false) => {
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
        const sign = activity.computedAttackBonus >= 0 ? '+' : '';
        const blessTerm = activeBuffs.bless ? '+1d4' : '';
        const atk = evaluateDiceExpression(
          `1d20${sign}${activity.computedAttackBonus}${blessTerm}`,
          condRoll.mode,
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
        const masteryTag = activity.weaponMastery ? ` [Mastery: ${activity.weaponMastery}]` : '';
        const blessTag = activeBuffs.bless ? ' [+Bless 1d4]' : '';
        appendLog(
          `${activity.name}${spentNote} Attack (${atk.mode}): ${atk.total}${tag}${condTag}${blessTag}${masteryTag} [${atk.terms.map((t) => t.kept.join(',')).join('+')}]`,
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
        const dmgExpr = attackIsCrit ? doubleDiceForCrit(upcastFormula) : upcastFormula;
        const dmg = evaluateDiceExpression(dmgExpr, 'normal');
        const critTag = attackIsCrit ? ' [CRIT DICE DOUBLED]' : '';
        const upcastTag = extraLevels > 0 && activity.upcastDicePerLevel ? ` [UPCAST +${extraLevels}]` : '';
        const buffTag = buffNotes.length > 0 ? ` [${buffNotes.join(', ')}]` : '';
        const kindLabel = activity.type === 'heal' ? 'Healing' : 'Damage';
        appendLog(
          `${activity.name}${activity.computedAttackBonus === null ? spentNote : ''} ${kindLabel}: ${dmg.total} ${activity.damageType ?? ''} (${dmgExpr})${upcastTag}${buffTag}${critTag}`,
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
        const durLow = activity.spellMeta?.duration?.toLowerCase() ?? '';
        let durationRounds: number | undefined;
        if (durLow.includes('1 min')) durationRounds = 10;
        else if (durLow.includes('10 min')) durationRounds = 100;
        else if (durLow.includes('1 hr') || durLow.includes('1 hour')) durationRounds = 600;
        else if (durLow.includes('1 round')) durationRounds = 1;

        persistEncounter((prev) => {
          let updated = applyEffectWithConcentrationCheck(prev, {
            id: concId,
            name: activity.parentItemName,
            sourceCombatantId: rawChar.id,
            targetCombatantId: rawChar.id,
            isConcentration: activity.concentration,
            expiration: activity.concentration ? 'concentration' : durationRounds ? 'rounds_remaining' : 'indefinite',
            roundsRemaining: durationRounds,
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
    [rawChar, resolvedSheet.spellcasting.attackBonus.final, resolvedSheet.critThreshold, rollMode, persistCharacter, persistEncounter, appendLog]
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
          result.data.monsterMeta.cr,
          result.data.monsterMeta,
          result.data.entries.join(' ')
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
          const [refreshedChars, refreshedCompendium, refreshedEncounters, refreshedCampaigns, refreshedScenes] = await Promise.all([
            db.characters.toArray(),
            db.compendium.toArray(),
            db.encounters.toArray(),
            db.campaigns.toArray(),
            db.scenes.toArray(),
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
          if (refreshedCampaigns.length > 0) {
            setCampaignList(refreshedCampaigns);
            setCampaign(refreshedCampaigns[0]!);
          }
          setScenes(refreshedScenes);
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

  const moveCombatantToken = useCallback(
    (combatantId: string, x: number, y: number) => {
      if (liveStatus.role === 'player') {
        const session = liveSessionRef.current;
        if (session && combatantId === rawChar.id) {
          session.broadcast({
            type: 'token_move',
            senderId: session.senderId,
            senderName: rawChar.name,
            combatantId,
            x,
            y,
          });
        }
      }
      persistEncounter((prev) => {
        const nextCombatants = prev.combatants.map((c) =>
          c.id === combatantId ? { ...c, x, y } : c
        );
        if (prev.map?.dynamicVision && prev.map?.autoRevealFog && prev.map.fogCells?.length) {
          const visible = computeVisibleCells(
            nextCombatants,
            prev.map.cols,
            prev.map.rows,
            prev.map.gridFeet,
            prev.map.terrainCells ?? []
          );
          const nextFog = prev.map.fogCells.filter((cell) => !visible.has(cell));
          return {
            ...prev,
            combatants: nextCombatants,
            map: { ...prev.map, fogCells: nextFog },
          };
        }
        return {
          ...prev,
          combatants: nextCombatants,
        };
      });
    },
    [persistEncounter]
  );

  const setEncounterMapImage = useCallback(
    (imageDataUrl: string | undefined) => {
      persistEncounter((prev) => ({
        ...prev,
        map: {
          cols: 20,
          rows: 12,
          gridFeet: 5,
          templates: [],
          ...(prev.map ?? {}),
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
          cols: 20,
          rows: 12,
          gridFeet: 5,
          ...(prev.map ?? {}),
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
        cols: 20,
        rows: 12,
        gridFeet: 5,
        ...(prev.map ?? {}),
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
      const rawQ = query.trim().toLowerCase();
      if (!rawQ) return compendium.slice(0, 120);
      const normQ = normalizeSearchQuery(query);
      return compendium
        .filter((item) => {
          if (item.name.toLowerCase().includes(rawQ)) return true;
          return normQ ? buildSearchTokens(item).includes(normQ) : false;
        })
        .slice(0, 120);
    },
    [compendium]
  );

  const importSingleCharacter = useCallback(
    async (incoming: RawCharacterState) => {
      const idCollision = characterList.some((c) => c.id === incoming.id);
      const targetChar: RawCharacterState = idCollision
        ? {
            ...structuredClone(incoming),
            id: `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            name: `${incoming.name} (Imported)`,
          }
        : structuredClone(incoming);
      await saveCharacter(targetChar);
      setCharacterList((prev) => [...prev, targetChar]);
      setRawChar(targetChar);
      setPendingConcDc(null);
      appendLog(`Imported character "${targetChar.name}".`, 'info');
      pushToast(`Imported character: ${targetChar.name}`, 'info');
    },
    [characterList, appendLog, pushToast]
  );

  const applyLevelUpPlan = useCallback(
    (input: LevelUpPlanInput) => {
      const allPackEntities = new Map<string, CompendiumEntity>(
        BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).map((e) => [e.id, e])
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

  const onRemoteMessageRef = useRef<(msg: LiveTableMessage) => void>(() => {});
  onRemoteMessageRef.current = (msg: LiveTableMessage) => {
    if (msg.type === 'roll') {
      appendLog(`[LIVE • ${msg.senderName}] ${msg.text}`, msg.tone);
      if (msg.tone === 'roll' || msg.tone === 'crit') {
        playTableSound(msg.text.includes('[FUMBLE]') ? 'fumble' : msg.tone === 'crit' ? 'crit' : 'roll');
        pushToast(`[${msg.senderName}] ${msg.text}`, msg.tone);
      }
      return;
    }

    if (msg.type === 'encounter_state' && liveStatus.role === 'player') {
      isApplyingRemoteRef.current = true;
      try {
        setEncounter(msg.encounter);
        void saveEncounter(msg.encounter);
        setEncounterList((list) =>
          list.some((e) => e.id === msg.encounter.id)
            ? list.map((e) => (e.id === msg.encounter.id ? msg.encounter : e))
            : [...list, msg.encounter]
        );
        appendLog(`[LIVE] Encounter synced from DM (${msg.senderName}).`, 'info');
      } finally {
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
        }, 40);
      }
      return;
    }

    if (msg.type === 'player_sync' && liveStatus.role === 'host') {
      persistEncounter((prev) => {
        const exists = prev.combatants.some((c) => c.id === msg.characterId);
        if (!exists) return prev;
        return {
          ...prev,
          combatants: prev.combatants.map((c) =>
            c.id === msg.characterId
              ? { ...c, hp: msg.hp, ac: msg.ac, conditions: msg.conditions }
              : c
          ),
        };
      });
      return;
    }

    if (msg.type === 'character_share') {
      void importSingleCharacter(msg.character);
      return;
    }

    if (msg.type === 'ping') {
      const ping: MapPingEvent = {
        id: `ping-${msg.timestamp}`,
        x: msg.x,
        y: msg.y,
        color: msg.color,
        senderName: msg.senderName,
        timestamp: msg.timestamp,
      };
      setActivePings((prev) => [...prev.filter((p) => Date.now() - p.timestamp < 3200), ping]);
      setTimeout(() => {
        setActivePings((prev) => prev.filter((p) => p.id !== ping.id));
      }, 3300);
      return;
    }

    if (msg.type === 'handout_show' && liveStatus.role === 'player') {
      setActiveSharedHandout({
        id: msg.id,
        title: msg.title,
        summary: msg.summary,
        body: msg.body,
        imageDataUrl: msg.imageDataUrl,
        senderName: msg.senderName,
      });
      return;
    }

    if (msg.type === 'handout_hide' && liveStatus.role === 'player') {
      setActiveSharedHandout(null);
      return;
    }

    if (msg.type === 'roll_request' && liveStatus.role === 'player') {
      setPendingRollRequest({
        id: msg.id,
        senderName: msg.senderName,
        label: msg.label,
        kind: msg.kind,
        abilityOrSkill: msg.abilityOrSkill,
        dc: msg.dc,
      });
      pushToast(`DM Roll Request: ${msg.label}${msg.dc ? ` (DC ${msg.dc})` : ''}`, 'info');
      return;
    }

    if (msg.type === 'token_move' && liveStatus.role === 'host') {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === msg.combatantId && c.kind === 'pc' ? { ...c, x: msg.x, y: msg.y } : c
        ),
      }));
    }
  };

  const ensureLiveSession = useCallback((): LiveTableSession => {
    if (!liveSessionRef.current) {
      liveSessionRef.current = new LiveTableSession(
        (msg) => onRemoteMessageRef.current(msg),
        (peers) => {
          const st = liveSessionRef.current?.getState();
          setLiveStatus({
            role: st?.role ?? 'idle',
            roomCode: st?.roomCode ?? '',
            peers,
          });
        }
      );
    }
    return liveSessionRef.current;
  }, []);

  const refreshLiveStatus = useCallback(() => {
    const st = liveSessionRef.current?.getState();
    setLiveStatus({
      role: st?.role ?? 'idle',
      roomCode: st?.roomCode ?? '',
      peers: st?.peers ?? [],
    });
  }, []);

  const hostLocalTable = useCallback(
    (roomCode?: string) => {
      const session = ensureLiveSession();
      const code = session.startLocalRoom('host', roomCode ?? '', rawCharRef.current.name);
      refreshLiveStatus();
      appendLog(`Hosting Live Table room "${code}" (BroadcastChannel).`, 'info');
      pushToast(`Hosting room ${code}`, 'info');
      return code;
    },
    [ensureLiveSession, refreshLiveStatus, appendLog, pushToast]
  );

  const joinLocalTable = useCallback(
    (roomCode: string) => {
      const session = ensureLiveSession();
      const code = session.startLocalRoom('player', roomCode, rawCharRef.current.name);
      refreshLiveStatus();
      appendLog(`Joined Live Table room "${code}".`, 'info');
      pushToast(`Joined room ${code}`, 'info');
      return code;
    },
    [ensureLiveSession, refreshLiveStatus, appendLog, pushToast]
  );

  const createWebRtcInvite = useCallback(async () => {
    const session = ensureLiveSession();
    const res = await session.createWebRtcInvite(rawCharRef.current.name);
    refreshLiveStatus();
    appendLog('Generated WebRTC Invite Code for remote player.', 'info');
    return res;
  }, [ensureLiveSession, refreshLiveStatus, appendLog]);

  const acceptWebRtcInvite = useCallback(
    async (inviteCode: string) => {
      const session = ensureLiveSession();
      const res = await session.acceptWebRtcInvite(inviteCode, rawCharRef.current.name);
      refreshLiveStatus();
      appendLog('Accepted WebRTC Invite; share Reply Code with DM Host.', 'info');
      return res;
    },
    [ensureLiveSession, refreshLiveStatus, appendLog]
  );

  const completeWebRtcLink = useCallback(
    async (peerId: string, replyCode: string) => {
      const session = ensureLiveSession();
      await session.completeWebRtcLink(peerId, replyCode);
      refreshLiveStatus();
      appendLog('Completed WebRTC peer link!', 'info');
      pushToast('WebRTC peer connected!', 'info');
    },
    [ensureLiveSession, refreshLiveStatus, appendLog, pushToast]
  );

  const disconnectLiveTable = useCallback(() => {
    liveSessionRef.current?.disconnect();
    refreshLiveStatus();
    appendLog('Disconnected from Live Table session.', 'info');
  }, [refreshLiveStatus, appendLog]);

  const pushEncounterToPeers = useCallback(() => {
    const session = liveSessionRef.current;
    if (!session || liveStatus.role === 'idle') return;
    session.broadcast({
      type: 'encounter_state',
      senderId: session.senderId,
      senderName: rawCharRef.current.name,
      encounter: encounterRef.current,
    });
    appendLog('Broadcasted current encounter to connected players.', 'info');
  }, [liveStatus.role, appendLog]);

  const shareActiveCharacterToPeers = useCallback(() => {
    const session = liveSessionRef.current;
    if (!session || liveStatus.role === 'idle') return;
    session.broadcast({
      type: 'character_share',
      senderId: session.senderId,
      senderName: rawCharRef.current.name,
      character: rawCharRef.current,
    });
    appendLog(`Shared character "${rawCharRef.current.name}" with connected peers.`, 'info');
  }, [liveStatus.role, appendLog]);

  useEffect(() => {
    return () => {
      liveSessionRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#char=DFC1:')) return;
    try {
      const decoded = decodeCharacterShareCode(hash);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      void importSingleCharacter(decoded);
    } catch {
      appendLog('Could not decode shared character URL hash.', 'warn');
    }
    // run once after mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const session = liveSessionRef.current;
    if (!session || liveStatus.role === 'idle' || isApplyingRemoteRef.current) return;
    if (liveStatus.role === 'host') {
      const digest = JSON.stringify({ id: encounter.id, round: encounter.round, turn: encounter.activeTurnIndex, combatants: encounter.combatants, effects: encounter.activeEffects });
      if (digest !== lastBroadcastDigestRef.current) {
        lastBroadcastDigestRef.current = digest;
        session.broadcast({
          type: 'encounter_state',
          senderId: session.senderId,
          senderName: rawChar.name,
          encounter,
        });
      }
    } else if (liveStatus.role === 'player') {
      const digest = JSON.stringify({ id: rawChar.id, hp: rawChar.hp, ac: resolvedSheet.ac.final, cond: rawChar.conditions });
      if (digest !== lastBroadcastDigestRef.current) {
        lastBroadcastDigestRef.current = digest;
        session.broadcast({
          type: 'player_sync',
          senderId: session.senderId,
          senderName: rawChar.name,
          characterId: rawChar.id,
          hp: rawChar.hp,
          ac: resolvedSheet.ac.final,
          conditions: rawChar.conditions,
        });
      }
    }
  }, [liveStatus.role, encounter, rawChar, resolvedSheet.ac.final]);

  const persistCampaign = useCallback((updater: (prev: CampaignRecord) => CampaignRecord) => {
    setCampaign((prev) => {
      const next = updater(prev);
      void saveCampaign(next);
      setCampaignList((list) =>
        list.some((c) => c.id === next.id)
          ? list.map((c) => (c.id === next.id ? next : c))
          : [...list, next]
      );
      return next;
    });
  }, []);

  const switchCampaign = useCallback(
    async (campaignId: string) => {
      const found = campaignList.find((c) => c.id === campaignId) ?? (await db.campaigns.get(campaignId));
      if (found) {
        setCampaign(found);
        appendLog(`Switched campaign binder to "${found.name}".`, 'info');
      }
    },
    [campaignList, appendLog]
  );

  const createCampaign = useCallback(
    async (name: string, setting: string) => {
      const id = `camp-${Date.now().toString(36)}`;
      const fresh = createDefaultCampaign(id, name.trim() || 'New Campaign');
      fresh.setting = setting.trim() || 'Forgotten Realms';
      fresh.entries = [];
      await saveCampaign(fresh);
      setCampaignList((prev) => [...prev, fresh]);
      setCampaign(fresh);
      appendLog(`Created campaign "${fresh.name}".`, 'info');
    },
    [appendLog]
  );

  const deleteCampaign = useCallback(
    async (campaignId: string) => {
      if (campaignList.length <= 1) {
        appendLog('Cannot delete the only remaining campaign.', 'warn');
        return;
      }
      await db.campaigns.delete(campaignId);
      const remaining = campaignList.filter((c) => c.id !== campaignId);
      setCampaignList(remaining);
      if (campaign.id === campaignId && remaining[0]) {
        setCampaign(remaining[0]);
      }
      appendLog('Deleted campaign from local storage.', 'warn');
    },
    [campaignList, campaign.id, appendLog]
  );

  const upsertCampaignEntry = useCallback(
    (entry: Omit<CampaignEntry, 'updatedAt'>) => {
      const stamped: CampaignEntry = { ...entry, updatedAt: new Date().toISOString() };
      persistCampaign((prev) => {
        const exists = prev.entries.some((e) => e.id === stamped.id);
        return {
          ...prev,
          entries: exists
            ? prev.entries.map((e) => (e.id === stamped.id ? stamped : e))
            : [stamped, ...prev.entries],
        };
      });
      appendLog(`Saved campaign ${entry.category}: "${entry.title}".`, 'info');
    },
    [persistCampaign, appendLog]
  );

  const deleteCampaignEntry = useCallback(
    (entryId: string) => {
      persistCampaign((prev) => ({
        ...prev,
        entries: prev.entries.filter((e) => e.id !== entryId),
      }));
      appendLog('Removed campaign entry.', 'info');
    },
    [persistCampaign, appendLog]
  );

  const advanceCampaignClock = useCallback(
    (deltaMinutes: number) => {
      const { clock: nextClock, expiredTimers } = advanceWorldClock(campaign.clock, deltaMinutes);
      const daysElapsed = Math.max(0, nextClock.day - campaign.clock.day);
      persistCampaign((prev) => ({
        ...prev,
        clock: nextClock,
        downtimeProjects:
          daysElapsed > 0
            ? (prev.downtimeProjects ?? []).map((p) => ({
                ...p,
                daysDone: Math.min(p.daysTotal, p.daysDone + daysElapsed),
              }))
            : prev.downtimeProjects,
      }));
      appendLog(
        `World Clock: Day ${nextClock.day} • ${String(nextClock.hour).padStart(2, '0')}:${String(nextClock.minute).padStart(2, '0')}.`,
        'info'
      );
      if (expiredTimers.length > 0) {
        const msg = `Timer expired: ${expiredTimers.join(', ')}`;
        appendLog(msg, 'warn');
        pushToast(msg, 'warn');
      }
    },
    [campaign.clock, persistCampaign, appendLog, pushToast]
  );

  const addClockTimer = useCallback(
    (label: string, minutes: number) => {
      const clean = label.trim();
      if (!clean || minutes <= 0) return;
      persistCampaign((prev) => ({
        ...prev,
        clock: {
          ...prev.clock,
          activeTimers: [
            ...prev.clock.activeTimers,
            { id: `clk-${Date.now().toString(36)}`, label: clean, remainingMinutes: Math.round(minutes) },
          ],
        },
      }));
      appendLog(`Started clock timer "${clean}" (${minutes} min).`, 'info');
    },
    [persistCampaign, appendLog]
  );

  const setCampaignWeather = useCallback(
    (weather: string) => {
      persistCampaign((prev) => ({
        ...prev,
        clock: { ...prev.clock, weather },
      }));
    },
    [persistCampaign]
  );

  const addPartyLoot = useCallback(
    (gp: number, items: string[]) => {
      persistCampaign((prev) => ({
        ...prev,
        partyLootGp: Number((prev.partyLootGp + gp).toFixed(2)),
        partyLootItems: [...prev.partyLootItems, ...items],
      }));
      appendLog(`Added ${gp} GP and ${items.length} item(s) to Party Stash.`, 'info');
    },
    [persistCampaign, appendLog]
  );

  const distributeGoldToParty = useCallback(
    async (totalGp: number) => {
      const safeTotal = Math.max(0, Math.floor(totalGp));
      const share = Math.floor(safeTotal / Math.max(1, characterList.length));
      if (share <= 0) {
        appendLog('Not enough GP to split evenly across the party.', 'warn');
        return;
      }
      const nextList = characterList.map((c) => {
        const cur = c.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
        return { ...c, currency: { ...cur, gp: cur.gp + share } };
      });
      for (const ch of nextList) {
        await saveCharacter(ch);
      }
      setCharacterList(nextList);
      const activeUpdated = nextList.find((c) => c.id === rawChar.id);
      if (activeUpdated) setRawChar(activeUpdated);
      appendLog(`Distributed +${share} GP each across ${nextList.length} party member(s).`, 'info');
      pushToast(`Party split: +${share} GP each!`, 'info');
    },
    [characterList, rawChar.id, appendLog, pushToast]
  );

  const buyShopItemForActiveCharacter = useCallback(
    (item: ShopItem, chargeGold: boolean): boolean => {
      const currentGp = rawChar.currency?.gp ?? 0;
      if (chargeGold && currentGp < item.priceGp) {
        appendLog(
          `Insufficient GP for ${item.name} (costs ${item.priceGp} GP, have ${currentGp} GP).`,
          'warn'
        );
        return false;
      }

      const packEntity = item.entityId
        ? BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).find((e) => e.id === item.entityId)
        : undefined;

      const addedEntity: CompendiumEntity = packEntity
        ? {
            ...structuredClone(packEntity),
            id: `${packEntity.id}-${Date.now().toString(36)}`,
            equipped: false,
            prepared: true,
          }
        : {
            id: `shop-item-${Date.now().toString(36)}`,
            name: item.name,
            source: 'Campaign Shop',
            ruleset: rawChar.ruleset,
            category: 'gear',
            equipped: false,
            activities: [],
            entries: [item.notes],
          };

      persistCharacter((prev) => {
        const cur = prev.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
        return {
          ...prev,
          currency: chargeGold ? { ...cur, gp: Math.max(0, cur.gp - item.priceGp) } : cur,
          items: [addedEntity, ...prev.items],
        };
      });
      appendLog(
        chargeGold
          ? `${rawChar.name} purchased ${item.name} for ${item.priceGp} GP.`
          : `Granted ${item.name} to ${rawChar.name}.`,
        'info'
      );
      return true;
    },
    [rawChar.currency, rawChar.name, rawChar.ruleset, persistCharacter, appendLog]
  );

  const awardPartyXp = useCallback(
    async (totalXp: number) => {
      const safeTotal = Math.max(0, Math.round(totalXp));
      if (safeTotal <= 0) return;
      const perPc = Math.floor(safeTotal / Math.max(1, characterList.length));
      const readyNames: string[] = [];

      const nextList = characterList.map((c) => {
        const nextXp = (c.xp ?? 0) + perPc;
        const lvl = c.classes.reduce((s, cl) => s + cl.level, 0);
        const nextThreshold = getXpForNextLevel(lvl);
        if (nextThreshold !== null && nextXp >= nextThreshold) {
          readyNames.push(c.name);
        }
        return { ...c, xp: nextXp };
      });
      for (const ch of nextList) {
        await saveCharacter(ch);
      }
      setCharacterList(nextList);
      const activeUpdated = nextList.find((c) => c.id === rawChar.id);
      if (activeUpdated) setRawChar(activeUpdated);
      persistCampaign((prev) => ({ ...prev, partyXpTotal: prev.partyXpTotal + safeTotal }));
      appendLog(
        `Awarded ${safeTotal} XP total (+${perPc} XP each).${
          readyNames.length > 0 ? ` Ready to level up: ${readyNames.join(', ')}!` : ''
        }`,
        readyNames.length > 0 ? 'crit' : 'info'
      );
    },
    [characterList, rawChar.id, persistCampaign, appendLog]
  );

  const triggerPartyMilestoneLevelUp = useCallback(async () => {
    const nextList = characterList.map((c) => {
      if (c.classes.length === 0) return c;
      const updatedClasses = c.classes.map((cl, idx) =>
        idx === 0 ? { ...cl, level: Math.min(20, cl.level + 1) } : cl
      );
      const conScore = c.baseAbilities.con + c.bonusAbilities.con;
      const newMaxHp = computeFixedMaxHp(updatedClasses, conScore, c.items);
      const hpDiff = Math.max(1, newMaxHp - c.hp.max);
      const totalAbilities = {
        str: c.baseAbilities.str + c.bonusAbilities.str,
        dex: c.baseAbilities.dex + c.bonusAbilities.dex,
        con: c.baseAbilities.con + c.bonusAbilities.con,
        int: c.baseAbilities.int + c.bonusAbilities.int,
        wis: c.baseAbilities.wis + c.bonusAbilities.wis,
        cha: c.baseAbilities.cha + c.bonusAbilities.cha,
      };
      const withClassPools = syncClassResourcePools(updatedClasses, c.resources, totalAbilities);
      const syncedResources = syncSpellSlotPools(updatedClasses, withClassPools);
      return {
        ...c,
        classes: updatedClasses,
        hp: {
          ...c.hp,
          max: newMaxHp,
          current: Math.min(newMaxHp, c.hp.current + hpDiff),
        },
        resources: syncedResources,
      };
    });

    for (const ch of nextList) {
      await saveCharacter(ch);
    }
    setCharacterList(nextList);
    const activeUpdated = nextList.find((c) => c.id === rawChar.id);
    if (activeUpdated) setRawChar(activeUpdated);
    appendLog(`Milestone Level-Up granted across ${nextList.length} party character(s)!`, 'crit');
    pushToast('Party Milestone Level-Up applied!', 'crit');
  }, [characterList, rawChar.id, appendLog, pushToast]);

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
    persistEncounter((prev) => ({
      ...prev,
      round: 1,
      activeTurnIndex: 0,
      combatants: rollAllInitiativeOrder(prev.combatants),
    }));
    appendLog('Rolled Initiative for all combatants (Reset to Round 1).', 'roll');
  }, [persistEncounter, appendLog]);

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

  const updateEncounterMapSettings = useCallback(
    (patch: Partial<NonNullable<CombatEncounterState['map']>>) => {
      persistEncounter((prev) => {
        const nextMap = {
          cols: 20,
          rows: 12,
          gridFeet: 5,
          templates: [],
          ...(prev.map ?? {}),
          ...patch,
        };
        if (nextMap.dynamicVision && nextMap.autoRevealFog && nextMap.fogCells?.length) {
          const visible = computeVisibleCells(
            prev.combatants,
            nextMap.cols,
            nextMap.rows,
            nextMap.gridFeet,
            nextMap.terrainCells ?? []
          );
          nextMap.fogCells = nextMap.fogCells.filter((cell) => !visible.has(cell));
        }
        return {
          ...prev,
          map: nextMap,
        };
      });
    },
    [persistEncounter]
  );

  const toggleFogCells = useCallback(
    (cellKeys: string[], mode: 'paint' | 'reveal') => {
      if (cellKeys.length === 0) return;
      persistEncounter((prev) => {
        const currentFog = new Set(prev.map?.fogCells ?? []);
        for (const key of cellKeys) {
          if (mode === 'paint') currentFog.add(key);
          else currentFog.delete(key);
        }
        return {
          ...prev,
          map: {
            cols: 20,
            rows: 12,
            gridFeet: 5,
            templates: [],
            ...(prev.map ?? {}),
            fogCells: Array.from(currentFog),
          },
        };
      });
    },
    [persistEncounter]
  );

  const fillAllFog = useCallback(() => {
    persistEncounter((prev) => {
      const cols = prev.map?.cols ?? 20;
      const rows = prev.map?.rows ?? 12;
      const allKeys: string[] = [];
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          allKeys.push(`${x},${y}`);
        }
      }
      return {
        ...prev,
        map: {
          cols,
          rows,
          gridFeet: 5,
          templates: [],
          ...(prev.map ?? {}),
          fogCells: allKeys,
        },
      };
    });
  }, [persistEncounter]);

  const clearAllFog = useCallback(() => {
    persistEncounter((prev) => ({
      ...prev,
      map: {
        cols: 20,
        rows: 12,
        gridFeet: 5,
        templates: [],
        ...(prev.map ?? {}),
        fogCells: [],
      },
    }));
  }, [persistEncounter]);

  const setTerrainCell = useCallback(
    (x: number, y: number, kind: 'wall' | 'difficult' | 'water' | null) => {
      persistEncounter((prev) => {
        const filtered = (prev.map?.terrainCells ?? []).filter((t) => !(t.x === x && t.y === y));
        const nextTerrain = kind ? [...filtered, { x, y, kind }] : filtered;
        return {
          ...prev,
          map: {
            cols: 20,
            rows: 12,
            gridFeet: 5,
            templates: [],
            ...(prev.map ?? {}),
            terrainCells: nextTerrain,
          },
        };
      });
    },
    [persistEncounter]
  );

  const clearTerrain = useCallback(() => {
    persistEncounter((prev) => ({
      ...prev,
      map: {
        cols: 20,
        rows: 12,
        gridFeet: 5,
        templates: [],
        ...(prev.map ?? {}),
        terrainCells: [],
      },
    }));
  }, [persistEncounter]);

  const playerDisplayChannelRef = useRef<BroadcastChannel | null>(null);
  const sharedHandoutRef = useRef<SharedHandoutPayload | null>(null);
  sharedHandoutRef.current = activeSharedHandout;
  const activePingsRef = useRef<MapPingEvent[]>([]);
  activePingsRef.current = activePings;

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('dnd-forge-player-display');
    playerDisplayChannelRef.current = ch;
    ch.onmessage = (evt: MessageEvent) => {
      if (evt.data?.type === 'request_sync') {
        ch.postMessage({
          type: 'sync_state',
          encounter: encounterRef.current,
          sharedHandout: sharedHandoutRef.current,
          pings: activePingsRef.current.filter((p) => Date.now() - p.timestamp < 3200),
        });
      }
    };
    return () => {
      ch.close();
      playerDisplayChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    playerDisplayChannelRef.current?.postMessage({
      type: 'sync_state',
      encounter,
      sharedHandout: activeSharedHandout,
      pings: activePings.filter((p) => Date.now() - p.timestamp < 3200),
    });
  }, [encounter, activeSharedHandout, activePings]);

  const saveCurrentMapAsScene = useCallback(
    async (name: string) => {
      const clean = name.trim() || encounter.name || 'Untitled Scene';
      const m = encounter.map;
      const scene: BattlemapScene = {
        id: `scene-${Date.now().toString(36)}`,
        name: clean,
        imageDataUrl: m?.imageDataUrl,
        cols: m?.cols ?? 20,
        rows: m?.rows ?? 12,
        gridFeet: m?.gridFeet ?? 5,
        fogCells: m?.fogCells ? [...m.fogCells] : [],
        terrainCells: m?.terrainCells ? [...m.terrainCells] : [],
        sketches: m?.sketches ? [...m.sketches] : [],
        gridOpacity: m?.gridOpacity,
        imageScale: m?.imageScale,
        imageOffsetX: m?.imageOffsetX,
        imageOffsetY: m?.imageOffsetY,
        dynamicVision: m?.dynamicVision,
        autoRevealFog: m?.autoRevealFog,
        updatedAt: new Date().toISOString(),
      };
      await saveScene(scene);
      setScenes((prev) => [scene, ...prev.filter((s) => s.id !== scene.id)]);
      appendLog(`Saved battlemap scene "${clean}".`, 'info');
    },
    [encounter.name, encounter.map, appendLog]
  );

  const loadSceneToEncounter = useCallback(
    (sceneId: string) => {
      const scene = scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      persistEncounter((prev) => ({
        ...prev,
        map: {
          cols: scene.cols,
          rows: scene.rows,
          gridFeet: scene.gridFeet,
          templates: [],
          imageDataUrl: scene.imageDataUrl,
          fogCells: scene.fogCells ? [...scene.fogCells] : [],
          terrainCells: scene.terrainCells ? [...scene.terrainCells] : [],
          sketches: scene.sketches ? [...scene.sketches] : [],
          gridOpacity: scene.gridOpacity,
          imageScale: scene.imageScale,
          imageOffsetX: scene.imageOffsetX,
          imageOffsetY: scene.imageOffsetY,
          dynamicVision: scene.dynamicVision,
          autoRevealFog: scene.autoRevealFog,
        },
      }));
      appendLog(`Loaded battlemap scene "${scene.name}".`, 'info');
    },
    [scenes, persistEncounter, appendLog]
  );

  const deleteScene = useCallback(
    async (sceneId: string) => {
      await deleteSceneRecord(sceneId);
      setScenes((prev) => prev.filter((s) => s.id !== sceneId));
      appendLog('Deleted battlemap scene.', 'info');
    },
    [appendLog]
  );

  const setCombatantPortrait = useCallback(
    (combatantId: string, portraitUrl: string | undefined) => {
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === combatantId ? { ...c, portraitUrl } : c
        ),
      }));
    },
    [persistEncounter]
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

  const setCombatantVision = useCallback(
    (combatantId: string, visionFeet: number) => {
      const safeFeet = Math.max(5, Math.min(300, Math.round(visionFeet)));
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) =>
          c.id === combatantId ? { ...c, visionFeet: safeFeet } : c
        ),
      }));
    },
    [persistEncounter]
  );

  const addMapSketchStroke = useCallback(
    (stroke: MapSketchStroke) => {
      if (stroke.points.length < 2) return;
      persistEncounter((prev) => ({
        ...prev,
        map: {
          cols: 20,
          rows: 12,
          gridFeet: 5,
          templates: [],
          ...(prev.map ?? {}),
          sketches: [...(prev.map?.sketches ?? []), stroke],
        },
      }));
    },
    [persistEncounter]
  );

  const clearMapSketches = useCallback(() => {
    persistEncounter((prev) => ({
      ...prev,
      map: {
        cols: 20,
        rows: 12,
        gridFeet: 5,
        templates: [],
        ...(prev.map ?? {}),
        sketches: [],
      },
    }));
  }, [persistEncounter]);

  const broadcastMapPing = useCallback(
    (x: number, y: number) => {
      const ping: MapPingEvent = {
        id: `ping-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        x,
        y,
        color: '#f59e0b',
        senderName: rawChar.name,
        timestamp: Date.now(),
      };
      setActivePings((prev) => [...prev.filter((p) => Date.now() - p.timestamp < 3200), ping]);
      setTimeout(() => {
        setActivePings((prev) => prev.filter((p) => p.id !== ping.id));
      }, 3300);
      const session = liveSessionRef.current;
      if (session && session.getState().role !== 'idle') {
        session.broadcast({
          type: 'ping',
          senderId: session.senderId,
          senderName: rawChar.name,
          x,
          y,
          color: ping.color,
          timestamp: ping.timestamp,
        });
      }
    },
    [rawChar.name]
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

      const outcomes = targets.map((t) =>
        resolveTargetAttack(activity, t, rollMode, customBonus, undefined, weaponMastery, attackerAbilityMod)
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

  const setWorldMapImage = useCallback(
    (worldMapImageDataUrl: string | undefined) => {
      persistCampaign((prev) => ({ ...prev, worldMapImageDataUrl }));
      appendLog(worldMapImageDataUrl ? 'Updated campaign world map.' : 'Cleared campaign world map.', 'info');
    },
    [persistCampaign, appendLog]
  );

  const upsertWorldMapPin = useCallback(
    (pin: WorldMapPin) => {
      persistCampaign((prev) => {
        const existing = prev.worldMapPins ?? [];
        const hasPin = existing.some((p) => p.id === pin.id);
        return {
          ...prev,
          worldMapPins: hasPin
            ? existing.map((p) => (p.id === pin.id ? pin : p))
            : [...existing, pin],
        };
      });
    },
    [persistCampaign]
  );

  const deleteWorldMapPin = useCallback(
    (pinId: string) => {
      persistCampaign((prev) => ({
        ...prev,
        worldMapPins: (prev.worldMapPins ?? []).filter((p) => p.id !== pinId),
      }));
    },
    [persistCampaign]
  );

  const shareHandoutToPlayers = useCallback(
    (entry: CampaignEntry) => {
      const payload: SharedHandoutPayload = {
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        body: entry.body,
        imageDataUrl: entry.imageDataUrl,
        senderName: rawChar.name,
      };
      setActiveSharedHandout(payload);
      const session = liveSessionRef.current;
      if (session && session.getState().role !== 'idle') {
        session.broadcast({
          type: 'handout_show',
          senderId: session.senderId,
          senderName: payload.senderName,
          id: payload.id,
          title: payload.title,
          summary: payload.summary,
          body: payload.body,
          imageDataUrl: payload.imageDataUrl,
        });
      }
      appendLog(`Shared handout "${entry.title}" with Player Display / Live Table.`, 'info');
    },
    [rawChar.name, appendLog]
  );

  const hideSharedHandout = useCallback(() => {
    setActiveSharedHandout(null);
    const session = liveSessionRef.current;
    if (session && session.getState().role !== 'idle') {
      session.broadcast({
        type: 'handout_hide',
        senderId: session.senderId,
      });
    }
  }, []);

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

  const assignLootItemToCharacter = useCallback(
    async (itemName: string, characterId: string) => {
      const targetPc = characterList.find((c) => c.id === characterId);
      if (!targetPc) return;
      const newItem: CompendiumEntity = {
        id: `loot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        name: itemName,
        source: 'Party Loot',
        ruleset: targetPc.ruleset,
        category: 'gear',
        quantity: 1,
        activities: [],
        entries: ['Assigned from Party Stash.'],
      };
      const updatedPc: RawCharacterState = {
        ...targetPc,
        items: [newItem, ...targetPc.items],
      };
      await saveCharacter(updatedPc);
      setCharacterList((list) => list.map((c) => (c.id === updatedPc.id ? updatedPc : c)));
      if (updatedPc.id === rawChar.id) {
        setRawChar(updatedPc);
      }
      persistCampaign((prev) => {
        const idx = prev.partyLootItems.indexOf(itemName);
        if (idx < 0) return prev;
        const nextItems = [...prev.partyLootItems];
        nextItems.splice(idx, 1);
        return { ...prev, partyLootItems: nextItems };
      });
      appendLog(`Assigned "${itemName}" from Party Stash to ${updatedPc.name}.`, 'info');
    },
    [characterList, rawChar.id, persistCampaign, appendLog]
  );

  const upsertDowntimeProject = useCallback(
    (project: DowntimeProject) => {
      persistCampaign((prev) => {
        const existing = prev.downtimeProjects ?? [];
        const has = existing.some((p) => p.id === project.id);
        return {
          ...prev,
          downtimeProjects: has
            ? existing.map((p) => (p.id === project.id ? project : p))
            : [project, ...existing],
        };
      });
    },
    [persistCampaign]
  );

  const advanceDowntimeDays = useCallback(
    (deltaDays: number) => {
      const safeDays = Math.max(1, Math.round(deltaDays));
      persistCampaign((prev) => ({
        ...prev,
        downtimeProjects: (prev.downtimeProjects ?? []).map((p) => ({
          ...p,
          daysDone: Math.min(p.daysTotal, p.daysDone + safeDays),
        })),
      }));
      appendLog(`Advanced downtime projects by ${safeDays} day(s).`, 'info');
    },
    [persistCampaign, appendLog]
  );

  const deleteDowntimeProject = useCallback(
    (projectId: string) => {
      persistCampaign((prev) => ({
        ...prev,
        downtimeProjects: (prev.downtimeProjects ?? []).filter((p) => p.id !== projectId),
      }));
    },
    [persistCampaign]
  );

  const sendRollRequestToPeers = useCallback(
    (label: string, kind: 'check' | 'save', abilityOrSkill: string, dc?: number) => {
      const session = liveSessionRef.current;
      if (!session || session.getState().role !== 'host') {
        appendLog('Host a Live Table session first to send roll prompts.', 'warn');
        return;
      }
      session.broadcast({
        type: 'roll_request',
        senderId: session.senderId,
        senderName: rawChar.name,
        id: `req-${Date.now().toString(36)}`,
        label,
        kind,
        abilityOrSkill,
        dc,
      });
      appendLog(`Sent roll prompt to players: ${label}${dc ? ` (DC ${dc})` : ''}.`, 'info');
    },
    [rawChar.name, appendLog]
  );

  const dismissRollRequest = useCallback(() => {
    setPendingRollRequest(null);
  }, []);

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
    updateEncounterMapSettings,
    toggleFogCells,
    fillAllFog,
    clearAllFog,
    setTerrainCell,
    clearTerrain,
    scenes,
    saveCurrentMapAsScene,
    loadSceneToEncounter,
    deleteScene,
    setCombatantPortrait,
    setCharacterAvatar,
    setCombatantVision,
    addMapSketchStroke,
    clearMapSketches,
    activePings,
    broadcastMapPing,
    targetAttackCombatants,
    targetSaveCombatants,
    setWorldMapImage,
    upsertWorldMapPin,
    deleteWorldMapPin,
    activeSharedHandout,
    shareHandoutToPlayers,
    hideSharedHandout,
    activeBuffs,
    toggleBuff,
    divineSmite,
    assignLootItemToCharacter,
    upsertDowntimeProject,
    advanceDowntimeDays,
    deleteDowntimeProject,
    pendingRollRequest,
    sendRollRequestToPeers,
    dismissRollRequest,
    addTimedCombatEffect,
    rollAllInitiative,
    toggleCombatantHidden,
    setCombatantSize,
    adjustLegendaryActions,
    toggleOrRollRecharge,
    campaign,
    campaignList,
    switchCampaign,
    createCampaign,
    deleteCampaign,
    upsertCampaignEntry,
    deleteCampaignEntry,
    advanceCampaignClock,
    addClockTimer,
    setCampaignWeather,
    addPartyLoot,
    distributeGoldToParty,
    buyShopItemForActiveCharacter,
    awardPartyXp,
    triggerPartyMilestoneLevelUp,
    updateCurrency,
    updateItemQuantity,
    updateCharacterNotes,
    createHomebrewEntity,
    compendium,
    rollMode,
    setRollMode,
    pendingConcDc,
    toasts,
    dismissToast,
    pushToast,
    canUndo: historyCounts.past > 0,
    canRedo: historyCounts.future > 0,
    undo,
    redo,
    enterWildShape,
    revertWildShape,
    applyLevelUpPlan,
    importSingleCharacter,
    liveStatus,
    hostLocalTable,
    joinLocalTable,
    createWebRtcInvite,
    acceptWebRtcInvite,
    completeWebRtcLink,
    disconnectLiveTable,
    pushEncounterToPeers,
    shareActiveCharacterToPeers,
    consoleLines,
    appendLog,
    clearConsoleLog,
    setStatOverride,
    adjustHp,
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
    toggleCombatantEconomy,
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
