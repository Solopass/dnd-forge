import { BUILTIN_CONTENT_PACKS } from '../../engine/srd-packs';
import { loadCustomRepoEntities } from '../../engine/custom-content-loader';
import { db } from '../../storage/db';
import { SEED_CHARACTER } from '../seed';

let expected: Promise<number> | undefined;

/**
 * How many entries the compendium holds once the startup load has finished: the unique ids of the
 * built-in packs, the custom repo content and the seed character's items (what the store upserts
 * on a fresh start).
 * Tests wait for exactly this count so a slow machine can't make them assert or snapshot mid-load.
 */
export function expectedCompendiumSize(): Promise<number> {
  expected ??= (async () => {
    const custom = await loadCustomRepoEntities();
    // a fresh start also upserts the starting character's items (the seed character in these tests)
    const all = [...BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities), ...custom, ...SEED_CHARACTER.items];
    return new Set(all.map((e) => e.id)).size;
  })();
  return expected;
}

/** Resolves when the Dexie compendium table holds the full expected set. */
export async function waitForFullCompendiumInDb(
  waitFor: (cb: () => Promise<void>, o: { timeout: number }) => Promise<unknown>,
  timeout = 20_000
): Promise<number> {
  const size = await expectedCompendiumSize();
  await waitFor(
    async () => {
      const count = await db.compendium.count();
      if (count !== size) throw new Error(`compendium in db: ${count}, expected ${size}`);
    },
    { timeout }
  );
  return size;
}
