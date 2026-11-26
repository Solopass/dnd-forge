import type { CompendiumEntity, ItemCategory } from '../types/compendium';
import { PACK_FORMAT_V1, type PackManifest } from '../types/pack';

/** Pure pack helpers: manifest parsing, glob expansion, legacy (v0) conversion, ids, the Free5e tree adapter. */

export type ManifestResult = { ok: true; manifest: PackManifest } | { ok: false; errors: string[] };

const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RULESETS = ['2014', '2024', 'any'] as const;

export const FREE5E_PACK_ID = 'free5e';

export function slugifyPackText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizePackPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function checkPathList(field: string, value: unknown, errors: string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`"${field}" must be a list of file paths or globs.`);
    return [];
  }
  const out: string[] = [];
  value.forEach((p, i) => {
    if (typeof p !== 'string' || !p.trim()) {
      errors.push(`"${field}[${i}]" must be a non-empty string.`);
    } else if (/(^|[\\/])\.\.([\\/]|$)/.test(p) || /^[a-zA-Z]:|^[\\/]/.test(p.trim())) {
      errors.push(`"${field}[${i}]" ("${p}") must be a relative path inside the repo.`);
    } else {
      out.push(normalizePackPath(p));
    }
  });
  return out;
}

/** Parses and validates a v1 `pack.json`. Every problem is reported, with the field it is about. */
export function parsePackManifest(raw: unknown): ManifestResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['pack.json must be a JSON object.'] };
  }
  const o = raw as Record<string, unknown>;

  if (o.format !== PACK_FORMAT_V1) {
    errors.push(
      typeof o.format === 'string' && o.format.startsWith('dnd-forge-pack@')
        ? `Unsupported pack format "${o.format}" (this app reads "${PACK_FORMAT_V1}").`
        : `"format" must be "${PACK_FORMAT_V1}".`
    );
  }
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!id) errors.push('"id" is required.');
  else if (!PACK_ID_RE.test(id)) {
    errors.push(`"id" ("${id}") must be lower-case letters, digits and hyphens, starting with a letter or digit.`);
  }

  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) errors.push('"name" is required.');
  const version =
    typeof o.version === 'string' ? o.version.trim() : typeof o.version === 'number' ? String(o.version) : '';
  if (!version) errors.push('"version" is required (for example "1.0.0").');

  for (const f of ['author', 'license', 'description'] as const) {
    if (o[f] !== undefined && typeof o[f] !== 'string') errors.push(`"${f}" must be text.`);
  }
  if (o.ruleset !== undefined && !(RULESETS as readonly unknown[]).includes(o.ruleset)) {
    errors.push('"ruleset" must be "2014", "2024" or "any".');
  }

  let requires: string[] = [];
  if (o.requires !== undefined) {
    if (!Array.isArray(o.requires) || o.requires.some((r) => typeof r !== 'string' || !PACK_ID_RE.test(r))) {
      errors.push('"requires" must be a list of pack ids.');
    } else {
      requires = o.requires as string[];
    }
  }

  const content = checkPathList('content', o.content, errors);
  const characters = checkPathList('characters', o.characters, errors);
  let campaign: string | undefined;
  if (o.campaign !== undefined) {
    if (typeof o.campaign !== 'string' || !o.campaign.trim()) errors.push('"campaign" must be a file path.');
    else campaign = normalizePackPath(o.campaign);
  }
  if (errors.length === 0 && content.length === 0 && characters.length === 0 && !campaign) {
    errors.push('The pack lists nothing to import: add "content", "characters" or "campaign".');
  }
  if (errors.length > 0) return { ok: false, errors };

  const manifest: PackManifest = {
    format: PACK_FORMAT_V1,
    id,
    name,
    version,
    requires,
    content,
    characters,
    ...(typeof o.author === 'string' ? { author: o.author } : {}),
    ...(typeof o.license === 'string' ? { license: o.license } : {}),
    ...(typeof o.description === 'string' ? { description: o.description } : {}),
    ...(o.ruleset ? { ruleset: o.ruleset as PackManifest['ruleset'] } : {}),
    ...(campaign ? { campaign } : {}),
  };
  return { ok: true, manifest };
}

export function isFree5eRepo(owner: string, repo: string): boolean {
  return owner.toLowerCase() === 'solopass' && repo.toLowerCase() === 'free5e';
}

export interface LegacyConversion {
  manifest: PackManifest;
  /** Category the old manifest gave for a content path (`{ path, category }`). */
  categoryHints: Record<string, ItemCategory>;
  /** Entities written straight into the old manifest. */
  inlineEntities: Record<string, unknown>[];
  inlineCharacters: Record<string, unknown>[];
  entries: unknown[];
  /** The old `source` label, used for entities that have none. */
  sourceLabel: string;
}

/** Reads a v0 `campaign-pack.json` (the old CampaignPackManifest) as a v1 manifest plus its inline data. */
export function convertLegacyManifest(raw: unknown, repo: { owner: string; repo: string }): LegacyConversion {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const content: string[] = [];
  const categoryHints: Record<string, ItemCategory> = {};
  const inlineEntities: Record<string, unknown>[] = [];
  for (const spec of Array.isArray(o.entities) ? o.entities : []) {
    if (typeof spec === 'string') {
      content.push(normalizePackPath(spec));
    } else if (typeof spec === 'object' && spec !== null) {
      const s = spec as { path?: unknown; category?: unknown };
      if (typeof s.path === 'string') {
        const p = normalizePackPath(s.path);
        content.push(p);
        if (typeof s.category === 'string') categoryHints[p] = s.category as ItemCategory;
      } else {
        inlineEntities.push(spec as Record<string, unknown>);
      }
    }
  }
  const characters: string[] = [];
  const inlineCharacters: Record<string, unknown>[] = [];
  for (const spec of Array.isArray(o.characters) ? o.characters : []) {
    if (typeof spec === 'string') characters.push(normalizePackPath(spec));
    else if (typeof spec === 'object' && spec !== null) inlineCharacters.push(spec as Record<string, unknown>);
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : repo.repo;
  const id = isFree5eRepo(repo.owner, repo.repo) ? FREE5E_PACK_ID : slugifyPackText(repo.repo) || 'pack';
  const sourceLabel =
    typeof o.source === 'string' && o.source.trim() ? o.source.trim() : name || `${repo.owner}/${repo.repo}`;
  return {
    manifest: {
      format: PACK_FORMAT_V1,
      id,
      name,
      version: '0.0.0',
      ruleset: o.ruleset === '2014' || o.ruleset === '2024' ? o.ruleset : 'any',
      requires: [],
      content,
      characters,
    },
    categoryHints,
    inlineEntities,
    inlineCharacters,
    entries: Array.isArray(o.entries) ? o.entries : [],
    sourceLabel,
  };
}

export function isGlob(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Expands paths / globs (`*` within a folder, `**` across folders) against the repo's file list.
 * Results keep pattern order, sorted within a pattern, no duplicates. A plain path is returned as is
 * (a missing file then fails when fetched, with a clear error).
 */
export function expandGlobs(patterns: readonly string[], repoFiles: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const raw of patterns) {
    const pattern = normalizePackPath(raw);
    if (!isGlob(pattern)) {
      push(pattern);
      continue;
    }
    const re = globToRegExp(pattern);
    repoFiles
      .filter((f) => re.test(f))
      .sort()
      .forEach(push);
  }
  return out;
}

/** `<packId>:<slug>` */
export function namespacedId(packId: string, slug: string): string {
  return `${packId}:${slug}`;
}

export interface PackIdentity {
  packId: string;
  packVersion: string;
  packRef?: string;
}

/**
 * Stamps provenance on every entity and gives the ones that had no id of their own a namespaced id
 * `<packId>:<slug>` (so two packs can both carry an "Alert"). Entities with an id keep it. Inside one
 * pack, a name clash gets the category (and then a counter) appended.
 */
export function assignPackIdentity(
  items: ReadonlyArray<{ entity: CompendiumEntity; hadId: boolean }>,
  identity: PackIdentity
): CompendiumEntity[] {
  const taken = new Set<string>();
  for (const it of items) if (it.hadId) taken.add(it.entity.id);
  return items.map(({ entity, hadId }) => {
    let id = entity.id;
    if (!hadId) {
      const slug = slugifyPackText(entity.name) || 'entry';
      id = namespacedId(identity.packId, slug);
      if (taken.has(id)) id = namespacedId(identity.packId, `${slug}-${entity.category}`);
      for (let n = 2; taken.has(id); n++) id = namespacedId(identity.packId, `${slug}-${entity.category}-${n}`);
      taken.add(id);
    }
    return {
      ...entity,
      id,
      packId: identity.packId,
      packVersion: identity.packVersion,
      ...(identity.packRef ? { packRef: identity.packRef } : {}),
    };
  });
}

export function guessCategoryFromPath(path: string): ItemCategory {
  const p = path.toLowerCase();
  if (/spell/.test(p)) return 'spell';
  if (/monster|creature|bestiary/.test(p)) return 'monster';
  if (/feat/.test(p)) return 'feat';
  if (/background/.test(p)) return 'background';
  if (/species|race/.test(p)) return 'species';
  if (/infusion/.test(p)) return 'infusion';
  if (/feature|class/.test(p)) return 'feature';
  if (/weapon/.test(p)) return 'weapon';
  if (/armor|armour/.test(p)) return 'armor';
  return 'gear';
}

/**
 * Built-in Free5e adapter: which files of a Free5e-shaped repo tree are content, and of what category.
 * (This is the tree walk that used to live inside fetchFree5eTreeFromGitHub.)
 */
export function free5eTargetsFromTree(paths: readonly string[]): Array<{ path: string; category: ItemCategory }> {
  const targets: Array<{ path: string; category: ItemCategory }> = [];
  for (const p of paths) {
    if (!p.endsWith('.md')) continue;
    // `_A.md`-style files are alphabetical index pages, not content
    if ((p.split('/').pop() ?? '').startsWith('_')) continue;
    if (
      p.startsWith('en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/') &&
      !p.endsWith('/Spell_Descriptions.md')
    ) {
      targets.push({ path: p, category: 'spell' });
    } else if (p.startsWith('en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/')) {
      targets.push({ path: p, category: 'feat' });
    } else if (p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Weapons_table.md') {
      targets.push({ path: p, category: 'weapon' });
    } else if (p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Armor_table.md') {
      targets.push({ path: p, category: 'armor' });
    } else if (
      p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Adventuring_Gear.md' ||
      p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Tools.md'
    ) {
      targets.push({ path: p, category: 'gear' });
    } else if (p.startsWith('en-US/Monstrous_Manuscript/02_Monsters_A-Z/Monsters/')) {
      targets.push({ path: p, category: 'monster' });
    }
  }
  return targets;
}

export interface PackEntityDiff {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
}

function comparable(e: CompendiumEntity): string {
  const copy: Record<string, unknown> = { ...e };
  for (const k of ['packVersion', 'packRef', 'alsoIn', 'fixedBy', 'searchTokens']) delete copy[k];
  return stableStringify(copy);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** What updating a pack changes, by entity id; content is compared, not the version / commit stamps. */
export function diffPackEntities(
  previous: readonly CompendiumEntity[],
  next: readonly CompendiumEntity[]
): PackEntityDiff {
  const prev = new Map(previous.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const e of next) {
    seen.add(e.id);
    const old = prev.get(e.id);
    if (!old) added.push(e.id);
    else if (comparable(old) !== comparable(e)) changed.push(e.id);
    else unchanged++;
  }
  const removed = previous.filter((e) => !seen.has(e.id)).map((e) => e.id);
  return { added, changed, removed, unchanged };
}

/** The key two entries share when they are "the same thing": category + name without case, spacing or punctuation. */
export function adoptionKey(e: Pick<CompendiumEntity, 'category' | 'name'>): string {
  return `${e.category}|${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

/**
 * Entries that an older repo sync left behind (`custom-*` ids, no pack provenance) and that the pack
 * being installed now carries again: matched by (category, normalized name). Returns old id -> new id.
 * Only entries whose source is one the pack uses (or the old default "Custom Repo") are considered, and
 * a name that is ambiguous on either side is skipped, so a hand-made entry is never swallowed by accident.
 */
export function planLegacyAdoption(
  existing: readonly CompendiumEntity[],
  incoming: readonly CompendiumEntity[],
  packSourceLabels: readonly string[]
): Map<string, string> {
  const labels = new Set([...packSourceLabels, ...incoming.map((e) => e.source), 'Custom Repo'].map((l) => l.toLowerCase()));
  const byKey = new Map<string, CompendiumEntity[]>();
  for (const e of incoming) (byKey.get(adoptionKey(e)) ?? byKey.set(adoptionKey(e), []).get(adoptionKey(e))!).push(e);
  const legacyByKey = new Map<string, CompendiumEntity[]>();
  for (const e of existing) {
    if (e.packId || !e.id.startsWith('custom-') || !labels.has(e.source.toLowerCase())) continue;
    (legacyByKey.get(adoptionKey(e)) ?? legacyByKey.set(adoptionKey(e), []).get(adoptionKey(e))!).push(e);
  }
  const existingIds = new Set(existing.map((e) => e.id));
  const plan = new Map<string, string>();
  for (const [key, olds] of legacyByKey) {
    const news = byKey.get(key);
    if (!news || news.length !== 1 || olds.length !== 1) continue;
    const [old] = olds;
    const [next] = news;
    if (!old || !next || old.id === next.id || existingIds.has(next.id)) continue;
    plan.set(old.id, next.id);
  }
  return plan;
}
