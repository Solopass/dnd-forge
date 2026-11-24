import { RawCharacterState } from '../types/character';
import { CombatEncounterState } from '../types/combat';
import { Activity } from '../types/compendium';
import { WeaponMastery } from '../types/core';

export type LiveTableRole = 'idle' | 'host' | 'player';

export interface LivePeerInfo {
  id: string;
  name: string;
  transport: 'local' | 'webrtc';
}

export type LiveTableMessage =
  | {
      type: 'hello';
      senderId: string;
      senderName: string;
      role: 'host' | 'player';
    }
  | {
      type: 'roll';
      senderId: string;
      senderName: string;
      text: string;
      tone: 'roll' | 'crit' | 'info' | 'warn';
      timestamp: number;
    }
  | {
      type: 'encounter_state';
      senderId: string;
      senderName: string;
      encounter: CombatEncounterState;
    }
  | {
      type: 'player_sync';
      senderId: string;
      senderName: string;
      characterId: string;
      hp: RawCharacterState['hp'];
      ac: number;
      conditions: string[];
      initiative?: number;
    }
  | {
      type: 'character_share';
      senderId: string;
      senderName: string;
      character: RawCharacterState;
    }
  | {
      type: 'ping';
      senderId: string;
      senderName: string;
      x: number;
      y: number;
      color: string;
      timestamp: number;
    }
  | {
      type: 'handout_show';
      senderId: string;
      senderName: string;
      id: string;
      title: string;
      summary: string;
      body: string;
      imageDataUrl?: string;
    }
  | {
      type: 'handout_hide';
      senderId: string;
    }
  | {
      type: 'roll_request';
      senderId: string;
      senderName: string;
      id: string;
      label: string;
      kind: 'check' | 'save';
      abilityOrSkill: string;
      dc?: number;
    }
  | {
      type: 'token_move';
      senderId: string;
      senderName: string;
      combatantId: string;
      x: number;
      y: number;
    }
  | {
      type: 'target_attack';
      senderId: string;
      senderName: string;
      attackerName: string;
      targetIds: string[];
      activity: Activity;
      customBonus?: number;
      weaponMastery?: WeaponMastery;
      attackerAbilityMod?: number;
    }
  | {
      type: 'target_save';
      senderId: string;
      senderName: string;
      attackerName: string;
      targetIds: string[];
      activity: Activity;
      explicitDc?: number;
    }
  | {
      type: 'claim_token';
      senderId: string;
      senderName: string;
      combatantId: string;
    };

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)] ?? 'X';
  }
  return `SIDE-${suffix}`;
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeCharacterShareCode(character: RawCharacterState): string {
  return `DFC1:${toBase64Url(JSON.stringify(character))}`;
}

export function isValidRawCharacter(value: unknown): value is RawCharacterState {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Partial<RawCharacterState>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.classes) &&
    typeof obj.baseAbilities === 'object' &&
    obj.baseAbilities !== null &&
    typeof obj.hp === 'object' &&
    obj.hp !== null
  );
}

export function decodeCharacterShareCode(rawInput: string): RawCharacterState {
  const trimmed = rawInput.trim();
  const hashIdx = trimmed.indexOf('#char=');
  const code = hashIdx >= 0 ? trimmed.slice(hashIdx + 6) : trimmed;
  const payload = code.startsWith('DFC1:') ? code.slice(5) : code;
  const parsed: unknown = JSON.parse(fromBase64Url(payload));
  if (!isValidRawCharacter(parsed)) {
    throw new Error('Invalid character share code payload.');
  }
  return parsed;
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }, timeoutMs);
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

interface SignalPayload {
  sdp: RTCSessionDescriptionInit;
  senderId: string;
  senderName: string;
}

export class LiveTableSession {
  readonly senderId: string;
  private role: LiveTableRole = 'idle';
  private roomCode = '';
  private displayName = 'Adventurer';
  private bc: BroadcastChannel | null = null;
  private peerConnections = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel | null; name: string }>();
  private peers = new Map<string, LivePeerInfo>();
  private onMessageCb: (msg: LiveTableMessage) => void;
  private onPeersChangeCb: (peers: LivePeerInfo[]) => void;

  constructor(
    onMessage: (msg: LiveTableMessage) => void,
    onPeersChange: (peers: LivePeerInfo[]) => void
  ) {
    this.senderId = `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.onMessageCb = onMessage;
    this.onPeersChangeCb = onPeersChange;
  }

  getState(): { role: LiveTableRole; roomCode: string; peers: LivePeerInfo[] } {
    return {
      role: this.role,
      roomCode: this.roomCode,
      peers: Array.from(this.peers.values()),
    };
  }

  private emitPeers() {
    this.onPeersChangeCb(Array.from(this.peers.values()));
  }

  private handleIncomingRaw(data: unknown) {
    if (typeof data !== 'object' || data === null) return;
    const msg = data as Partial<LiveTableMessage>;
    if (!msg.senderId || msg.senderId === this.senderId || !msg.type) return;

    if (msg.type === 'hello' && typeof msg.senderName === 'string') {
      const existing = this.peers.get(msg.senderId);
      if (!existing) {
        this.peers.set(msg.senderId, {
          id: msg.senderId,
          name: msg.senderName,
          transport: 'local',
        });
        this.emitPeers();
        // Reply with our own hello so joining peers immediately see host/others
        this.broadcast({
          type: 'hello',
          senderId: this.senderId,
          senderName: this.displayName,
          role: this.role === 'host' ? 'host' : 'player',
        });
      }
    }

    this.onMessageCb(msg as LiveTableMessage);
  }

  startLocalRoom(role: 'host' | 'player', roomCode: string, displayName: string): string {
    this.disconnect();
    const cleanCode = roomCode.trim().toUpperCase() || generateRoomCode();
    this.role = role;
    this.roomCode = cleanCode;
    this.displayName = displayName.trim() || (role === 'host' ? 'DM Host' : 'Player');

    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(`dnd-forge-room-${cleanCode}`);
      channel.onmessage = (ev: MessageEvent) => {
        this.handleIncomingRaw(ev.data);
      };
      this.bc = channel;
      this.broadcast({
        type: 'hello',
        senderId: this.senderId,
        senderName: this.displayName,
        role,
      });
    }
    this.emitPeers();
    return cleanCode;
  }

  private attachDataChannel(peerId: string, dc: RTCDataChannel, peerName: string) {
    const entry = this.peerConnections.get(peerId);
    if (entry) entry.dc = dc;

    dc.onopen = () => {
      this.peers.set(peerId, { id: peerId, name: peerName, transport: 'webrtc' });
      this.emitPeers();
      try {
        dc.send(
          JSON.stringify({
            type: 'hello',
            senderId: this.senderId,
            senderName: this.displayName,
            role: this.role === 'host' ? 'host' : 'player',
          } satisfies LiveTableMessage)
        );
      } catch {
        // ignore transient open failure
      }
    };

    dc.onmessage = (ev: MessageEvent<string>) => {
      try {
        const parsed: unknown = JSON.parse(ev.data);
        this.handleIncomingRaw(parsed);
      } catch {
        // ignore malformed message
      }
    };

    dc.onclose = () => {
      this.peers.delete(peerId);
      this.emitPeers();
    };
  }

  async createWebRtcInvite(displayName: string): Promise<{ peerId: string; inviteCode: string }> {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC RTCPeerConnection is not supported in this browser.');
    }
    if (this.role === 'idle') this.role = 'host';
    this.displayName = displayName.trim() || 'DM Host';

    const peerId = `rtc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const dc = pc.createDataChannel('dnd-forge');
    this.peerConnections.set(peerId, { pc, dc, name: 'Remote Player' });
    this.attachDataChannel(peerId, dc, 'Remote Player');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    if (!pc.localDescription) {
      throw new Error('Failed to gather WebRTC offer SDP.');
    }
    const payload: SignalPayload = {
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      senderId: this.senderId,
      senderName: this.displayName,
    };
    return { peerId, inviteCode: `DFO1:${toBase64Url(JSON.stringify(payload))}` };
  }

  async acceptWebRtcInvite(
    inviteCode: string,
    displayName: string
  ): Promise<{ peerId: string; replyCode: string }> {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC RTCPeerConnection is not supported in this browser.');
    }
    const clean = inviteCode.trim();
    const body = clean.startsWith('DFO1:') ? clean.slice(5) : clean;
    const decoded = JSON.parse(fromBase64Url(body)) as SignalPayload;
    if (!decoded.sdp?.sdp) throw new Error('Invalid WebRTC invite code.');

    if (this.role === 'idle') this.role = 'player';
    this.displayName = displayName.trim() || 'Remote Player';

    const peerId = decoded.senderId || `rtc-${Date.now().toString(36)}`;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const peerName = decoded.senderName || 'DM Host';
    this.peerConnections.set(peerId, { pc, dc: null, name: peerName });

    pc.ondatachannel = (ev: RTCDataChannelEvent) => {
      this.attachDataChannel(peerId, ev.channel, peerName);
    };

    await pc.setRemoteDescription(decoded.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);

    if (!pc.localDescription) {
      throw new Error('Failed to gather WebRTC answer SDP.');
    }
    const replyPayload: SignalPayload = {
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      senderId: this.senderId,
      senderName: this.displayName,
    };
    return { peerId, replyCode: `DFA1:${toBase64Url(JSON.stringify(replyPayload))}` };
  }

  async completeWebRtcLink(peerId: string, replyCode: string): Promise<void> {
    const entry = this.peerConnections.get(peerId);
    if (!entry) throw new Error('No matching pending WebRTC invite found.');
    const clean = replyCode.trim();
    const body = clean.startsWith('DFA1:') ? clean.slice(5) : clean;
    const decoded = JSON.parse(fromBase64Url(body)) as SignalPayload;
    if (!decoded.sdp?.sdp) throw new Error('Invalid WebRTC reply code.');

    if (decoded.senderName) {
      entry.name = decoded.senderName;
    }
    await entry.pc.setRemoteDescription(decoded.sdp);
  }

  broadcast(msg: LiveTableMessage) {
    if (this.bc) {
      try {
        this.bc.postMessage(msg);
      } catch {
        // ignore channel send errors
      }
    }
    const serialized = JSON.stringify(msg);
    for (const { dc } of this.peerConnections.values()) {
      if (dc && dc.readyState === 'open') {
        try {
          dc.send(serialized);
        } catch {
          // ignore open channel write failure
        }
      }
    }
  }

  disconnect() {
    if (this.bc) {
      this.bc.close();
      this.bc = null;
    }
    for (const { pc, dc } of this.peerConnections.values()) {
      try {
        dc?.close();
        pc.close();
      } catch {
        // ignore
      }
    }
    this.peerConnections.clear();
    this.peers.clear();
    this.role = 'idle';
    this.roomCode = '';
    this.emitPeers();
  }
}
