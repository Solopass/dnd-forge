import { describe, expect, it } from 'vitest';
import { applyUiMode, readStoredUiMode, UI_MODE_STORAGE_KEY } from '../ui-mode';

describe('Dual UI Mode Persistence (Classic vs Unified)', () => {
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
});
