import type { CompendiumEntity } from '../types/compendium';
import {
  areNearDuplicates,
  DEFAULT_SOURCE_PRIORITY,
  exactKey,
  groupExactDuplicates,
  type SourceTier,
} from './compendium-dedupe';

export interface ImportPlan {
  /** Entities the import would add or replace. */
  incoming: CompendiumEntity[];
  newItems: CompendiumEntity[];
  /** Same name + category + ruleset as something already there (or earlier in the same import). */
  exact: Array<{ incoming: CompendiumEntity; existing: CompendiumEntity; winner: CompendiumEntity }>;
  /** Possible duplicates that need a look in the Duplicates tab; never hidden automatically. */
  near: Array<{ incoming: CompendiumEntity; similar: CompendiumEntity[] }>;
  /** Characters in the same import (they are not de-duplicated). */
  characters: number;
  /** Sources the exact duplicates fold into, e.g. ["SRD 5.1"]. */
  foldTargets: string[];
  summary: string;
}

/** What importing `incoming` into a compendium that already holds `existing` would do. Writes nothing. */
export function planEntityImport(
  incoming: readonly CompendiumEntity[],
  existing: readonly CompendiumEntity[],
  priority: readonly SourceTier[] = DEFAULT_SOURCE_PRIORITY,
  characters = 0
): ImportPlan {
  const byKey = new Map<string, CompendiumEntity[]>();
  const byCat = new Map<string, CompendiumEntity[]>();
  const add = (e: CompendiumEntity) => {
    const k = exactKey(e);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
    (byCat.get(e.category) ?? byCat.set(e.category, []).get(e.category)!).push(e);
  };
  existing.forEach(add);

  const newItems: CompendiumEntity[] = [];
  const exact: ImportPlan['exact'] = [];
  const near: ImportPlan['near'] = [];
  for (const inc of incoming) {
    const same = byKey.get(exactKey(inc)) ?? [];
    if (same.length > 0) {
      const group = groupExactDuplicates([...same, inc], priority)[0];
      exact.push({ incoming: inc, existing: same[0]!, winner: group ? group.winner : same[0]! });
    } else {
      const similar = (byCat.get(inc.category) ?? []).filter((o) => areNearDuplicates(inc, o)).slice(0, 5);
      if (similar.length > 0) near.push({ incoming: inc, similar });
      else newItems.push(inc);
    }
    add(inc);
  }

  const foldTargets = [...new Set(exact.map((x) => x.winner.source))];
  const parts = [`${newItems.length} new`];
  parts.push(
    exact.length > 0
      ? `${exact.length} exact duplicate${exact.length === 1 ? '' : 's'} (will fold into ${foldTargets.join(', ')})`
      : '0 exact duplicates'
  );
  parts.push(`${near.length} possible duplicate${near.length === 1 ? '' : 's'} (review)`);
  if (characters > 0) parts.push(`${characters} character${characters === 1 ? '' : 's'}`);
  return { incoming: [...incoming], newItems, exact, near, characters, foldTargets, summary: parts.join(', ') };
}
