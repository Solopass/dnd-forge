import { useCallback, useEffect } from 'react';
import { CampaignEntry, DowntimeProject, SharedHandoutPayload, WorldMapPin } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { BattlemapScene, CombatEncounterState, MapPingEvent, MapSketchStroke } from '../types/combat';
import { computeVisibleCells } from '../engine/vtt-vision';
import { CompendiumEntity } from '../types/compendium';
import { syncSpellSlotPools } from '../engine/rules-math';
import { applyEffectWithConcentrationCheck } from '../engine/combat-machine';
import { parseHomebrewMarkdownBlock } from '../engine/statblock-parser';
import { parseFree5eMarkdownAuto } from '../engine/free5e-parser';
import { adapt5eToolsPayload } from '../engine/five-tools-adapter';
import { parseDndBeyondPdfBuffer } from '../engine/ddb-pdf-importer';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { parseCustomContentJson } from '../engine/custom-content-loader';
import { buildCampaignPackExport, fetchCampaignPackFromGitHub, getStoredGithubPat, pushFileToGitHubRepo, tryFetchExistingManifest } from '../engine/campaign-repo-sync';
import { ExternalRepoConfig } from '../types/campaign';
import { computeFixedMaxHp, syncClassResourcePools } from '../engine/classes';
import { advanceWorldClock, createDefaultCampaign, getXpForNextLevel, ShopItem } from '../engine/dm-tools';
import { decodeCharacterShareCode, LiveTableMessage, LiveTableSession } from '../engine/live-sync';
import { playTableSound } from '../engine/sound';
import { tabletopSoundboard } from '../engine/soundboard';
import { buildSearchTokens, db, deleteSceneRecord, importBackupBundle, normalizeSearchQuery, saveCampaign, saveCharacter, saveEncounter, saveScene, upsertCompendiumEntities } from '../storage/db';
import { useStoreCore } from './store/core';
import { useCharacterActions } from './store/character';
import { useActivitiesActions } from './store/activities';
import { useCombatActions } from './store/combat';

export type { ConsoleLine, ToastMessage, LevelUpPlanInput } from './store/types';

export function useSheetStore(initialCharacter: RawCharacterState, initialEncounter: CombatEncounterState) {
  const core = useStoreCore(initialCharacter, initialEncounter);
  const character = useCharacterActions(core);
  const activities = useActivitiesActions(core);
  const combat = useCombatActions(core, { adjustHp: character.adjustHp, toggleCondition: character.toggleCondition });
  const {
    persistCharacter,
    appendLog,
    setCompendium,
    setCharacterList,
    setRawChar,
    setEncounterList,
    setEncounter,
    setCampaignList,
    setCampaign,
    setScenes,
    liveStatus,
    liveSessionRef,
    claimedTokenId,
    rawChar,
    persistEncounter,
    compendium,
    characterList,
    setPendingConcDc,
    pushToast,
    onRemoteMessageRef,
    isApplyingRemoteRef,
    setClaimedTokenId,
    setActivePings,
    setActiveSharedHandout,
    setPendingRollRequest,
    setInitiativeAlert,
    persistCampaign,
    setLiveStatus,
    rawCharRef,
    encounterRef,
    encounter,
    lastBroadcastDigestRef,
    resolvedSheet,
    campaignList,
    campaign,
    playerDisplayChannelRef,
    sharedHandoutRef,
    activePingsRef,
    activeSharedHandout,
    activePings,
    scenes,
    setFree5eSyncing,
  } = core;
  const { addMonsterToEncounter, targetAttackCombatants, targetSaveCombatants } = combat;

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
          entity.entries.join(' '),
          entity.imageUrl
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

  const importMarkdownHomebrew = useCallback(
    async (rawMarkdown: string) => {
      const free5e = /\[_metadata_:spell_name\]:-/i.test(rawMarkdown)
        ? parseFree5eMarkdownAuto(rawMarkdown, 'spell')
        : null;
      if (free5e) {
        await upsertCompendiumEntities([free5e]);
        setCompendium((prev) => [free5e, ...prev]);
        persistCharacter((prev) => ({
          ...prev,
          items: [free5e, ...prev.items],
        }));
        appendLog(`Imported Free5e "${free5e.name}" (${free5e.category}) from Markdown.`, 'info');
        return;
      }

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
          result.data.entries.join(' '),
          result.data.imageUrl
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
          return;
        }

        const customParsed = parseCustomContentJson(rawText);
        if (customParsed.entities.length > 0 || customParsed.characters.length > 0) {
          if (customParsed.entities.length > 0) {
            await upsertCompendiumEntities(customParsed.entities);
            setCompendium((prev) => [...customParsed.entities, ...prev]);
          }
          for (const ch of customParsed.characters) {
            await saveCharacter(ch);
            setCharacterList((prev) => (prev.some((p) => p.id === ch.id) ? prev : [...prev, ch]));
            setRawChar(ch);
          }
          appendLog(
            `Imported ${customParsed.entities.length} custom entity(s) and ${customParsed.characters.length} character(s).`,
            'info'
          );
        } else {
          appendLog('JSON recognized, but no Sidereroll entities, characters, or 5e.tools arrays were found.', 'warn');
        }
      } catch (err) {
        appendLog(`JSON import failed: ${String(err)}`, 'warn');
      }
    },
    [appendLog]
  );

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
      if (!rawQ) return compendium;
      const normQ = normalizeSearchQuery(query);
      return compendium.filter((item) => {
        if (item.name.toLowerCase().includes(rawQ)) return true;
        return normQ ? buildSearchTokens(item).includes(normQ) : false;
      });
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
        setClaimedTokenId((prevClaim) => {
          if (prevClaim && msg.encounter.combatants.some((c) => c.id === prevClaim)) {
            return prevClaim;
          }
          const matched = msg.encounter.combatants.find(
            (c) =>
              c.kind === 'pc' &&
              (c.id === rawChar.id || c.name.toLowerCase() === rawChar.name.toLowerCase())
          );
          return matched ? matched.id : prevClaim;
        });
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

    if (msg.type === 'initiative_alert') {
      tabletopSoundboard.playInitiativeAlertSound(msg.soundUrl);
      setInitiativeAlert({
        senderName: msg.senderName,
        encounterName: msg.encounterName,
        timestamp: msg.timestamp,
      });
      appendLog(`${msg.senderName} signaled: ROLL INITIATIVE for "${msg.encounterName}"!`, 'warn');
      return;
    }

    if (msg.type === 'token_move' && liveStatus.role === 'host') {
      persistEncounter((prev) => {
        const nextCombatants = prev.combatants.map((c) =>
          c.id === msg.combatantId && c.kind === 'pc' ? { ...c, x: msg.x, y: msg.y } : c
        );
        if (prev.map?.dynamicVision && prev.map?.autoRevealFog && prev.map.fogCells?.length) {
          const visible = computeVisibleCells(
            nextCombatants,
            prev.map.cols,
            prev.map.rows,
            prev.map.gridFeet,
            prev.map.terrainCells
          );
          const nextFog = prev.map.fogCells.filter((cell) => !visible.has(cell));
          return {
            ...prev,
            combatants: nextCombatants,
            map: { ...prev.map, fogCells: nextFog },
          };
        }
        return { ...prev, combatants: nextCombatants };
      });
      return;
    }

    if (msg.type === 'target_attack' && liveStatus.role === 'host') {
      targetAttackCombatants(
        msg.attackerName,
        msg.targetIds,
        msg.activity,
        msg.customBonus,
        msg.weaponMastery,
        msg.attackerAbilityMod
      );
      return;
    }

    if (msg.type === 'target_save' && liveStatus.role === 'host') {
      targetSaveCombatants(msg.attackerName, msg.targetIds, msg.activity, msg.explicitDc);
      return;
    }

    if (msg.type === 'claim_token' && liveStatus.role === 'host') {
      appendLog(`[LIVE] ${msg.senderName} claimed token "${msg.combatantId}".`, 'info');
      return;
    }

    if (msg.type === 'party_stash_sync') {
      persistCampaign((prev) => ({
        ...prev,
        partyLootGp: msg.partyLootGp,
        partyStash: msg.partyStash,
      }));
      appendLog(`[LIVE] ${msg.senderName} updated Party Shared Inventory.`, 'info');
      return;
    }

    if (msg.type === 'target_heal' && liveStatus.role === 'host') {
      const healedNames: string[] = [];
      persistEncounter((prev) => ({
        ...prev,
        combatants: prev.combatants.map((c) => {
          if (!msg.targetIds.includes(c.id)) return c;
          healedNames.push(c.name);
          return { ...c, hp: { ...c.hp, current: Math.min(c.hp.max, c.hp.current + msg.amount) } };
        }),
      }));
      if (healedNames.length > 0) {
        appendLog(`[LIVE] ${msg.senderName} healed ${healedNames.join(', ')} (+${msg.amount} HP via ${msg.sourceName}).`, 'info');
      }
      return;
    }

    if (msg.type === 'target_buff' && liveStatus.role === 'host') {
      persistEncounter((prev) => {
        let updated = prev;
        msg.targetIds.forEach((tid, idx) => {
          updated = applyEffectWithConcentrationCheck(updated, {
            id: `eff-live-${Date.now()}-${idx}`,
            name: msg.effectName,
            sourceCombatantId: msg.sourceCombatantId,
            targetCombatantId: tid,
            isConcentration: msg.isConcentration && idx === 0,
            expiration: msg.isConcentration ? 'concentration' : msg.durationRounds ? 'rounds_remaining' : 'indefinite',
            roundsRemaining: msg.durationRounds,
          });
        });
        return updated;
      });
      appendLog(`[LIVE] ${msg.senderName} applied ${msg.effectName} to ${msg.targetIds.length} target(s).`, 'info');
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
      const digest = JSON.stringify({
        id: encounter.id,
        round: encounter.round,
        turn: encounter.activeTurnIndex,
        combatants: encounter.combatants,
        effects: encounter.activeEffects,
        map: encounter.map,
      });
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

  const claimCombatantToken = useCallback(
    (combatantId: string) => {
      setClaimedTokenId(combatantId);
      const session = liveSessionRef.current;
      if (session && liveStatus.role !== 'idle') {
        session.broadcast({
          type: 'claim_token',
          senderId: session.senderId,
          senderName: rawChar.name,
          combatantId,
        });
      }
      appendLog(`Claimed map token "${combatantId}".`, 'info');
    },
    [liveStatus.role, rawChar.name, appendLog]
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

  const syncCampaignExternalRepo = useCallback(
    async (repoConfig?: ExternalRepoConfig, persistAsCampaignRepo = true) => {
      const cfg = repoConfig ?? campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Set an owner/repo (e.g. Solopass/my-campaign) before syncing.', 'warn');
        return;
      }
      const token = getStoredGithubPat();
      try {
        const result = await fetchCampaignPackFromGitHub(cfg, token || undefined);
        if (result.entities.length > 0) {
          await upsertCompendiumEntities(result.entities);
          setCompendium((prev) => {
            const map = new Map(prev.map((e) => [e.id, e]));
            for (const e of result.entities) map.set(e.id, e);
            return Array.from(map.values());
          });
        }
        if (result.characters.length > 0) {
          for (const ch of result.characters) {
            await saveCharacter(ch);
          }
          setCharacterList((prev) => {
            const map = new Map(prev.map((c) => [c.id, c]));
            for (const ch of result.characters) map.set(ch.id, ch);
            return Array.from(map.values());
          });
        }
        if (persistAsCampaignRepo) {
          persistCampaign((prev) => {
            const existingEntryIds = new Set(prev.entries.map((e) => e.id));
            const newEntries = result.entries.filter((e) => !existingEntryIds.has(e.id));
            return {
              ...prev,
              externalRepo: { ...cfg, lastSyncedAt: result.syncedAt },
              entries: newEntries.length > 0 ? [...newEntries, ...prev.entries] : prev.entries,
            };
          });
        }
        appendLog(
          `Synced ${cfg.owner}/${cfg.repo}: ${result.entities.length} entities, ${result.characters.length} characters, ${result.entries.length} binder entries.`,
          'info'
        );
        pushToast(`Synced ${cfg.owner}/${cfg.repo} (${result.entities.length} items, ${result.characters.length} PCs)`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Campaign repo sync failed: ${msg}`, 'warn');
        pushToast(`Sync failed: ${msg}`, 'warn');
      }
    },
    [campaign.externalRepo, persistCampaign, appendLog, pushToast]
  );

  const syncFree5ePack = useCallback(async () => {
    setFree5eSyncing(true);
    try {
      await syncCampaignExternalRepo(
        { owner: 'Solopass', repo: 'free5e', branch: 'main' },
        false
      );
      try {
        localStorage.setItem('sidereroll-free5e-autosynced', '1');
      } catch {
        // ignore
      }
    } finally {
      setFree5eSyncing(false);
    }
  }, [syncCampaignExternalRepo]);

  const pushCharacterToCampaignRepo = useCallback(
    async (character: RawCharacterState) => {
      const cfg = campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Link a Campaign Repo in DM Hub first before pushing.', 'warn');
        pushToast('Link a Campaign Repo in DM Hub first.', 'warn');
        return;
      }
      const token = getStoredGithubPat();
      if (!token) {
        appendLog('Add a GitHub Sync Token in Settings first to push from the browser.', 'warn');
        pushToast('Add a GitHub Sync Token in Settings first.', 'warn');
        return;
      }
      const slug = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || character.id;
      const filePath = `characters/${slug}.json`;
      try {
        await pushFileToGitHubRepo(
          cfg,
          filePath,
          `${JSON.stringify(character, null, 2)}\n`,
          `feat: save character ${character.name} from Sidereroll`,
          token
        );
        appendLog(`Pushed "${character.name}" -> ${cfg.owner}/${cfg.repo}/${filePath}.`, 'info');
        pushToast(`Pushed ${character.name} to ${cfg.owner}/${cfg.repo}`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Push failed: ${msg}`, 'warn');
        pushToast(`Push failed: ${msg}`, 'warn');
      }
    },
    [campaign.externalRepo, appendLog, pushToast]
  );

  const pushCampaignToRepo = useCallback(
    async (repoConfig?: ExternalRepoConfig) => {
      const cfg = repoConfig ?? campaign.externalRepo;
      if (!cfg?.owner || !cfg?.repo) {
        appendLog('Set an owner/repo in DM Hub before pushing.', 'warn');
        pushToast('Set an owner/repo in DM Hub first.', 'warn');
        return;
      }
      const token = getStoredGithubPat();
      if (!token) {
        appendLog('Add a GitHub Sync Token in Settings first to push from the browser.', 'warn');
        pushToast('Add a GitHub Sync Token in Settings first.', 'warn');
        return;
      }
      const builtinIds = new Set(BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).map((e) => e.id));
      const customOnly = compendium.filter((e) => !builtinIds.has(e.id));
      const packPath = cfg.packPath?.trim() || 'campaign-pack.json';
      try {
        const existingManifest = await tryFetchExistingManifest(cfg, token);
        const contentText = buildCampaignPackExport(campaign, customOnly, existingManifest);
        await pushFileToGitHubRepo(
          cfg,
          packPath,
          contentText,
          `feat: sync campaign pack "${campaign.name}" from Sidereroll`,
          token
        );
        const now = new Date().toISOString();
        persistCampaign((prev) => ({
          ...prev,
          externalRepo: { ...cfg, packPath, lastSyncedAt: now },
        }));
        appendLog(
          `Pushed campaign pack "${campaign.name}" (${customOnly.length} custom entities, ${campaign.entries.length} binder entries) -> ${cfg.owner}/${cfg.repo}/${packPath}.`,
          'info'
        );
        pushToast(`Pushed ${campaign.name} to ${cfg.owner}/${cfg.repo}`, 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`Push campaign pack failed: ${msg}`, 'warn');
        pushToast(`Push failed: ${msg}`, 'warn');
      }
    },
    [campaign, compendium, persistCampaign, appendLog, pushToast]
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
    sendRollRequestToPeers,
    dismissRollRequest,
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
    createHomebrewEntity,
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
    importSingleCharacter,
    liveStatus: core.liveStatus,
    claimedTokenId: core.claimedTokenId,
    claimCombatantToken,
    moveCombatantOrder: combat.moveCombatantOrder,
    hostLocalTable,
    joinLocalTable,
    createWebRtcInvite,
    acceptWebRtcInvite,
    completeWebRtcLink,
    disconnectLiveTable,
    pushEncounterToPeers,
    shareActiveCharacterToPeers,
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
    syncCampaignExternalRepo,
    syncFree5ePack,
    free5eSyncing: core.free5eSyncing,
    pushCharacterToCampaignRepo,
    pushCampaignToRepo,
    toggleItemEquipped: character.toggleItemEquipped,
    toggleItemPrepared: character.toggleItemPrepared,
    toggleItemAttuned: character.toggleItemAttuned,
    removeSheetItem: character.removeSheetItem,
    addCompendiumItemToSheet,
    installContentPack,
    importDdbPdfFile,
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
    importMarkdownHomebrew,
    importJsonFilePayload,
    searchCompendium,
  };
}
