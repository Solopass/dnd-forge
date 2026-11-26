// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LiveTableModal, LIVE_TAB_STORAGE_KEY } from '../LiveTableModal';
import { SEED_CHARACTER } from '../../state/seed';
import { installDialogPolyfill } from './dialogPolyfill';

installDialogPolyfill();

function modal() {
  return (
    <LiveTableModal
      isOpen
      onClose={() => {}}
      activeCharacter={SEED_CHARACTER}
      liveStatus={{ role: 'idle', roomCode: '', peers: [] }}
      onHostLocalRoom={(c) => c ?? ''}
      onJoinLocalRoom={(c) => c}
      onCreateWebRtcInvite={async () => ({ peerId: 'p', inviteCode: 'DFO1:x' })}
      onAcceptWebRtcInvite={async () => ({ peerId: 'p', replyCode: 'DFA1:x' })}
      onCompleteWebRtcLink={async () => {}}
      onDisconnect={() => {}}
      onPushEncounter={() => {}}
      onShareCharacterToPeers={() => {}}
      onImportCharacter={async () => {}}
      onLog={() => {}}
    />
  );
}

describe('Live Table dialog (audit L1)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('opens on the cross-device tab with numbered host and player steps', () => {
    render(modal());
    expect(screen.getByRole('button', { name: 'Remote WebRTC (No Server)' }).className).toContain('active');
    expect(screen.getByRole('button', { name: 'Same computer (testing)' })).toBeTruthy();
    expect(screen.getByLabelText('Host steps').querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByLabelText('Player steps').querySelectorAll('li')).toHaveLength(4);
  });

  it('remembers the last tab used', () => {
    const first = render(modal());
    fireEvent.click(screen.getByRole('button', { name: 'Same computer (testing)' }));
    expect(localStorage.getItem(LIVE_TAB_STORAGE_KEY)).toBe('local');
    first.unmount();
    render(modal());
    expect(screen.getByRole('button', { name: 'Same computer (testing)' }).className).toContain('active');
  });
});
