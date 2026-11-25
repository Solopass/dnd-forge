import { useCallback, useEffect } from 'react';
import { CampaignEntry, DowntimeProject, SharedHandoutPayload, WorldMapPin } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { BattlemapScene, CombatEncounterState, MapPingEvent, MapSketchStroke } from '../types/combat';
import { computeVisibleCells } from '../engine/vtt-vision';
import { CompendiumEntity } from '../types/compendium';
import { syncSpellSlotPools } from '../engine/rules-math';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { computeFixedMaxHp, syncClassResourcePools } from '../engine/classes';
import { advanceWorldClock, createDefaultCampaign, getXpForNextLevel, ShopItem } from '../engine/dm-tools';
import { db, deleteSceneRecord, saveCampaign, saveCharacter, saveScene } from '../storage/db';
import { useStoreCore } from './store/core';
import { useCharacterActions } from './store/character';
import { useActivitiesActions } from './store/activities';
import { useCombatActions } from './store/combat';
import { useContentImportActions } from './store/content-import';
import { useLiveTableActions } from './store/live-table';

export type { ConsoleLine, ToastMessage, LevelUpPlanInput } from './store/types';

export function useSheetStore(initialCharacter: RawCharacterState, initialEncounter: CombatEncounterState) {
  const core = useStoreCore(initialCharacter, initialEncounter);
  const character = useCharacterActions(core);
  const activities = useActivitiesActions(core);
  const combat = useCombatActions(core, { adjustHp: character.adjustHp, toggleCondition: character.toggleCondition });
  const contentImport = useContentImportActions(core, { addMonsterToEncounter: combat.addMonsterToEncounter });
  const liveTable = useLiveTableActions(core, { importSingleCharacter: contentImport.importSingleCharacter, targetAttackCombatants: combat.targetAttackCombatants, targetSaveCombatants: combat.targetSaveCombatants });
  const {
    liveStatus,
    liveSessionRef,
    claimedTokenId,
    rawChar,
    persistEncounter,
    appendLog,
    campaignList,
    setCampaign,
    setCampaignList,
    campaign,
    persistCampaign,
    pushToast,
    characterList,
    setCharacterList,
    setRawChar,
    persistCharacter,
    playerDisplayChannelRef,
    encounterRef,
    sharedHandoutRef,
    activePingsRef,
    encounter,
    activeSharedHandout,
    activePings,
    setScenes,
    scenes,
    setActivePings,
    setActiveSharedHandout,
  } = core;

  const moveCombatantToken = useCallback(
    (combatantId: string, x: number, y: number) => {
      if (liveStatus.role === 'player') {
        const session = liveSessionRef.current;
        const ownedId = claimedTokenId ?? rawChar.id;
        if (session && combatantId === ownedId) {
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

  const depositItemToPartyStash = useCallback(
    (itemId: string) => {
      const item = rawChar.items.find((it) => it.id === itemId);
      if (!item) return;
      const qty = item.quantity ?? 1;
      persistCharacter((prev) => {
        if (qty > 1) {
          return {
            ...prev,
            items: prev.items.map((it) =>
              it.id === itemId ? { ...it, quantity: qty - 1 } : it
            ),
          };
        }
        return {
          ...prev,
          items: prev.items.filter((it) => it.id !== itemId),
        };
      });
      persistCampaign((prev) => {
        const stash = prev.partyStash ?? [];
        const existingIdx = stash.findIndex((s) => s.name === item.name && s.category === item.category);
        const nextStash =
          existingIdx >= 0
            ? stash.map((s, idx) =>
                idx === existingIdx ? { ...s, quantity: (s.quantity ?? 1) + 1 } : s
              )
            : [
                {
                  ...item,
                  id: `stash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  equipped: false,
                  attuned: false,
                  quantity: 1,
                },
                ...stash,
              ];
        return { ...prev, partyStash: nextStash };
      });
      if (liveSessionRef.current && liveStatus.role !== 'idle') {
        const nextStash = (() => {
          const stash = campaign?.partyStash ?? [];
          const existingIdx = stash.findIndex((s) => s.name === item.name && s.category === item.category);
          return existingIdx >= 0
            ? stash.map((s, idx) => (idx === existingIdx ? { ...s, quantity: (s.quantity ?? 1) + 1 } : s))
            : [{ ...item, id: `stash-${Date.now()}`, equipped: false, attuned: false, quantity: 1 }, ...stash];
        })();
        liveSessionRef.current.broadcast({
          type: 'party_stash_sync',
          senderId: liveSessionRef.current.senderId,
          senderName: rawChar.name,
          partyLootGp: campaign?.partyLootGp ?? 0,
          partyStash: nextStash,
        });
      }
      appendLog(`${rawChar.name} deposited "${item.name}" into Party Shared Inventory.`, 'info');
    },
    [rawChar.items, rawChar.name, persistCharacter, persistCampaign, appendLog]
  );

  const claimPartyStashItem = useCallback(
    (stashItemId: string) => {
      const stash = campaign?.partyStash ?? [];
      const item = stash.find((s) => s.id === stashItemId);
      if (!item) return;
      const qty = item.quantity ?? 1;
      persistCampaign((prev) => {
        const prevStash = prev.partyStash ?? [];
        const nextStash =
          qty > 1
            ? prevStash.map((s) =>
                s.id === stashItemId ? { ...s, quantity: qty - 1 } : s
              )
            : prevStash.filter((s) => s.id !== stashItemId);
        return { ...prev, partyStash: nextStash };
      });
      if (liveSessionRef.current && liveStatus.role !== 'idle') {
        const prevStash = campaign?.partyStash ?? [];
        const nextStash =
          qty > 1
            ? prevStash.map((s) => (s.id === stashItemId ? { ...s, quantity: qty - 1 } : s))
            : prevStash.filter((s) => s.id !== stashItemId);
        liveSessionRef.current.broadcast({
          type: 'party_stash_sync',
          senderId: liveSessionRef.current.senderId,
          senderName: rawChar.name,
          partyLootGp: campaign?.partyLootGp ?? 0,
          partyStash: nextStash,
        });
      }
      persistCharacter((prev) => {
        const existingIdx = prev.items.findIndex(
          (it) => it.name === item.name && it.category === item.category
        );
        if (existingIdx >= 0) {
          return {
            ...prev,
            items: prev.items.map((it, idx) =>
              idx === existingIdx ? { ...it, quantity: (it.quantity ?? 1) + 1 } : it
            ),
          };
        }
        return {
          ...prev,
          items: [
            {
              ...item,
              id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              equipped: false,
              attuned: false,
              quantity: 1,
            },
            ...prev.items,
          ],
        };
      });
      appendLog(`${rawChar.name} claimed "${item.name}" from Party Shared Inventory.`, 'info');
    },
    [campaign?.partyStash, rawChar.name, persistCampaign, persistCharacter, appendLog]
  );

  const addPartyStashItem = useCallback(
    (name: string, category: CompendiumEntity['category'] = 'gear', quantity = 1, notes?: string) => {
      const clean = name.trim();
      if (!clean) return;
      persistCampaign((prev) => {
        const stash = prev.partyStash ?? [];
        const newItem: CompendiumEntity = {
          id: `stash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: clean,
          source: 'Party Stash',
          ruleset: rawChar.ruleset,
          category,
          quantity: Math.max(1, quantity),
          activities: [],
          entries: notes?.trim() ? [notes.trim()] : [],
        };
        return { ...prev, partyStash: [newItem, ...stash] };
      });
      if (liveSessionRef.current && liveStatus.role !== 'idle') {
        const stash = campaign?.partyStash ?? [];
        const previewItem: CompendiumEntity = {
          id: `stash-${Date.now()}`,
          name: clean,
          source: 'Party Stash',
          ruleset: rawChar.ruleset,
          category,
          quantity: Math.max(1, quantity),
          activities: [],
          entries: notes?.trim() ? [notes.trim()] : [],
        };
        liveSessionRef.current.broadcast({
          type: 'party_stash_sync',
          senderId: liveSessionRef.current.senderId,
          senderName: rawChar.name,
          partyLootGp: campaign?.partyLootGp ?? 0,
          partyStash: [previewItem, ...stash],
        });
      }
      appendLog(`Added "${clean}" (×${Math.max(1, quantity)}) to Party Shared Inventory.`, 'info');
    },
    [rawChar.ruleset, persistCampaign, appendLog]
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

  return {
    rawChar: core.rawChar,
    characterList: core.characterList,
    switchCharacter: character.switchCharacter,
    createNewCharacter: character.createNewCharacter,
    createCharacterFromPreset: character.createCharacterFromPreset,
    duplicateCharacter: character.duplicateCharacter,
    deleteCharacter: character.deleteCharacter,
    spendHitDie: character.spendHitDie,
    persistCharacter: core.persistCharacter,
    resolvedSheet: core.resolvedSheet,
    encounter: core.encounter,
    encounterList: core.encounterList,
    switchEncounter: combat.switchEncounter,
    createEncounter: combat.createEncounter,
    duplicateEncounter: combat.duplicateEncounter,
    deleteEncounter: combat.deleteEncounter,
    addPartyToEncounter: combat.addPartyToEncounter,
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
    scenes: core.scenes,
    saveCurrentMapAsScene,
    loadSceneToEncounter,
    deleteScene,
    setCombatantPortrait,
    setCharacterAvatar: character.setCharacterAvatar,
    setCombatantVision,
    addMapSketchStroke,
    clearMapSketches,
    activePings: core.activePings,
    broadcastMapPing,
    targetAttackCombatants: combat.targetAttackCombatants,
    targetSaveCombatants: combat.targetSaveCombatants,
    setWorldMapImage,
    upsertWorldMapPin,
    deleteWorldMapPin,
    activeSharedHandout: core.activeSharedHandout,
    shareHandoutToPlayers,
    hideSharedHandout,
    activeBuffs: core.activeBuffs,
    toggleBuff: activities.toggleBuff,
    divineSmite: activities.divineSmite,
    houseRules: core.houseRules,
    updateHouseRules: core.updateHouseRules,
    assignLootItemToCharacter,
    upsertDowntimeProject,
    advanceDowntimeDays,
    deleteDowntimeProject,
    pendingRollRequest: core.pendingRollRequest,
    sendRollRequestToPeers: liveTable.sendRollRequestToPeers,
    dismissRollRequest: liveTable.dismissRollRequest,
    addTimedCombatEffect: combat.addTimedCombatEffect,
    rollAllInitiative: combat.rollAllInitiative,
    toggleCombatantHidden: combat.toggleCombatantHidden,
    setCombatantSize: combat.setCombatantSize,
    adjustLegendaryActions: combat.adjustLegendaryActions,
    toggleOrRollRecharge: combat.toggleOrRollRecharge,
    campaign: core.campaign,
    campaignList: core.campaignList,
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
    updateCurrency: character.updateCurrency,
    updateItemQuantity: character.updateItemQuantity,
    updateCharacterNotes: character.updateCharacterNotes,
    createHomebrewEntity: contentImport.createHomebrewEntity,
    compendium: core.compendium,
    rollMode: core.rollMode,
    setRollMode: core.setRollMode,
    pendingConcDc: core.pendingConcDc,
    initiativeAlert: core.initiativeAlert,
    startEncounterAlert: combat.startEncounterAlert,
    dismissInitiativeAlert: combat.dismissInitiativeAlert,
    toasts: core.toasts,
    dismissToast: core.dismissToast,
    pushToast: core.pushToast,
    canUndo: core.historyCounts.past > 0,
    canRedo: core.historyCounts.future > 0,
    undo: core.undo,
    redo: core.redo,
    enterWildShape: character.enterWildShape,
    revertWildShape: character.revertWildShape,
    applyLevelUpPlan: character.applyLevelUpPlan,
    importSingleCharacter: contentImport.importSingleCharacter,
    liveStatus: core.liveStatus,
    claimedTokenId: core.claimedTokenId,
    claimCombatantToken: liveTable.claimCombatantToken,
    moveCombatantOrder: combat.moveCombatantOrder,
    hostLocalTable: liveTable.hostLocalTable,
    joinLocalTable: liveTable.joinLocalTable,
    createWebRtcInvite: liveTable.createWebRtcInvite,
    acceptWebRtcInvite: liveTable.acceptWebRtcInvite,
    completeWebRtcLink: liveTable.completeWebRtcLink,
    disconnectLiveTable: liveTable.disconnectLiveTable,
    pushEncounterToPeers: liveTable.pushEncounterToPeers,
    shareActiveCharacterToPeers: liveTable.shareActiveCharacterToPeers,
    consoleLines: core.consoleLines,
    appendLog: core.appendLog,
    clearConsoleLog: core.clearConsoleLog,
    setStatOverride: character.setStatOverride,
    adjustHp: character.adjustHp,
    setTempHp: character.setTempHp,
    setExhaustion: character.setExhaustion,
    updateDeathSaves: character.updateDeathSaves,
    rollDeathSave: character.rollDeathSave,
    toggleInspiration: character.toggleInspiration,
    toggleDefense: character.toggleDefense,
    applySubclassGrants: character.applySubclassGrants,
    adjustResourcePool: character.adjustResourcePool,
    addCustomResourcePool: character.addCustomResourcePool,
    toggleCondition: character.toggleCondition,
    rollCharacterInitiative: activities.rollCharacterInitiative,
    takeRest: character.takeRest,
    spendHitDiceBulk: character.spendHitDiceBulk,
    castRitualSpell: activities.castRitualSpell,
    updateSenses: character.updateSenses,
    updateSpeeds: character.updateSpeeds,
    updateStructuredProficiencies: character.updateStructuredProficiencies,
    updateDetails: character.updateDetails,
    updateItemContainer: character.updateItemContainer,
    simplifyCurrency: character.simplifyCurrency,
    depositItemToPartyStash,
    claimPartyStashItem,
    addPartyStashItem,
    syncCampaignExternalRepo: contentImport.syncCampaignExternalRepo,
    syncFree5ePack: contentImport.syncFree5ePack,
    free5eSyncing: core.free5eSyncing,
    pushCharacterToCampaignRepo: contentImport.pushCharacterToCampaignRepo,
    pushCampaignToRepo: contentImport.pushCampaignToRepo,
    toggleItemEquipped: character.toggleItemEquipped,
    toggleItemPrepared: character.toggleItemPrepared,
    toggleItemAttuned: character.toggleItemAttuned,
    removeSheetItem: character.removeSheetItem,
    addCompendiumItemToSheet: contentImport.addCompendiumItemToSheet,
    installContentPack: contentImport.installContentPack,
    importDdbPdfFile: contentImport.importDdbPdfFile,
    rollInlineExpression: activities.rollInlineExpression,
    triggerCombatantActivity: activities.triggerCombatantActivity,
    triggerActivity: activities.triggerActivity,
    stepCombatTurn: combat.stepCombatTurn,
    adjustCombatantHp: combat.adjustCombatantHp,
    setCombatantInitiative: combat.setCombatantInitiative,
    toggleCombatantCondition: combat.toggleCombatantCondition,
    toggleCombatantEconomy: combat.toggleCombatantEconomy,
    removeCombatant: combat.removeCombatant,
    dropConcentration: combat.dropConcentration,
    rollConcentrationSave: combat.rollConcentrationSave,
    resetEncounter: combat.resetEncounter,
    addMonsterToEncounter: combat.addMonsterToEncounter,
    importMarkdownHomebrew: contentImport.importMarkdownHomebrew,
    importJsonFilePayload: contentImport.importJsonFilePayload,
    searchCompendium: contentImport.searchCompendium,
  };
}
