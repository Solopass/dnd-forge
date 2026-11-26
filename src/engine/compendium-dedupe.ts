import type { CompendiumEntity } from '../types/compendium';

type SourceKind = 'srd' | 'free5e' | 'other';

/** Lower-cases and strips everything that is not a letter or digit, so "Cure  Wounds" == "cure-wounds". */
export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sourceKind(e: CompendiumEntity): SourceKind {
  if (/^free5e/i.test(e.id) || /free5e/i.test(e.source)) return 'free5e';
  if (/^SRD/i.test(e.source) || /^srd/i.test(e.id)) return 'srd';
  return 'other';
}

/** Rough "how much data does this entry carry" score, used to pick between two SRD copies. */
function richness(e: CompendiumEntity): number {
  return (
    (e.monsterMeta ? 5 : 0) +
    e.activities.length * 3 +
    e.entries.length +
    (e.classes?.length ? 2 : 0) +
    (e.components ? 1 : 0)
  );
}

/**
 * Hides duplicate compendium entries for list building (search, Add Spell/Gear, Level-Up, Encounter
 * Builder). Two entries are duplicates when they share normalized name + category + ruleset.
 * Only SRD and Free5e entries are de-duplicated: the SRD copy wins over Free5e; between two SRD
 * copies (built-in pack vs SRD JSON) the one with richer data wins. Homebrew, imported and other
 * sources are never hidden. Nothing is deleted; input order is kept, and a winner that lacks
 * spell class lists inherits them from a hidden duplicate.
 */
export function dedupeCompendium(entities: readonly CompendiumEntity[]): CompendiumEntity[] {
  const winners = new Map<string, CompendiumEntity>();
  for (const e of entities) {
    const kind = sourceKind(e);
    if (kind === 'other') continue;
    const key = `${normalizeEntityName(e.name)}|${e.category}|${e.ruleset}`;
    const cur = winners.get(key);
    if (!cur) {
      winners.set(key, e);
      continue;
    }
    const curKind = sourceKind(cur);
    if (kind === curKind ? richness(e) > richness(cur) : kind === 'srd') winners.set(key, e);
  }
  const out: CompendiumEntity[] = [];
  const emitted = new Set<string>();
  for (const e of entities) {
    if (sourceKind(e) === 'other') {
      out.push(e);
      continue;
    }
    const key = `${normalizeEntityName(e.name)}|${e.category}|${e.ruleset}`;
    const win = winners.get(key);
    if (win !== e || emitted.has(key)) continue;
    emitted.add(key);
    if (win.category === 'spell' && !win.classes?.length) {
      const donor = entities.find(
        (o) =>
          o !== win &&
          o.category === 'spell' &&
          o.ruleset === win.ruleset &&
          o.classes?.length &&
          normalizeEntityName(o.name) === normalizeEntityName(win.name)
      );
      out.push(donor ? { ...win, classes: donor.classes } : win);
    } else {
      out.push(win);
    }
  }
  return out;
}
