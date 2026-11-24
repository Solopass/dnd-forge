import { CompendiumEntity } from '../types/compendium';
import type { ContentPack } from './srd-packs';
import { RawCharacterState } from '../types/character';
import type { ThemeDefinition } from '../types/theme';
import type { WorkspaceLayoutConfig } from '../types/layout';
import { normalizeEntries } from './entries';
export { normalizeEntries };

/**
 * Automatically discovers and loads any .json file placed into:
 *   src/custom-content/monsters/*.json
 *   src/custom-content/items/*.json
 *   src/custom-content/spells/*.json
 *   src/custom-content/features/*.json
 *   src/custom-content/characters/*.json
 *
 * Files in src/custom-content/_templates/ are ignored by auto-loading and serve
 * purely as reference templates for AI formatting.
 */
const hasGlob = typeof import.meta.glob === 'function';
const monsterLoaders = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/monsters/*.json', { import: 'default' })
  : {};
const itemLoaders = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/items/*.json', { import: 'default' })
  : {};
const spellLoaders = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/spells/*.json', { import: 'default' })
  : {};
const featureLoaders = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/features/*.json', { import: 'default' })
  : {};
const characterModules = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/characters/*.json', { eager: true, import: 'default' })
  : {};
const themeModules = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/themes/*.json', { eager: true, import: 'default' })
  : {};
const layoutModules = hasGlob
  ? import.meta.glob<Record<string, unknown>>('../custom-content/layouts/*.json', { eager: true, import: 'default' })
  : {};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeCustomEntity(
  raw: Record<string, unknown>,
  fallbackCategory: CompendiumEntity['category']
): CompendiumEntity | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const category =
    typeof raw.category === 'string'
      ? (raw.category as CompendiumEntity['category'])
      : fallbackCategory;

  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `custom-${category}-${slugify(name)}`;

  const rawImg =
    [raw.imageUrl, raw.image, raw.img, raw.portraitUrl, raw.tokenUrl].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0
    );

  return {
    ...(raw as unknown as CompendiumEntity),
    id,
    name,
    category,
    imageUrl: rawImg ? rawImg.trim() : undefined,
    source: typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : 'Custom Repo',
    ruleset: raw.ruleset === '2024' ? '2024' : '2014',
    activities: Array.isArray(raw.activities) ? (raw.activities as CompendiumEntity['activities']) : [],
    entries: normalizeEntries(raw.entries, raw.description),
  };
}

function collectEntities(
  modules: Record<string, Record<string, unknown>>,
  fallbackCategory: CompendiumEntity['category']
): CompendiumEntity[] {
  const out: CompendiumEntity[] = [];
  for (const mod of Object.values(modules)) {
    if (!mod || typeof mod !== 'object') continue;
    if (Array.isArray(mod)) {
      for (const item of mod) {
        if (item && typeof item === 'object') {
          const norm = normalizeCustomEntity(item as Record<string, unknown>, fallbackCategory);
          if (norm) out.push(norm);
        }
      }
    } else {
      const norm = normalizeCustomEntity(mod, fallbackCategory);
      if (norm) out.push(norm);
    }
  }
  return out;
}

export function normalizeCustomCharacter(raw: Record<string, unknown>): RawCharacterState | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || !raw.abilities || !Array.isArray(raw.classes)) return null;
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `custom-char-${slugify(name)}`;
  return {
    ...(raw as unknown as RawCharacterState),
    id,
    name,
    items: Array.isArray(raw.items) ? (raw.items as CompendiumEntity[]) : [],
    conditions: Array.isArray(raw.conditions) ? (raw.conditions as string[]) : [],
    resources: Array.isArray(raw.resources) ? (raw.resources as RawCharacterState['resources']) : [],
    overrides:
      raw.overrides && typeof raw.overrides === 'object'
        ? (raw.overrides as RawCharacterState['overrides'])
        : {},
  };
}

export async function loadCustomRepoEntities(): Promise<CompendiumEntity[]> {
  const groups: Array<[Record<string, () => Promise<Record<string, unknown>>>, CompendiumEntity['category']]> = [
    [monsterLoaders, 'monster'],
    [itemLoaders, 'gear'],
    [spellLoaders, 'spell'],
    [featureLoaders, 'feature'],
  ];
  const out: CompendiumEntity[] = [];
  for (const [loaders, fallbackCat] of groups) {
    const loadedModules = await Promise.all(Object.values(loaders).map((fn) => fn()));
    const map: Record<string, Record<string, unknown>> = {};
    loadedModules.forEach((m, idx) => {
      map[String(idx)] = m;
    });
    out.push(...collectEntities(map, fallbackCat));
  }
  return out;
}

export const CUSTOM_REPO_ENTITIES: CompendiumEntity[] = [];

export const CUSTOM_REPO_CONTENT_PACK: ContentPack = {
  id: 'pack-custom-repo',
  name: 'Custom Repo Content (src/custom-content)',
  ruleset: '2014',
  description:
    'Auto-loaded custom monsters, items, spells, and features dropped into src/custom-content/.',
  entities: CUSTOM_REPO_ENTITIES,
};

export const CUSTOM_REPO_CHARACTERS: RawCharacterState[] = Object.values(characterModules)
  .map((mod) => (mod && typeof mod === 'object' ? normalizeCustomCharacter(mod) : null))
  .filter((c): c is RawCharacterState => c !== null);

export const CUSTOM_REPO_THEMES: ThemeDefinition[] = (
  Object.values(themeModules) as unknown[]
).filter(
  (mod): mod is ThemeDefinition =>
    Boolean(mod && typeof mod === 'object' && 'name' in mod && 'tokens' in mod)
);

export const CUSTOM_REPO_LAYOUTS: WorkspaceLayoutConfig[] = (
  Object.values(layoutModules) as unknown[]
).filter(
  (mod): mod is WorkspaceLayoutConfig =>
    Boolean(mod && typeof mod === 'object' && 'name' in mod && 'widgets' in mod)
);

/**
 * Parses arbitrary pasted/uploaded JSON text into CompendiumEntity[] and/or RawCharacterState[].
 * Supports:
 *  - A single CompendiumEntity object
 *  - An array of CompendiumEntity objects
 *  - A single RawCharacterState object
 */
export function parseCustomContentJson(rawText: string): {
  entities: CompendiumEntity[];
  characters: RawCharacterState[];
} {
  const parsed: unknown = JSON.parse(rawText);
  const entities: CompendiumEntity[] = [];
  const characters: RawCharacterState[] = [];

  const handleOne = (obj: Record<string, unknown>) => {
    if (obj.abilities && Array.isArray(obj.classes)) {
      const ch = normalizeCustomCharacter(obj);
      if (ch) characters.push(ch);
      return;
    }
    const cat =
      typeof obj.category === 'string'
        ? (obj.category as CompendiumEntity['category'])
        : 'gear';
    const ent = normalizeCustomEntity(obj, cat);
    if (ent) entities.push(ent);
  };

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        handleOne(item as Record<string, unknown>);
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    handleOne(parsed as Record<string, unknown>);
  }

  return { entities, characters };
}
