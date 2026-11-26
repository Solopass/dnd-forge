import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useSheetStore } from '../useSheetStore';
import { SEED_CHARACTER, SEED_ENCOUNTER } from '../seed';
import { db } from '../../storage/db';
import { expectedCompendiumSize } from './compendiumReady';

/** Shared setup for store-level tests: a fresh fake-indexeddb, the store hook, and its startup load finished. */
export async function setupStore() {
  const size = await expectedCompendiumSize();
  const hook = renderHook(() => useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER));
  await waitFor(
    async () => {
      expect(await db.compendium.count()).toBe(size);
      expect(hook.result.current.compendium.length).toBe(size);
      expect(hook.result.current.encounterList.length).toBeGreaterThan(0);
    },
    { timeout: 20_000 }
  );
  return hook;
}

export type StoreHook = Awaited<ReturnType<typeof setupStore>>;

export function logTexts(h: StoreHook): string[] {
  return h.result.current.consoleLines.map((l) => l.text);
}

/** Registers the beforeEach/afterEach that reset the database and storage around every test. */
export function useFreshDatabase() {
  vi.setConfig({ testTimeout: 30_000 });
  beforeEach(async () => {
    localStorage.setItem('sidereroll-free5e-autosynced', '1');
    await db.delete();
    await db.open();
  });
  afterEach(async () => {
    cleanup();
    await db.transaction('rw', db.tables, () => undefined);
    localStorage.clear();
    vi.restoreAllMocks();
  });
}
