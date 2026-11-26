import type { Activity, ActivityType, CompendiumEntity, CreatureSize, ItemCategory, MonsterStatMeta } from '../types/compendium';
import type { AbilityKey, ActionEconomy, Ruleset, WeaponMastery } from '../types/core';
import { normalizeEntries } from './entries';
import { pickImageRef, sanitizeArtCredit } from './image-ref';

/**
 * The one place where incoming content is cleaned: text (BOM, CRLF, unicode, HTML, 5e.tools tags),
 * ids, category, ruleset, CR, dice formulas, numbers given as strings. Every entity that leaves
 * here is either valid, valid after a repair (the repairs are listed as notes, never silent) or
 * rejected with a reason. Pure: no React, DOM or storage.
 *
 * What counts as a note: anything that changes the meaning of a value (a guessed category, a clamped
 * number, "0.25" -> "1/4", "STR" -> "@str", a dropped formula). Purely cosmetic clean-up (BOM, CRLF,
 * stray whitespace, HTML tags, the case of "D") is applied without a note, or every file would be
 * "repaired".
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const KNOWN_CATEGORIES: readonly ItemCategory[] = [
  'weapon', 'armor', 'shield', 'gear', 'spell', 'feature', 'feat', 'infusion', 'monster', 'background', 'species',
];
const ACTIVITY_TYPES: readonly ActivityType[] = ['attack', 'save', 'heal', 'summon', 'utility'];
const ACTION_ECONOMIES: readonly ActionEconomy[] = ['action', 'bonus_action', 'reaction', 'free', 'special'];
const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SIZES: readonly CreatureSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const MASTERIES: readonly WeaponMastery[] = ['Cleave', 'Graze', 'Nick', 'Push', 'Sap', 'Slow', 'Topple', 'Vex'];

export const MAX_NAME_LENGTH = 200;
export const MAX_ENTRY_LENGTH = 20000;
export const MAX_ENTRIES = 400;
const MAX_ID_LENGTH = 200;
const MAX_SHORT_TEXT = 500;
const MAX_ACTIVITIES = 100;

const CATEGORY_ALIASES: Record<string, ItemCategory> = {
  spell: 'spell', spells: 'spell', cantrip: 'spell', cantrips: 'spell',
  monster: 'monster', monsters: 'monster', creature: 'monster', creatures: 'monster', npc: 'monster', npcs: 'monster', beast: 'monster', bestiary: 'monster',
  weapon: 'weapon', weapons: 'weapon',
  armor: 'armor', armour: 'armor', armors: 'armor', armours: 'armor',
  shield: 'shield', shields: 'shield',
  gear: 'gear', item: 'gear', items: 'gear', equipment: 'gear', tool: 'gear', tools: 'gear', 'adventuring gear': 'gear', 'magic item': 'gear', 'magic items': 'gear',
  'wondrous item': 'gear', potion: 'gear', scroll: 'gear', ring: 'gear', wand: 'gear', rod: 'gear', staff: 'gear', ammunition: 'gear',
  feat: 'feat', feats: 'feat',
  feature: 'feature', features: 'feature', 'class feature': 'feature', trait: 'feature', traits: 'feature', ability: 'feature',
  infusion: 'infusion', infusions: 'infusion',
  background: 'background', backgrounds: 'background',
  species: 'species', race: 'species', races: 'species',
};

export function slugifyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------- text

const HTML_TAG = /<\/?(?:p|br|b|i|em|strong|u|ul|ol|li|div|span|a|h[1-6]|table|tr|td|th|thead|tbody|sup|sub|hr|img|font|center|blockquote|code|pre)\b[^>]*>/gi;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...',
};

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function stripHtml(s: string): string {
  if (!/<\/?[a-z]/i.test(s)) return decodeEntities(s);
  const text = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n\u2022 ')
    .replace(HTML_TAG, '');
  return decodeEntities(text);
}

/** Replaces the variable part of a 5e.tools formula with the app's tokens: "2d6+STR" -> "2d6+@str". */
function compactDiceExpr(expr: string): string {
  return expr
    .replace(/\s+/g, '')
    .replace(/(\d)D(\d)/g, '$1d$2')
    .replace(/(?<![@\w])(str|dex|con|int|wis|cha)(?:mod(?:ifier)?)?(?!\w)/gi, (_m, a: string) => `@${a.toLowerCase()}`);
}

const ATK_TEXT: Record<string, string> = {
  mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:',
  'mw,rw': 'Melee or Ranged Weapon Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:',
};
const PLAIN_TAGS = new Set([
  'b', 'bold', 'i', 'italic', 's', 'strike', 'u', 'underline', 'note', 'color', 'highlight', 'code', 'style', 'font',
  'filter', 'link', 'book', 'quickref', 'footnote', 'adventure', 'area', 'cite', 'kbd',
]);
const ROLL_TAGS = new Set(['dice', 'damage', 'hit', 'scaledamage', 'scaledice', 'd20']);

/**
 * Keeps the tags the app renders as clickable rolls ({@dice}, {@damage}, {@hit}, {@dc}, {@save},
 * {@recharge}, {@h}, references) and turns the ones it has no meaning for ({@b x}, {@atk mw}, {@filter ...})
 * into plain text. Stray "{@tag" without a closing brace is flattened.
 */
export function normalizeTags(s: string): string {
  if (!s.includes('{@')) return s;
  let out = s.replace(/\{@(\w+)(?:\s+([^}]*))?\}/g, (whole, rawTag: string, body: string | undefined) => {
    const tag = rawTag.toLowerCase();
    const text = (body ?? '').trim();
    if (tag === 'atk') return ATK_TEXT[text.toLowerCase().replace(/\s+/g, '')] ?? text;
    if (PLAIN_TAGS.has(tag)) return text.split('|')[0]?.trim() ?? '';
    if (ROLL_TAGS.has(tag)) {
      const [expr = '', ...rest] = text.split('|');
      const cleaned = compactDiceExpr(expr);
      return `{@${tag} ${[cleaned, ...rest].join('|')}}`;
    }
    return whole;
  });
  out = out.replace(/\{@(\w+)\s*([^}]*)$/, (_m, _tag: string, body: string) => body.split('|')[0]?.trim() ?? '');
  return out;
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Cosmetic clean-up only: encoding junk, line endings, HTML, 5e.tools formatting tags. Never changes meaning. */
export function cleanText(input: string): string {
  let s = input.replace(LONE_SURROGATE, '').replace(/^\uFEFF/, '');
  s = s.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(/\u00A0/g, ' ');
  s = s.replace(INVISIBLE, '').replace(/\uFFFD/g, '').replace(CONTROL, '');
  s = s.normalize('NFC');
  s = stripHtml(s);
  s = normalizeTags(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function oneLine(s: string): string {
  return cleanText(s).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- numbers, CR, formulas

/** A number from a number or a numeric-looking string ("15", "15 (natural armor)", "1,500", "2 lb."). */
export function toNumber(v: unknown): { n: number; exact: boolean; rest: string } | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v, exact: true, rest: '' } : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/,(?=\d{3}\b)/g, '').trim();
  const m = t.match(/^([-+]?\d+(?:\.\d+)?)/);
  if (!m?.[1]) return undefined;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? { n, exact: m[1].length === t.length, rest: t.slice(m[1].length).trim() } : undefined;
}

const CR_FRACTIONS: Record<string, string> = { '0.125': '1/8', '0.25': '1/4', '0.5': '1/2', '\u215B': '1/8', '\u00BC': '1/4', '\u00BD': '1/2' };

/** "0.25" -> "1/4", 0.5 -> "1/2", "CR 5 (1,800 XP)" -> "5", 5.0 -> "5". Undefined when it is not a challenge rating. */
export function normalizeCr(raw: unknown): string | undefined {
  let text: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return undefined;
    text = String(raw);
  } else if (typeof raw === 'string') {
    text = raw.trim().replace(/^cr\s*:?\s*/i, '').replace(/\s*\(.*\)\s*$/, '').replace(/\s*xp\b.*$/i, '').replace(/\s*\/\s*/g, '/').trim();
  } else {
    return undefined;
  }
  if (!text) return undefined;
  if (CR_FRACTIONS[text]) return CR_FRACTIONS[text];
  if (/^(?:1\/8|1\/4|1\/2)$/.test(text)) return text;
  if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const n = Number.parseFloat(text);
  const frac = CR_FRACTIONS[String(n)];
  if (frac) return frac;
  return Number.isInteger(n) && n >= 0 && n <= 30 ? String(n) : undefined;
}

export type FormulaResult =
  | { kind: 'ok'; value: string }
  | { kind: 'repaired'; value: string; note: string }
  | { kind: 'invalid'; note: string };

const FORMULA_TERM = '(?:\\d*d\\d+(?:k[hl]\\d+)?|\\d+|@(?:str|dex|con|int|wis|cha|mod|prof|spell|lvl|cantrip(?:d\\d+)?))';
const FORMULA_FULL = new RegExp(`^[+-]?${FORMULA_TERM}(?:[+-]${FORMULA_TERM})*$`);
const FORMULA_LEADING = new RegExp(`^([+-]?${FORMULA_TERM}(?:[+-]${FORMULA_TERM})*)(?=[^\\w@+-]|[a-z]|$)`);

/**
 * Normalizes a dice / bonus formula: "1d8 + 3" -> "1d8+3" (cosmetic), "2d6+STR" -> "2d6+@str" and
 * "1d8 slashing" -> "1d8" (repairs, with a note). Anything the dice roller could not read is invalid.
 */
export function normalizeFormula(raw: unknown): FormulaResult {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { kind: 'repaired', value: String(raw), note: `formula ${raw} was a number: kept as text` } : { kind: 'invalid', note: 'formula is not a number' };
  }
  if (typeof raw !== 'string') return { kind: 'invalid', note: 'formula is not text' };
  const original = raw.trim();
  if (!original) return { kind: 'invalid', note: 'formula is empty' };
  if (original.length > 200) return { kind: 'invalid', note: 'formula is far too long' };
  const unified = original.replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\u00D7x]\s*(?=\d)/g, '*');
  if (unified.includes('*')) return { kind: 'invalid', note: `formula "${original}" uses multiplication, which the dice roller cannot read` };
  const compact = compactDiceExpr(unified)
    .replace(/(?<![@\w])(?:mod|modifier)(?!\w)/gi, '@mod')
    .replace(/(?<![@\w])(?:prof|proficiency)(?!\w)/gi, '@prof')
    .replace(/@(str|dex|con|int|wis|cha|mod|prof|spell|lvl|cantrip)/gi, (_m, t: string) => `@${t.toLowerCase()}`);
  if (FORMULA_FULL.test(compact)) {
    const semantic = compact !== original.replace(/\s+/g, '').replace(/(\d)D(\d)/g, '$1d$2');
    return semantic ? { kind: 'repaired', value: compact, note: `formula "${original}" read as "${compact}"` } : { kind: 'ok', value: compact };
  }
  const lead = compact.match(FORMULA_LEADING)?.[1];
  if (lead && /[\dd@]/.test(lead) && lead.length < compact.length) {
    return { kind: 'repaired', value: lead, note: `formula "${original}" trimmed to "${lead}"` };
  }
  return { kind: 'invalid', note: `formula "${original}" is not a dice expression` };
}

function parseSpellLevel(raw: unknown): number | undefined | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 9 ? raw : 'invalid';
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    if (/^cantrip/.test(t)) return 0;
    const m = t.match(/^(\d+)(?:st|nd|rd|th)?(?:[- ]level)?$/);
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10);
      return n >= 0 && n <= 9 ? n : 'invalid';
    }
  }
  return 'invalid';
}

// ---------------------------------------------------------------- entity

export interface SanitizeContext {
  /** Category to use when the entry has none (from the file name or the caller). */
  fallbackCategory?: ItemCategory;
  defaultRuleset?: Ruleset;
  /** Source label for entries that carry none. */
  sourceLabel?: string;
}

export interface ProcessedEntity {
  entity: CompendiumEntity;
  /** Repairs applied (empty = accepted as it was). */
  notes: string[];
  /** False when the id was made up from the name. */
  explicitId: boolean;
}

export type EntityOutcome =
  | ({ ok: true } & ProcessedEntity)
  | { ok: false; reason: string; label: string };

function str(v: unknown, max = MAX_SHORT_TEXT): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = oneLine(v);
  return t ? t.slice(0, max) : undefined;
}

function bool(v: unknown, field: string, notes: string[]): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(t)) {
      notes.push(`${field} "${v}" read as true`);
      return true;
    }
    if (['false', 'no', 'n', '0', ''].includes(t)) {
      notes.push(`${field} "${v}" read as false`);
      return false;
    }
  }
  if (typeof v === 'number') {
    notes.push(`${field} ${v} read as ${v !== 0}`);
    return v !== 0;
  }
  notes.push(`${field} was not true/false: dropped`);
  return undefined;
}

const UNIT_ONLY = /^(?:lbs?\.?|pounds?|ft\.?|feet|[gesc]p)?$/i;

function num(v: unknown, field: string, notes: string[], opts: { min?: number; max?: number; int?: boolean } = {}): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const parsed = toNumber(v);
  if (!parsed) {
    notes.push(`${field} "${String(v).slice(0, 40)}" is not a number: dropped`);
    return undefined;
  }
  let n = parsed.n;
  if (!parsed.exact && !UNIT_ONLY.test(parsed.rest)) notes.push(`${field} "${String(v).slice(0, 40)}" read as ${n}`);
  if (opts.int && !Number.isInteger(n)) {
    n = Math.round(n);
    notes.push(`${field} rounded to ${n}`);
  }
  if ((opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    notes.push(`${field} ${n} is out of range: dropped`);
    return undefined;
  }
  return n;
}

function strList(v: unknown, field: string, notes: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  let list: string[];
  if (Array.isArray(v)) {
    list = v.flatMap((x) => (typeof x === 'string' ? [oneLine(x)] : isObj(x) && typeof x.name === 'string' ? [oneLine(x.name)] : [])).filter(Boolean);
  } else if (typeof v === 'string') {
    list = v.split(/[,;]/).map((s) => oneLine(s)).filter(Boolean);
    if (list.length > 0) notes.push(`${field} was text: split into ${list.length} item(s)`);
  } else {
    notes.push(`${field} is not a list: dropped`);
    return undefined;
  }
  return list.length > 0 ? list.slice(0, 100).map((s) => s.slice(0, 100)) : undefined;
}

function abilityOf(v: unknown): AbilityKey | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase().slice(0, 3);
  return (ABILITIES as readonly string[]).includes(t) && /^(str|dex|con|int|wis|cha)/.test(v.trim().toLowerCase()) ? (t as AbilityKey) : undefined;
}

function sanitizeActivity(raw: unknown, index: number, entityId: string, entityName: string, used: Set<string>, notes: string[]): Activity | null {
  if (!isObj(raw)) {
    notes.push(`activity #${index + 1} is not an object: removed`);
    return null;
  }
  const name = str(raw.name, MAX_NAME_LENGTH) ?? entityName;
  let id = str(raw.id, MAX_ID_LENGTH) ?? `act-${entityId}-${index}`;
  if (used.has(id)) {
    let n = 2;
    while (used.has(`${id}-${n}`)) n++;
    notes.push(`activity id "${id}" was used twice: renamed to "${id}-${n}"`);
    id = `${id}-${n}`;
  }
  used.add(id);

  let type: ActivityType = 'utility';
  if (typeof raw.type === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(raw.type)) type = raw.type as ActivityType;
  else notes.push(`activity "${name}": type ${raw.type === undefined ? 'missing' : `"${String(raw.type).slice(0, 20)}" unknown`}, set to utility`);

  let actionEconomy: ActionEconomy = 'action';
  if (typeof raw.actionEconomy === 'string') {
    const e = raw.actionEconomy.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if ((ACTION_ECONOMIES as readonly string[]).includes(e)) actionEconomy = e as ActionEconomy;
    else notes.push(`activity "${name}": action type "${raw.actionEconomy.slice(0, 20)}" unknown, set to action`);
  }

  const act: Activity = { id, name, type, actionEconomy };
  for (const key of ['attackBonusFormula', 'saveDcFormula', 'damageFormula', 'upcastDicePerLevel'] as const) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    const res = normalizeFormula(value);
    if (res.kind === 'invalid') {
      notes.push(`activity "${name}": ${key} removed (${res.note})`);
    } else {
      if (res.kind === 'repaired') notes.push(`activity "${name}": ${key} ${res.note}`);
      act[key] = res.value;
    }
  }
  for (const key of ['attackAbility', 'saveAbility'] as const) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    const ab = abilityOf(value);
    if (ab) act[key] = ab;
    else notes.push(`activity "${name}": ${key} "${String(value).slice(0, 20)}" is not an ability: removed`);
  }
  const dmgType = str(raw.damageType, 60);
  if (dmgType) act.damageType = dmgType;
  const summon = str(raw.summonTemplateId, MAX_ID_LENGTH);
  if (summon) act.summonTemplateId = summon;
  if (typeof raw.description === 'string' && raw.description.trim()) act.description = cleanText(raw.description).slice(0, MAX_ENTRY_LENGTH);
  if (isObj(raw.resourceCost)) {
    const amount = toNumber(raw.resourceCost.amount);
    const poolId = str(raw.resourceCost.poolId, 100);
    if (poolId && amount && amount.n >= 0) act.resourceCost = { poolId, amount: Math.round(amount.n) };
    else notes.push(`activity "${name}": resourceCost unreadable: removed`);
  }
  return act;
}

type SizeValue = CreatureSize;

function sanitizeMonsterMeta(raw: unknown, notes: string[]): { meta: MonsterStatMeta } | { reason: string } {
  if (!isObj(raw)) return { reason: 'monster without monsterMeta (ac, hp, dexModifier)' };
  const ac = toNumber(raw.ac);
  if (!ac) return { reason: 'monster AC is missing or not a number' };
  const hp = toNumber(raw.hp);
  if (!hp) return { reason: 'monster hit points are missing or not a number' };
  if (ac.n < 0 || ac.n > 50) return { reason: `monster AC ${ac.n} is out of range (0-50)` };
  if (hp.n < 1 || hp.n > 100000) return { reason: `monster hit points ${hp.n} are out of range (1-100000)` };
  if (typeof raw.ac === 'string' && ac.rest) notes.push(`monsterMeta.ac "${raw.ac.slice(0, 40)}" read as ${Math.round(ac.n)}`);
  if (typeof raw.hp === 'string' && hp.rest) notes.push(`monsterMeta.hp "${raw.hp.slice(0, 40)}" read as ${Math.round(hp.n)}`);
  const meta: MonsterStatMeta = { ac: Math.round(ac.n), hp: Math.round(hp.n), dexModifier: 0 };
  const dex = toNumber(raw.dexModifier);
  if (dex) {
    meta.dexModifier = Math.max(-10, Math.min(20, Math.round(dex.n)));
    if (typeof raw.dexModifier === 'string' && dex.rest) notes.push(`monsterMeta.dexModifier "${raw.dexModifier.slice(0, 20)}" read as ${meta.dexModifier}`);
  } else {
    notes.push('monsterMeta.dexModifier missing: set to 0');
  }
  if (raw.cr !== undefined && raw.cr !== null && raw.cr !== '') {
    const cr = normalizeCr(raw.cr);
    if (cr === undefined) notes.push(`challenge rating "${String(raw.cr).slice(0, 20)}" is not a CR: removed`);
    else {
      meta.cr = cr;
      if (String(raw.cr).trim() !== cr) notes.push(`challenge rating ${JSON.stringify(raw.cr)} written as "${cr}"`);
    }
  } else {
    notes.push('monsterMeta.cr missing');
  }
  if (typeof raw.size === 'string') {
    const s = raw.size.trim().toLowerCase();
    if ((SIZES as readonly string[]).includes(s)) meta.size = s as SizeValue;
    else notes.push(`size "${raw.size.slice(0, 20)}" unknown: removed`);
  }
  for (const key of ['speeds', 'saves', 'skills', 'senses'] as const) {
    const t = str(raw[key], 300);
    if (t) meta[key] = t;
  }
  for (const key of ['resistances', 'immunities', 'vulnerabilities', 'traits'] as const) {
    const list = strList(raw[key], `monsterMeta.${key}`, notes);
    if (list) meta[key] = list;
  }
  const legendary = toNumber(raw.legendaryActionsMax);
  if (legendary && legendary.n >= 0) meta.legendaryActionsMax = Math.round(legendary.n);
  if (isObj(raw.rechargeAbility)) {
    const name = str(raw.rechargeAbility.name, 100);
    const minRoll = toNumber(raw.rechargeAbility.minRoll);
    if (name && minRoll && minRoll.n >= 2 && minRoll.n <= 6) meta.rechargeAbility = { name, minRoll: Math.round(minRoll.n) };
  }
  return { meta };
}

function resolveCategory(raw: unknown, fallback: ItemCategory | undefined, notes: string[]): ItemCategory | { reason: string } {
  if (typeof raw === 'string' && raw.trim()) {
    const key = raw.trim().toLowerCase();
    if ((KNOWN_CATEGORIES as readonly string[]).includes(key)) return key as ItemCategory;
    const alias = CATEGORY_ALIASES[key];
    if (alias) {
      notes.push(`category "${raw.trim().slice(0, 30)}" read as ${alias}`);
      return alias;
    }
    return { reason: `unknown category "${raw.trim().slice(0, 40)}"` };
  }
  if (raw !== undefined && raw !== null && raw !== '') return { reason: `unknown category "${String(raw).slice(0, 40)}"` };
  if (fallback) return fallback;
  notes.push('category missing: filed as gear');
  return 'gear';
}

/** Cleans, checks and repairs one incoming entity of any shape. Never throws. */
export function sanitizeEntity(raw: unknown, ctx: SanitizeContext = {}): EntityOutcome {
  try {
    return sanitizeEntityUnsafe(raw, ctx);
  } catch (err) {
    return { ok: false, label: labelOf(raw), reason: `could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
}

function labelOf(raw: unknown): string {
  if (isObj(raw)) {
    if (typeof raw.name === 'string' && raw.name.trim()) return raw.name.trim().slice(0, 80);
    if (typeof raw.id === 'string' && raw.id.trim()) return raw.id.trim().slice(0, 80);
  }
  return 'entry';
}

function sanitizeEntityUnsafe(raw: unknown, ctx: SanitizeContext): EntityOutcome {
  if (!isObj(raw)) return { ok: false, label: 'entry', reason: 'not an object' };
  const notes: string[] = [];

  let nameRaw = raw.name;
  if (typeof nameRaw === 'number' && Number.isFinite(nameRaw)) {
    nameRaw = String(nameRaw);
    notes.push('name was a number: kept as text');
  }
  let name = typeof nameRaw === 'string' ? oneLine(nameRaw) : '';
  if (!name) return { ok: false, label: labelOf(raw), reason: 'missing name' };
  if (name.length > MAX_NAME_LENGTH) {
    name = name.slice(0, MAX_NAME_LENGTH).trim();
    notes.push(`name longer than ${MAX_NAME_LENGTH} characters: shortened`);
  }

  const cat = resolveCategory(raw.category, ctx.fallbackCategory, notes);
  if (typeof cat !== 'string') return { ok: false, label: name, reason: cat.reason };
  const category = cat;

  let id = '';
  let explicitId = false;
  if (typeof raw.id === 'string' && raw.id.trim()) {
    id = oneLine(raw.id).slice(0, MAX_ID_LENGTH);
    explicitId = id.length > 0;
  } else if (typeof raw.id === 'number' && Number.isFinite(raw.id)) {
    id = String(raw.id);
    explicitId = true;
    notes.push('id was a number: kept as text');
  }
  if (!id) id = `custom-${category}-${slugifyText(name) || 'entry'}`;

  let ruleset: Ruleset = ctx.defaultRuleset ?? '2014';
  if (raw.ruleset === '2014' || raw.ruleset === '2024' || raw.ruleset === 'homebrew') ruleset = raw.ruleset;
  else if (raw.ruleset === 2014 || raw.ruleset === 2024) ruleset = String(raw.ruleset) as Ruleset;
  else if (raw.ruleset !== undefined && raw.ruleset !== null && raw.ruleset !== '') notes.push(`ruleset "${String(raw.ruleset).slice(0, 20)}" unknown: set to ${ruleset}`);

  const source = str(raw.source, 120) ?? ctx.sourceLabel ?? 'Custom Repo';

  const entries = normalizeEntries(raw.entries, raw.description)
    .map((e) => cleanText(e))
    .filter(Boolean);
  if (entries.length === 0 && raw.entries !== undefined && raw.entries !== null && !(Array.isArray(raw.entries) && raw.entries.length === 0)) {
    notes.push('entries could not be read: left empty');
  }
  let trimmedEntries = entries.map((e) => (e.length > MAX_ENTRY_LENGTH ? `${e.slice(0, MAX_ENTRY_LENGTH)}...` : e));
  if (entries.some((e) => e.length > MAX_ENTRY_LENGTH)) notes.push(`text longer than ${MAX_ENTRY_LENGTH} characters was shortened`);
  if (trimmedEntries.length > MAX_ENTRIES) {
    trimmedEntries = trimmedEntries.slice(0, MAX_ENTRIES);
    notes.push(`more than ${MAX_ENTRIES} paragraphs: the rest was dropped`);
  }

  const entity: CompendiumEntity = { id, name, source, ruleset, category, activities: [], entries: trimmedEntries };

  const img = pickImageRef(raw, { keepRelative: true });
  if (img) entity.imageUrl = img;
  const credit = sanitizeArtCredit(raw.artCredit);
  if (credit) entity.artCredit = credit;

  for (const key of ['castingTime', 'range', 'components', 'duration', 'container', 'customName'] as const) {
    const t = str(raw[key], key === 'components' ? 300 : 120);
    if (t) entity[key] = t;
  }
  for (const key of ['equipped', 'prepared', 'alwaysPrepared', 'attuned', 'requiresAttunement', 'concentration', 'ritual'] as const) {
    const b = bool(raw[key], key, notes);
    if (b !== undefined) entity[key] = b;
  }
  const quantity = num(raw.quantity, 'quantity', notes, { min: 0, max: 100000, int: true });
  if (quantity !== undefined) entity.quantity = quantity;
  const weight = num(raw.weight, 'weight', notes, { min: 0, max: 100000 });
  if (weight !== undefined) entity.weight = weight;
  const flat = num(raw.acFlatBonus, 'acFlatBonus', notes, { min: -10, max: 30, int: true });
  if (flat !== undefined) entity.acFlatBonus = flat;
  const magic = num(raw.magicBonus, 'magicBonus', notes, { min: 0, max: 3, int: true });
  if (magic !== undefined) entity.magicBonus = magic as 0 | 1 | 2 | 3;
  if (typeof raw.weaponMastery === 'string') {
    const m = MASTERIES.find((x) => x.toLowerCase() === (raw.weaponMastery as string).trim().toLowerCase());
    if (m) entity.weaponMastery = m;
    else notes.push(`weapon mastery "${(raw.weaponMastery as string).slice(0, 20)}" unknown: removed`);
  }
  for (const key of ['packId', 'packVersion', 'packRef', 'packFile'] as const) {
    const t = str(raw[key], 300);
    if (t) entity[key] = t;
  }

  if (category === 'spell') {
    const lvl = parseSpellLevel(raw.spellLevel ?? raw.level);
    if (lvl === 'invalid') {
      return { ok: false, label: name, reason: `spell level "${String(raw.spellLevel ?? raw.level).slice(0, 20)}" is not 0-9` };
    }
    if (lvl === undefined) {
      entity.spellLevel = 0;
      notes.push('spell level missing: set to 0 (cantrip)');
    } else {
      entity.spellLevel = lvl;
      const given = raw.spellLevel ?? raw.level;
      if (typeof given !== 'number' && !/^\d+$/.test(String(given).trim())) notes.push(`spell level "${String(given).slice(0, 20)}" read as ${lvl}`);
    }
    const classes = strList(raw.classes, 'classes', notes);
    if (classes) entity.classes = classes;
  } else if (raw.classes !== undefined && Array.isArray(raw.classes)) {
    const classes = strList(raw.classes, 'classes', notes);
    if (classes) entity.classes = classes;
  }

  if (isObj(raw.acFormula)) {
    const base = toNumber(raw.acFormula.base);
    if (base && base.n >= 0 && base.n <= 40) {
      const cap = raw.acFormula.dexCap;
      let dexCap: number | null = null;
      if (cap === null) dexCap = null;
      else if (cap === undefined) notes.push('acFormula.dexCap missing: no cap');
      else {
        const c = toNumber(cap);
        if (c) dexCap = Math.round(c.n);
        else notes.push('acFormula.dexCap unreadable: no cap');
      }
      entity.acFormula = { base: Math.round(base.n), dexCap };
      const extra = abilityOf(raw.acFormula.extraAbility);
      if (extra) entity.acFormula.extraAbility = extra;
      if (raw.acFormula.requiresUnarmored === true) entity.acFormula.requiresUnarmored = true;
    } else {
      notes.push('acFormula unreadable: removed');
    }
  }

  if (Array.isArray(raw.modifiers)) {
    const mods: NonNullable<CompendiumEntity['modifiers']> = [];
    for (const m of raw.modifiers) {
      const target = isObj(m) ? str(m.target, 100) : undefined;
      const value = isObj(m) ? toNumber(m.value) : undefined;
      if (isObj(m) && target && value) {
        const condition = str(m.condition, 200);
        mods.push({ target, value: value.n, ...(condition ? { condition } : {}) });
      } else notes.push('a modifier without target and number was removed');
    }
    if (mods.length > 0) entity.modifiers = mods;
  }

  if (category === 'monster') {
    const res = sanitizeMonsterMeta(raw.monsterMeta, notes);
    if ('reason' in res) return { ok: false, label: name, reason: res.reason };
    entity.monsterMeta = res.meta;
  } else if (isObj(raw.monsterMeta)) {
    const res = sanitizeMonsterMeta(raw.monsterMeta, []);
    if ('meta' in res) entity.monsterMeta = res.meta;
  }

  if (raw.activities !== undefined && raw.activities !== null) {
    if (Array.isArray(raw.activities)) {
      if (raw.activities.length > MAX_ACTIVITIES) notes.push(`more than ${MAX_ACTIVITIES} activities: the rest was dropped`);
      const used = new Set<string>();
      raw.activities.slice(0, MAX_ACTIVITIES).forEach((a, i) => {
        const act = sanitizeActivity(a, i, id, name, used, notes);
        if (act) entity.activities.push(act);
      });
    } else {
      notes.push('activities was not a list: removed');
    }
  }

  return { ok: true, entity, notes, explicitId };
}

// ---------------------------------------------------------------- batches

export interface Rejection {
  source: string;
  reason: string;
  /** "duplicate": an identical copy of an entry already taken (harmless, but listed). */
  kind?: 'duplicate';
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Same entry apart from which file it came from. */
function sameContent(a: CompendiumEntity, b: CompendiumEntity): boolean {
  const { packFile: _a, ...restA } = a;
  const { packFile: _b, ...restB } = b;
  return stable(restA) === stable(restB);
}

/**
 * Makes ids unique inside one import. A second entry with the same id is dropped (merged, counted) when it is
 * identical to the first and renamed ("id-2", with a note) when it differs; made-up ids are numbered
 * quietly. Mutates `items` (in place) and appends to `rejected`.
 */
export function dedupeProcessedIds(items: ProcessedEntity[], rejected: Rejection[]): ProcessedEntity[] {
  const seen = new Map<string, ProcessedEntity>();
  const kept: ProcessedEntity[] = [];
  for (const item of items) {
    const first = seen.get(item.entity.id);
    if (!first) {
      seen.set(item.entity.id, item);
      kept.push(item);
      continue;
    }
    if (sameContent(item.entity, first.entity)) {
      rejected.push({ source: item.entity.name, reason: `exact duplicate of an earlier entry (id "${item.entity.id}")`, kind: 'duplicate' });
      continue;
    }
    const base = item.entity.id;
    let n = 2;
    while (seen.has(`${base}-${n}`)) n++;
    item.entity = { ...item.entity, id: `${base}-${n}` };
    if (item.explicitId) item.notes.push(`id "${base}" was already used in this import: renamed to "${base}-${n}"`);
    seen.set(item.entity.id, item);
    kept.push(item);
  }
  return kept;
}

/** Runs `sanitizeEntity` over a list and makes the ids unique. */
export function sanitizeEntityList(
  rawList: readonly unknown[],
  ctx: SanitizeContext,
  rejected: Rejection[],
  label = 'entry'
): ProcessedEntity[] {
  const items: ProcessedEntity[] = [];
  rawList.forEach((raw, i) => {
    const res = sanitizeEntity(raw, ctx);
    if (res.ok) items.push({ entity: res.entity, notes: res.notes, explicitId: res.explicitId });
    else rejected.push({ source: res.label === 'entry' ? `${label} ${i + 1}` : res.label, reason: res.reason });
  });
  return dedupeProcessedIds(items, rejected);
}
