import { DEFAULT_SOURCE_PRIORITY, sanitizeSourcePriority, type SourceTier } from '../engine/compendium-dedupe';

export const SOURCE_PRIORITY_STORAGE_KEY = 'dnd-forge-source-priority';

/** The saved duplicate-source order (first = shown), or the default: Mine > SRD 2024 > SRD 2014 > Free5e. */
export function readStoredSourcePriority(): SourceTier[] {
  try {
    const raw = localStorage.getItem(SOURCE_PRIORITY_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SOURCE_PRIORITY];
    return sanitizeSourcePriority(JSON.parse(raw));
  } catch {
    return [...DEFAULT_SOURCE_PRIORITY];
  }
}

export function saveSourcePriority(order: readonly SourceTier[]): void {
  try {
    localStorage.setItem(SOURCE_PRIORITY_STORAGE_KEY, JSON.stringify(sanitizeSourcePriority(order)));
  } catch {
    // Ignore storage errors
  }
}

/** Moves one tier one step up (-1) or down (+1); returns a new array. */
export function moveSourceTier(order: readonly SourceTier[], tier: SourceTier, delta: -1 | 1): SourceTier[] {
  const next = [...order];
  const i = next.indexOf(tier);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
