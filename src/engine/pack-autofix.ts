import { normalizeCr, normalizeFormula, normalizeTags } from './import-normalize';
import { slugifyPackText } from './pack-manifest';

/**
 * Safe, mechanical repairs for a pack's JSON files (`content:validate --pack <dir> --fix`). Pure: text in, text out.
 *
 * The import pipeline (import-normalize.ts) repairs far more on import, and reports those repairs as free-text notes,
 * not codes. Only the ones below are written back into the source files, because they never change meaning:
 *
 *   cr-fraction   monsterMeta.cr / cr written as 0.25, 0.5, "CR 5", "5 (1,800 XP)"  ->  "1/4", "1/2", "5"   (normalizeCr)
 *   dice-format   activity formulas that are already valid but spelled "1d8 + 3", "1D8"  ->  "1d8+3"          (normalizeFormula kind "ok",
 *                 or kind "repaired" for ability words such as "2d6+STR" -> "2d6+@str"; never the "trimmed" / "was a number" repairs)
 *   id-slug       entity without an id  ->  "<packId>:<slug of name>", the same id an install would have stored (skipped on a name clash)
 *   format-tags   5e.tools tags {@b x}, {@atk mw}, {@filter ...} in entries / descriptions  ->  plain text (normalizeTags; roll tags stay)
 *   encoding      byte-order mark and CRLF line endings removed (the file is rewritten as 2-space JSON with a trailing newline)
 *
 * Everything else (unit guesses, dropped fields, truncation, category guesses, missing stats) stays a human decision.
 */

export const SAFE_REPAIR_CODES = ['cr-fraction', 'dice-format', 'id-slug', 'format-tags', 'encoding'] as const;
export type SafeRepairCode = (typeof SAFE_REPAIR_CODES)[number];

export interface AutofixContext {
  /** Pack id from pack.json: needed to write ids. Without it no ids are added. */
  packId?: string;
  /** Every id already used in the pack, plus the ids added so far (mutated). */
  usedIds: Set<string>;
}

export interface AutofixResult {
  /** The new file text, or null when nothing was fixed (the file must be left alone). */
  text: string | null;
  counts: Partial<Record<SafeRepairCode, number>>;
  /** Entries that could not get an id (name clash). */
  skippedIds: string[];
  /** Set when the file is not valid JSON. */
  invalid?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const FORMULA_KEYS = ['attackBonusFormula', 'saveDcFormula', 'damageFormula', 'upcastDicePerLevel'] as const;
const ENTITY_HINTS = ['category', 'spellLevel', 'monsterMeta', 'activities', 'entries'];

function looksLikeEntity(o: Obj): boolean {
  return typeof o.name === 'string' && ENTITY_HINTS.some((k) => k in o);
}

/** Ids already present in a parsed file (for seeding `usedIds` before fixing). */
export function collectIds(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) {
      if (looksLikeEntity(v) && typeof v.id === 'string' && v.id.trim()) out.push(v.id.trim());
      for (const child of Object.values(v)) if (typeof child === 'object' && child !== null) walk(child);
    }
  };
  walk(parsed);
  return out;
}

export function fixPackJson(text: string, ctx: AutofixContext): AutofixResult {
  const counts: Partial<Record<SafeRepairCode, number>> = {};
  const skippedIds: string[] = [];
  const bump = (code: SafeRepairCode) => {
    counts[code] = (counts[code] ?? 0) + 1;
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (err) {
    return { text: null, counts, skippedIds, invalid: err instanceof Error ? err.message.slice(0, 100) : 'invalid JSON' };
  }
  if (text.startsWith('﻿') || text.includes('\r\n')) bump('encoding');

  const fixText = (s: string): string => {
    if (!s.includes('{@')) return s;
    const next = normalizeTags(s);
    if (next !== s) bump('format-tags');
    return next;
  };

  const fixEntity = (o: Obj) => {
    // cr
    const meta = isObj(o.monsterMeta) ? o.monsterMeta : undefined;
    for (const holder of [meta, o]) {
      if (!holder || !('cr' in holder)) continue;
      const cr = holder.cr;
      if (typeof cr !== 'string' && typeof cr !== 'number') continue;
      const next = normalizeCr(cr);
      if (next !== undefined && next !== cr) {
        holder.cr = next;
        bump('cr-fraction');
      }
    }
    // dice
    if (Array.isArray(o.activities)) {
      for (const act of o.activities) {
        if (!isObj(act)) continue;
        for (const key of FORMULA_KEYS) {
          const v = act[key];
          if (typeof v !== 'string' || !v.trim()) continue;
          const res = normalizeFormula(v);
          const safe = res.kind === 'ok' || (res.kind === 'repaired' && !/trimmed|was a number/.test(res.note));
          if (safe && res.value !== v) {
            act[key] = res.value;
            bump('dice-format');
          }
        }
        if (typeof act.description === 'string') act.description = fixText(act.description);
      }
    }
    // text
    if (Array.isArray(o.entries)) o.entries = o.entries.map((e) => (typeof e === 'string' ? fixText(e) : e));
    else if (typeof o.entries === 'string') o.entries = fixText(o.entries);
    if (typeof o.description === 'string') o.description = fixText(o.description);
    // id
    const hasId = (typeof o.id === 'string' && o.id.trim() !== '') || typeof o.id === 'number';
    if (!hasId && ctx.packId && typeof o.name === 'string') {
      const slug = slugifyPackText(o.name);
      const id = slug ? `${ctx.packId}:${slug}` : '';
      if (id && !ctx.usedIds.has(id)) {
        ctx.usedIds.add(id);
        // keep "id" first for readability: rebuild the key order with id in front
        const rest = { ...o };
        for (const k of Object.keys(o)) delete o[k];
        o.id = id;
        Object.assign(o, rest);
        bump('id-slug');
      } else skippedIds.push(o.name);
    }
  };

  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) {
      if (looksLikeEntity(v)) fixEntity(v);
      for (const child of Object.values(v)) if (typeof child === 'object' && child !== null) walk(child);
    }
  };
  walk(parsed);

  const changed = Object.keys(counts).length > 0;
  return { text: changed ? `${JSON.stringify(parsed, null, 2)}\n` : null, counts, skippedIds };
}
