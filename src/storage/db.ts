import Dexie, { Table } from 'dexie';
import { CampaignRecord } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CompendiumEntity } from '../types/compendium';
import { BattlemapScene, CombatEncounterState } from '../types/combat';
import type { DuplicateDecision } from '../engine/compendium-dedupe';
import type { ContentFix } from '../types/content-fix';
import type { InstalledPack } from '../types/pack';

export const CURRENT_SCHEMA_VERSION = 6;

export interface IndexedCompendiumRecord extends CompendiumEntity {
  searchTokens: string;
}

export interface BackupBundle {
  app: 'dnd-forge';
  schemaVersion: number;
  exportedAt: string;
  characters: RawCharacterState[];
  compendium: CompendiumEntity[];
  encounters: CombatEncounterState[];
  campaigns?: CampaignRecord[];
  scenes?: BattlemapScene[];
  dupDecisions?: DuplicateDecision[];
  contentFixes?: ContentFix[];
  packs?: InstalledPack[];
}

export function normalizeSearchQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\{@\w+\s+([^}]+)\}/g, '$1')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchTokens(entity: CompendiumEntity): string {
  return normalizeSearchQuery(
    `${entity.name} ${entity.category} ${entity.source} ${entity.ruleset} ${entity.entries.join(' ')}`
  );
}

export class DndForgeDatabase extends Dexie {
  characters!: Table<RawCharacterState, string>;
  compendium!: Table<IndexedCompendiumRecord, string>;
  encounters!: Table<CombatEncounterState, string>;
  campaigns!: Table<CampaignRecord, string>;
  scenes!: Table<BattlemapScene, string>;
  dupDecisions!: Table<DuplicateDecision, string>;
  contentFixes!: Table<ContentFix, string>;
  packs!: Table<InstalledPack, string>;

  constructor() {
    super('dnd-forge-local-db');

    this.version(1).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
    });

    this.version(2).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
    });

    this.version(3).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
    });

    // v4: the Duplicates review decisions. Existing tables are untouched, so no data migration is needed.
    this.version(4).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
      dupDecisions: 'id',
    });

    // v5: content fixes (reviewable corrections to compendium entries), a separate layer so that
    // re-imports and resyncs never touch them. Only a new table; every existing record is kept.
    this.version(5).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
      dupDecisions: 'id',
      contentFixes: 'id, entityId, status',
    });

    // v6: installed packs (a `packs` table) and a `packId` index on the compendium. Nothing is removed.
    // Entries that older Free5e syncs wrote (ids `free5e-*`) get stamped as belonging to the `free5e` pack.
    this.version(CURRENT_SCHEMA_VERSION)
      .stores({
        characters: 'id, name, ruleset',
        compendium: 'id, name, category, source, ruleset, searchTokens, packId',
        encounters: 'id, name',
        campaigns: 'id, name',
        scenes: 'id, name',
        dupDecisions: 'id',
        contentFixes: 'id, entityId, status',
        packs: 'id',
      })
      .upgrade(async (tx) => {
        let legacyFree5e = 0;
        await tx
          .table('compendium')
          .toCollection()
          .modify((e: { id?: unknown; packId?: string }) => {
            if (!e.packId && typeof e.id === 'string' && e.id.startsWith('free5e-')) {
              e.packId = 'free5e';
              legacyFree5e++;
            }
          });
        if (legacyFree5e > 0) {
          await tx.table('packs').put({
            id: 'free5e',
            name: 'Free5e',
            version: 'unknown',
            repo: 'Solopass/free5e',
            ref: 'main',
            license: 'CC-BY-4.0',
            entityCount: legacyFree5e,
            installedAt: new Date().toISOString(),
          } satisfies InstalledPack);
        }
      });

    this.on('versionchange', () => {
      this.close();
    });
  }
}

export const db = new DndForgeDatabase();

export async function saveCharacter(character: RawCharacterState): Promise<void> {
  const cleanPayload = structuredClone(character);
  await db.characters.put(cleanPayload);
}

export async function saveEncounter(encounter: CombatEncounterState): Promise<void> {
  const cleanPayload = structuredClone(encounter);
  await db.encounters.put(cleanPayload);
}

export async function saveCampaign(campaign: CampaignRecord): Promise<void> {
  const cleanPayload = structuredClone(campaign);
  await db.campaigns.put(cleanPayload);
}

export async function saveScene(scene: BattlemapScene): Promise<void> {
  const cleanPayload = structuredClone(scene);
  await db.scenes.put(cleanPayload);
}

export async function saveDuplicateDecision(decision: DuplicateDecision): Promise<void> {
  await db.dupDecisions.put(structuredClone(decision));
}

export async function deleteDuplicateDecision(id: string): Promise<void> {
  await db.dupDecisions.delete(id);
}

export async function saveContentFix(fix: ContentFix): Promise<void> {
  await db.contentFixes.put(structuredClone(fix));
}

export async function saveContentFixes(fixes: ContentFix[]): Promise<void> {
  if (fixes.length > 0) await db.contentFixes.bulkPut(structuredClone(fixes));
}

export async function deleteContentFix(id: string): Promise<void> {
  await db.contentFixes.delete(id);
}

export async function savePack(pack: InstalledPack): Promise<void> {
  await db.packs.put(structuredClone(pack));
}

/**
 * Removes exactly the compendium entries that belong to a pack (by provenance) and the pack record.
 * Content fixes and duplicate decisions that point at them are kept but marked `orphaned`.
 * Returns the removed entity ids.
 */
export async function removePackFromDb(packId: string): Promise<string[]> {
  const removed: string[] = [];
  await db.transaction('rw', [db.compendium, db.packs, db.contentFixes, db.dupDecisions], async () => {
    const owned = await db.compendium.where('packId').equals(packId).primaryKeys();
    removed.push(...owned);
    await db.compendium.bulkDelete(owned);
    await db.packs.delete(packId);
    if (owned.length > 0) await markOrphans(new Set(owned), true);
  });
  return removed;
}

/**
 * Re-points everything that referred to an entry by its old id at its new id (a legacy repo entry that
 * a pack adopted): content fixes, duplicate decisions and the copies on character sheets (whose ids are
 * the entry id plus a "-<time>" suffix). `map` is old id -> new id.
 */
export async function adoptEntityIds(map: ReadonlyMap<string, string>): Promise<{ fixes: number; decisions: number; characterItems: number }> {
  const done = { fixes: 0, decisions: 0, characterItems: 0 };
  if (map.size === 0) return done;
  const prefixes = [...map.keys()].sort((a, b) => b.length - a.length);
  const remap = (id: string): string => {
    const direct = map.get(id);
    if (direct) return direct;
    const hit = prefixes.find((old) => id.startsWith(`${old}-`));
    return hit ? `${map.get(hit)!}${id.slice(hit.length)}` : id;
  };
  await db.transaction('rw', [db.contentFixes, db.dupDecisions, db.characters], async () => {
    const fixes = (await db.contentFixes.toArray()).filter((f) => map.has(f.entityId));
    for (const f of fixes) f.entityId = map.get(f.entityId)!;
    if (fixes.length > 0) await db.contentFixes.bulkPut(fixes);
    done.fixes = fixes.length;
    const decisions = (await db.dupDecisions.toArray()).filter((d) => d.memberIds.some((m) => map.has(m)) || (d.keepId !== undefined && map.has(d.keepId)));
    for (const d of decisions) {
      d.memberIds = d.memberIds.map((m) => map.get(m) ?? m);
      if (d.keepId !== undefined && map.has(d.keepId)) d.keepId = map.get(d.keepId)!;
    }
    if (decisions.length > 0) await db.dupDecisions.bulkPut(decisions);
    done.decisions = decisions.length;
    const characters = await db.characters.toArray();
    const changed: RawCharacterState[] = [];
    for (const ch of characters) {
      let touched = false;
      const items = ch.items.map((it) => {
        const next = remap(it.id);
        if (next === it.id) return it;
        touched = true;
        done.characterItems++;
        return { ...it, id: next };
      });
      if (touched) changed.push({ ...ch, items });
    }
    if (changed.length > 0) await db.characters.bulkPut(changed);
  });
  return done;
}

/** Sets or clears `orphaned` on fixes / duplicate decisions that point at the given entity ids. */
export async function markOrphans(entityIds: ReadonlySet<string>, orphaned: boolean): Promise<void> {
  const fixes = (await db.contentFixes.toArray()).filter((f) => entityIds.has(f.entityId) && !!f.orphaned !== orphaned);
  for (const f of fixes) {
    if (orphaned) f.orphaned = true;
    else delete f.orphaned;
  }
  if (fixes.length > 0) await db.contentFixes.bulkPut(fixes);
  const decisions = (await db.dupDecisions.toArray()).filter(
    (d) => d.memberIds.some((m) => entityIds.has(m)) && !!d.orphaned !== orphaned
  );
  for (const d of decisions) {
    if (orphaned) d.orphaned = true;
    else delete d.orphaned;
  }
  if (decisions.length > 0) await db.dupDecisions.bulkPut(decisions);
}

export async function deleteSceneRecord(sceneId: string): Promise<void> {
  await db.scenes.delete(sceneId);
}

export async function upsertCompendiumEntities(entities: CompendiumEntity[]): Promise<number> {
  const indexed: IndexedCompendiumRecord[] = entities.map((item) => ({
    ...structuredClone(item),
    searchTokens: buildSearchTokens(item),
  }));
  await db.compendium.bulkPut(indexed);
  return indexed.length;
}

/**
 * Removes the fake one-letter spells ("A".."Z", ids `free5e-spl-a`..) that older Free5e syncs
 * created from the repo's alphabetical index pages (audit item C2). Safe to run on every start.
 */
export async function removeFree5eIndexJunk(): Promise<number> {
  const junkIds = 'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => `free5e-spl-${letter}`);
  const existing = await db.compendium.bulkGet(junkIds);
  const toDelete = junkIds.filter((_, i) => existing[i] !== undefined);
  if (toDelete.length > 0) await db.compendium.bulkDelete(toDelete);
  return toDelete.length;
}

export async function exportFullBundle(): Promise<BackupBundle> {
  const [characters, compendiumRecords, encounters, campaigns, scenes, dupDecisions, contentFixes, packs] = await Promise.all([
    db.characters.toArray(),
    db.compendium.toArray(),
    db.encounters.toArray(),
    db.campaigns.toArray(),
    db.scenes.toArray(),
    db.dupDecisions.toArray(),
    db.contentFixes.toArray(),
    db.packs.toArray(),
  ]);

  const compendium: CompendiumEntity[] = compendiumRecords.map(({ searchTokens: _omit, ...rest }) => rest);

  return {
    app: 'dnd-forge',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    characters,
    compendium,
    encounters,
    campaigns,
    scenes,
    dupDecisions,
    contentFixes,
    packs,
  };
}

export async function importBackupBundle(
  rawJson: unknown,
  mode: 'merge' | 'replace'
): Promise<{ importedCharacters: number; importedEntities: number; importedEncounters: number; warnings: string[] }> {
  if (typeof rawJson !== 'object' || rawJson === null) {
    throw new Error('Invalid JSON payload: expected a root object.');
  }

  const candidate = rawJson as Partial<BackupBundle>;
  const warnings: string[] = [];

  const validCharacters = Array.isArray(candidate.characters)
    ? candidate.characters.filter(
        (c): c is RawCharacterState =>
          typeof c === 'object' && c !== null && typeof c.id === 'string' && typeof c.name === 'string'
      )
    : [];

  const validCompendium = Array.isArray(candidate.compendium)
    ? candidate.compendium.filter(
        (e): e is CompendiumEntity =>
          typeof e === 'object' && e !== null && typeof e.id === 'string' && typeof e.name === 'string'
      )
    : [];

  const validEncounters = Array.isArray(candidate.encounters)
    ? candidate.encounters.filter(
        (enc): enc is CombatEncounterState =>
          typeof enc === 'object' && enc !== null && typeof enc.id === 'string' && typeof enc.name === 'string'
      )
    : [];

  const validCampaigns = Array.isArray(candidate.campaigns)
    ? candidate.campaigns.filter(
        (camp): camp is CampaignRecord =>
          typeof camp === 'object' && camp !== null && typeof camp.id === 'string' && typeof camp.name === 'string'
      )
    : [];

  const validScenes = Array.isArray(candidate.scenes)
    ? candidate.scenes.filter(
        (sc): sc is BattlemapScene =>
          typeof sc === 'object' && sc !== null && typeof sc.id === 'string' && typeof sc.name === 'string'
      )
    : [];

  const validDecisions = Array.isArray(candidate.dupDecisions)
    ? candidate.dupDecisions.filter(
        (d): d is DuplicateDecision =>
          typeof d === 'object' && d !== null && typeof d.id === 'string' && Array.isArray(d.memberIds)
      )
    : [];

  const validFixes = Array.isArray(candidate.contentFixes)
    ? candidate.contentFixes.filter(
        (f): f is ContentFix =>
          typeof f === 'object' && f !== null && typeof f.id === 'string' && typeof f.entityId === 'string' && typeof f.patch === 'object'
      )
    : [];

  const validPacks = Array.isArray(candidate.packs)
    ? candidate.packs.filter(
        (p): p is InstalledPack =>
          typeof p === 'object' && p !== null && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.repo === 'string'
      )
    : [];

  if (Array.isArray(candidate.characters) && validCharacters.length < candidate.characters.length) {
    warnings.push(`Skipped ${candidate.characters.length - validCharacters.length} malformed character record(s).`);
  }

  await db.transaction('rw', [db.characters, db.compendium, db.encounters, db.campaigns, db.scenes, db.dupDecisions, db.contentFixes, db.packs], async () => {
    if (mode === 'replace') {
      await db.characters.clear();
      await db.compendium.clear();
      await db.encounters.clear();
      await db.campaigns.clear();
      await db.scenes.clear();
      await db.dupDecisions.clear();
      await db.contentFixes.clear();
      await db.packs.clear();
    }
    if (validCharacters.length > 0) {
      await db.characters.bulkPut(structuredClone(validCharacters));
    }
    if (validCompendium.length > 0) {
      await upsertCompendiumEntities(validCompendium);
    }
    if (validEncounters.length > 0) {
      await db.encounters.bulkPut(structuredClone(validEncounters));
    }
    if (validCampaigns.length > 0) {
      await db.campaigns.bulkPut(structuredClone(validCampaigns));
    }
    if (validScenes.length > 0) {
      await db.scenes.bulkPut(structuredClone(validScenes));
    }
    if (validDecisions.length > 0) {
      await db.dupDecisions.bulkPut(structuredClone(validDecisions));
    }
    if (validFixes.length > 0) {
      await db.contentFixes.bulkPut(structuredClone(validFixes));
    }
    if (validPacks.length > 0) {
      await db.packs.bulkPut(structuredClone(validPacks));
    }
  });

  return {
    importedCharacters: validCharacters.length,
    importedEntities: validCompendium.length,
    importedEncounters: validEncounters.length,
    warnings,
  };
}
