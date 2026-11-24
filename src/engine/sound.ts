const SOUND_STORAGE_KEY = 'dnd-forge-sound';

let audioCtx: AudioContext | null = null;

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // ignore storage failures
  }
}

export function playTableSound(kind: 'roll' | 'crit' | 'fumble' | 'heal', force = false): void {
  if (!force && !isSoundEnabled()) return;
  if (typeof window === 'undefined') return;
  const Ctor = window.AudioContext;
  if (!Ctor) return;

  try {
    audioCtx ??= new Ctor();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    const playTone = (freq: number, startOffset: number, duration: number, type: OscillatorType = 'triangle', gainPeak = 0.08) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(gainPeak, now + startOffset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    if (kind === 'crit') {
      playTone(523.25, 0, 0.14, 'triangle', 0.09);
      playTone(659.25, 0.08, 0.14, 'triangle', 0.09);
      playTone(783.99, 0.16, 0.24, 'triangle', 0.1);
    } else if (kind === 'fumble') {
      playTone(220, 0, 0.18, 'sawtooth', 0.05);
      playTone(164.81, 0.12, 0.24, 'sawtooth', 0.05);
    } else if (kind === 'heal') {
      playTone(440, 0, 0.14, 'sine', 0.07);
      playTone(554.37, 0.09, 0.18, 'sine', 0.07);
    } else {
      playTone(360, 0, 0.08, 'triangle', 0.06);
      playTone(480, 0.05, 0.09, 'triangle', 0.05);
    }
  } catch {
    // ignore Web Audio autoplay/device restrictions
  }
}
