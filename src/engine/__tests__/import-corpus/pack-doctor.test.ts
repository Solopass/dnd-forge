// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompendiumEntity } from '../../../types/compendium';
import { buildCampaignPackExport, fetchPackFromGitHub } from '../../campaign-repo-sync';
import { analyzePackFiles, formatPackDoctor } from '../../import-pipeline';
import { createDefaultCampaign } from '../../dm-tools';
import { stubGitHub } from '../fakeGithub';

const manifest = JSON.stringify({ format: 'dnd-forge-pack@1', id: 'doc', name: 'Doc Pack', version: '1.0.0', content: ['items/*.json', 'monsters/*.csv'] });
const files = {
  'pack.json': manifest,
  'README.md': '# Doc Pack\n\nNot content.',
  'items/a.json': JSON.stringify([
    { name: 'Doc Lamp', category: 'gear' },
    { name: 'Doc Bolt', category: 'spell', spellLevel: '2nd', entries: ['{@damage 2d6 + STR} fire'] },
    { name: 'Bad Spell', category: 'spell', spellLevel: 14 },
  ]),
  'items/broken.json': '[{"name": "cut',
  'monsters/rats.csv': 'Name,AC,HP,CR,Dex\nDoc Rat,12,5,0.125,14\n',
};

describe('pack doctor (analyzePackFiles)', () => {
  it('reads a v1 pack like an install: counts, repairs, rejections and unreadable files', async () => {
    const a = await analyzePackFiles(files, 'folder');
    expect(a.kind).toBe('v1');
    expect(a.manifestProblems).toEqual([]);
    expect(a.packId).toBe('doc');
    expect(a.report.accepted).toBe(3); // lamp, bolt, rat
    expect(a.report.repaired.map((r) => r.name).sort()).toEqual(['Doc Bolt', 'Doc Rat']);
    expect(a.report.rejected.map((r) => r.reason)).toEqual([expect.stringContaining('spell level "14"')]);
    expect(a.report.unreadable).toEqual(['items/broken.json']);
    expect(a.warnings.join(' ')).toContain('items/broken.json: not valid JSON, skipped.');
    const text = formatPackDoctor(a.report).join('\n');
    expect(text).toContain('3 accepted (2 repaired), 1 rejected, 1 file unreadable');
    expect(text).toContain('Top problems');
  });

  it('reports a bad manifest and a pattern that matches nothing', async () => {
    const bad = await analyzePackFiles({ 'pack.json': JSON.stringify({ format: 'dnd-forge-pack@1', id: 'x' }) }, 'folder');
    expect(bad.manifestProblems.join(' ')).toContain('"name" is required');
    const empty = await analyzePackFiles({ 'pack.json': manifest }, 'folder');
    expect(empty.warnings.join(' ')).toContain('matched no files');
    expect(empty.report.accepted).toBe(0);
  });

  it('counts characters found in content files and identical copies in two files without failing the pack', async () => {
    const hero = { name: 'Doc Hero', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, classes: [{ name: 'Fighter', level: 1, hitDie: 'd10' }], hp: { current: 10, max: 10, temp: 0 }, ac: 10, speed: 30, proficiencyBonus: 2 };
    const lamp = { id: 'doc-lamp', name: 'Doc Lamp', category: 'gear', entries: ['x'] };
    const a = await analyzePackFiles({ 'one.json': JSON.stringify([lamp, hero]), 'two.json': JSON.stringify([lamp]) }, 'folder');
    expect(a.report.characters).toBe(1);
    expect(a.report.accepted).toBe(1);
    // an identical copy is merged silently and counted, not listed as rejected
    expect(a.report.rejected).toEqual([]);
    expect(a.report.identicalMerged).toBe(1);
    expect(formatPackDoctor(a.report).join(String.fromCharCode(10))).toContain('1 identical copy merged');
    expect(formatPackDoctor(a.report).join(String.fromCharCode(10))).not.toContain('Rejected:');
  });

  it('merges identical entries without ids (a batch file plus individual files) and keeps different ones with the same name', async () => {
    const rope = { name: 'Twin Rope', category: 'gear', entries: ['Fifty feet.'] };
    const a = await analyzePackFiles(
      { 'all.json': JSON.stringify([rope, { name: 'Twin Lamp', category: 'gear', entries: ['Bright.'] }]), 'items/rope.json': JSON.stringify([rope]), 'items/rope-b.json': JSON.stringify([{ ...rope, entries: ['Sixty feet.'] }]) },
      'folder'
    );
    expect(a.report.rejected).toEqual([]);
    expect(a.report.identicalMerged).toBe(1);
    expect(a.report.accepted).toBe(3);
    expect(formatPackDoctor(a.report).join(String.fromCharCode(10))).toContain('1 identical copy merged');
  });

  it('reads an old campaign-pack.json and a folder with no manifest at all', async () => {
    const v0 = await analyzePackFiles(
      { 'campaign-pack.json': JSON.stringify({ name: 'Old', entities: [{ path: 'x/rope.json', category: 'gear' }, { id: 'inline-1', name: 'Inline Orb', category: 'gear' }] }), 'x/rope.json': JSON.stringify([{ name: 'Old Rope' }]) },
      'folder'
    );
    expect(v0.kind).toBe('v0');
    expect(v0.report.accepted).toBe(2);
    const loose = await analyzePackFiles({ 'spells.csv': 'Name,Level\nLoose Spark,1\n', 'notes.md': 'just some words, no structure' }, 'folder');
    expect(loose.kind).toBe('loose');
    expect(loose.report.accepted).toBe(1);
    expect(loose.report.rejected.map((r) => r.source + ': ' + r.reason)).toEqual(['notes.md: notes.md block 1: no name found']);
  });
});

describe('round trip through a repo: export a pack, install it, get identical entities', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  const ORIGINAL: CompendiumEntity[] = [
    { id: 'rt-rope', name: 'Trip Rope', source: 'Round Trip', ruleset: '2014', category: 'gear', weight: 10, activities: [], entries: ['Fifty feet.'] },
    { id: 'rt-bolt', name: 'Trip Bolt', source: 'Round Trip', ruleset: '2014', category: 'spell', spellLevel: 3, classes: ['Wizard'], concentration: false, ritual: false, activities: [{ id: 'act-rt-bolt', name: 'Bolt', type: 'save', actionEconomy: 'action', saveAbility: 'dex', saveDcFormula: '8+@prof+@spell', damageFormula: '8d6', damageType: 'fire' }], entries: ['A {@damage 8d6} bolt.'] },
    { id: 'rt-ogre', name: 'Trip Ogre', source: 'Round Trip', ruleset: '2014', category: 'monster', monsterMeta: { ac: 11, hp: 59, dexModifier: -1, cr: '1/4', size: 'large' }, activities: [], entries: ['A brute.'] },
  ];

  it('campaign-pack.json export -> fetchPackFromGitHub: same entities (plus provenance)', async () => {
    const exported = buildCampaignPackExport(createDefaultCampaign(), ORIGINAL);
    stubGitHub({ 'Someone/trip': { sha: 'a'.repeat(40), files: { 'campaign-pack.json': exported } } });
    const fetched = await fetchPackFromGitHub({ owner: 'Someone', repo: 'trip' });
    expect(fetched.report.rejected).toEqual([]);
    expect(fetched.report.repaired).toEqual([]);
    const stripped = fetched.entities.map(({ packId, packVersion, packRef, packFile, ...rest }) => {
      void packId;
      void packVersion;
      void packRef;
      void packFile;
      return rest;
    });
    expect(stripped).toEqual(ORIGINAL);
    expect(fetched.entities.every((e) => e.packId === 'trip')).toBe(true);
  });
});
