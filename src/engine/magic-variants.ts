import type { CompendiumEntity } from '../types/compendium';
import type { RawCharacterState } from '../types/character';

/** Item kinds that can carry a magic bonus on a character sheet. */
export type MagicBonus = 0 | 1 | 2 | 3;

export function canHaveMagicBonus(e: Pick<CompendiumEntity, 'category'>): boolean {
  return e.category === 'weapon' || e.category === 'armor' || e.category === 'shield';
}

export function clampMagicBonus(n: unknown): MagicBonus {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return (v <= 0 ? 0 : v >= 3 ? 3 : v) as MagicBonus;
}

export interface VariantName {
  /** The name without the bonus ("Longsword" for "+1 Longsword"; a "(+2 AC)" note is kept). */
  base: string;
  /** 1..3, or null for a "+1, +2, or +3" umbrella entry. */
  bonus: 1 | 2 | 3 | null;
}

const PREFIX_FORM = /^\+([123])\s+(.+)$/;
const SUFFIX_FORM = /^(.+?)\s*,?\s*\+([123])$/;
const UMBRELLA_FORM = /^(.+?)\s*,?\s*\+[123](?:\s*,\s*\+[123])*\s*,?\s*or\s*\+[123]$/i;

/** Reads "+N X", "X +N", "X, +N" (and the "X, +1, +2, or +3" umbrella); null for anything else. */
export function parseVariantName(name: string): VariantName | null {
  const n = name.trim();
  const um = UMBRELLA_FORM.exec(n);
  if (um) return { base: um[1]!.trim(), bonus: null };
  const pre = PREFIX_FORM.exec(n);
  if (pre) return { base: pre[2]!.trim(), bonus: Number(pre[1]) as 1 | 2 | 3 };
  const suf = SUFFIX_FORM.exec(n);
  if (suf) return { base: suf[1]!.trim(), bonus: Number(suf[2]) as 1 | 2 | 3 };
  return null;
}

/** Same folding as compendium-dedupe's normalizeEntityName (local, so the two modules do not import each other). */
function norm(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function stripNote(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** Key shared by an item and all its "+N" variants: normalized name without the bonus and a trailing "(note)". */
export function variantFamilyKey(name: string): string {
  const v = parseVariantName(name);
  return norm(stripNote(v ? v.base : name));
}

/** True when two names are the same base item or variants of it (so they are not "possible duplicates"). */
export function isVariantRelation(nameA: string, nameB: string): boolean {
  if (!parseVariantName(nameA) && !parseVariantName(nameB)) return false;
  return variantFamilyKey(nameA) === variantFamilyKey(nameB);
}

function familyIndexKey(e: CompendiumEntity): string {
  return `${e.category}|${e.ruleset}|${variantFamilyKey(e.name)}`;
}

/** Plain (non-variant) weapon/armor/shield entries by family. */
export function buildVariantBaseIndex(pool: readonly CompendiumEntity[]): Map<string, CompendiumEntity> {
  const idx = new Map<string, CompendiumEntity>();
  for (const e of pool) {
    if (!canHaveMagicBonus(e) || parseVariantName(e.name)) continue;
    const k = familyIndexKey(e);
    if (!idx.has(k)) idx.set(k, e);
  }
  return idx;
}

type BaseIndex = Map<string, CompendiumEntity>;

export interface VariantMatch {
  base: CompendiumEntity;
  bonus: 1 | 2 | 3;
}

/** The base item and bonus of a "+N X" entry, when the base exists in the index. */
export function findVariantBase(variant: CompendiumEntity, idx: BaseIndex): VariantMatch | null {
  if (!canHaveMagicBonus(variant)) return null;
  const v = parseVariantName(variant.name);
  if (!v || v.bonus === null) return null;
  const base = idx.get(familyIndexKey(variant));
  return base ? { base, bonus: v.bonus } : null;
}

/**
 * Hides the "+N X" weapon/armor/shield entries whose base item exists: players add the base item and
 * set its Magic bonus instead. Nothing is deleted; entries without a base (or umbrella entries) stay.
 */
export function foldMagicVariants(entities: readonly CompendiumEntity[]): CompendiumEntity[] {
  const idx = buildVariantBaseIndex(entities);
  return entities.filter((e) => !findVariantBase(e, idx));
}

/** Name to show on a sheet: customName, else "+N Base" when the item has a magic bonus. */
export function displayItemName(item: Pick<CompendiumEntity, 'name' | 'customName' | 'magicBonus'>): string {
  const custom = item.customName?.trim();
  if (custom) return custom;
  return item.magicBonus && item.magicBonus > 0 ? `+${item.magicBonus} ${item.name}` : item.name;
}

/**
 * Old saves hold the built-in "+1 Longsword" as its own item. When the base item exists, turn it into
 * the base item with magicBonus (keeping the sheet item's id and its equipped / attuned / quantity /
 * container state). Items whose base cannot be found are left as they are.
 */
export function migrateVariantItems(
  items: readonly CompendiumEntity[],
  idx: BaseIndex
): { items: CompendiumEntity[]; changed: boolean } {
  let changed = false;
  const out = items.map((it) => {
    if (it.magicBonus !== undefined) return it;
    const m = findVariantBase(it, idx);
    if (!m) return it;
    changed = true;
    const next: CompendiumEntity = { ...structuredClone(m.base), id: it.id, magicBonus: m.bonus };
    for (const k of ['equipped', 'prepared', 'attuned', 'quantity', 'container', 'customName'] as const) {
      if (it[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = it[k];
    }
    return next;
  });
  return { items: out, changed };
}

export function migrateCharacterVariants(
  character: RawCharacterState,
  idx: BaseIndex
): { character: RawCharacterState; changed: boolean } {
  const r = migrateVariantItems(character.items, idx);
  return r.changed ? { character: { ...character, items: r.items }, changed: true } : { character, changed: false };
}
