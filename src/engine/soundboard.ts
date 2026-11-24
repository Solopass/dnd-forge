export type AmbientPresetId = 'tavern' | 'rain' | 'dungeon' | 'battle';

export type SfxPresetId = 'sword' | 'fireball' | 'thunder' | 'door' | 'fanfare' | 'coins' | 'initiative';

const CUSTOM_INITIATIVE_SFX_KEY = 'sidereroll-initiative-sfx-url';

export function getCustomInitiativeSoundUrl(): string {
  try {
    return localStorage.getItem(CUSTOM_INITIATIVE_SFX_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCustomInitiativeSoundUrl(url: string): void {
  try {
    const clean = url.trim();
    if (clean) {
      localStorage.setItem(CUSTOM_INITIATIVE_SFX_KEY, clean);
    } else {
      localStorage.removeItem(CUSTOM_INITIATIVE_SFX_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

class TabletopSoundboard {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private activeNodes: AudioNode[] = [];
  private activeLoopId: AmbientPresetId | null = null;
  private volume = 0.35;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    this.ctx ??= new Ctor();
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  getActiveLoop(): AmbientPresetId | null {
    return this.activeLoopId;
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(next: number): void {
    this.volume = Math.max(0, Math.min(1, next));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
  }

  stopAmbient(): void {
    for (const node of this.activeNodes) {
      try {
        if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
          (node as AudioScheduledSourceNode).stop();
        }
        node.disconnect();
      } catch {
        // ignore already-stopped audio nodes
      }
    }
    this.activeNodes = [];
    this.activeLoopId = null;
  }

  toggleAmbient(preset: AmbientPresetId): AmbientPresetId | null {
    if (this.activeLoopId === preset) {
      this.stopAmbient();
      return null;
    }
    this.stopAmbient();
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) {
      this.activeLoopId = preset;
      return preset;
    }

    try {
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = output[i]!;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      const loopGain = ctx.createGain();

      if (preset === 'rain') {
        filter.type = 'bandpass';
        filter.frequency.value = 1400;
        filter.Q.value = 0.7;
        loopGain.gain.value = 0.45;
      } else if (preset === 'tavern') {
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        loopGain.gain.value = 0.35;
      } else if (preset === 'dungeon') {
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        loopGain.gain.value = 0.4;
      } else {
        filter.type = 'bandpass';
        filter.frequency.value = 260;
        loopGain.gain.value = 0.35;
      }

      noise.connect(filter);
      filter.connect(loopGain);
      loopGain.connect(this.masterGain);
      noise.start();
      this.activeNodes.push(noise, filter, loopGain);

      if (preset === 'dungeon' || preset === 'battle') {
        const drone = ctx.createOscillator();
        const droneGain = ctx.createGain();
        drone.type = preset === 'battle' ? 'sawtooth' : 'sine';
        drone.frequency.value = preset === 'battle' ? 73.42 : 55;
        droneGain.gain.value = preset === 'battle' ? 0.07 : 0.09;
        drone.connect(droneGain);
        droneGain.connect(this.masterGain);
        drone.start();
        this.activeNodes.push(drone, droneGain);
      }
    } catch {
      // ignore headless/blocked Web Audio
    }

    this.activeLoopId = preset;
    return preset;
  }

  playSfx(sfx: SfxPresetId): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    try {
      const now = ctx.currentTime;
      const tone = (freq: number, offset: number, dur: number, type: OscillatorType, peak: number) => {
        if (!this.masterGain) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + offset);
        g.gain.setValueAtTime(0.0001, now + offset);
        g.gain.exponentialRampToValueAtTime(peak, now + offset + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + dur);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(now + offset);
        osc.stop(now + offset + dur + 0.03);
      };

      if (sfx === 'sword') {
        tone(1100, 0, 0.08, 'sawtooth', 0.2);
        tone(740, 0.03, 0.14, 'triangle', 0.15);
      } else if (sfx === 'fireball') {
        tone(140, 0, 0.45, 'sawtooth', 0.25);
        tone(85, 0.08, 0.55, 'triangle', 0.25);
      } else if (sfx === 'thunder') {
        tone(95, 0, 0.65, 'sawtooth', 0.3);
        tone(55, 0.15, 0.7, 'sine', 0.3);
      } else if (sfx === 'door') {
        tone(190, 0, 0.24, 'sawtooth', 0.12);
        tone(165, 0.18, 0.22, 'sawtooth', 0.1);
      } else if (sfx === 'coins') {
        tone(1567.98, 0, 0.09, 'sine', 0.18);
        tone(2093, 0.06, 0.12, 'sine', 0.18);
      } else if (sfx === 'initiative') {
        tone(293.66, 0, 0.14, 'sawtooth', 0.18);
        tone(440, 0.11, 0.16, 'sawtooth', 0.2);
        tone(587.33, 0.22, 0.42, 'triangle', 0.24);
      } else {
        tone(523.25, 0, 0.15, 'triangle', 0.18);
        tone(659.25, 0.12, 0.15, 'triangle', 0.18);
        tone(783.99, 0.24, 0.32, 'triangle', 0.22);
      }
    } catch {
      // ignore audio restrictions
    }
  }

  playInitiativeAlertSound(overrideUrl?: string): void {
    const url = (overrideUrl ?? getCustomInitiativeSoundUrl()).trim();
    if (url && typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(url);
        audio.volume = Math.max(0.1, Math.min(1, this.volume));
        void audio.play().catch(() => {
          this.playSfx('initiative');
        });
        return;
      } catch {
        // fallback to synth horn
      }
    }
    this.playSfx('initiative');
  }
}

export const tabletopSoundboard = new TabletopSoundboard();
