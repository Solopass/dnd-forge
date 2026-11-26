import { CompendiumEntity } from '../types/compendium';
import type { ContentPack } from './srd-packs';
import { RawCharacterState } from '../types/character';
import type { ThemeDefinition } from '../types/theme';
import type { WorkspaceLayoutConfig } from '../types/layout';
import { normalizeEntries } from './entries';
import { normalizeIncomingCharacter, type ClassLookup } from './character-adapter';
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
// Vite rewrites literal `import.meta.glob(...)` calls at build time, but `typeof import.meta.glob`
// is a runtime check that is always false in the browser, so it can't be used as a guard (it once
// was, and the whole SRD library silently stopped loading). Under Bun (the content CLI scripts)
// `import.meta.glob` doesn't exist and the call throws: fall back to no files there.
function globOrEmpty<T>(load: () => Record<string, T>): Record<string, T> {
  try {
    return load();
  } catch {
    return {};
  }
}
const monsterLoaders = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/monsters/*.json', { import: 'default' })
);
const itemLoaders = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/items/*.json', { import: 'default' })
);
const spellLoaders = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/spells/*.json', { import: 'default' })
);
const featureLoaders = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/features/*.json', { import: 'default' })
);
const characterModules = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/characters/*.json', { eager: true, import: 'default' })
);
const themeModules = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/themes/*.json', { eager: true, import: 'default' })
);
const layoutModules = globOrEmpty(() =>
  import.meta.glob<Record<string, unknown>>('../custom-content/layouts/*.json', { eager: true, import: 'default' })
);

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
  return normalizeIncomingCharacter(raw).character;
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

export const ITEM_CATEGORIES: readonly CompendiumEntity['category'][] = [
  'weapon', 'armor', 'shield', 'gear', 'spell', 'feature', 'feat', 'infusion', 'monster', 'background', 'species',
];

/** Why an entry cannot be imported as an entity, or null when it is fine. */
export function entityProblem(obj: Record<string, unknown>, ent: CompendiumEntity | null): string | null {
  if (!ent) return 'missing name';
  if (!ITEM_CATEGORIES.includes(ent.category)) return `unknown category "${String(obj.category)}"`;
  if (ent.category === 'monster') {
    const m = (obj.monsterMeta ?? null) as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return 'monster without monsterMeta (ac, hp, dexModifier)';
    for (const k of ['ac', 'hp', 'dexModifier']) {
      if (typeof m[k] !== 'number' || !Number.isFinite(m[k])) return `monsterMeta.${k} must be a number`;
    }
  }
  return null;
}

export interface CustomParseResult {
  entities: CompendiumEntity[];
  characters: RawCharacterState[];
  /** Entries that were not imported, each with the reason. */
  rejected: Array<{ name: string; reason: string }>;
  warnings: string[];
}

/**
 * Parses pasted/uploaded JSON text (one object or an array: the "batch" format) into entities and
 * characters. Every entry is either accepted or listed in `rejected` with a reason. Characters may
 * use the app's own export shape or the simple shape (see character-adapter); their equipment /
 * features / spells id lists are resolved against the entities in the same payload first, then
 * through `resolve` (the existing compendium).
 */
export function parseCustomContentJson(
  rawText: string,
  resolve: (id: string) => CompendiumEntity | undefined = () => undefined,
  classLookup?: ClassLookup
): CustomParseResult {
  const parsed: unknown = JSON.parse(rawText);
  const entities: CompendiumEntity[] = [];
  const characters: RawCharacterState[] = [];
  const rejected: CustomParseResult['rejected'] = [];
  const warnings: string[] = [];
  const pendingChars: Array<Record<string, unknown>> = [];

  const handleOne = (obj: Record<string, unknown>, label: string) => {
    const looksLikeCharacter = obj.abilities !== undefined || obj.baseAbilities !== undefined;
    if (looksLikeCharacter && Array.isArray(obj.classes)) {
      pendingChars.push(obj);
      return;
    }
    const cat = typeof obj.category === 'string' ? (obj.category as CompendiumEntity['category']) : 'gear';
    const ent = normalizeCustomEntity(obj, cat);
    const problem = entityProblem(obj, ent);
    if (problem) rejected.push({ name: typeof obj.name === 'string' && obj.name ? obj.name : label, reason: problem });
    else if (ent) entities.push(ent);
  };

  const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  items.forEach((item, i) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) handleOne(item as Record<string, unknown>, `entry ${i + 1}`);
    else rejected.push({ name: `entry ${i + 1}`, reason: 'not an object' });
  });

  const local = new Map(entities.map((e) => [e.id, e]));
  for (const obj of pendingChars) {
    const res = normalizeIncomingCharacter(obj, (id) => local.get(id) ?? resolve(id), classLookup);
    const label = typeof obj.name === 'string' && obj.name ? obj.name : 'unnamed character';
    if (res.character) {
      characters.push(res.character);
      res.warnings.forEach((w) => warnings.push(`${label}: ${w}`));
    } else {
      rejected.push({ name: label, reason: res.problems.join('; ') });
    }
  }
  return { entities, characters, rejected, warnings };
}
