import { describe, expect, it } from 'vitest';
import type { CompendiumEntity } from '../../types/compendium';
import { buildQualityReport, findCrossPackClashes, looksOcrDamaged, REPORT_ROW_CAP, scoreEntity } from '../content-quality';

function ent(over: Partial<CompendiumEntity> & { name: string; category: CompendiumEntity['category'] }): CompendiumEntity {
  return { id: over.id ?? `t-${over.name}`, source: 'Test', ruleset: '2014', activities: [], entries: ['Some text.'], imageUrl: 'https://example.com/a.png', ...over };
}
const codes = (e: CompendiumEntity) => scoreEntity(e).issues.map((i) => i.code);

const goodSpell = ent({
  name: 'Fine Bolt',
  category: 'spell',
  spellLevel: 1,
  classes: ['Wizard'],
  components: 'V, S',
  range: '60 feet',
  duration: 'Instantaneous',
  castingTime: '1 action',
  activities: [{ id: 'a', name: 'Cast', type: 'attack', actionEconomy: 'action', damageFormula: '2d6' }],
});

describe('scoreEntity', () => {
  it('gives a complete spell 100 and no issues', () => {
    expect(scoreEntity(goodSpell)).toEqual({ score: 100, issues: [] });
  });

  it('flags missing spell fields, no activity and bad dice', () => {
    const bad = ent({ name: 'Thin Spell', category: 'spell', entries: [], activities: [{ id: 'a', name: 'Hit', type: 'attack', actionEconomy: 'action', damageFormula: '1d8 + 3' }] });
    const c = codes(bad);
    for (const code of ['spell-no-level', 'spell-no-classes', 'spell-no-components', 'spell-no-range', 'spell-no-duration', 'no-description', 'bad-dice']) expect(c).toContain(code);
    expect(codes({ ...bad, activities: [] })).toContain('spell-no-activity');
    expect(scoreEntity(bad).score).toBeLessThan(50);
  });

  it('checks monsters for stats and actions', () => {
    expect(codes(ent({ name: 'Blob', category: 'monster', entries: [] }))).toEqual(expect.arrayContaining(['monster-no-stats', 'monster-no-actions']));
    const m = ent({ name: 'Rat', category: 'monster', monsterMeta: { ac: 12, hp: 5, dexModifier: 2 } });
    const c = codes(m);
    expect(c).toEqual(expect.arrayContaining(['monster-no-cr', 'monster-no-speed', 'monster-no-size']));
    expect(c).not.toContain('monster-no-stats');
  });

  it('checks weapons, armor and gear', () => {
    expect(codes(ent({ name: 'Stick', category: 'weapon' }))).toEqual(expect.arrayContaining(['weapon-no-damage', 'item-no-weight']));
    expect(codes(ent({ name: 'Plate', category: 'armor', weight: 65 }))).toContain('armor-no-ac');
    expect(codes(ent({ name: 'Plate', category: 'armor', weight: 65, acFormula: { base: 18, dexCap: 0 } }))).toEqual([]);
    expect(codes(ent({ name: 'Rope', category: 'gear' }))).toEqual(['item-no-weight']);
  });

  it('flags leftover tags, missing image and OCR-looking names with low severity', () => {
    const e = ent({ name: 'AjarNette', category: 'feature', entries: ['A {@b bold} claim {@filter x|y}.'], imageUrl: undefined });
    const issues = scoreEntity(e).issues;
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['leftover-tags', 'no-image', 'name-ocr']));
    expect(issues.find((i) => i.code === 'name-ocr')?.severity).toBe('low');
    expect(codes(ent({ name: 'Fireball', category: 'feature', entries: ['Deal {@damage 8d6} fire.'] }))).toEqual([]);
    expect(looksOcrDamaged('McDonald Blade')).toBe(false);
    expect(looksOcrDamaged('Sw0rd of Light')).toBe(true);
  });
});

describe('cross-pack clashes', () => {
  const srd = [ent({ name: 'Fireball', category: 'spell', source: 'SRD 5.1', id: 'srd-fireball' }), ent({ name: "Tasha's Hideous Laughter", category: 'spell', id: 'srd-laughter' })];
  it('finds exact and near matches against another set, ignoring other categories', () => {
    const mine = [
      ent({ name: 'fireball', category: 'spell', id: 'p-fb' }),
      ent({ name: 'Hideous Laughter', category: 'spell', id: 'p-hl' }),
      ent({ name: 'Fireball', category: 'gear', id: 'p-gear' }),
      ent({ name: 'Unique Thing', category: 'spell', id: 'p-u' }),
    ];
    const clashes = findCrossPackClashes(mine, srd);
    expect(clashes.map((c) => `${c.kind}:${c.entity.id}->${c.other.id}`).sort()).toEqual(['exact:p-fb->srd-fireball', 'near:p-hl->srd-laughter']);
  });
});

describe('buildQualityReport', () => {
  const entities = [
    goodSpell,
    ent({ name: 'Thin Spell', category: 'spell', entries: [], id: 'b', packFile: 'spells/b.json' }),
    ent({ name: 'Plate|Mail', category: 'armor', id: 'c', packFile: 'items/c.json' }),
    ent({ name: 'Fireball', category: 'spell', id: 'd', spellLevel: 3, packFile: 'spells/d.json' }),
  ];
  const against = [ent({ name: 'Fireball', category: 'spell', id: 'srd-fb', source: 'SRD 5.1' })];

  it('is deterministic regardless of input order and lists worst entries first', () => {
    const a = buildQualityReport({ packName: 'Synthetic', entities, against });
    const b = buildQualityReport({ packName: 'Synthetic', entities: [...entities].reverse(), against });
    expect(a).toBe(b);
    expect(a).toContain('# Content quality report: Synthetic');
    expect(a).toContain('- Entries: 4');
    expect(a).toContain('1 exact name match(es), 0 near duplicate(s)');
    expect(a).toContain(String.raw`Plate\|Mail`);
    const rows = a.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    const scores = rows.map((l) => Number(l.split('|')[1]));
    expect(scores).toEqual([...scores].sort((x, y) => x - y));
    expect(a.indexOf('Fine Bolt')).toBeGreaterThan(a.indexOf('Thin Spell'));
  });

  it('caps the entry table', () => {
    const many = Array.from({ length: REPORT_ROW_CAP + 5 }, (_, i) => ent({ name: `Thing ${String(i).padStart(3, '0')}`, category: 'gear', id: `g${i}` }));
    const md = buildQualityReport({ packName: 'Big', entities: many });
    expect(md.split('\n').filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(REPORT_ROW_CAP);
    expect(md).toContain('...and 5 more');
  });
});
