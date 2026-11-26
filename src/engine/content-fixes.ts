import type { CompendiumEntity } from '../types/compendium';
import type { ContentFix, ContentFixPatch, ContentFixStatus } from '../types/content-fix';

/**
 * "Flag it, fix it, review it": pure helpers for the content-fix layer. A fix is a small patch on top
 * of a compendium entry; the entry itself is never edited. Pure: no React, DOM or IndexedDB here.
 */

/** Fields that are not part of the entry's identity: derived by folding, or state of a sheet copy. */
const NON_CONTENT_FIELDS = new Set([
  'alsoIn',
  'fixedBy',
  'equipped',
  'prepared',
  'attuned',
  'quantity',
  'container',
  'magicBonus',
  'customName',
]);

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 53-bit string hash (cyrb53); plenty to notice "the source entry changed". */
function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Content hash of an entry, ignoring derived and sheet-copy fields. */
export function hashEntity(e: CompendiumEntity): string {
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) if (!NON_CONTENT_FIELDS.has(k)) content[k] = v;
  return hashString(stableStringify(content));
}

// ---------------------------------------------------------------- paths

/** Flattens an entry to editable leaves: top-level fields, monsterMeta.<k>, activities.<id>.<k>. */
function flatten(e: CompendiumEntity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (NON_CONTENT_FIELDS.has(k) || k === 'activities' || k === 'monsterMeta' || k === 'id') continue;
    if (v !== undefined) out[k] = v;
  }
  if (e.monsterMeta) {
    for (const [k, v] of Object.entries(e.monsterMeta)) if (v !== undefined) out[`monsterMeta.${k}`] = v;
  }
  for (const a of e.activities ?? []) {
    for (const [k, v] of Object.entries(a)) {
      if (k === 'id' || v === undefined) continue;
      out[`activities.${a.id}.${k}`] = v;
    }
  }
  return out;
}

export interface FieldChange {
  path: string;
  /** Human label: "Damage formula (Fire Bolt)". */
  label: string;
  before: unknown;
  after: unknown;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  entries: 'Text',
  range: 'Range',
  spellLevel: 'Spell level',
  castingTime: 'Casting time',
  components: 'Components',
  duration: 'Duration',
  damageFormula: 'Damage formula',
  damageType: 'Damage type',
  saveAbility: 'Save ability',
  saveDcFormula: 'Save DC',
  attackBonusFormula: 'Attack bonus',
  attackAbility: 'Attack ability',
  description: 'Description',
  ac: 'AC',
  hp: 'HP',
  cr: 'CR',
};

export function labelForPath(path: string, entity?: CompendiumEntity): string {
  const parts = path.split('.');
  if (parts[0] === 'monsterMeta' && parts[1]) return `${FIELD_LABELS[parts[1]] ?? parts[1]} (monster)`;
  if (parts[0] === 'activities' && parts[1] && parts[2]) {
    const act = entity?.activities.find((a) => a.id === parts[1]);
    return `${FIELD_LABELS[parts[2]] ?? parts[2]}${act ? ` (${act.name})` : ''}`;
  }
  return FIELD_LABELS[path] ?? path;
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Field-level differences between two versions of an entry (paths in the order they appear). */
export function diffEntities(a: CompendiumEntity, b: CompendiumEntity): FieldChange[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const paths = [...new Set([...Object.keys(fa), ...Object.keys(fb)])];
  const out: FieldChange[] = [];
  for (const path of paths) {
    if (sameValue(fa[path], fb[path])) continue;
    out.push({ path, label: labelForPath(path, b.activities.length >= a.activities.length ? b : a), before: fa[path], after: fb[path] });
  }
  return out;
}

/** The patch that turns `base` into `edited` (changed fields only; removed fields become null). */
export function buildPatch(base: CompendiumEntity, edited: CompendiumEntity): ContentFixPatch {
  const patch: ContentFixPatch = {};
  for (const c of diffEntities(base, edited)) patch[c.path] = c.after === undefined ? null : c.after;
  return patch;
}

/** Applies a patch to a copy of the entry. Activity paths for ids the entry does not have are skipped. */
export function applyPatch(entity: CompendiumEntity, patch: ContentFixPatch): CompendiumEntity {
  const out = structuredClone(entity) as CompendiumEntity & Record<string, unknown>;
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('.');
    const unset = value === null;
    if (parts[0] === 'activities' && parts.length >= 3) {
      const act = out.activities.find((a) => a.id === parts[1]);
      if (!act) continue;
      const key = parts.slice(2).join('.');
      if (unset) delete (act as unknown as Record<string, unknown>)[key];
      else (act as unknown as Record<string, unknown>)[key] = structuredClone(value);
    } else if (parts[0] === 'monsterMeta' && parts.length === 2) {
      if (!out.monsterMeta) continue;
      const meta = out.monsterMeta as unknown as Record<string, unknown>;
      if (unset) delete meta[parts[1]!];
      else meta[parts[1]!] = structuredClone(value);
    } else if (parts.length === 1 && parts[0] !== 'id' && !NON_CONTENT_FIELDS.has(parts[0]!)) {
      if (unset) delete out[parts[0]!];
      else out[parts[0]!] = structuredClone(value);
    }
  }
  return out;
}

// ---------------------------------------------------------------- state and application

export type EffectiveFixState = ContentFixStatus | 'needs-re-review';

/** True when the entry changed since the fix was made (so the fix may no longer fit). */
export function isStale(fix: ContentFix, base: CompendiumEntity): boolean {
  return fix.baseSnapshotHash !== hashEntity(base);
}

/** The state to show: an approved or proposed fix whose base changed needs re-review; rejected stays rejected. */
export function fixState(fix: ContentFix, base: CompendiumEntity | undefined): EffectiveFixState {
  if (fix.status === 'rejected') return 'rejected';
  if (!base || isStale(fix, base)) return 'needs-re-review';
  return fix.status;
}

/** The entry with every approved, still-fitting fix for it applied (oldest first). Stale fixes are skipped. */
export function applyFixes(entity: CompendiumEntity, fixes: readonly ContentFix[]): CompendiumEntity {
  const mine = fixes
    .filter((f) => f.entityId === entity.id && f.status === 'approved' && !isStale(f, entity))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (mine.length === 0) return entity;
  let out = entity;
  for (const f of mine) out = applyPatch(out, f.patch);
  return { ...out, fixedBy: mine.map((f) => f.id) };
}

/** applyFixes over a whole list (the effective compendium). Entries without a fix are returned as they are. */
export function applyFixesToList(entities: readonly CompendiumEntity[], fixes: readonly ContentFix[]): CompendiumEntity[] {
  if (fixes.length === 0 || !fixes.some((f) => f.status === 'approved')) return entities as CompendiumEntity[];
  const byEntity = new Map<string, ContentFix[]>();
  for (const f of fixes) {
    if (f.status !== 'approved') continue;
    const list = byEntity.get(f.entityId);
    if (list) list.push(f);
    else byEntity.set(f.entityId, [f]);
  }
  return entities.map((e) => {
    const list = byEntity.get(e.id);
    return list ? applyFixes(e, list) : e;
  });
}

/**
 * Sheet items made by "Add to sheet" have the entry's id plus a base-36 timestamp ("fx-bolt-lq3k2a9z").
 * Returns the compendium id the sheet item came from, or null when it is not a known entry.
 */
export function entityIdForSheetItem(itemId: string, knownIds: { has(id: string): boolean }): string | null {
  if (knownIds.has(itemId)) return itemId;
  const m = /^(.+)-[a-z0-9]{6,9}$/.exec(itemId);
  return m && knownIds.has(m[1]!) ? m[1]! : null;
}

export function newFixId(now = Date.now(), rand = Math.random()): string {
  return `fix-${now.toString(36)}-${rand.toString(36).slice(2, 7)}`;
}

export interface CreateFixInput {
  /** The stored entry: its id and hash identify what the fix was made against. */
  base: CompendiumEntity;
  /** What the editor showed (the entry with approved fixes applied). Defaults to `base`. The patch holds the changes against this. */
  shown?: CompendiumEntity;
  /** The entry as the editor left it (prefilled from the effective entry, then edited). */
  edited: CompendiumEntity;
  note: string;
  author: string;
  now?: Date;
}

/** Builds a proposed fix, or an Error text when there is nothing to propose or the note is empty. */
export function createFix(input: CreateFixInput): { fix: ContentFix } | { error: string } {
  const note = input.note.trim();
  if (!note) return { error: 'Add a note saying what is wrong.' };
  const patch = buildPatch(input.shown ?? input.base, input.edited);
  if (Object.keys(patch).length === 0) return { error: 'Nothing was changed.' };
  const now = input.now ?? new Date();
  return {
    fix: {
      id: newFixId(now.getTime()),
      entityId: input.base.id,
      baseSnapshotHash: hashEntity(input.base),
      patch,
      note,
      author: input.author,
      status: 'proposed',
      createdAt: now.toISOString(),
      reviewedAt: null,
    },
  };
}

// ---------------------------------------------------------------- export / import

export const FIX_FILE_KIND = 'sidereroll-content-fixes';

export interface FixFile {
  kind: typeof FIX_FILE_KIND;
  version: 1;
  exportedAt: string;
  fixes: Array<ContentFix & { entityName?: string; entitySource?: string }>;
}

/** A shareable file of fixes, each with the entry's name and source so a maintainer can find it. */
export function exportFixesFile(
  fixes: readonly ContentFix[],
  entities: readonly CompendiumEntity[],
  now = new Date()
): FixFile {
  const byId = new Map(entities.map((e) => [e.id, e]));
  return {
    kind: FIX_FILE_KIND,
    version: 1,
    exportedAt: now.toISOString(),
    fixes: fixes.map((f) => {
      const e = byId.get(f.entityId);
      return { ...structuredClone(f), entityName: e?.name, entitySource: e?.source };
    }),
  };
}

/**
 * Reads a fix file. Everything comes in as "proposed" (the review flow decides), with a fresh id when
 * one is already taken. Returns the accepted fixes and a reason for each skipped one.
 */
export function parseFixesFile(
  raw: unknown,
  existingIds: ReadonlySet<string>
): { fixes: ContentFix[]; skipped: string[] } {
  const skipped: string[] = [];
  const fixes: ContentFix[] = [];
  const list = Array.isArray(raw) ? raw : (raw as Partial<FixFile> | null)?.fixes;
  if (!Array.isArray(list)) return { fixes, skipped: ['Not a fixes file (no "fixes" list).'] };
  const taken = new Set(existingIds);
  list.forEach((item, i) => {
    const f = item as Partial<ContentFix> | null;
    if (!f || typeof f !== 'object') return void skipped.push(`#${i + 1}: not an object`);
    if (typeof f.entityId !== 'string' || !f.entityId) return void skipped.push(`#${i + 1}: no entityId`);
    if (typeof f.patch !== 'object' || f.patch === null || Array.isArray(f.patch) || Object.keys(f.patch).length === 0) {
      return void skipped.push(`#${i + 1}: empty or missing patch`);
    }
    if (typeof f.baseSnapshotHash !== 'string') return void skipped.push(`#${i + 1}: no baseSnapshotHash`);
    let id = typeof f.id === 'string' && f.id ? f.id : newFixId();
    if (taken.has(id)) id = newFixId(Date.now() + i);
    taken.add(id);
    fixes.push({
      id,
      entityId: f.entityId,
      baseSnapshotHash: f.baseSnapshotHash,
      patch: structuredClone(f.patch),
      note: typeof f.note === 'string' ? f.note : '',
      author: typeof f.author === 'string' && f.author ? f.author : 'Imported',
      status: 'proposed',
      createdAt: typeof f.createdAt === 'string' ? f.createdAt : new Date().toISOString(),
      reviewedAt: null,
    });
  });
  return { fixes, skipped };
}
