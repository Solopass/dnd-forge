import { useState } from 'react';
import {
  decodeCharacterShareCode,
  encodeCharacterShareCode,
  generateRoomCode,
  LivePeerInfo,
  LiveTableRole,
} from '../engine/live-sync';
import { RawCharacterState } from '../types/character';
import { ModalDialog } from './ModalDialog';

interface LiveTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCharacter: RawCharacterState;
  liveStatus: {
    role: LiveTableRole;
    roomCode: string;
    peers: LivePeerInfo[];
  };
  onHostLocalRoom: (roomCode?: string) => string;
  onJoinLocalRoom: (roomCode: string) => string;
  onCreateWebRtcInvite: () => Promise<{ peerId: string; inviteCode: string }>;
  onAcceptWebRtcInvite: (inviteCode: string) => Promise<{ peerId: string; replyCode: string }>;
  onCompleteWebRtcLink: (peerId: string, replyCode: string) => Promise<void>;
  onDisconnect: () => void;
  onPushEncounter: () => void;
  onShareCharacterToPeers: () => void;
  onImportCharacter: (char: RawCharacterState) => Promise<void>;
  onSendRollRequest?: (label: string, kind: 'check' | 'save', abilityOrSkill: string, dc?: number) => void;
  onLog: (msg: string, tone?: 'info' | 'warn') => void;
}

export function LiveTableModal({
  isOpen,
  onClose,
  activeCharacter,
  liveStatus,
  onHostLocalRoom,
  onJoinLocalRoom,
  onCreateWebRtcInvite,
  onAcceptWebRtcInvite,
  onCompleteWebRtcLink,
  onDisconnect,
  onPushEncounter,
  onShareCharacterToPeers,
  onImportCharacter,
  onSendRollRequest,
  onLog,
}: LiveTableModalProps) {
  const [tab, setTab] = useState<'local' | 'webrtc' | 'share'>('local');
  const [roomInput, setRoomInput] = useState(() => generateRoomCode());
  const [pendingPeerId, setPendingPeerId] = useState('');
  const [generatedInvite, setGeneratedInvite] = useState('');
  const [incomingInvite, setIncomingInvite] = useState('');
  const [generatedReply, setGeneratedReply] = useState('');
  const [incomingReply, setIncomingReply] = useState('');
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [copiedNotice, setCopiedNotice] = useState('');
  const [reqKind, setReqKind] = useState<'check' | 'save'>('save');
  const [reqAbilityOrSkill, setReqAbilityOrSkill] = useState('dex');
  const [reqDc, setReqDc] = useState('14');

  const shareCode = encodeCharacterShareCode(activeCharacter);

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedNotice(`Copied ${label}!`);
      setTimeout(() => setCopiedNotice(''), 2500);
    } catch {
      onLog('Clipboard write denied by browser.', 'warn');
    }
  };

  const downloadActiveCharacter = () => {
    const blob = new Blob([JSON.stringify(activeCharacter, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeCharacter.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'character'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onLog(`Exported single character "${activeCharacter.name}" (.json).`);
  };

  const handleImportCode = async () => {
    if (!shareCodeInput.trim()) return;
    try {
      const parsed = decodeCharacterShareCode(shareCodeInput);
      await onImportCharacter(parsed);
      setShareCodeInput('');
      onClose();
    } catch (err) {
      onLog(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
    }
  };

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Live Table Sync & Character Sharing">
      <div className="forge-stack">
        <div className="forge-row-between card">
          <div>
            <strong>
              Status:{' '}
              {liveStatus.role === 'idle'
                ? 'Offline (Solo Local)'
                : `${liveStatus.role.toUpperCase()} • ${liveStatus.roomCode || 'WebRTC P2P'}`}
            </strong>
            <div className="forge-muted tabular">
              Connected peers: {liveStatus.peers.length}
              {liveStatus.peers.length > 0
                ? ` (${liveStatus.peers.map((p) => p.name).join(', ')})`
                : ''}
            </div>
          </div>
          {liveStatus.role !== 'idle' && (
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              {liveStatus.role === 'host' && (
                <button type="button" className="btn btn-primary" onClick={onPushEncounter}>
                  Push Encounter
                </button>
              )}
              <button type="button" className="btn" onClick={onShareCharacterToPeers}>
                Send My Sheet
              </button>
              <button type="button" className="btn btn-danger" onClick={onDisconnect}>
                Disconnect
              </button>
            </div>
          )}
        </div>

        {liveStatus.role === 'host' && onSendRollRequest && (
          <div className="card forge-stack">
            <div className="forge-section-label">DM ROLL PROMPT (LIVE TABLE)</div>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <select
                aria-label="Roll request kind"
                className="forge-input"
                value={reqKind}
                onChange={(e) => {
                  const next = e.target.value as 'check' | 'save';
                  setReqKind(next);
                  setReqAbilityOrSkill(next === 'save' ? 'dex' : 'Perception');
                }}
                style={{ width: 115 }}
              >
                <option value="save">Saving Throw</option>
                <option value="check">Skill / Check</option>
              </select>
              <select
                aria-label="Roll request ability or skill"
                className="forge-input"
                value={reqAbilityOrSkill}
                onChange={(e) => setReqAbilityOrSkill(e.target.value)}
                style={{ flex: 1, minWidth: 140 }}
              >
                {reqKind === 'save' ? (
                  <>
                    <option value="str">Strength Save</option>
                    <option value="dex">Dexterity Save</option>
                    <option value="con">Constitution Save</option>
                    <option value="int">Intelligence Save</option>
                    <option value="wis">Wisdom Save</option>
                    <option value="cha">Charisma Save</option>
                  </>
                ) : (
                  <>
                    <option value="Perception">Perception</option>
                    <option value="Stealth">Stealth</option>
                    <option value="Investigation">Investigation</option>
                    <option value="Insight">Insight</option>
                    <option value="Athletics">Athletics</option>
                    <option value="Acrobatics">Acrobatics</option>
                    <option value="Arcana">Arcana</option>
                    <option value="Persuasion">Persuasion</option>
                  </>
                )}
              </select>
              <input
                aria-label="Roll request DC"
                type="number"
                min={1}
                max={35}
                className="forge-input tabular"
                value={reqDc}
                onChange={(e) => setReqDc(e.target.value)}
                style={{ width: 68 }}
                placeholder="DC"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const dcNum = Number.parseInt(reqDc, 10);
                  const label =
                    reqKind === 'save'
                      ? `${reqAbilityOrSkill.toUpperCase()} Saving Throw`
                      : `${reqAbilityOrSkill} Check`;
                  onSendRollRequest(label, reqKind, reqAbilityOrSkill, Number.isFinite(dcNum) ? dcNum : undefined);
                }}
              >
                Request Roll from Players
              </button>
            </div>
          </div>
        )}

        <div className="pill-row">
          <button
            type="button"
            className={`pill ${tab === 'local' ? 'active' : ''}`}
            onClick={() => setTab('local')}
          >
            Local Browser Room
          </button>
          <button
            type="button"
            className={`pill ${tab === 'webrtc' ? 'active' : ''}`}
            onClick={() => setTab('webrtc')}
          >
            Remote WebRTC (No Server)
          </button>
          <button
            type="button"
            className={`pill ${tab === 'share' ? 'active' : ''}`}
            onClick={() => setTab('share')}
          >
            Share / Export Character
          </button>
          {copiedNotice && <span className="forge-muted" style={{ color: 'var(--accent-green)' }}>{copiedNotice}</span>}
        </div>

        {tab === 'local' && (
          <div className="card forge-stack">
            <div className="forge-muted">
              Instant same-browser / second-window sync via <code>BroadcastChannel</code>. Open Sidereroll in another tab on the same device and join with the same room code to sync rolls, encounters, and HP live.
            </div>
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <label className="forge-row" style={{ flex: 1 }}>
                <span className="forge-label">ROOM CODE</span>
                <input
                  aria-label="Live room code"
                  type="text"
                  className="forge-input tabular"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  placeholder="FORGE-A7K2"
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const code = onHostLocalRoom(roomInput);
                  setRoomInput(code);
                }}
              >
                Host Room (DM)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const code = onJoinLocalRoom(roomInput);
                  setRoomInput(code);
                }}
              >
                Join Room (Player)
              </button>
            </div>
          </div>
        )}

        {tab === 'webrtc' && (
          <div className="card forge-stack">
            <div className="forge-muted">
              Serverless peer-to-peer connection across devices. DM generates an Invite Code, sends it over Discord/chat, player generates a Reply Code back, and DM clicks Link Peer.
            </div>
            <div className="forge-grid-2">
              <div className="forge-stack">
                <div className="forge-section-label">DM HOST STEP</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      const res = await onCreateWebRtcInvite();
                      setPendingPeerId(res.peerId);
                      setGeneratedInvite(res.inviteCode);
                    } catch (err) {
                      onLog(`WebRTC error: ${err instanceof Error ? err.message : String(err)}`, 'warn');
                    }
                  }}
                >
                  1. Create WebRTC Invite Code
                </button>
                {generatedInvite && (
                  <>
                    <textarea readOnly rows={3} className="forge-input" value={generatedInvite} />
                    <button type="button" className="btn" onClick={() => void copyText('Invite Code', generatedInvite)}>
                      Copy Invite Code
                    </button>
                  </>
                )}
                <textarea
                  rows={2}
                  className="forge-input"
                  value={incomingReply}
                  onChange={(e) => setIncomingReply(e.target.value)}
                  placeholder="2. Paste Player Reply Code (DFA1:...)"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!pendingPeerId || !incomingReply.trim()}
                  onClick={async () => {
                    try {
                      await onCompleteWebRtcLink(pendingPeerId, incomingReply);
                      setIncomingReply('');
                    } catch (err) {
                      onLog(`Link failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
                    }
                  }}
                >
                  3. Link Peer
                </button>
              </div>

              <div className="forge-stack">
                <div className="forge-section-label">PLAYER JOIN STEP</div>
                <textarea
                  rows={3}
                  className="forge-input"
                  value={incomingInvite}
                  onChange={(e) => setIncomingInvite(e.target.value)}
                  placeholder="Paste DM Invite Code (DFO1:...)"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!incomingInvite.trim()}
                  onClick={async () => {
                    try {
                      const res = await onAcceptWebRtcInvite(incomingInvite);
                      setGeneratedReply(res.replyCode);
                    } catch (err) {
                      onLog(`Accept failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
                    }
                  }}
                >
                  Accept Invite &amp; Generate Reply
                </button>
                {generatedReply && (
                  <>
                    <textarea readOnly rows={3} className="forge-input" value={generatedReply} />
                    <button type="button" className="btn" onClick={() => void copyText('Reply Code', generatedReply)}>
                      Copy Reply Code for DM
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'share' && (
          <div className="card forge-stack">
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={downloadActiveCharacter}>
                Download {activeCharacter.name} (.json)
              </button>
              <button type="button" className="btn" onClick={() => void copyText('Share Code', shareCode)}>
                Copy Share Code (DFC1)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const baseUrl = `${window.location.origin}${window.location.pathname}`;
                  void copyText('Shareable Link', `${baseUrl}#char=${shareCode}`);
                }}
              >
                Copy Direct Share URL
              </button>
            </div>

            <label className="forge-field">
              <span className="forge-label">IMPORT SINGLE CHARACTER JSON FILE</span>
              <input
                aria-label="Import single character JSON file"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const parsed = JSON.parse(text) as RawCharacterState;
                    if (!parsed?.name || !Array.isArray(parsed.classes)) {
                      throw new Error('Not a valid single character export.');
                    }
                    await onImportCharacter(parsed);
                    onClose();
                  } catch (err) {
                    onLog(`Character JSON import failed: ${err instanceof Error ? err.message : String(err)}`, 'warn');
                  }
                }}
              />
            </label>

            <div className="forge-stack">
              <textarea
                rows={3}
                className="forge-input"
                value={shareCodeInput}
                onChange={(e) => setShareCodeInput(e.target.value)}
                placeholder="Paste a DFC1:... share code or full #char=... link here"
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!shareCodeInput.trim()}
                onClick={() => void handleImportCode()}
              >
                Import Character Share Code
              </button>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
