import type { CompendiumEntity } from '../types/compendium';

/**
 * Where an entry comes from, for the source-priority order. "mine" is everything that is not SRD or
 * Free5e: homebrew, imported files, repo syncs, custom packs.
 */
export type SourceTier = 'mine' | 'srd2024' | 'srd2014' | 'free5e';

export const DEFAULT_SOURCE_PRIORITY: readonly SourceTier[] = ['mine', 'srd2024', 'srd2014', 'free5e'];

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  mine: 'Mine (homebrew / imported / custom)',
  srd2024: 'SRD 5.2 (2024)',
  srd2014: 'SRD 5.1 (2014)',
  free5e: 'Free5e',
};

/** Accepts anything (e.g. parsed localStorage) and returns a complete, valid priority list. */
export function sanitizeSourcePriority(raw: unknown): SourceTier[] {
  const out: SourceTier[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (DEFAULT_SOURCE_PRIORITY.includes(v as SourceTier) && !out.includes(v as SourceTier)) out.push(v as SourceTier);
    }
  }
  for (const t of DEFAULT_SOURCE_PRIORITY) if (!out.includes(t)) out.push(t);
  return out;
}

/** Lower-cases, strips diacritics, punctuation and spaces, so "Cure  Wounds" == "cure-wounds" == "Cüre Wounds". */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function sourceTierOf(e: CompendiumEntity): SourceTier {
  if (/^free5e/i.test(e.id) || /free5e/i.test(e.source)) return 'free5e';
  const isSrdSource = /^SRD/i.test(e.source) || /^PHB \/ SRD/i.test(e.source) || /^srd/i.test(e.id);
  if (isSrdSource) {
    if (/5\.2|2024/.test(e.source) || /^srd24/i.test(e.id) || e.ruleset === '2024') return 'srd2024';
    return 'srd2014';
  }
  return 'mine';
}

/** Rough "how much data does this entry carry" score, used to pick between two copies of the same tier. */
function richness(e: CompendiumEntity): number {
  return (
    (e.monsterMeta ? 5 : 0) +
    e.activities.length * 3 +
    e.entries.length +
    (e.classes?.length ? 2 : 0) +
    (e.components ? 1 : 0) +
    (e.imageUrl ? 1 : 0)
  );
}

export function exactKey(e: CompendiumEntity): string {
  return `${normalizeEntityName(e.name)}|${e.category}|${e.ruleset}`;
}

/** True when `a` should be shown instead of `b`. */
function outranks(a: CompendiumEntity, b: CompendiumEntity, priority: readonly SourceTier[]): boolean {
  const pa = priority.indexOf(sourceTierOf(a));
  const pb = priority.indexOf(sourceTierOf(b));
  if (pa !== pb) return pa < pb;
  return richness(a) > richness(b);
}

/** Fills fields the winner lacks from the other copies. Never overwrites what the winner has. */
export function mergeEntities(winner: CompendiumEntity, others: readonly CompendiumEntity[]): CompendiumEntity {
  const out: CompendiumEntity = { ...winner };
  const donors = others.filter((o) => o !== winner);
  const fillable = ['imageUrl', 'castingTime', 'range', 'components', 'duration', 'spellLevel', 'monsterMeta', 'weight', 'weaponMastery', 'acFormula'] as const;
  for (const d of donors) {
    if (!out.classes?.length && d.classes?.length) out.classes = d.classes;
    if (!out.entries.length && d.entries.length) out.entries = d.entries;
    if (!out.activities.length && d.activities.length) out.activities = d.activities;
    if (!out.modifiers?.length && d.modifiers?.length) out.modifiers = d.modifiers;
    for (const k of fillable) {
      if (out[k] === undefined && d[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = d[k];
    }
  }
  return out;
}

export interface ExactDuplicateGroup {
  key: string;
  winner: CompendiumEntity;
  folded: CompendiumEntity[];
}

/** Groups entries that share normalized name + category + ruleset; groups of one are left out. */
export function groupExactDuplicates(
  entities: readonly CompendiumEntity[],
  priority: readonly SourceTier[] = DEFAULT_SOURCE_PRIORITY
): ExactDuplicateGroup[] {
  const byKey = new Map<string, CompendiumEntity[]>();
  for (const e of entities) {
    const k = exactKey(e);
    const list = byKey.get(k);
    if (list) list.push(e);
    else byKey.set(k, [e]);
  }
  const out: ExactDuplicateGroup[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    let winner = list[0]!;
    for (const e of list) if (outranks(e, winner, priority)) winner = e;
    out.push({ key, winner, folded: list.filter((e) => e !== winner) });
  }
  return out;
}

/**
 * Collapses exact duplicates for list building (search, Add Spell/Gear, Level-Up, Encounter Builder).
 * Two entries are exact duplicates when they share normalized name + category + ruleset. The copy
 * from the highest-priority source is shown (richer data breaks ties); the others are folded into
 * it: it gets `alsoIn` (their sources) and any field it lacks (class lists, description, image...)
 * from them. Nothing is deleted; input order is kept.
 */
export function dedupeCompendium(
  entities: readonly CompendiumEntity[],
  priority: readonly SourceTier[] = DEFAULT_SOURCE_PRIORITY
): CompendiumEntity[] {
  const groups = new Map(groupExactDuplicates(entities, priority).map((g) => [g.key, g]));
  if (groups.size === 0) return [...entities];
  const out: CompendiumEntity[] = [];
  const emitted = new Set<string>();
  for (const e of entities) {
    const key = exactKey(e);
    const g = groups.get(key);
    if (!g) {
      out.push(e);
      continue;
    }
    if (g.winner !== e || emitted.has(key)) continue;
    emitted.add(key);
    const merged = mergeEntities(g.winner, g.folded);
    const also = [...new Set(g.folded.map((f) => f.source).filter((s) => s !== g.winner.source))];
    out.push(also.length > 0 ? { ...merged, alsoIn: also } : merged);
  }
  return out;
}

// ---------------------------------------------------------------- near duplicates

const POSSESSIVE_PREFIX = /^[A-Z][\w-]*'s\s+/;

/** Name without a leading possessive ("Melf's Acid Arrow" -> "Acid Arrow") and without a trailing "(...)" note. */
export function stripPossessiveAndNotes(name: string): string {
  const base = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const stripped = base.replace(POSSESSIVE_PREFIX, '');
  return stripped.length >= 3 ? stripped : base;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 0..1 similarity: the larger of token Jaccard and character-bigram Dice on the normalized names. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeEntityName(a);
  const nb = normalizeEntityName(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const tok = (s: string) =>
    new Set(
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    );
  const ta = tok(a);
  const tb = tok(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter || 1);
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let common = 0;
  for (const [g, n] of ba) common += Math.min(n, bb.get(g) ?? 0);
  const dice = (2 * common) / (na.length - 1 + (nb.length - 1));
  return Math.max(jaccard, dice);
}

export const NEAR_DUPLICATE_THRESHOLD = 0.85;

function crValue(e: CompendiumEntity): number | undefined {
  const cr = e.monsterMeta?.cr;
  if (cr === undefined || cr === null || cr === '') return undefined;
  const s = String(cr).trim();
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function sameRulesetFamily(a: CompendiumEntity, b: CompendiumEntity): boolean {
  return a.ruleset === b.ruleset || a.ruleset === 'homebrew' || b.ruleset === 'homebrew';
}

/**
 * True when two entries are possible duplicates without being exact ones: same category, names equal
 * after stripping a possessive prefix / trailing note, or similar by >= 0.85, and the same spell
 * level / monster CR whenever both entries state one.
 */
export function areNearDuplicates(a: CompendiumEntity, b: CompendiumEntity): boolean {
  if (a === b || a.category !== b.category || !sameRulesetFamily(a, b)) return false;
  if (a.ruleset === b.ruleset && normalizeEntityName(a.name) === normalizeEntityName(b.name)) return false;
  if (a.spellLevel !== undefined && b.spellLevel !== undefined && a.spellLevel !== b.spellLevel) return false;
  const ca = crValue(a);
  const cb = crValue(b);
  if (ca !== undefined && cb !== undefined && ca !== cb) return false;
  const sa = stripPossessiveAndNotes(a.name);
  const sb = stripPossessiveAndNotes(b.name);
  if (normalizeEntityName(sa) === normalizeEntityName(sb)) return true;
  return nameSimilarity(sa, sb) >= NEAR_DUPLICATE_THRESHOLD;
}

export interface NearDuplicateGroup {
  /** Stable id: the member ids, sorted. Decisions are stored against it. */
  id: string;
  category: CompendiumEntity['category'];
  /** Highest priority first. */
  members: CompendiumEntity[];
}

export function nearGroupId(memberIds: readonly string[]): string {
  return [...memberIds].sort().join('|');
}

/**
 * Finds groups of possible duplicates. Exact duplicates are collapsed first (only each group's
 * winner takes part), so these are the cases dedupeCompendium cannot decide. Never hides anything.
 */
export function findNearDuplicates(
  entities: readonly CompendiumEntity[],
  priority: readonly SourceTier[] = DEFAULT_SOURCE_PRIORITY
): NearDuplicateGroup[] {
  const pool = dedupeCompendium(entities, priority);
  const byCat = new Map<string, CompendiumEntity[]>();
  for (const e of pool) {
    const list = byCat.get(e.category);
    if (list) list.push(e);
    else byCat.set(e.category, [e]);
  }
  const groups: NearDuplicateGroup[] = [];
  for (const [category, list] of byCat) {
    const n = list.length;
    const parent = list.map((_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r]!;
      while (parent[i] !== r) {
        const next = parent[i]!;
        parent[i] = r;
        i = next;
      }
      return r;
    };
    // Cheap pre-filter: a similarity >= 0.85 needs comparable name lengths, and possessive-stripped
    // names are compared through the same helper, so sort by stripped length to prune.
    const keyLen = list.map((e) => normalizeEntityName(stripPossessiveAndNotes(e.name)).length);
    const order = list.map((_, i) => i).sort((x, y) => keyLen[x]! - keyLen[y]!);
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi]!;
      for (let oj = oi + 1; oj < n; oj++) {
        const j = order[oj]!;
        if (keyLen[j]! > keyLen[i]! * 1.4 + 2) break;
        if (find(i) === find(j)) continue;
        if (areNearDuplicates(list[i]!, list[j]!)) parent[find(i)] = find(j);
      }
    }
    const buckets = new Map<number, CompendiumEntity[]>();
    list.forEach((e, i) => {
      const r = find(i);
      const b = buckets.get(r);
      if (b) b.push(e);
      else buckets.set(r, [e]);
    });
    for (const members of buckets.values()) {
      if (members.length < 2) continue;
      const sorted = [...members].sort((a, b) =>
        outranks(a, b, priority) ? -1 : outranks(b, a, priority) ? 1 : 0
      );
      groups.push({ id: nearGroupId(sorted.map((m) => m.id)), category: category as CompendiumEntity['category'], members: sorted });
    }
  }
  return groups.sort((a, b) => a.members[0]!.name.localeCompare(b.members[0]!.name));
}

// ---------------------------------------------------------------- review decisions

export type DuplicateAction = 'keep-one' | 'keep-both' | 'merge';

export interface DuplicateDecision {
  /** NearDuplicateGroup.id */
  id: string;
  memberIds: string[];
  action: DuplicateAction;
  /** The entry that stays (keep-one / merge). */
  keepId?: string;
  decidedAt: string;
}

/** Applies review decisions to a (already exact-deduped) list: hides the non-kept members, merges fields. */
export function applyDuplicateDecisions(
  entities: readonly CompendiumEntity[],
  decisions: readonly DuplicateDecision[]
): CompendiumEntity[] {
  if (decisions.length === 0) return [...entities];
  const hide = new Set<string>();
  const replace = new Map<string, CompendiumEntity>();
  const byId = new Map(entities.map((e) => [e.id, e]));
  for (const d of decisions) {
    if (d.action === 'keep-both' || !d.keepId) continue;
    const keep = byId.get(d.keepId);
    const others = d.memberIds.filter((m) => m !== d.keepId).map((m) => byId.get(m)).filter((o): o is CompendiumEntity => !!o);
    if (!keep || others.length === 0) continue;
    for (const o of others) hide.add(o.id);
    const base = d.action === 'merge' ? mergeEntities(keep, others) : keep;
    const also = [...new Set([...(keep.alsoIn ?? []), ...others.map((o) => o.source)].filter((s) => s !== keep.source))];
    replace.set(keep.id, also.length > 0 ? { ...base, alsoIn: also } : base);
  }
  return entities.filter((e) => !hide.has(e.id)).map((e) => replace.get(e.id) ?? e);
}
