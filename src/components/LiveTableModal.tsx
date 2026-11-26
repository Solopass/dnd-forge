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

type LiveTab = 'local' | 'webrtc' | 'share';
export const LIVE_TAB_STORAGE_KEY = 'dnd-forge-live-table-tab';

/** Cross-device (WebRTC) is the default: laptops at a table are on different devices. */
function readStoredLiveTab(): LiveTab {
  try {
    const v = localStorage.getItem(LIVE_TAB_STORAGE_KEY);
    if (v === 'local' || v === 'webrtc' || v === 'share') return v;
  } catch {
    // best effort: fall back to the default
  }
  return 'webrtc';
}

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
  pcTokens?: Array<{ id: string; name: string }>;
  claimedTokenId?: string | null;
  onClaimToken?: (combatantId: string) => void;
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
  pcTokens = [],
  claimedTokenId,
  onClaimToken,
  onLog,
}: LiveTableModalProps) {
  const [tab, setTabState] = useState<LiveTab>(readStoredLiveTab);
  const setTab = (next: LiveTab) => {
    setTabState(next);
    try {
      localStorage.setItem(LIVE_TAB_STORAGE_KEY, next);
    } catch {
      // best effort
    }
  };
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
            <div className="forge-row wrap">
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

        {liveStatus.role === 'player' && onClaimToken && pcTokens.length > 0 && (
          <div className="card forge-row-between wrap gap-3">
            <div>
              <div className="forge-section-label">CLAIM MY BATTLEMAP TOKEN</div>
              <div className="forge-muted text-sm">
                Select which PC token on the Battlemap you control.
              </div>
            </div>
            <select
              aria-label="Claim battlemap token"
              className="forge-input"
              value={claimedTokenId ?? activeCharacter.id}
              onChange={(e) => onClaimToken(e.target.value)}
            >
              {pcTokens.map((pc) => (
                <option key={pc.id} value={pc.id}>
                  {pc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {liveStatus.role === 'host' && onSendRollRequest && (
          <div className="card forge-stack">
            <div className="forge-section-label">DM ROLL PROMPT (LIVE TABLE)</div>
            <div className="forge-row wrap">
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
            Same computer (testing)
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
              For testing on one computer only: instant sync between tabs or windows of this browser via <code>BroadcastChannel</code>. It does not reach other devices; use the Remote WebRTC tab for that. Open Sidereroll in another tab and join with the same room code.
            </div>
            <div className="forge-row wrap">
              <label className="forge-row flex-1">
                <span className="forge-label">ROOM CODE</span>
                <input
                  aria-label="Live room code"
                  type="text"
                  className="forge-input tabular"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                  placeholder="SIDE-A7K2"
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
              Serverless peer-to-peer link between two devices on different computers. No account or server is needed; you swap two codes by chat.
            </div>
            <div className="forge-grid-2">
              <div className="forge-stack">
                <div className="forge-section-label">HOW TO: DM (HOST)</div>
                <ol className="forge-muted" aria-label="Host steps">
                  <li>Click &quot;1. Create WebRTC Invite Code&quot; and copy the invite.</li>
                  <li>Send it to your player (Discord, text, anything).</li>
                  <li>Paste the player&apos;s reply code below and click &quot;3. Link Peer&quot;.</li>
                  <li>Done: the status at the top shows the connected peer.</li>
                </ol>
              </div>
              <div className="forge-stack">
                <div className="forge-section-label">HOW TO: PLAYER</div>
                <ol className="forge-muted" aria-label="Player steps">
                  <li>Paste the DM&apos;s invite code on the right.</li>
                  <li>Click &quot;Accept Invite &amp; Generate Reply&quot; and copy the reply.</li>
                  <li>Send the reply code back to the DM.</li>
                  <li>Done once the DM links you: the status shows PLAYER.</li>
                </ol>
              </div>
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
            <div className="forge-row wrap">
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
