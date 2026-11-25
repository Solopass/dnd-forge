import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CampaignRecord, SharedHandoutPayload } from '../../types/campaign';
import { RawCharacterState, ResolvedCharacterSheet } from '../../types/character';
import { BattlemapScene, CombatEncounterState, MapPingEvent } from '../../types/combat';
import { CompendiumEntity } from '../../types/compendium';
import { ActiveBuffState, RollMode } from '../../types/core';
import { computeCharacterSheet, syncSpellSlotPools } from '../../engine/rules-math';
import { BUILTIN_CONTENT_PACKS } from '../../engine/srd-packs';
import { CUSTOM_REPO_CHARACTERS, loadCustomRepoEntities } from '../../engine/custom-content-loader';
import { fetchCampaignPackFromGitHub } from '../../engine/campaign-repo-sync';
import { HouseRulesConfig, readStoredHouseRules, saveHouseRules } from '../../engine/ruleset-config';
import { syncClassResourcePools } from '../../engine/classes';
import { createDefaultCampaign } from '../../engine/dm-tools';
import { LivePeerInfo, LiveTableMessage, LiveTableRole, LiveTableSession } from '../../engine/live-sync';
import { playTableSound } from '../../engine/sound';
import {
  db,
  removeFree5eIndexJunk,
  saveCampaign,
  saveCharacter,
  saveEncounter,
  upsertCompendiumEntities,
} from '../../storage/db';
import type { ConsoleLine, ToastMessage } from './types';

export function useStoreCore(initialCharacter: RawCharacterState, initialEncounter: CombatEncounterState) {
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

  const [claimedTokenId, setClaimedTokenId] = useState<string | null>(null);

  const [compendium, setCompendium] = useState<CompendiumEntity[]>(() => {
    const map = new Map<string, CompendiumEntity>();
    for (const p of BUILTIN_CONTENT_PACKS) {
      for (const e of p.entities) map.set(e.id, e);
    }
    for (const e of initialCharacter.items) {
      if (!map.has(e.id)) map.set(e.id, e);
    }
    return Array.from(map.values());
  });

  const [rollMode, setRollMode] = useState<RollMode>('normal');

  const [free5eSyncing, setFree5eSyncing] = useState(false);

  const [pendingConcDc, setPendingConcDc] = useState<number | null>(null);

  const [initiativeAlert, setInitiativeAlert] = useState<{
    senderName: string;
    encounterName: string;
    timestamp: number;
  } | null>(null);

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
      text: 'Sidereroll v0.7 ready. Press Ctrl+K for Compendium Packs, D&D Beyond PDF Import, or JSON/Markdown ingestion.',
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
          const existingIds = new Set(allSaved.map((c) => c.id));
          const missingRepoChars = CUSTOM_REPO_CHARACTERS.filter((c) => !existingIds.has(c.id));
          for (const rc of missingRepoChars) {
            await saveCharacter(rc);
          }
          const combined = [...allSaved, ...missingRepoChars];
          setCharacterList(combined);
          setRawChar(combined[0]!);
        } else {
          await saveCharacter(initialCharacter);
          await upsertCompendiumEntities(initialCharacter.items);
          for (const rc of CUSTOM_REPO_CHARACTERS) {
            await saveCharacter(rc);
          }
          if (active && CUSTOM_REPO_CHARACTERS.length > 0) {
            setCharacterList([initialCharacter, ...CUSTOM_REPO_CHARACTERS]);
          }
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
        const customRepoEntities = await loadCustomRepoEntities();
        const combinedEntities = [...basePackEntities, ...customRepoEntities];
        await upsertCompendiumEntities(combinedEntities);
        await removeFree5eIndexJunk();
        const refreshed = await db.compendium.toArray();
        if (active && refreshed.length > 0) {
          setCompendium(refreshed);
        } else if (active && customRepoEntities.length > 0) {
          setCompendium(combinedEntities);
        }

        const hasFree5e = refreshed.some((e) => e.id.startsWith('free5e-'));
        const alreadyAutoSynced =
          typeof localStorage !== 'undefined' &&
          localStorage.getItem('sidereroll-free5e-autosynced') === '1';
        if (active && !hasFree5e && !alreadyAutoSynced) {
          setFree5eSyncing(true);
          void fetchCampaignPackFromGitHub({ owner: 'Solopass', repo: 'free5e', branch: 'main' })
            .then(async (res) => {
              if (!active || res.entities.length === 0) return;
              await upsertCompendiumEntities(res.entities);
              setCompendium((prev) => {
                const map = new Map(prev.map((e) => [e.id, e]));
                for (const e of res.entities) map.set(e.id, e);
                return Array.from(map.values());
              });
              try {
                localStorage.setItem('sidereroll-free5e-autosynced', '1');
              } catch {
                // ignore
              }
              appendLog(`Auto-synced ${res.entities.length} Free5e items from Solopass/free5e.`, 'info');
            })
            .catch(() => {
              // manual sync button remains available in Packs / DM Hub
            })
            .finally(() => {
              if (active) setFree5eSyncing(false);
            });
        }
      } catch (err) {
        appendLog(`Storage hydration warning: ${String(err)}`, 'warn');
      }
    })();
    return () => {
      active = false;
    };
  }, [initialCharacter, initialEncounter, defaultCampaign, appendLog]);

  const [houseRules, setHouseRules] = useState<HouseRulesConfig>(() => readStoredHouseRules());

  const updateHouseRules = useCallback((next: HouseRulesConfig) => {
    setHouseRules(next);
    saveHouseRules(next);
  }, []);

  const resolvedSheet: ResolvedCharacterSheet = useMemo(
    () => computeCharacterSheet(rawChar, houseRules),
    [rawChar, houseRules]
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

  const clearConsoleLog = useCallback(() => {
    setConsoleLines([]);
  }, []);

  const onRemoteMessageRef = useRef<(msg: LiveTableMessage) => void>(() => {});

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

  const playerDisplayChannelRef = useRef<BroadcastChannel | null>(null);

  const sharedHandoutRef = useRef<SharedHandoutPayload | null>(null);

  sharedHandoutRef.current = activeSharedHandout;

  const activePingsRef = useRef<MapPingEvent[]>([]);

  activePingsRef.current = activePings;

  return {
    defaultCampaign,
    rawChar,
    setRawChar,
    characterList,
    setCharacterList,
    encounter,
    setEncounter,
    encounterList,
    setEncounterList,
    campaign,
    setCampaign,
    campaignList,
    setCampaignList,
    scenes,
    setScenes,
    activePings,
    setActivePings,
    activeSharedHandout,
    setActiveSharedHandout,
    activeBuffs,
    setActiveBuffs,
    pendingRollRequest,
    setPendingRollRequest,
    claimedTokenId,
    setClaimedTokenId,
    compendium,
    setCompendium,
    rollMode,
    setRollMode,
    free5eSyncing,
    setFree5eSyncing,
    pendingConcDc,
    setPendingConcDc,
    initiativeAlert,
    setInitiativeAlert,
    toasts,
    setToasts,
    liveStatus,
    setLiveStatus,
    historyCounts,
    setHistoryCounts,
    consoleLines,
    setConsoleLines,
    rawCharRef,
    encounterRef,
    pastRef,
    futureRef,
    lastSnapshotTsRef,
    isApplyingHistoryRef,
    isApplyingRemoteRef,
    lastBroadcastDigestRef,
    liveSessionRef,
    dismissToast,
    pushToast,
    appendLog,
    recordUndoSnapshot,
    houseRules,
    setHouseRules,
    updateHouseRules,
    resolvedSheet,
    persistCharacter,
    persistEncounter,
    undo,
    redo,
    clearConsoleLog,
    onRemoteMessageRef,
    persistCampaign,
    playerDisplayChannelRef,
    sharedHandoutRef,
    activePingsRef,
  };
}

export type StoreCore = ReturnType<typeof useStoreCore>;
