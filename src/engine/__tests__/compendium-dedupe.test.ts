import { describe, expect, it } from 'vitest';
import {
  applyDuplicateDecisions,
  dedupeCompendium,
  DEFAULT_SOURCE_PRIORITY,
  findNearDuplicates,
  nameSimilarity,
  normalizeEntityName,
  sanitizeSourcePriority,
  sourceTierOf,
} from '../compendium-dedupe';
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

  it('keeps entries that differ by ruleset or category; Mine wins over SRD for the same ruleset', () => {
    const out = dedupeCompendium([
      ent('a', 'Fireball', 'SRD 5.1'),
      ent('b', 'Fireball', 'SRD 5.2', { ruleset: '2024' }),
      ent('c', 'Fireball', 'My Homebrew', { ruleset: 'homebrew' }),
      ent('d', 'Fireball', 'My Book'),
      ent('e', 'Fireball', 'SRD 5.1', { category: 'feat' }),
    ]);
    // d (Mine, 2014) replaces a (SRD 5.1, 2014) and records it in "alsoIn".
    expect(out.map((e) => e.id)).toEqual(['b', 'c', 'd', 'e']);
    expect(out.find((e) => e.id === 'd')!.alsoIn).toEqual(['SRD 5.1']);
  });

  it('classifies sources into tiers', () => {
    expect(sourceTierOf(ent('free5e-spl-x', 'X', 'Free5e (Solopass/free5e)'))).toBe('free5e');
    expect(sourceTierOf(ent('srd14-spl-x', 'X', 'SRD 5.1'))).toBe('srd2014');
    expect(sourceTierOf(ent('srd24-spl-x', 'X', 'SRD 5.2', { ruleset: '2024' }))).toBe('srd2024');
    expect(sourceTierOf(ent('custom-x', 'X', 'My Homebrew Handbook'))).toBe('mine');
  });

  it('honours a custom priority order and folds the rest, filling missing fields', () => {
    const free = ent('free5e-spl-bless', 'Bless', 'Free5e', { classes: ['Cleric'], imageUrl: 'a.png', entries: ['long text'] });
    const srd = ent('srd14-spl-bless', 'Bless', 'SRD 5.1', { entries: [] });
    const mine = ent('custom-bless', 'Bless', 'My Book', { entries: [] });
    const out = dedupeCompendium([free, srd, mine], ['free5e', 'mine', 'srd2024', 'srd2014']);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('free5e-spl-bless');
    expect(out[0]!.alsoIn).toEqual(['SRD 5.1', 'My Book']);
    const out2 = dedupeCompendium([free, srd, mine]);
    expect(out2[0]!.id).toBe('custom-bless');
    expect(out2[0]!.classes).toEqual(['Cleric']);
    expect(out2[0]!.imageUrl).toBe('a.png');
    expect(out2[0]!.entries).toEqual(['long text']);
    expect(out2[0]!.alsoIn).toEqual(['Free5e', 'SRD 5.1']);
  });

  it('normalizes diacritics and punctuation, and repairs a bad priority list', () => {
    expect(normalizeEntityName('Drägon’s  Breath!')).toBe('dragonsbreath');
    expect(sanitizeSourcePriority(['srd2014', 'junk', 'srd2014'])).toEqual(['srd2014', 'mine', 'srd2024', 'free5e']);
    expect(sanitizeSourcePriority(null)).toEqual([...DEFAULT_SOURCE_PRIORITY]);
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

describe('findNearDuplicates (synthetic)', () => {
  const sp = (id: string, name: string, level: number, source = 'SRD 5.1', extra: Partial<CompendiumEntity> = {}) =>
    ent(id, name, source, { spellLevel: level, ...extra });

  it('flags possessive-prefix variants with the same level, but not different levels', () => {
    const groups = findNearDuplicates([
      sp('a', "Melf's Acid Arrow", 2),
      sp('b', 'Acid Arrow', 2, 'My Book'),
      sp('c', "Tasha's Hideous Laughter", 1),
      sp('d', 'Hideous Laughter', 3, 'My Book'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.id)).toEqual(['b', 'a']); // Mine before SRD
  });

  it('flags >= 0.85 token/character similarity, not unrelated names', () => {
    expect(nameSimilarity('Protection from Evil and Good', 'Protection from Good and Evil')).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity('Mage Armor', 'Mage Hand')).toBeLessThan(0.85);
    const groups = findNearDuplicates([sp('a', 'Hold Person', 2), sp('b', 'Hold Persons', 2, 'My Book'), sp('c', 'Hold Monster', 5)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('uses CR for monsters and never groups across categories; exact duplicates are not near', () => {
    const mon = (id: string, name: string, cr: string, source = 'SRD 5.1') =>
      ent(id, name, source, { category: 'monster', monsterMeta: { ac: 10, hp: 5, dexModifier: 0, cr } });
    const groups = findNearDuplicates([
      mon('m1', "Bigby's Hand", '2'),
      mon('m2', 'Hand', '5', 'My Book'),
      mon('m3', 'Giant Wolf Spiders', '1', 'My Book'),
      mon('m4', 'Giant Wolf Spider', '1'),
      ent('s1', 'Giant Wolf Spider', 'SRD 5.1'),
      ent('x1', 'Cure Wounds', 'SRD 5.1'),
      ent('x2', 'Cure Wounds', 'Free5e'),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id).sort())).toEqual([['m3', 'm4']]);
  });

  it('a homebrew-ruleset copy can be a near duplicate of an SRD one', () => {
    const groups = findNearDuplicates([
      sp('a', "Leomund's Tiny Hut", 3),
      sp('b', 'Tiny Hut', 3, 'Mine', { ruleset: 'homebrew' }),
      sp('c', 'Tiny Hut', 3, 'SRD 5.2', { ruleset: '2024' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(3);
  });

  it('applyDuplicateDecisions: keep-one hides, merge fills, keep-both changes nothing', () => {
    const a = sp('a', "Melf's Acid Arrow", 2, 'SRD 5.1', { classes: ['Wizard'] });
    const b = sp('b', 'Acid Arrow', 2, 'My Book', { entries: [] });
    const decide = (action: 'keep-one' | 'keep-both' | 'merge') => [
      { id: 'a|b', memberIds: ['a', 'b'], action, keepId: 'b', decidedAt: 'now' },
    ];
    expect(applyDuplicateDecisions([a, b], decide('keep-both')).map((e) => e.id)).toEqual(['a', 'b']);
    const one = applyDuplicateDecisions([a, b], decide('keep-one'));
    expect(one.map((e) => e.id)).toEqual(['b']);
    expect(one[0]!.classes).toBeUndefined();
    const merged = applyDuplicateDecisions([a, b], decide('merge'));
    expect(merged[0]!.classes).toEqual(['Wizard']);
    expect(merged[0]!.alsoIn).toEqual(['SRD 5.1']);
  });

  it('real shipped content: finds groups without throwing, in reasonable time', async () => {
    const all = [...BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities), ...(await loadCustomRepoEntities())];
    const t0 = Date.now();
    const groups = findNearDuplicates(all);
    expect(Date.now() - t0).toBeLessThan(20000);
    for (const g of groups) expect(g.members.length).toBeGreaterThan(1);
  }, 30000);
});
