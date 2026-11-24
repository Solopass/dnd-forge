import { describe, expect, it } from 'vitest';
import { applyUiMode, readStoredUiMode, UI_MODE_STORAGE_KEY } from '../ui-mode';
import { BUILTIN_MAP_PRESETS } from '../map-presets';

describe('Dual UI Mode Persistence & Map Presets', () => {
  it('defaults to classic mode and persists classic/unified toggles safely', () => {
    const store = new Map<string, string>();
    const prevStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });

    try {
      expect(readStoredUiMode()).toBe('classic');
      applyUiMode('unified');
      expect(store.get(UI_MODE_STORAGE_KEY)).toBe('unified');
      expect(readStoredUiMode()).toBe('unified');
      applyUiMode('classic');
      expect(readStoredUiMode()).toBe('classic');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: prevStorage,
      });
    }
  });

  it('provides built-in SVG data-URI battlemap presets', () => {
    expect(BUILTIN_MAP_PRESETS).toHaveLength(3);
    for (const preset of BUILTIN_MAP_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(2);
      expect(preset.dataUrl.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    }
  });
});
