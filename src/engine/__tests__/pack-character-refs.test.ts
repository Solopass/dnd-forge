// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPackFromGitHub } from '../campaign-repo-sync';
import { analyzePackFiles } from '../import-pipeline';
import type { CompendiumEntity } from '../../types/compendium';
import { stubGitHub } from './fakeGithub';

const SHA = 'b'.repeat(40);

const character = (refs: { equipment?: string[]; features?: string[]; spells?: string[] }) =>
  JSON.stringify({
    name: 'Ref Hero',
    classes: [{ name: 'Rogue', level: 3, hitDie: 'd8' }],
    abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
    hp: { current: 20, max: 20 },
    ...refs,
  });

const packFiles = (hero: string, manifest: Record<string, unknown> = {}): Record<string, string> => ({
  'pack.json': JSON.stringify({
    format: 'dnd-forge-pack@1',
    id: 'ref-pack',
    name: 'Ref Pack',
    version: '1.0.0',
    license: 'CC-BY-4.0',
    content: ['items/*.json', 'spells/*.json', 'features/*.json'],
    characters: ['characters/*.json'],
    ...manifest,
  }),
  'items/kunai.json': JSON.stringify({ id: 'custom-item-kunai', name: 'Kunai', category: 'gear' }),
  // no id in the file: the id is made up and the install namespaces it
  'items/shuriken.json': JSON.stringify({ name: 'Shuriken', category: 'gear' }),
  'spells/flame.json': JSON.stringify({ id: 'custom-spell-flame', name: 'Flame Jet', category: 'spell', spellMeta: { level: 1, school: 'Evocation' } }),
  'features/sneak.json': JSON.stringify({ id: 'custom-feature-sneak', name: 'Sneaky Strike', category: 'feature' }),
  'characters/hero.json': hero,
});

const missingWarnings = (warnings: string[]) => warnings.filter((w) => /not found in the compendium/.test(w));

describe('character references resolve against the pack first', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('doctor: refs to the pack own item, spell and feature (by file id or namespaced id) are not missing', async () => {
    const hero = character({
      equipment: ['custom-item-kunai', 'ref-pack:shuriken'],
      features: ['custom-feature-sneak'],
      spells: ['custom-spell-flame'],
    });
    const a = await analyzePackFiles(packFiles(hero), 'ref-pack');
    expect(missingWarnings(a.warnings)).toEqual([]);
    expect(a.report.characters).toBe(1);
  });

  it('doctor: a ref to an id that exists nowhere still warns', async () => {
    const a = await analyzePackFiles(packFiles(character({ equipment: ['custom-item-kunai', 'nope-item'] })), 'ref-pack');
    const missing = missingWarnings(a.warnings);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('nope-item');
  });

  it('install: the character keeps the pack gear, spell and feature under the stored ids', async () => {
    stubGitHub({ 'Someone/ref-pack': { sha: SHA, files: packFiles(character({ equipment: ['custom-item-kunai', 'ref-pack:shuriken'], features: ['custom-feature-sneak'], spells: ['custom-spell-flame'] })) } });
    const res = await fetchPackFromGitHub({ owner: 'Someone', repo: 'ref-pack' });
    const hero = res.characters[0]!;
    const storedIds = new Set(res.entities.map((e) => e.id));
    expect(hero.items.map((i) => i.id).sort()).toEqual(['custom-feature-sneak', 'custom-item-kunai', 'custom-spell-flame', 'ref-pack:shuriken']);
    for (const item of hero.items) expect(storedIds.has(item.id)).toBe(true);
    expect(hero.items.find((i) => i.id === 'custom-item-kunai')!.packId).toBe('ref-pack');
    expect(missingWarnings(res.warnings)).toEqual([]);
  });

  it('install: a ref into an installed required pack resolves through the compendium', async () => {
    const sword: CompendiumEntity = { id: 'base-pack:sword', name: 'Base Sword', category: 'gear', source: 'Base', packId: 'base-pack' } as CompendiumEntity;
    stubGitHub({ 'Someone/ref-pack': { sha: SHA, files: packFiles(character({ equipment: ['base-pack:sword'] }), { requires: ['base-pack'] }) } });
    const res = await fetchPackFromGitHub({ owner: 'Someone', repo: 'ref-pack' }, undefined, {
      resolveEntity: (id) => (id === sword.id ? sword : undefined),
      installedPackIds: new Set(['base-pack']),
    });
    expect(res.characters[0]!.items.map((i) => i.id)).toEqual(['base-pack:sword']);
    expect(res.warnings.filter((w) => /base-pack/.test(w))).toEqual([]);
  });

  it('a required pack that is not installed gives one warning naming it, not one per ref', async () => {
    const files = packFiles(character({ equipment: ['base-pack:sword', 'base-pack:bow', 'custom-item-kunai'], spells: ['base-pack:bolt'] }), { requires: ['base-pack'] });
    const a = await analyzePackFiles(files, 'ref-pack');
    const named = a.warnings.filter((w) => w.includes('base-pack'));
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/not installed/);
    expect(missingWarnings(a.warnings)).toEqual([]);
  });
});
