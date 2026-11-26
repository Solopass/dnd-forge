import { describe, expect, it } from 'vitest';
import { dedupeCompendium, normalizeEntityName } from '../compendium-dedupe';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { loadCustomRepoEntities } from '../custom-content-loader';
import type { CompendiumEntity } from '../../types/compendium';

function ent(id: string, name: string, source: string, extra: Partial<CompendiumEntity> = {}): CompendiumEntity {
  return { id, name, source, ruleset: '2014', category: 'spell', activities: [], entries: ['x'], ...extra };
}

describe('dedupeCompendium (audit C3)', () => {
  it('normalizes names', () => {
    expect(normalizeEntityName('Cure  Wounds')).toBe(normalizeEntityName('cure-wounds'));
  });

  it('SRD wins over Free5e and keeps its own id; Free5e-only entries stay', () => {
    const out = dedupeCompendium([
      ent('free5e-spl-cure-wounds', 'Cure Wounds', 'Free5e (Solopass/free5e)'),
      ent('srd14-spl-cure-wounds', 'Cure Wounds', 'SRD 5.1'),
      ent('free5e-spl-only', 'Only Here', 'Free5e (Solopass/free5e)'),
    ]);
    expect(out.map((e) => e.id)).toEqual(['srd14-spl-cure-wounds', 'free5e-spl-only']);
  });

  it('between two SRD copies the one with richer data wins', () => {
    const poor = ent('srd-m-goblin', 'Goblin', 'SRD 5.1', { category: 'monster' });
    const rich = ent('srd14-mon-goblin', 'Goblin', 'SRD 5.1', {
      category: 'monster',
      entries: ['a', 'b', 'c'],
      activities: [{ id: 'a1', name: 'Scimitar', type: 'attack', actionEconomy: 'action', description: '' }],
    });
    expect(dedupeCompendium([poor, rich]).map((e) => e.id)).toEqual(['srd14-mon-goblin']);
    expect(dedupeCompendium([rich, poor]).map((e) => e.id)).toEqual(['srd14-mon-goblin']);
  });

  it('keeps entries that differ by ruleset or category, and never hides homebrew', () => {
    const out = dedupeCompendium([
      ent('a', 'Fireball', 'SRD 5.1'),
      ent('b', 'Fireball', 'SRD 5.2', { ruleset: '2024' }),
      ent('c', 'Fireball', 'My Homebrew', { ruleset: 'homebrew' }),
      ent('d', 'Fireball', 'My Book'),
      ent('e', 'Fireball', 'SRD 5.1', { category: 'feat' }),
    ]);
    expect(out.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a class-less winner inherits the spell class list of a hidden duplicate', () => {
    const out = dedupeCompendium([
      ent('srd-spell-x', 'Fire Bolt', 'SRD 5.1'),
      ent('srd14-spl-fire-bolt', 'Fire Bolt', 'SRD 5.1', { classes: ['Wizard'], entries: [] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.classes).toEqual(['Wizard']);
  });

  it('shrinks the real built-in + SRD library without losing any name', async () => {
    const all = [...BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities), ...(await loadCustomRepoEntities())];
    const out = dedupeCompendium(all);
    expect(out.length).toBeLessThan(all.length);
    const goblins = out.filter((e) => e.category === 'monster' && e.ruleset === '2014' && e.name === 'Goblin');
    expect(goblins).toHaveLength(1);
    const key = (e: CompendiumEntity) => `${normalizeEntityName(e.name)}|${e.category}|${e.ruleset}`;
    expect(new Set(out.map(key))).toEqual(new Set(all.map(key)));
  });
});
