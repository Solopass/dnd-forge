import Dexie, { Table } from 'dexie';
import { CampaignRecord } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CompendiumEntity } from '../types/compendium';
import { BattlemapScene, CombatEncounterState } from '../types/combat';

export const CURRENT_SCHEMA_VERSION = 3;

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

    this.version(CURRENT_SCHEMA_VERSION).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
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
  const [characters, compendiumRecords, encounters, campaigns, scenes] = await Promise.all([
    db.characters.toArray(),
    db.compendium.toArray(),
    db.encounters.toArray(),
    db.campaigns.toArray(),
    db.scenes.toArray(),
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

  if (Array.isArray(candidate.characters) && validCharacters.length < candidate.characters.length) {
    warnings.push(`Skipped ${candidate.characters.length - validCharacters.length} malformed character record(s).`);
  }

  await db.transaction('rw', db.characters, db.compendium, db.encounters, db.campaigns, db.scenes, async () => {
    if (mode === 'replace') {
      await db.characters.clear();
      await db.compendium.clear();
      await db.encounters.clear();
      await db.campaigns.clear();
      await db.scenes.clear();
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
  });

  return {
    importedCharacters: validCharacters.length,
    importedEntities: validCompendium.length,
    importedEncounters: validEncounters.length,
    warnings,
  };
}
