import { CompendiumEntity } from '../types/compendium';
import type { ContentPack } from './srd-packs';
import { RawCharacterState } from '../types/character';
import type { ThemeDefinition } from '../types/theme';
import type { WorkspaceLayoutConfig } from '../types/layout';

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
const monsterModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/monsters/*.json',
  { eager: true, import: 'default' }
);
const itemModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/items/*.json',
  { eager: true, import: 'default' }
);
const spellModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/spells/*.json',
  { eager: true, import: 'default' }
);
const featureModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/features/*.json',
  { eager: true, import: 'default' }
);
const characterModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/characters/*.json',
  { eager: true, import: 'default' }
);
const themeModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/themes/*.json',
  { eager: true, import: 'default' }
);
const layoutModules = import.meta.glob<Record<string, unknown>>(
  '../custom-content/layouts/*.json',
  { eager: true, import: 'default' }
);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function flattenEntryNode(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) flattenEntryNode(child, out);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const heading = typeof obj.name === 'string' && obj.name.trim() ? `${obj.name.trim()}: ` : '';
    if (Array.isArray(obj.entries)) {
      const sub: string[] = [];
      for (const child of obj.entries) flattenEntryNode(child, sub);
      if (sub.length > 0) {
        if (heading) sub[0] = `${heading}${sub[0]}`;
        out.push(...sub);
      }
      return;
    }
    if (Array.isArray(obj.items)) {
      if (heading) out.push(heading.replace(/:\s*$/, ''));
      for (const item of obj.items) {
        const sub: string[] = [];
        flattenEntryNode(item, sub);
        for (const line of sub) out.push(`• ${line}`);
      }
      return;
    }
    if (typeof obj.entry === 'string' && obj.entry.trim()) {
      out.push(`${heading}${obj.entry.trim()}`);
      return;
    }
    if (typeof obj.text === 'string' && obj.text.trim()) {
      out.push(`${heading}${obj.text.trim()}`);
    }
  }
}

export function normalizeEntries(rawEntries: unknown, rawDescription?: unknown): string[] {
  const out: string[] = [];
  if (rawEntries !== undefined) {
    flattenEntryNode(rawEntries, out);
  }
  if (out.length === 0 && typeof rawDescription === 'string' && rawDescription.trim()) {
    for (const para of rawDescription.split(/\n{2,}/)) {
      const t = para.trim();
      if (t) out.push(t);
    }
  }
  return out;
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

export const CUSTOM_REPO_ENTITIES: CompendiumEntity[] = [
  ...collectEntities(monsterModules, 'monster'),
  ...collectEntities(itemModules, 'gear'),
  ...collectEntities(spellModules, 'spell'),
  ...collectEntities(featureModules, 'feature'),
];

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
