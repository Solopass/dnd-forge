import type { RawCharacterState } from '../types/character';
import type { CompendiumEntity, ItemCategory } from '../types/compendium';
import type { Ruleset } from '../types/core';
import { adapt5eToolsPayload } from './five-tools-adapter';
import { isFree5eIndexPage, parseFree5eMarkdownBatch } from './free5e-parser';
import { parseHomebrewMarkdownBlock } from './statblock-parser';
import { extractStatblocksFromText } from './statblock-extractor';
import { splitMarkdownBlocks } from './content-converter';
import { normalizeIncomingCharacter, type ClassLookup } from './character-adapter';
import { buildCharacterFromDdbFields } from './ddb-pdf-importer';
import { assignPackIdentity, convertLegacyManifest, expandGlobs, guessCategoryFromPath, isGlob, parsePackManifest } from './pack-manifest';
import {
  dedupeProcessedIds,
  normalizeFormula,
  sanitizeEntity,
  sanitizeEntityList,
  slugifyText,
  toNumber,
  type ProcessedEntity,
  type Rejection,
} from './import-normalize';

export { normalizeCr, normalizeFormula, cleanText, sanitizeEntity, type ProcessedEntity, type Rejection } from './import-normalize';

/**
 * One import pipeline: detect (by content) -> parse (the existing adapters) -> normalize / validate /
 * repair (import-normalize.ts) -> result. Every format ends as accepted, repaired (with notes) or
 * rejected (with a reason); nothing throws. Pure: callers pass text in and get plain data out.
 */

export type DetectedFormat =
  | 'empty'
  | 'binary'
  | 'invalid-json'
  | 'pack-manifest'
  | 'app-bundle'
  | 'five-tools'
  | 'entity-json'
  | 'character-json'
  | 'free5e-markdown'
  | 'homebrew-markdown'
  | 'csv'
  | 'pdf-text'
  | 'unknown';

export interface PipelineOptions {
  /** File name or path: used in reports and to guess a category ("spells/x.json"). */
  name?: string;
  categoryHint?: ItemCategory;
  sourceLabel?: string;
  defaultRuleset?: Ruleset;
  /** Parser-made ids (Markdown) are stable and kept as they are (the Free5e pack); otherwise they count as made up. */
  stableIds?: boolean;
  /** Treat the text as the text of a PDF (statblocks) instead of guessing. */
  assumeFormat?: 'pdf-text';
  /** Runs on every accepted entity (e.g. resolve repo-relative image paths). */
  mapEntity?: (entity: CompendiumEntity) => CompendiumEntity;
  /** Looks up entities already in the compendium (for characters that list item ids). */
  resolveEntity?: (id: string) => CompendiumEntity | undefined;
  /** Character references that are skipped without their own warning (the caller reports them once). */
  quietMissing?: (id: string) => boolean;
  classLookup?: ClassLookup;
  /** Stamped on every entity as `packFile`. */
  packFile?: string;
}

export interface RepairedEntity {
  entity: CompendiumEntity;
  notes: string[];
}

export interface PipelineResult {
  format: DetectedFormat;
  /** Everything that will be imported, repaired or not. */
  accepted: CompendiumEntity[];
  /** The part of `accepted` that needed an auto-fix, with what was changed. */
  repaired: RepairedEntity[];
  rejected: Rejection[];
  /** Identical copies of an entry already taken (same id and content): merged silently, never listed as rejected. */
  identicalMerged: number;
  warnings: string[];
  characters: RawCharacterState[];
  /** The same entities with their notes and whether the id came from the file (internal bookkeeping). */
  items: ProcessedEntity[];
  /** Ids that were made up from the name (a pack replaces them with namespaced ids). */
  generatedIds: ReadonlySet<string>;
  /** For a backup bundle: the bundle with its compendium replaced by the cleaned entities. */
  bundle?: unknown;
}

function makeResult(
  format: DetectedFormat,
  items: ProcessedEntity[],
  rejected: Rejection[],
  warnings: string[],
  characters: RawCharacterState[] = [],
  bundle?: unknown,
  priorMerged = 0
): PipelineResult {
  const identical = rejected.filter((r) => r.kind === 'duplicate').length;
  rejected = rejected.filter((r) => r.kind !== 'duplicate');
  return {
    format,
    accepted: items.map((i) => i.entity),
    repaired: items.filter((i) => i.notes.length > 0).map((i) => ({ entity: i.entity, notes: i.notes })),
    rejected,
    identicalMerged: priorMerged + identical,
    warnings,
    characters,
    items,
    generatedIds: new Set(items.filter((i) => !i.explicitId).map((i) => i.entity.id)),
    ...(bundle !== undefined ? { bundle } : {}),
  };
}

const failed = (format: DetectedFormat, source: string, reason: string): PipelineResult =>
  makeResult(format, [], [{ source, reason }], []);

// ---------------------------------------------------------------- detect

type Json = { ok: true; value: unknown } | { ok: false; error: string };

function tryJson(text: string): Json {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const FIVE_TOOLS_KEYS = ['spell', 'item', 'baseitem', 'feat', 'monster'] as const;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function classifyJson(value: unknown): DetectedFormat {
  if (isObj(value)) {
    if (value.format === 'dnd-forge-pack@1') return 'pack-manifest';
    if (value.app === 'dnd-forge') return 'app-bundle';
    if (FIVE_TOOLS_KEYS.some((k) => Array.isArray(value[k]) && (value[k] as unknown[]).length > 0)) return 'five-tools';
    if ((value.abilities !== undefined || value.baseAbilities !== undefined) && Array.isArray(value.classes)) return 'character-json';
  }
  return 'entity-json';
}

function detectDelimiter(headerLine: string): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const d of [',', '\t', ';', '|']) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function looksLikeCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  if (/^\s*\|/.test(lines[0]!)) return false; // a Markdown table
  const d = detectDelimiter(lines[0]!);
  if (!d) return false;
  const header = lines[0]!.split(d).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  return header.some((h) => /^(name|item|spell|monster|creature|weapon|armor|title)(\s|$)/.test(h)) && header.length >= 2;
}

/** Works out what a piece of text is from what is in it, not from the file extension. */
export function detectFormat(rawText: string, opts: Pick<PipelineOptions, 'assumeFormat' | 'name'> = {}): DetectedFormat {
  const text = rawText.replace(/^\uFEFF/, '').trim();
  if (!text) return 'empty';
  if (text.startsWith('%PDF') || text.slice(0, 4000).includes('\u0000')) return 'binary';
  if (opts.assumeFormat === 'pdf-text') return 'pdf-text';
  const first = text[0];
  if (first === '{' || first === '[') {
    if (/^\[_metadata_/i.test(text)) return 'free5e-markdown';
    const json = tryJson(text);
    return json.ok ? classifyJson(json.value) : 'invalid-json';
  }
  if (/\[_metadata_:/i.test(text) || isFree5eIndexPage(text, opts.name)) return 'free5e-markdown';
  if (/Armor\s*Class\b/i.test(text) && /Hit\s*Points\b/i.test(text)) return 'homebrew-markdown';
  if (looksLikeCsv(text)) return 'csv';
  if (/^\s*\|.+\|\s*$/m.test(text)) return 'free5e-markdown';
  if (/^#{1,6}\s+\S/m.test(text) || /^\s*\*\*[^*\n]+\*\*/.test(text)) return 'homebrew-markdown';
  if (/^\W*(type|category|level|casting time|range|duration|components|damage|armor class|hit points|challenge)\s*:/im.test(text)) return 'homebrew-markdown';
  return /\.(md|markdown)$/i.test(opts.name ?? '') ? 'homebrew-markdown' : 'unknown';
}

// ---------------------------------------------------------------- CSV

/** Quote-aware CSV / TSV reader (cells may hold commas, doubled quotes and line breaks). */
export function parseCsvRows(rawText: string, delimiter: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const COLUMN_ALIASES: Record<string, string> = {
  name: 'name', item: 'name', 'item name': 'name', spell: 'name', 'spell name': 'name', monster: 'name', creature: 'name', title: 'name', weapon: 'name', armor: 'name', armour: 'name',
  id: 'id', category: 'category', kind: 'category', type: 'type', source: 'source', book: 'source', ruleset: 'ruleset', edition: 'ruleset', rules: 'ruleset',
  level: 'level', 'spell level': 'level', lvl: 'level', school: 'school',
  'casting time': 'castingTime', 'cast time': 'castingTime', time: 'castingTime', range: 'range', components: 'components', duration: 'duration',
  concentration: 'concentration', ritual: 'ritual', classes: 'classes', class: 'classes', 'class list': 'classes',
  description: 'description', desc: 'description', text: 'description', details: 'description', effect: 'description', entries: 'description', notes: 'description', body: 'description',
  cost: 'cost', price: 'cost', weight: 'weight', wt: 'weight', quantity: 'quantity', qty: 'quantity',
  damage: 'damage', dmg: 'damage', 'damage dice': 'damage', 'damage type': 'damageType', 'dmg type': 'damageType', properties: 'properties', property: 'properties',
  ac: 'ac', 'armor class': 'ac', 'base ac': 'ac', hp: 'hp', 'hit points': 'hp', cr: 'cr', 'challenge rating': 'cr', challenge: 'cr',
  dex: 'dex', 'dex mod': 'dexModifier', 'dex modifier': 'dexModifier', size: 'size', save: 'save', 'saving throw': 'save',
  image: 'imageUrl', 'image url': 'imageUrl', img: 'imageUrl',
};

function guessCsvCategory(columns: ReadonlySet<string>): ItemCategory {
  if (columns.has('damage')) return 'weapon';
  if (columns.has('hp') || columns.has('cr')) return 'monster';
  if (columns.has('ac')) return 'armor';
  if (columns.has('level') || columns.has('castingTime') || columns.has('school')) return 'spell';
  return 'gear';
}

function parseArmorClass(text: string): { base: number; dexCap: number | null } | { flat: number } | undefined {
  const t = text.trim();
  const flat = t.match(/^\+\s*(\d+)$/);
  if (flat?.[1]) return { flat: Number.parseInt(flat[1], 10) };
  const m = t.match(/^(\d+)\s*(?:\+\s*dex(?:terity)?(?:\s*mod(?:ifier)?)?)?\s*(?:\(max\s*(\d+)\))?/i);
  if (!m?.[1]) return undefined;
  const base = Number.parseInt(m[1], 10);
  const hasDex = /dex/i.test(t);
  if (!hasDex) return { base, dexCap: 0 };
  return { base, dexCap: m[2] ? Number.parseInt(m[2], 10) : null };
}

function csvRowToRaw(row: Record<string, string>, category: ItemCategory): Record<string, unknown> {
  const raw: Record<string, unknown> = { category };
  const name = row.name ?? '';
  raw.name = name;
  for (const key of ['id', 'source', 'ruleset', 'castingTime', 'range', 'components', 'duration', 'concentration', 'ritual', 'weight', 'quantity', 'imageUrl'] as const) {
    if (row[key] !== undefined && row[key] !== '') raw[key] = row[key];
  }
  if (row.classes) raw.classes = row.classes.split(/[,;/]/).map((c) => c.trim()).filter(Boolean);
  if (row.category) raw.category = row.category;
  else if (row.type) raw.category = category; // "type" is often "Martial Melee", not a category
  if (row.level !== undefined && row.level !== '') raw.spellLevel = row.level;
  const entries: string[] = [];
  if (row.description) entries.push(...row.description.split(/\n{2,}/));
  if (row.school) entries.push(`School: ${row.school}`);
  if (row.cost) entries.push(`Cost: ${row.cost}`);
  if (row.properties) entries.push(`Properties: ${row.properties}`);
  if (row.type && !['weapon', 'spell', 'armor', 'gear'].includes(row.type.toLowerCase())) entries.push(`Type: ${row.type}`);
  raw.entries = entries;

  const slug = slugifyText(name) || 'entry';
  const damage = row.damage ? normalizeFormula(row.damage) : undefined;
  if (category === 'weapon' || (category === 'spell' && row.damage)) {
    if (damage && damage.kind !== 'invalid') {
      const props = (row.properties ?? '').toLowerCase();
      const ranged = /range|thrown|ammunition/.test(props) && !/melee/.test(row.type?.toLowerCase() ?? '') && /ranged/i.test(`${row.type ?? ''} ${row.properties ?? ''}`);
      const ability = ranged || /finesse/.test(props) ? 'dex' : 'str';
      raw.activities = [
        category === 'weapon'
          ? { id: `act-${slug}`, name, type: 'attack', actionEconomy: 'action', attackAbility: ability, attackBonusFormula: '@mod+@prof', damageFormula: `${damage.value}+@mod`, ...(row.damageType ? { damageType: row.damageType.toLowerCase() } : {}) }
          : { id: `act-${slug}`, name, type: row.save ? 'save' : 'utility', actionEconomy: 'action', ...(row.save ? { saveAbility: row.save.slice(0, 3).toLowerCase(), saveDcFormula: '8+@prof+@spell' } : {}), damageFormula: damage.value, ...(row.damageType ? { damageType: row.damageType.toLowerCase() } : {}) },
      ];
    } else if (row.damage) {
      // keep the bad value visible to the validator through an activity it will reject
      raw.activities = [{ id: `act-${slug}`, name, type: 'attack', actionEconomy: 'action', damageFormula: row.damage }];
    }
  }
  if (category === 'armor' && row.ac) {
    const ac = parseArmorClass(row.ac);
    if (ac && 'base' in ac) raw.acFormula = ac;
  }
  if (category === 'shield' && row.ac) {
    const ac = parseArmorClass(row.ac);
    if (ac && 'flat' in ac) raw.acFlatBonus = ac.flat;
  }
  if (category === 'monster') {
    const dex = row.dexModifier !== undefined ? toNumber(row.dexModifier)?.n : row.dex !== undefined ? Math.floor(((toNumber(row.dex)?.n ?? 10) - 10) / 2) : undefined;
    raw.monsterMeta = {
      ...(row.ac !== undefined ? { ac: row.ac } : {}),
      ...(row.hp !== undefined ? { hp: row.hp } : {}),
      ...(dex !== undefined ? { dexModifier: dex } : {}),
      ...(row.cr !== undefined ? { cr: row.cr } : {}),
      ...(row.size ? { size: row.size } : {}),
    };
  }
  return raw;
}

function parseCsv(text: string, ctx: Ctx): PipelineResult {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(header) ?? ',';
  const rows = parseCsvRows(text, delimiter);
  const head = rows[0];
  if (!head || rows.length < 2) return failed('csv', ctx.name, 'a table needs a header row and at least one data row');
  const keys = head.map((h) => COLUMN_ALIASES[h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()] ?? '');
  if (!keys.includes('name')) return failed('csv', ctx.name, 'no "name" column in the header row');
  const category = ctx.opts.categoryHint ?? guessCsvCategory(new Set(keys));
  const rejected: Rejection[] = [];
  const raws: unknown[] = [];
  rows.slice(1).forEach((cells, i) => {
    const row: Record<string, string> = {};
    keys.forEach((k, idx) => {
      const v = cells[idx];
      if (k && v !== undefined && v !== '' && row[k] === undefined) row[k] = v;
    });
    if (!row.name) {
      rejected.push({ source: `${ctx.name} row ${i + 2}`, reason: 'missing name' });
      return;
    }
    raws.push(csvRowToRaw(row, category));
  });
  const items = sanitizeEntityList(raws, ctx.sanitize, rejected, `${ctx.name} row`);
  if (cellsOverflow(rows, head.length)) {
    return makeResult('csv', items, rejected, [`${ctx.name}: some rows have more cells than the header; the extras were ignored.`]);
  }
  return makeResult('csv', items, rejected, []);
}

function cellsOverflow(rows: string[][], width: number): boolean {
  return rows.slice(1).some((r) => r.length > width && r.slice(width).some((c) => c !== ''));
}

// ---------------------------------------------------------------- JSON entities

const WRAPPER_KEYS: Record<string, ItemCategory | undefined> = {
  entities: undefined, items: 'gear', equipment: 'gear', spells: 'spell', monsters: 'monster', creatures: 'monster', feats: 'feat',
  features: 'feature', weapons: 'weapon', armor: 'armor', armour: 'armor', backgrounds: 'background', species: 'species', races: 'species', infusions: 'infusion',
};

interface Collected {
  entities: Array<{ raw: unknown; hint: ItemCategory | undefined }>;
  characters: Array<Record<string, unknown>>;
  rejected: Rejection[];
}

function looksLikeCharacter(o: Record<string, unknown>): boolean {
  return (o.abilities !== undefined || o.baseAbilities !== undefined) && Array.isArray(o.classes);
}

function collectJson(value: unknown, hint: ItemCategory | undefined, out: Collected, depth: number, label: string): void {
  if (depth > 5) {
    out.rejected.push({ source: label, reason: 'nested too deeply' });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectJson(v, hint, out, depth + 1, `${label} ${i + 1}`));
    return;
  }
  if (typeof value === 'string' && depth > 0) {
    out.rejected.push({ source: label, reason: `"${value.slice(0, 40)}" is a file reference, not an entry (install the repo as a pack to follow it)` });
    return;
  }
  if (!isObj(value)) {
    out.rejected.push({ source: label, reason: 'not an object' });
    return;
  }
  if (looksLikeCharacter(value)) {
    out.characters.push(value);
    return;
  }
  const wrapperKey = Object.keys(value).find((k) => k in WRAPPER_KEYS && Array.isArray(value[k]));
  const isEntityLike = typeof value.name === 'string' && (typeof value.category === 'string' || Array.isArray(value.activities) || value.monsterMeta !== undefined);
  if (wrapperKey && !isEntityLike) {
    for (const k of Object.keys(value)) {
      if (k in WRAPPER_KEYS && Array.isArray(value[k])) collectJson(value[k], WRAPPER_KEYS[k] ?? hint, out, depth + 1, `${k}`);
    }
    if (Array.isArray(value.characters)) for (const c of value.characters) if (isObj(c)) out.characters.push(c);
    return;
  }
  out.entities.push({ raw: value, hint });
}

function parseEntityJson(value: unknown, ctx: Ctx, format: DetectedFormat = 'entity-json'): PipelineResult {
  const collected: Collected = { entities: [], characters: [], rejected: [] };
  collectJson(value, ctx.opts.categoryHint, collected, 0, 'entry');
  const rejected = [...collected.rejected];
  const items: ProcessedEntity[] = [];
  collected.entities.forEach(({ raw, hint }, i) => {
    const res = sanitizeEntity(raw, { ...ctx.sanitize, fallbackCategory: hint ?? ctx.sanitize.fallbackCategory });
    if (res.ok) items.push({ entity: res.entity, notes: res.notes, explicitId: res.explicitId });
    else rejected.push({ source: res.label === 'entry' ? `entry ${i + 1}` : res.label, reason: res.reason });
  });
  const unique = dedupeProcessedIds(items, rejected);
  const local = new Map(unique.map((i) => [i.entity.id, i.entity]));
  const characters: RawCharacterState[] = [];
  const warnings: string[] = [];
  for (const obj of collected.characters) {
    const res = normalizeIncomingCharacter(obj, (id) => local.get(id) ?? ctx.opts.resolveEntity?.(id), ctx.opts.classLookup, ctx.opts.quietMissing);
    const label = typeof obj.name === 'string' && obj.name ? obj.name : 'unnamed character';
    if (res.character) {
      characters.push(res.character);
      res.warnings.forEach((w) => warnings.push(`${label}: ${w}`));
    } else rejected.push({ source: label, reason: res.problems.join('; ') });
  }
  return makeResult(format, unique, rejected, warnings, characters);
}

// ---------------------------------------------------------------- the other formats

function parseFiveTools(value: unknown, ctx: Ctx): PipelineResult {
  const adapted = adapt5eToolsPayload(value);
  const rejected: Rejection[] = [];
  if (adapted.skipped > 0) rejected.push({ source: `${adapted.skipped} entries`, reason: 'missing name (5e.tools entries need a name)' });
  const items = sanitizeEntityList(adapted.entities, ctx.sanitize, rejected, '5e.tools entry');
  return makeResult('five-tools', items, rejected, []);
}

function markExplicit(items: ProcessedEntity[], stable: boolean): ProcessedEntity[] {
  for (const i of items) i.explicitId = stable;
  return items;
}

function parseFree5eMarkdown(text: string, ctx: Ctx): PipelineResult {
  if (isFree5eIndexPage(text, ctx.opts.name)) return makeResult('free5e-markdown', [], [], [`${ctx.name}: index page (links only), skipped.`]);
  const hint = ctx.sanitize.fallbackCategory ?? 'gear';
  const parsed = parseFree5eMarkdownBatch(text, hint, ctx.opts.sourceLabel);
  const rejected: Rejection[] = [];
  if (parsed.length === 0) return failed('free5e-markdown', ctx.name, 'no entries found (an index page, or the layout is not recognized)');
  const items = sanitizeEntityList(parsed, ctx.sanitize, rejected, `${ctx.name} entry`);
  return makeResult('free5e-markdown', markExplicit(items, ctx.opts.stableIds === true), rejected, []);
}

function parseHomebrewMarkdown(text: string, ctx: Ctx, format: DetectedFormat): PipelineResult {
  const isStatblock = /Armor\s*Class/i.test(text) && /Hit\s*Points/i.test(text);
  const hint = ctx.sanitize.fallbackCategory;
  // a Free5e-style feat / spell page (the file's folder says what it is): the Free5e reader knows the layout
  if (!isStatblock && (hint === 'feat' || hint === 'spell')) return parseFree5eMarkdown(text, ctx);
  const rejected: Rejection[] = [];
  const raws: Array<{ entity: CompendiumEntity; notes: string[] }> = [];
  const ruleset = ctx.opts.defaultRuleset ?? 'homebrew';
  const source = ctx.opts.sourceLabel ?? 'Custom Homebrew';
  if (/Armor\s*Class\b/i.test(text) && /Hit\s*Points\b/i.test(text)) {
    for (const s of extractStatblocksFromText(text, { ruleset, source, idPrefix: 'hb' })) {
      if (s.entity) raws.push({ entity: s.entity, notes: s.problems.map((p) => `statblock: ${p}`) });
      else rejected.push({ source: s.name, reason: s.problems.join('; ') || 'statblock not readable' });
    }
  }
  if (raws.length === 0 && rejected.length === 0) {
    for (const [i, block] of splitMarkdownBlocks(text).entries()) {
      const res = parseHomebrewMarkdownBlock(block, ctx.sanitize.fallbackCategory ?? 'feature', ruleset);
      if (!res.data.name || res.data.name === 'Unnamed Homebrew Entry') {
        rejected.push({ source: `${ctx.name} block ${i + 1}`, reason: 'no name found' });
        continue;
      }
      raws.push({
        entity: { ...res.data, source: ctx.opts.sourceLabel ?? res.data.source },
        notes: res.warnings.slice(0, 3).map((w) => `line ${w.line}: ${w.reason}`),
      });
    }
  }
  const items: ProcessedEntity[] = [];
  for (const { entity, notes } of raws) {
    const res = sanitizeEntity(entity, { ...ctx.sanitize, defaultRuleset: ruleset });
    if (res.ok) items.push({ entity: res.entity, notes: [...notes, ...res.notes], explicitId: ctx.opts.stableIds === true });
    else rejected.push({ source: res.label, reason: res.reason });
  }
  return makeResult(format, dedupeProcessedIds(items, rejected), rejected, []);
}

function parseBundle(value: Record<string, unknown>, ctx: Ctx): PipelineResult {
  const list = Array.isArray(value.compendium) ? value.compendium : [];
  const rejected: Rejection[] = [];
  const items = sanitizeEntityList(list, { ...ctx.sanitize, fallbackCategory: undefined }, rejected, 'backup entry');
  const chars = Array.isArray(value.characters) ? value.characters.filter((c): c is RawCharacterState => isObj(c)) : [];
  const bundle = { ...value, compendium: items.map((i) => i.entity) };
  return makeResult('app-bundle', items, rejected, [], chars, bundle);
}

// ---------------------------------------------------------------- run

interface Ctx {
  opts: PipelineOptions;
  name: string;
  sanitize: { fallbackCategory?: ItemCategory; defaultRuleset?: Ruleset; sourceLabel?: string };
}

function hintFromName(name: string | undefined): ItemCategory | undefined {
  if (!name) return undefined;
  const guess = guessCategoryFromPath(name);
  return guess === 'gear' && !/gear|item|equip/i.test(name) ? undefined : guess;
}

function finalize(result: PipelineResult, opts: PipelineOptions): PipelineResult {
  if (!opts.mapEntity && !opts.packFile) return result;
  const items = result.items.map((i) => {
    const mapped = opts.mapEntity ? opts.mapEntity(i.entity) : i.entity;
    return { ...i, entity: opts.packFile ? { ...mapped, packFile: opts.packFile } : mapped };
  });
  return makeResult(result.format, items, result.rejected, result.warnings, result.characters, result.bundle, result.identicalMerged);
}

/** Detects the format of `rawText`, parses it with the matching adapter and cleans every entity. Never throws. */
export function runImportPipeline(rawText: string, opts: PipelineOptions = {}): PipelineResult {
  const name = opts.name?.trim() || 'pasted text';
  if (typeof rawText !== 'string') return failed('unknown', name, 'the content is not text');
  try {
    const text = rawText.replace(/^\uFEFF/, '');
    const format = detectFormat(text, opts);
    const fallbackCategory = opts.categoryHint ?? hintFromName(opts.name);
    const ctx: Ctx = {
      opts,
      name,
      sanitize: {
        ...(fallbackCategory ? { fallbackCategory } : {}),
        ...(opts.defaultRuleset ? { defaultRuleset: opts.defaultRuleset } : {}),
        ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel } : {}),
      },
    };
    let result: PipelineResult;
    switch (format) {
      case 'empty':
        return failed(format, name, 'the file is empty');
      case 'binary':
        return failed(format, name, 'this is a binary file (PDF or other); open it with the PDF import instead of as text');
      case 'invalid-json': {
        const json = tryJson(text.trim());
        return failed(format, name, `not valid JSON (${json.ok ? 'unreadable' : json.error.slice(0, 120)})`);
      }
      case 'unknown':
        return failed(format, name, 'format not recognized (expected JSON, Markdown, CSV or a PDF statblock)');
      case 'pack-manifest':
        return failed(format, name, 'this is a pack.json: install the repo as a pack (Packs tab) or run "bun run content:validate --pack <dir>"');
      case 'app-bundle': {
        const json = tryJson(text.trim());
        result = json.ok && isObj(json.value) ? parseBundle(json.value, ctx) : failed(format, name, 'backup bundle unreadable');
        break;
      }
      case 'five-tools':
      case 'entity-json':
      case 'character-json': {
        const json = tryJson(text.trim());
        if (!json.ok) return failed('invalid-json', name, `not valid JSON (${json.error.slice(0, 120)})`);
        result = format === 'five-tools' ? parseFiveTools(json.value, ctx) : parseEntityJson(json.value, ctx, format);
        if (format === 'five-tools' && result.accepted.length === 0 && result.rejected.length === 0) {
          result = parseEntityJson(json.value, ctx);
        }
        break;
      }
      case 'csv':
        result = parseCsv(text, ctx);
        break;
      case 'free5e-markdown':
        result = parseFree5eMarkdown(text, ctx);
        break;
      case 'homebrew-markdown':
      case 'pdf-text':
        result = parseHomebrewMarkdown(text, ctx, format);
        break;
    }
    if (result.accepted.length === 0 && result.characters.length === 0 && result.rejected.length === 0 && result.warnings.length === 0 && result.format !== 'app-bundle') {
      result = makeResult(result.format, [], [{ source: name, reason: 'recognized, but no entries were found in it' }], result.warnings);
    }
    return finalize(result, opts);
  } catch (err) {
    return failed('unknown', name, `unexpected problem while reading (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** Text extracted from a PDF: form fields (a D&D Beyond character sheet) or running text (statblocks). */
export function importPdfExtract(fields: Record<string, string>, pagesText: string, name: string, opts: PipelineOptions = {}): PipelineResult {
  if (Object.keys(fields).length >= 5) {
    const summary = buildCharacterFromDdbFields(fields, name.replace(/\.pdf$/i, ''));
    return resultFromCharacter(summary.character, summary.warnings);
  }
  return runImportPipeline(pagesText, { ...opts, name, assumeFormat: 'pdf-text' });
}

/** A character produced by an adapter (D&D Beyond PDF): its weapons / spells go through the same cleaning. */
export function resultFromCharacter(character: RawCharacterState, warnings: string[] = []): PipelineResult {
  const rejected: Rejection[] = [];
  const items = sanitizeEntityList(character.items, {}, rejected, 'sheet item');
  const cleaned: RawCharacterState = { ...character, items: items.map((i) => i.entity) };
  return makeResult('pdf-text', items, rejected, warnings, [cleaned]);
}

/** Cleans entities that are already parsed (built-in packs, a Free5e tree, hand-made content). */
export function runImportPipelineOnEntities(
  entities: readonly unknown[],
  opts: PipelineOptions & { explicitIds?: boolean } = {}
): PipelineResult {
  const rejected: Rejection[] = [];
  const ctx = {
    ...(opts.categoryHint ? { fallbackCategory: opts.categoryHint } : {}),
    ...(opts.defaultRuleset ? { defaultRuleset: opts.defaultRuleset } : {}),
    ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel } : {}),
  };
  const items = sanitizeEntityList(entities, ctx, rejected, opts.name ?? 'entry');
  if (opts.explicitIds !== undefined) markExplicit(items, opts.explicitIds);
  return finalize(makeResult('entity-json', items, rejected, []), opts);
}

// ---------------------------------------------------------------- merging and reports

/** Combines the results of several files into one (ids are made unique across all of them). */
export function mergePipelineResults(results: readonly PipelineResult[], format: DetectedFormat = 'entity-json'): PipelineResult {
  const rejected = results.flatMap((r) => r.rejected);
  const items = dedupeProcessedIds(results.flatMap((r) => r.items), rejected);
  return makeResult(
    format,
    items,
    rejected,
    results.flatMap((r) => r.warnings),
    results.flatMap((r) => r.characters),
    undefined,
    results.reduce((n, r) => n + r.identicalMerged, 0)
  );
}

export interface ImportReport {
  format: DetectedFormat | 'pack';
  files: number;
  accepted: number;
  repaired: Array<{ name: string; category: string; notes: string[] }>;
  rejected: Rejection[];
  /** Identical copies inside the same import / pack (e.g. a batch file plus single files), merged silently. */
  identicalMerged?: number;
  warnings: string[];
  /** Pack files that could not be read; their existing entries are kept on an update. */
  unreadable: string[];
  characters: number;
  /** On a pack update: entries whose file could not be read this time and that were therefore kept. */
  keptEntries?: number;
  /** Older repo-synced entries (no provenance) that this pack took over instead of duplicating. */
  adopted?: number;
  /** Most common problems (repairs and rejections) with counts, numbers and quoted names folded together. */
  topProblems: Array<{ text: string; count: number }>;
}

function foldProblem(text: string): string {
  return text.replace(/"[^"]*"/g, '"\u2026"').replace(/\d+(?:\.\d+)?/g, 'N');
}

export function buildImportReport(result: PipelineResult, extra: { files?: number; unreadable?: string[]; format?: ImportReport['format'] } = {}): ImportReport {
  const counts = new Map<string, number>();
  for (const r of result.repaired) for (const n of r.notes) counts.set(foldProblem(n), (counts.get(foldProblem(n)) ?? 0) + 1);
  for (const r of result.rejected) counts.set(foldProblem(r.reason), (counts.get(foldProblem(r.reason)) ?? 0) + 1);
  return {
    format: extra.format ?? result.format,
    files: extra.files ?? 1,
    accepted: result.accepted.length,
    repaired: result.repaired.map((r) => ({ name: r.entity.name, category: r.entity.category, notes: r.notes })),
    rejected: result.rejected,
    ...(result.identicalMerged > 0 ? { identicalMerged: result.identicalMerged } : {}),
    warnings: result.warnings,
    unreadable: extra.unreadable ?? [],
    characters: result.characters.length,
    topProblems: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([text, count]) => ({ text, count })),
  };
}

/** "12 accepted (3 repaired), 2 rejected" */
export function summarizeReport(report: ImportReport): string {
  const parts = [`${report.accepted} accepted${report.repaired.length > 0 ? ` (${report.repaired.length} repaired)` : ''}`, `${report.rejected.length} rejected`];
  if (report.identicalMerged) parts.push(`${report.identicalMerged} identical cop${report.identicalMerged === 1 ? 'y' : 'ies'} merged`);
  if (report.unreadable.length > 0) parts.push(`${report.unreadable.length} file${report.unreadable.length === 1 ? '' : 's'} unreadable`);
  if (report.keptEntries) parts.push(`${report.keptEntries} unreadable — kept`);
  if (report.adopted) parts.push(`${report.adopted} existing adopted`);
  return parts.join(', ');
}

/** The "pack doctor" text shown by the CLI and in the install preview. */
export function formatPackDoctor(report: ImportReport): string[] {
  const lines = [`Entries: ${summarizeReport(report)}${report.characters > 0 ? `; ${report.characters} character(s)` : ''}`];
  if (report.files > 1) lines.unshift(`Files read: ${report.files}`);
  if (report.topProblems.length > 0) {
    lines.push('Top problems:');
    for (const p of report.topProblems) lines.push(`  ${p.count}x ${p.text}`);
  }
  for (const f of report.unreadable) lines.push(`Unreadable (kept as they were on update): ${f}`);
  for (const r of report.rejected.slice(0, 10)) lines.push(`Rejected: ${r.source}: ${r.reason}`);
  if (report.rejected.length > 10) lines.push(`... and ${report.rejected.length - 10} more rejected`);
  return lines;
}

// ---------------------------------------------------------------- packs (shared by the app and the CLI)

export interface PackFilesInput {
  /** Pack id: the Free5e pack keeps its parsers' stable ids. */
  packId: string;
  sourceLabel: string;
  defaultRuleset?: Ruleset;
  mapEntity?: (entity: CompendiumEntity) => CompendiumEntity;
  mapCharacter?: (character: RawCharacterState) => RawCharacterState;
  /** Pack version / pinned ref, stamped on the entities characters receive (same values the install stamps). */
  packVersion?: string;
  packRef?: string;
  /** Pack ids this pack builds on (manifest `requires`). */
  requires?: readonly string[];
  /** Ids of the required packs that are installed; refs into them resolve through `resolveEntity`. */
  installedPackIds?: ReadonlySet<string>;
  /** Looks up entities already stored (the compendium) for character references. */
  resolveEntity?: (id: string) => CompendiumEntity | undefined;
  contentPaths: readonly string[];
  characterPaths: readonly string[];
  categoryHints?: Readonly<Record<string, ItemCategory>>;
  /** Entities / characters written straight into an old campaign-pack.json. */
  inlineEntities?: readonly unknown[];
  inlineCharacters?: readonly unknown[];
  /** Reads one file of the pack (a repo file, a local file ...). May throw: that file is then "unreadable". */
  read: (path: string) => Promise<string>;
}

export interface PackFilesOutput {
  /** Entities of every readable file, ids made unique across files. */
  merged: PipelineResult;
  characters: RawCharacterState[];
  /** Files that could not be read or are not text; on an update their entries are kept. */
  unreadable: string[];
  /** File-level notes ("x.json: not valid JSON, skipped."). */
  warnings: string[];
  filesRead: number;
  /** Every listed file failed: there is nothing to install. */
  allFailed: boolean;
}

const SKIPPED_NAMES = /(^|\/)(readme|license|licence|changelog|contributing|code_of_conduct)(\.[a-z]+)?$/i;
const NOT_CONTENT = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|woff2?|ttf|mp3|ogg|wav|mp4)$/i;
const UNREADABLE_FORMATS: ReadonlySet<DetectedFormat> = new Set(['invalid-json', 'binary', 'unknown']);

/** Reads every file a pack lists through the pipeline. Never throws; file problems end up in the output. */
export async function processPackFiles(input: PackFilesInput): Promise<PackFilesOutput> {
  const warnings: string[] = [];
  const unreadable: string[] = [];
  const results: PipelineResult[] = [];
  let filesRead = 0;
  const stableIds = input.packId === 'free5e';
  const shared: PipelineOptions = {
    sourceLabel: input.sourceLabel,
    ...(input.defaultRuleset ? { defaultRuleset: input.defaultRuleset } : {}),
    ...(input.mapEntity ? { mapEntity: input.mapEntity } : {}),
  };
  const prefixed = (path: string, r: PipelineResult): PipelineResult => ({
    ...r,
    rejected: r.rejected.map((x) => ({ source: `${path}: ${x.source}`, reason: x.reason })),
  });
  const readText = async (path: string): Promise<string | null> => {
    try {
      return await input.read(path);
    } catch (err) {
      unreadable.push(path);
      warnings.push(`${path}: could not be read (${err instanceof Error ? err.message : String(err)}).`);
      return null;
    }
  };

  if (input.inlineEntities && input.inlineEntities.length > 0) {
    results.push(runImportPipelineOnEntities(input.inlineEntities, { ...shared, categoryHint: 'gear', name: 'campaign-pack.json' }));
  }

  for (const path of input.contentPaths) {
    if (NOT_CONTENT.test(path)) {
      warnings.push(`${path}: not a content file (image or binary), skipped.`);
      continue;
    }
    if (SKIPPED_NAMES.test(path)) continue;
    const text = await readText(path);
    if (text === null) continue;
    filesRead++;
    const hint = input.categoryHints?.[path] ?? guessCategoryFromPath(path);
    const result = prefixed(path, runImportPipeline(text, { ...shared, name: path, categoryHint: hint, stableIds, packFile: path }));
    if (UNREADABLE_FORMATS.has(result.format)) {
      unreadable.push(path);
      warnings.push(result.format === 'invalid-json' ? `${path}: not valid JSON, skipped.` : `${path}: ${result.rejected[0]?.reason ?? 'could not be read'}; skipped.`);
      continue;
    }
    if (result.accepted.length === 0 && result.rejected.length === 0 && result.warnings.length === 0) warnings.push(`${path}: no entries found.`);
    results.push(result);
  }
  const allFailed = unreadable.length > 0 && filesRead === 0 && results.length === 0;

  // Characters resolve against this pack's own entities first (by the id in the file and by the id the install
  // will store, `<packId>:<slug>` when the file gave none), then the compendium.
  const contentMerge = mergePipelineResults(results);
  const stored = assignPackIdentity(
    contentMerge.items.map((i) => ({ entity: i.entity, hadId: i.explicitId })),
    { packId: input.packId, packVersion: input.packVersion ?? '', ...(input.packRef ? { packRef: input.packRef } : {}) }
  );
  const ownById = new Map<string, CompendiumEntity>();
  contentMerge.items.forEach((i, n) => {
    const s = stored[n];
    if (s) ownById.set(i.entity.id, s);
  });
  for (const s of stored) ownById.set(s.id, s);
  const notInstalled = (input.requires ?? []).filter((r) => !input.installedPackIds?.has(r));
  const missingByPack = new Map<string, number>(notInstalled.map((r) => [r, 0]));
  const resolveEntity = (id: string): CompendiumEntity | undefined => ownById.get(id) ?? ownById.get(`${input.packId}:${id}`) ?? input.resolveEntity?.(id);
  const quietMissing = (id: string): boolean => {
    const owner = notInstalled.find((r) => id.startsWith(`${r}:`));
    if (owner === undefined) return false;
    missingByPack.set(owner, (missingByPack.get(owner) ?? 0) + 1);
    return true;
  };
  const charOpts = { resolveEntity, quietMissing };

  const charResults: PipelineResult[] = [];
  const takeCharacters = (r: PipelineResult) => {
    charResults.push({ ...r, items: [] });
  };
  if (input.inlineCharacters && input.inlineCharacters.length > 0) {
    takeCharacters(runImportPipeline(JSON.stringify(input.inlineCharacters), { name: 'campaign-pack.json (characters)', ...charOpts }));
  }
  for (const path of input.characterPaths) {
    const text = await readText(path);
    if (text === null) continue;
    const r = prefixed(path, runImportPipeline(text, { name: path, ...charOpts }));
    if (UNREADABLE_FORMATS.has(r.format)) {
      unreadable.push(path);
      warnings.push(r.format === 'invalid-json' ? `${path}: not valid JSON, skipped.` : `${path}: ${r.rejected[0]?.reason ?? 'could not be read'}; skipped.`);
      continue;
    }
    takeCharacters(r);
  }

  for (const [pack, n] of missingByPack) {
    if (n > 0) warnings.push(`Required pack "${pack}" is not installed: ${n} character reference${n === 1 ? '' : 's'} into it ${n === 1 ? 'was' : 'were'} skipped.`);
  }
  const merged = mergePipelineResults([...results, ...charResults]);
  // characters can sit in content files, in character files or inline: they all come out of the merge
  const characters = input.mapCharacter ? merged.characters.map(input.mapCharacter) : merged.characters;
  return { merged, characters, unreadable, warnings: [...warnings, ...merged.warnings], filesRead, allFailed };
}

export interface PackAnalysis {
  /** Which kind of pack: pack.json (v1), campaign-pack.json (v0) or just loose files. */
  kind: 'v1' | 'v0' | 'loose';
  /** Problems with the manifest itself (empty when fine). */
  manifestProblems: string[];
  packId: string;
  packName: string;
  report: ImportReport;
  warnings: string[];
  result: PipelineResult;
}

/** The "pack doctor": reads a pack given as `{ path: text }` the way an install would and reports on it. */
export async function analyzePackFiles(files: Readonly<Record<string, string>>, fallbackName = 'pack'): Promise<PackAnalysis> {
  const paths = Object.keys(files).sort();
  const problems: string[] = [];
  let kind: PackAnalysis['kind'] = 'loose';
  let packId = fallbackName;
  let packName = fallbackName;
  let sourceLabel = fallbackName;
  let ruleset: Ruleset | undefined;
  let content: string[] = [];
  let requires: string[] = [];
  let characterPatterns: string[] = [];
  let categoryHints: Record<string, ItemCategory> | undefined;
  let inlineEntities: unknown[] = [];
  let inlineCharacters: unknown[] = [];

  const parseJsonFile = (path: string): unknown => {
    try {
      return JSON.parse((files[path] ?? '').replace(/^﻿/, '')) as unknown;
    } catch (err) {
      problems.push(`${path} is not valid JSON (${err instanceof Error ? err.message.slice(0, 100) : 'unreadable'})`);
      return undefined;
    }
  };

  if (files['pack.json'] !== undefined) {
    kind = 'v1';
    const raw = parseJsonFile('pack.json');
    if (raw !== undefined) {
      const parsed = parsePackManifest(raw);
      if (parsed.ok) {
        packId = parsed.manifest.id;
        packName = parsed.manifest.name;
        sourceLabel = parsed.manifest.name;
        if (parsed.manifest.ruleset === '2014' || parsed.manifest.ruleset === '2024') ruleset = parsed.manifest.ruleset;
        content = parsed.manifest.content;
        requires = parsed.manifest.requires;
        characterPatterns = parsed.manifest.characters;
      } else problems.push(...parsed.errors);
    }
  } else if (files['campaign-pack.json'] !== undefined) {
    kind = 'v0';
    const raw = parseJsonFile('campaign-pack.json');
    if (raw !== undefined) {
      const legacy = convertLegacyManifest(raw, { owner: 'local', repo: fallbackName });
      packId = legacy.manifest.id;
      packName = legacy.manifest.name;
      sourceLabel = legacy.sourceLabel;
      content = legacy.manifest.content;
      characterPatterns = legacy.manifest.characters;
      categoryHints = legacy.categoryHints;
      inlineEntities = legacy.inlineEntities;
      inlineCharacters = legacy.inlineCharacters;
    }
  } else {
    content = paths.filter((p) => /\.(json|md|markdown|csv|tsv|txt)$/i.test(p));
  }

  const warnings: string[] = [];
  const expand = (patterns: string[], field: string): string[] => {
    const out: string[] = [];
    for (const pattern of patterns) {
      const hits = expandGlobs([pattern], paths).filter((f) => f !== 'pack.json' && f !== 'campaign-pack.json');
      if (isGlob(pattern) && hits.length === 0) warnings.push(`"${field}" pattern "${pattern}" matched no files.`);
      if (!isGlob(pattern) && hits.length === 0) {
        // an explicit path with no file behind it: report it as unreadable below
        out.push(pattern);
        continue;
      }
      for (const h of hits) if (!out.includes(h)) out.push(h);
    }
    return out;
  };

  const out = await processPackFiles({
    packId,
    sourceLabel,
    requires,
    ...(ruleset ? { defaultRuleset: ruleset } : {}),
    contentPaths: expand(content, 'content'),
    characterPaths: expand(characterPatterns, 'characters'),
    ...(categoryHints ? { categoryHints } : {}),
    inlineEntities,
    inlineCharacters,
    read: (path) => {
      const text = files[path];
      return text === undefined ? Promise.reject(new Error('file not found in the pack')) : Promise.resolve(text);
    },
  });
  const report = buildImportReport(out.merged, { files: out.filesRead, unreadable: out.unreadable, format: 'pack' });
  return { kind, manifestProblems: problems, packId, packName, report: { ...report, characters: out.characters.length }, warnings: [...warnings, ...out.warnings], result: out.merged };
}
