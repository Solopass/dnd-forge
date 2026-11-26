import { describe, expect, it } from 'vitest';
import {
  assignPackIdentity,
  convertLegacyManifest,
  diffPackEntities,
  expandGlobs,
  free5eTargetsFromTree,
  guessCategoryFromPath,
  parsePackManifest,
} from '../pack-manifest';
import { sourceTierOf } from '../compendium-dedupe';
import type { CompendiumEntity } from '../../types/compendium';

const GOOD = {
  format: 'dnd-forge-pack@1',
  id: 'naruto-5e',
  name: 'Synthetic Pack',
  version: '1.2.0',
  license: 'CC-BY-4.0',
  ruleset: '2024',
  requires: ['free5e'],
  content: ['monsters/*.json', 'features/**/*.json'],
  characters: ['characters/*.json'],
};

const ent = (over: Partial<CompendiumEntity>): CompendiumEntity => ({
  id: 'x',
  name: 'X',
  source: 'Test',
  ruleset: '2014',
  category: 'spell',
  activities: [],
  entries: [],
  ...over,
});

describe('pack.json v1 parsing', () => {
  it('accepts a good manifest and normalises paths', () => {
    const r = parsePackManifest({ ...GOOD, content: ['./monsters/*.json'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.id).toBe('naruto-5e');
      expect(r.manifest.content).toEqual(['monsters/*.json']);
      expect(r.manifest.requires).toEqual(['free5e']);
    }
  });

  it('reports every problem of a bad manifest with the field name', () => {
    const r = parsePackManifest({
      format: 'dnd-forge-pack@2',
      id: 'Bad Id',
      version: 3,
      content: ['../escape.json', 5],
      ruleset: '5e',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const text = r.errors.join('\n');
      expect(text).toContain('Unsupported pack format "dnd-forge-pack@2"');
      expect(text).toContain('"id" ("Bad Id")');
      expect(text).toContain('"name" is required');
      expect(text).toContain('"ruleset"');
      expect(text).toContain('"content[0]"');
      expect(text).toContain('"content[1]"');
      expect(text).not.toContain('"version" is required'); // a number version is accepted
    }
  });

  it('rejects non-objects, a missing format, and a pack that lists nothing', () => {
    expect(parsePackManifest('nope')).toEqual({ ok: false, errors: ['pack.json must be a JSON object.'] });
    expect(parsePackManifest([])).toMatchObject({ ok: false });
    const noFormat = parsePackManifest({ ...GOOD, format: undefined });
    expect(noFormat.ok === false && noFormat.errors[0]).toContain('"format" must be');
    const empty = parsePackManifest({ ...GOOD, content: [], characters: [] });
    expect(empty.ok === false && empty.errors.join()).toContain('lists nothing');
  });

  it('rejects a bad requires list and absolute paths', () => {
    const r = parsePackManifest({ ...GOOD, requires: ['Not Valid'], characters: ['/etc/passwd', 'C:\\x.json'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/requires[\s\S]*characters\[0\][\s\S]*characters\[1\]/);
  });
});

describe('glob expansion', () => {
  const files = [
    'pack.json',
    'monsters/orc.json',
    'monsters/goblin.json',
    'monsters/notes.md',
    'features/a.json',
    'features/deep/b.json',
    'features/deep/er/c.json',
    'characters/hero.json',
  ];
  it('* stays inside one folder, ** crosses folders, plain paths pass through', () => {
    expect(expandGlobs(['monsters/*.json'], files)).toEqual(['monsters/goblin.json', 'monsters/orc.json']);
    expect(expandGlobs(['features/**/*.json'], files)).toEqual([
      'features/a.json',
      'features/deep/b.json',
      'features/deep/er/c.json',
    ]);
    expect(expandGlobs(['**/hero.json'], files)).toEqual(['characters/hero.json']);
    expect(expandGlobs(['characters/hero.json', 'missing/file.json'], files)).toEqual([
      'characters/hero.json',
      'missing/file.json',
    ]);
  });
  it('keeps pattern order and drops duplicates', () => {
    expect(expandGlobs(['monsters/orc.json', 'monsters/*.json'], files)).toEqual([
      'monsters/orc.json',
      'monsters/goblin.json',
    ]);
  });
  it('escapes regex characters in names', () => {
    expect(expandGlobs(['a+b/*.json'], ['a+b/x.json', 'aab/x.json'])).toEqual(['a+b/x.json']);
  });
});

describe('v0 campaign-pack.json conversion', () => {
  it('reads the old manifest as a v1 manifest with its inline data and category hints', () => {
    const conv = convertLegacyManifest(
      {
        name: 'My Campaign',
        ruleset: '2024',
        source: 'My Book',
        entities: ['spells/s.json', { path: 'items/i.json', category: 'gear' }, { name: 'Inline Thing', category: 'gear' }],
        characters: ['characters/hero.json', { name: 'Inline Hero' }],
        entries: [{ id: 'e1' }],
      },
      { owner: 'Someone', repo: 'My-Campaign' }
    );
    expect(conv.manifest.id).toBe('my-campaign');
    expect(conv.manifest.name).toBe('My Campaign');
    expect(conv.manifest.ruleset).toBe('2024');
    expect(conv.manifest.content).toEqual(['spells/s.json', 'items/i.json']);
    expect(conv.manifest.characters).toEqual(['characters/hero.json']);
    expect(conv.categoryHints['items/i.json']).toBe('gear');
    expect(conv.inlineEntities).toHaveLength(1);
    expect(conv.inlineCharacters).toHaveLength(1);
    expect(conv.entries).toHaveLength(1);
    expect(conv.sourceLabel).toBe('My Book');
  });
  it('gives Solopass/free5e the id free5e', () => {
    expect(convertLegacyManifest({}, { owner: 'solopass', repo: 'Free5e' }).manifest.id).toBe('free5e');
  });
});

describe('Free5e adapter on a recorded tree', () => {
  const tree = [
    'README.md',
    'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions.md',
    'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/_A.md',
    'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/A/Alarm.md',
    'en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/Alert.md',
    'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Weapons_table.md',
    'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Armor_table.md',
    'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Tools.md',
    'en-US/Monstrous_Manuscript/02_Monsters_A-Z/Monsters/Goblin.md',
    'en-US/Monstrous_Manuscript/02_Monsters_A-Z/Monsters/image.png',
  ];
  it('picks content files with their categories and skips index pages and non-markdown', () => {
    expect(free5eTargetsFromTree(tree)).toEqual([
      { path: 'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/A/Alarm.md', category: 'spell' },
      { path: 'en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/Alert.md', category: 'feat' },
      { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Weapons_table.md', category: 'weapon' },
      { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Armor_table.md', category: 'armor' },
      { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Tools.md', category: 'gear' },
      { path: 'en-US/Monstrous_Manuscript/02_Monsters_A-Z/Monsters/Goblin.md', category: 'monster' },
    ]);
  });
  it('finds nothing in a tree that is not Free5e-shaped', () => {
    expect(free5eTargetsFromTree(['README.md', 'docs/a.md'])).toEqual([]);
  });
});

describe('provenance and namespaced ids', () => {
  const identity = { packId: 'pack-a', packVersion: '1.0.0', packRef: 'abc123' };
  it('stamps provenance and namespaces only entities without an id', () => {
    const out = assignPackIdentity(
      [
        { entity: ent({ id: 'custom-spell-alert', name: 'Alert' }), hadId: false },
        { entity: ent({ id: 'my-own-id', name: 'Keeper' }), hadId: true },
      ],
      identity
    );
    expect(out[0]).toMatchObject({ id: 'pack-a:alert', packId: 'pack-a', packVersion: '1.0.0', packRef: 'abc123' });
    expect(out[1]).toMatchObject({ id: 'my-own-id', packId: 'pack-a' });
  });
  it('two packs with the same entry name do not collide', () => {
    const a = assignPackIdentity([{ entity: ent({ name: 'Fire Bolt' }), hadId: false }], identity)[0]!;
    const b = assignPackIdentity([{ entity: ent({ name: 'Fire Bolt' }), hadId: false }], { ...identity, packId: 'pack-b' })[0]!;
    expect(a.id).toBe('pack-a:fire-bolt');
    expect(b.id).toBe('pack-b:fire-bolt');
  });
  it('a name clash inside one pack gets the category, then a counter', () => {
    const out = assignPackIdentity(
      [
        { entity: ent({ name: 'Alert', category: 'spell' }), hadId: false },
        { entity: ent({ name: 'Alert', category: 'feat' }), hadId: false },
        { entity: ent({ name: 'Alert', category: 'feat' }), hadId: false },
      ],
      identity
    );
    expect(out.map((e) => e.id)).toEqual(['pack-a:alert', 'pack-a:alert-feat', 'pack-a:alert-feat-2']);
  });
});

describe('source tier by provenance', () => {
  it('uses packId first and the old strings as a fallback', () => {
    expect(sourceTierOf(ent({ packId: 'free5e', id: 'free5e:x', source: 'Whatever' }))).toBe('free5e');
    expect(sourceTierOf(ent({ packId: 'naruto-5e', source: 'SRD 5.1' }))).toBe('mine'); // a pack never counts as SRD
    expect(sourceTierOf(ent({ id: 'srd-spl-x', source: 'SRD 5.1' }))).toBe('srd2014');
    expect(sourceTierOf(ent({ id: 'free5e-spl-x', source: 'Free5e (Solopass/free5e)' }))).toBe('free5e');
    expect(sourceTierOf(ent({ id: 'custom-x', source: 'Custom' }))).toBe('mine');
  });
});

describe('pack entity diff', () => {
  it('separates added, changed, removed and ignores version / commit stamps', () => {
    const prev = [
      ent({ id: 'a', name: 'A', packVersion: '1', packRef: 'old' }),
      ent({ id: 'b', name: 'B', entries: ['old text'] }),
      ent({ id: 'c', name: 'C' }),
    ];
    const next = [
      ent({ id: 'a', name: 'A', packVersion: '2', packRef: 'new' }),
      ent({ id: 'b', name: 'B', entries: ['new text'] }),
      ent({ id: 'd', name: 'D' }),
    ];
    expect(diffPackEntities(prev, next)).toEqual({ added: ['d'], changed: ['b'], removed: ['c'], unchanged: 1 });
  });
});

describe('category guessing from a path', () => {
  it('maps folder names to categories', () => {
    expect(guessCategoryFromPath('spells/a.md')).toBe('spell');
    expect(guessCategoryFromPath('Monsters/a.json')).toBe('monster');
    expect(guessCategoryFromPath('misc/a.json')).toBe('gear');
  });
});
