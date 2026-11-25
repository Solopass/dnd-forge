import { useCallback, useEffect } from 'react';
import { BattlemapScene, CombatEncounterState, MapPingEvent, MapSketchStroke } from '../../types/combat';
import { computeVisibleCells } from '../../engine/vtt-vision';
import { deleteSceneRecord, saveScene } from '../../storage/db';
import type { StoreCore } from './core';

export function useBattlemapActions(core: StoreCore) {
  const {
    liveStatus,
    liveSessionRef,
    claimedTokenId,
    rawChar,
    persistEncounter,
    appendLog,
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

  return {
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
    saveCurrentMapAsScene,
    loadSceneToEncounter,
    deleteScene,
    setCombatantPortrait,
    setCombatantVision,
    addMapSketchStroke,
    clearMapSketches,
    broadcastMapPing,
  };
}
