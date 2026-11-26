import { useCallback, useEffect } from 'react';
import { MapPingEvent } from '../../types/combat';
import { computeVisibleCells } from '../../engine/vtt-vision';
import { applyEffectWithConcentrationCheck } from '../../engine/combat-machine';
import { decodeCharacterShareCode, LiveTableMessage, LiveTableSession } from '../../engine/live-sync';
import { playTableSound } from '../../engine/sound';
import { tabletopSoundboard } from '../../engine/soundboard';
import { saveContentFix, saveEncounter } from '../../storage/db';
import { parseFixesFile } from '../../engine/content-fixes';
import { parseTablePacks, toTablePacks } from '../../engine/campaign-packs';
import type { StoreCore } from './core';
import type { useContentImportActions } from './content-import';
import type { useCombatActions } from './combat';

export type LiveTableDeps = Pick<ReturnType<typeof useContentImportActions>, 'importSingleCharacter' | 'syncTablePacks'> & Pick<ReturnType<typeof useCombatActions>, 'targetAttackCombatants' | 'targetSaveCombatants'>;

export function useLiveTableActions(core: StoreCore, deps: LiveTableDeps) {
  const {
    onRemoteMessageRef,
    appendLog,
    pushToast,
    liveStatus,
    isApplyingRemoteRef,
    setEncounter,
    setEncounterList,
    setClaimedTokenId,
    rawChar,
    persistEncounter,
    setActivePings,
    setActiveSharedHandout,
    setPendingRollRequest,
    setInitiativeAlert,
    persistCampaign,
    liveSessionRef,
    setLiveStatus,
    rawCharRef,
    encounterRef,
    encounter,
    lastBroadcastDigestRef,
    resolvedSheet,
    compendium,
    contentFixes,
    setContentFixes,
    campaign,
  } = core;
  const { importSingleCharacter, syncTablePacks, targetAttackCombatants, targetSaveCombatants } = deps;

  /** Host: tells the table which packs (enabled and pinned only) this campaign uses. Players' own packs are never sent. */
  const sendCampaignPacks = (onlyIfAny: boolean) => {
    const session = liveSessionRef.current;
    if (!session || liveStatus.role !== 'host') return;
    const packs = toTablePacks(campaign.packs);
    if (onlyIfAny && packs.length === 0) return;
    session.broadcast({ type: 'campaign_packs', senderId: session.senderId, senderName: rawChar.name, campaignId: campaign.id, packs });
  };

  onRemoteMessageRef.current = (msg: LiveTableMessage) => {
    if (msg.type === 'hello') {
      // a player joined: hand them the campaign's pack list
      if (msg.role === 'player') sendCampaignPacks(true);
      return;
    }

    if (msg.type === 'campaign_packs') {
      if (liveStatus.role !== 'player') return;
      const wanted = parseTablePacks(msg.packs);
      if (wanted.length === 0) return;
      appendLog(`[LIVE] ${msg.senderName} sent ${wanted.length} campaign pack${wanted.length === 1 ? '' : 's'}.`, 'info');
      void syncTablePacks(wanted, String(msg.campaignId ?? ''));
      return;
    }

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

    if (msg.type === 'content_fix_proposed' && liveStatus.role === 'host') {
      if (contentFixes.some((f) => f.id === msg.fix?.id)) return;
      const { fixes } = parseFixesFile([msg.fix], new Set(contentFixes.map((f) => f.id)));
      const fix = fixes[0];
      const entry = fix ? compendium.find((e) => e.id === fix.entityId) : undefined;
      if (!fix || !entry) {
        appendLog(`[LIVE] Ignored a fix from ${msg.senderName} (unknown entry or malformed).`, 'warn');
        return;
      }
      void saveContentFix(fix).then(() => setContentFixes((prev) => [...prev.filter((f) => f.id !== fix.id), fix]));
      appendLog(`[LIVE] ${msg.senderName} proposed a fix for "${entry.name}": ${fix.note}`, 'info');
      pushToast(`${msg.senderName} proposed a fix for ${entry.name}`, 'info');
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

  // host: the DM changed the campaign's pack list (link, update, enable, remove) -> tell the table
  const tablePacksDigest = JSON.stringify(toTablePacks(campaign.packs));
  useEffect(() => {
    if (liveStatus.role !== 'host') return;
    sendCampaignPacks(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStatus.role, tablePacksDigest]);

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
    ensureLiveSession,
    refreshLiveStatus,
    hostLocalTable,
    joinLocalTable,
    createWebRtcInvite,
    acceptWebRtcInvite,
    completeWebRtcLink,
    disconnectLiveTable,
    pushEncounterToPeers,
    shareActiveCharacterToPeers,
    claimCombatantToken,
    sendRollRequestToPeers,
    dismissRollRequest,
  };
}
