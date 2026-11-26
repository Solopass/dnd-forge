import { describe, expect, it } from 'vitest';
import {
  applyFixes,
  applyFixesToList,
  applyPatch,
  buildPatch,
  createFix,
  diffEntities,
  exportFixesFile,
  fixState,
  hashEntity,
  isStale,
  parseFixesFile,
} from '../content-fixes';
import type { CompendiumEntity } from '../../types/compendium';
import type { ContentFix } from '../../types/content-fix';

const spell = (extra: Partial<CompendiumEntity> = {}): CompendiumEntity => ({
  id: 'syn-spark',
  name: 'Synthetic Spark',
  source: 'Test Book',
  ruleset: '2014',
  category: 'spell',
  spellLevel: 1,
  range: '30 feet',
  activities: [
    { id: 'syn-spark-a', name: 'Spark', type: 'attack', actionEconomy: 'action', attackBonusFormula: '@prof', damageFormula: '1d6', damageType: 'fire' },
  ],
  entries: ['A spark leaps out.'],
  ...extra,
});
const monster = (): CompendiumEntity => ({
  id: 'syn-mob', name: 'Synthetic Mob', source: 'Test Book', ruleset: '2014', category: 'monster',
  monsterMeta: { ac: 12, hp: 20, dexModifier: 1, cr: '1/2' }, activities: [], entries: [],
});

function fixOf(base: CompendiumEntity, edited: CompendiumEntity, status: ContentFix['status'] = 'approved', createdAt = '2026-01-01T00:00:00.000Z'): ContentFix {
  const r = createFix({ base, edited, note: 'n', author: 'DM', now: new Date(createdAt) });
  if ('error' in r) throw new Error(r.error);
  return { ...r.fix, status };
}
const edit = (e: CompendiumEntity, f: (c: CompendiumEntity) => void) => {
  const c = structuredClone(e);
  f(c);
  return c;
};

describe('diffEntities / buildPatch / applyPatch', () => {
  it('lists field-level changes with labels, and nothing for identical entries', () => {
    const a = spell();
    expect(diffEntities(a, structuredClone(a))).toEqual([]);
    const b = edit(a, (c) => {
      c.activities[0]!.damageFormula = '2d6';
      c.range = '60 feet';
    });
    const d = diffEntities(a, b);
    expect(d.map((c) => c.path).sort()).toEqual(['activities.syn-spark-a.damageFormula', 'range']);
    expect(d.find((c) => c.path === 'range')).toMatchObject({ label: 'Range', before: '30 feet', after: '60 feet' });
    expect(d.find((c) => c.path.endsWith('damageFormula'))?.label).toBe('Damage formula (Spark)');
  });

  it('a patch holds only the changed fields and reproduces the edit; monster stats work too', () => {
    const a = spell();
    const b = edit(a, (c) => (c.activities[0]!.damageFormula = '2d6'));
    const patch = buildPatch(a, b);
    expect(patch).toEqual({ 'activities.syn-spark-a.damageFormula': '2d6' });
    expect(applyPatch(a, patch)).toEqual(b);
    expect(a.activities[0]!.damageFormula).toBe('1d6'); // original untouched
    const m = monster();
    const m2 = applyPatch(m, buildPatch(m, edit(m, (c) => { c.monsterMeta!.ac = 15; c.monsterMeta!.cr = '1'; })));
    expect(m2.monsterMeta).toMatchObject({ ac: 15, cr: '1', hp: 20 });
  });

  it('null removes a field; unknown activity ids and protected fields are ignored', () => {
    const a = spell();
    const out = applyPatch(a, { range: null, 'activities.nope.damageFormula': 'x', id: 'hacked', equipped: true });
    expect(out.range).toBeUndefined();
    expect(out.id).toBe('syn-spark');
    expect(out.equipped).toBeUndefined();
  });
});

describe('applyFixes and staleness', () => {
  it('applies approved fixes only; proposed and rejected do nothing', () => {
    const base = spell();
    const edited = edit(base, (c) => (c.activities[0]!.damageFormula = '2d6'));
    expect(applyFixes(base, [fixOf(base, edited, 'proposed')])).toBe(base);
    expect(applyFixes(base, [fixOf(base, edited, 'rejected')])).toBe(base);
    const approved = fixOf(base, edited, 'approved');
    const eff = applyFixes(base, [approved]);
    expect(eff.activities[0]!.damageFormula).toBe('2d6');
    expect(eff.fixedBy).toEqual([approved.id]);
    expect(base.activities[0]!.damageFormula).toBe('1d6');
  });

  it('later approved fixes win on the same field; fixes for other entries are ignored', () => {
    const base = spell();
    const f1 = fixOf(base, edit(base, (c) => (c.range = '60 feet')), 'approved', '2026-01-01T00:00:00.000Z');
    const f2 = fixOf(base, edit(base, (c) => (c.range = '90 feet')), 'approved', '2026-02-01T00:00:00.000Z');
    const other = { ...fixOf(base, edit(base, (c) => (c.range = 'X')), 'approved'), entityId: 'someone-else' };
    expect(applyFixes(base, [f2, f1, other]).range).toBe('90 feet');
  });

  it('a fix whose base changed is stale: not applied, shown as needs-re-review', () => {
    const base = spell();
    const fix = fixOf(base, edit(base, (c) => (c.range = '60 feet')), 'approved');
    expect(isStale(fix, base)).toBe(false);
    expect(fixState(fix, base)).toBe('approved');
    const resynced = edit(base, (c) => (c.entries = ['Resynced text.']));
    expect(isStale(fix, resynced)).toBe(true);
    expect(fixState(fix, resynced)).toBe('needs-re-review');
    expect(fixState({ ...fix, status: 'proposed' }, resynced)).toBe('needs-re-review');
    expect(fixState({ ...fix, status: 'rejected' }, resynced)).toBe('rejected');
    expect(fixState(fix, undefined)).toBe('needs-re-review');
    expect(applyFixes(resynced, [fix])).toBe(resynced);
  });

  it('the hash ignores derived and sheet-copy fields', () => {
    const a = spell();
    expect(hashEntity({ ...a, alsoIn: ['SRD'], fixedBy: ['x'], equipped: true, quantity: 3, magicBonus: 1, customName: 'z' })).toBe(hashEntity(a));
    expect(hashEntity({ ...a, range: '31 feet' })).not.toBe(hashEntity(a));
  });

  it('applyFixesToList leaves the list alone without approved fixes', () => {
    const list = [spell()];
    expect(applyFixesToList(list, [])).toBe(list);
    const base = list[0]!;
    const fix = fixOf(base, edit(base, (c) => (c.range = '60 feet')), 'approved');
    const out = applyFixesToList(list, [fix]);
    expect(out[0]!.range).toBe('60 feet');
    expect(list[0]!.range).toBe('30 feet');
  });
});

describe('createFix and fix files', () => {
  it('needs a note and a real change', () => {
    const base = spell();
    expect(createFix({ base, edited: edit(base, (c) => (c.range = 'x')), note: '  ', author: 'Player' })).toEqual({ error: 'Add a note saying what is wrong.' });
    expect(createFix({ base, edited: structuredClone(base), note: 'n', author: 'Player' })).toEqual({ error: 'Nothing was changed.' });
    const ok = createFix({ base, edited: edit(base, (c) => (c.range = 'x')), note: 'typo', author: 'Player' });
    expect('fix' in ok && ok.fix).toMatchObject({ entityId: 'syn-spark', status: 'proposed', author: 'Player', note: 'typo', reviewedAt: null });
  });

  it('exports with entry name/source and imports everything as proposed with fresh ids on collision', () => {
    const base = spell();
    const fix = fixOf(base, edit(base, (c) => (c.range = '60 feet')), 'approved');
    const file = exportFixesFile([fix], [base]);
    expect(file.fixes[0]).toMatchObject({ entityName: 'Synthetic Spark', entitySource: 'Test Book' });
    const parsed = parseFixesFile(JSON.parse(JSON.stringify(file)), new Set([fix.id]));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.fixes).toHaveLength(1);
    expect(parsed.fixes[0]!.status).toBe('proposed');
    expect(parsed.fixes[0]!.id).not.toBe(fix.id);
    expect(parsed.fixes[0]!.patch).toEqual(fix.patch);
    const bad = parseFixesFile({ fixes: [{ entityId: 'a' }, 5, { entityId: 'a', patch: {}, baseSnapshotHash: 'h' }] }, new Set());
    expect(bad.fixes).toEqual([]);
    expect(bad.skipped).toHaveLength(3);
    expect(parseFixesFile({ nope: 1 }, new Set()).skipped).toHaveLength(1);
  });
});
