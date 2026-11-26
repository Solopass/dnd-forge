// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPackFromGitHub, resolveCommitSha } from '../campaign-repo-sync';
import { SEED_CHARACTER } from '../../state/seed';
import { stubGitHub } from './fakeGithub';

const SHA_A = 'a'.repeat(40);
const manifestJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: 'dnd-forge-pack@1',
    id: 'synthetic-pack',
    name: 'Synthetic Pack',
    version: '1.0.0',
    license: 'CC-BY-4.0',
    content: ['monsters/*.json', 'spells/**/*.md'],
    characters: ['characters/*.json'],
    ...over,
  });

const SPELL_MD = [
  '[_metadata_:spell_name]:- "Test Spark"',
  '[_metadata_:level]:- "1"',
  '[_metadata_:school]:- "Evocation"',
  '',
  '#### Test Spark',
  '',
  '*1st-level evocation*',
  '',
  '**Casting Time:** 1 action',
  '',
  '**Range:** 30 feet',
  '',
  'A harmless synthetic spark.',
].join('\n');

describe('fetchPackFromGitHub (mocked GitHub)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('installs a v1 pack: globs expanded, files read at the pinned sha, provenance + namespaced ids', async () => {
    const urls = stubGitHub({
      'Someone/synthetic-pack': {
        sha: SHA_A,
        files: {
          'pack.json': manifestJson(),
          'monsters/ghoul.json': JSON.stringify([
            { name: 'Synthetic Ghoul', category: 'monster', imageUrl: './img/ghoul.png', monsterMeta: { ac: 12, hp: 20, dexModifier: 1 } },
            { id: 'keep-this-id', name: 'Keeper Beast', category: 'monster', monsterMeta: { ac: 10, hp: 5, dexModifier: 0 } },
          ]),
          'monsters/readme.txt': 'ignored (not matched by *.json)',
          'spells/evocation/spark.md': SPELL_MD,
          'characters/hero.json': JSON.stringify({ ...SEED_CHARACTER, id: 'hero-1', name: 'Synthetic Hero' }),
        },
      },
    });
    const res = await fetchPackFromGitHub({ owner: 'Someone', repo: 'synthetic-pack' });
    expect(res.format).toBe('v1');
    expect(res.sha).toBe(SHA_A);
    expect(res.manifest.id).toBe('synthetic-pack');
    const byName = new Map(res.entities.map((e) => [e.name, e]));
    expect([...byName.keys()].sort()).toEqual(['Keeper Beast', 'Synthetic Ghoul', 'Test Spark']);
    expect(byName.get('Synthetic Ghoul')!.id).toBe('synthetic-pack:synthetic-ghoul');
    expect(byName.get('Keeper Beast')!.id).toBe('keep-this-id');
    expect(byName.get('Test Spark')!.id).toBe('synthetic-pack:test-spark');
    for (const e of res.entities) {
      expect(e.packId).toBe('synthetic-pack');
      expect(e.packVersion).toBe('1.0.0');
      expect(e.packRef).toBe(SHA_A);
    }
    expect(byName.get('Synthetic Ghoul')!.imageUrl).toBe(`https://raw.githubusercontent.com/Someone/synthetic-pack/${SHA_A}/img/ghoul.png`);
    expect(byName.get('Synthetic Ghoul')!.source).toBe('Synthetic Pack');
    expect(res.characters.map((c) => c.name)).toEqual(['Synthetic Hero']);
    // file reads use the sha, not the branch
    expect(urls.filter((u) => u.startsWith('https://raw.githubusercontent.com/')).every((u) => u.includes(`/${SHA_A}/`))).toBe(true);
  });

  it('a bad pack.json fails with a readable list of problems', async () => {
    stubGitHub({ 'Someone/bad': { sha: SHA_A, files: { 'pack.json': JSON.stringify({ format: 'dnd-forge-pack@1', id: 'Bad Id', content: [] }) } } });
    await expect(fetchPackFromGitHub({ owner: 'Someone', repo: 'bad' })).rejects.toThrow(/not a valid pack[\s\S]*"id" \("Bad Id"\)[\s\S]*"name" is required/);
  });

  it('pack.json that is not JSON fails clearly', async () => {
    stubGitHub({ 'Someone/broken': { sha: SHA_A, files: { 'pack.json': '{ nope' } } });
    await expect(fetchPackFromGitHub({ owner: 'Someone', repo: 'broken' })).rejects.toThrow(/pack\.json in Someone\/broken is not valid JSON/);
  });

  it('warns when a pattern matches nothing and when a file is not valid JSON', async () => {
    stubGitHub({
      'Someone/warny': {
        sha: SHA_A,
        files: {
          'pack.json': manifestJson({ content: ['nothing/*.json', 'items/*.json'], characters: [] }),
          'items/broken.json': '{ not json',
          'items/ok.json': JSON.stringify({ name: 'Plain Rope', category: 'gear' }),
        },
      },
    });
    const res = await fetchPackFromGitHub({ owner: 'Someone', repo: 'warny' });
    expect(res.entities.map((e) => e.name)).toEqual(['Plain Rope']);
    expect(res.warnings.join('\n')).toContain('"content" pattern "nothing/*.json" matched no files.');
    expect(res.warnings.join('\n')).toContain('items/broken.json: not valid JSON, skipped.');
  });

  it('works without a commit sha (offline API): falls back to the branch name', async () => {
    stubGitHub({ 'Someone/nosha': { files: { 'pack.json': manifestJson({ content: ['a.json'], characters: [] }), 'a.json': JSON.stringify({ name: 'Thing', category: 'gear' }) } } });
    const res = await fetchPackFromGitHub({ owner: 'Someone', repo: 'nosha', branch: 'dev' });
    expect(res.sha).toBeUndefined();
    expect(res.entities[0]!.packRef).toBe('dev');
  });

  it('reads a v0 campaign-pack.json as a converted manifest', async () => {
    stubGitHub({
      'Someone/old-campaign': {
        sha: SHA_A,
        files: {
          'campaign-pack.json': JSON.stringify({
            name: 'Old Campaign',
            source: 'Old Book',
            entities: [{ path: 'items/rope.json', category: 'gear' }, { name: 'Inline Trinket', category: 'gear' }],
            entries: [{ id: 'entry-1', title: 'Hook', kind: 'note', body: 'x', tags: [], createdAt: 'then' }],
          }),
          'items/rope.json': JSON.stringify([{ name: 'Old Rope' }]),
        },
      },
    });
    const res = await fetchPackFromGitHub({ owner: 'Someone', repo: 'old-campaign' });
    expect(res.format).toBe('v0');
    expect(res.manifest.id).toBe('old-campaign');
    expect(res.entities.map((e) => e.name).sort()).toEqual(['Inline Trinket', 'Old Rope']);
    expect(res.entities.every((e) => e.packId === 'old-campaign' && e.source === 'Old Book')).toBe(true);
    expect(res.entities.find((e) => e.name === 'Old Rope')!.category).toBe('gear');
    expect(res.entries).toHaveLength(1);
  });

  it('built-in Free5e adapter: installs Solopass/free5e as pack "free5e" without a pack.json, keeping parser ids', async () => {
    stubGitHub({
      'Solopass/free5e': {
        sha: SHA_A,
        files: {
          'README.md': '# Free5e',
          'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/_T.md': 'index page',
          'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/T/Test_Spark.md': SPELL_MD,
          'en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/Alert.md': '#### Alert\n\nYou are always on the lookout for danger.',
        },
      },
    });
    const res = await fetchPackFromGitHub({ owner: 'Solopass', repo: 'free5e', branch: 'main' });
    expect(res.format).toBe('tree-adapter');
    expect(res.manifest.id).toBe('free5e');
    expect(res.manifest.license).toBe('CC-BY-4.0');
    expect(res.entities.length).toBe(2);
    expect(res.entities.every((e) => e.packId === 'free5e' && e.id.startsWith('free5e-') && e.packRef === SHA_A)).toBe(true);
  });

  it('Free5e with a pack.json uses the v1 path (the adapter is only the fallback)', async () => {
    stubGitHub({
      'Solopass/free5e': {
        sha: SHA_A,
        files: {
          'pack.json': manifestJson({ id: 'free5e', name: 'Free5e', content: ['en-US/**/Feats/**/*.md'], characters: [] }),
          'en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/Alert.md': '#### Alert\n\nYou are always on the lookout for danger.',
        },
      },
    });
    const res = await fetchPackFromGitHub({ owner: 'Solopass', repo: 'free5e' });
    expect(res.format).toBe('v1');
    expect(res.entities).toHaveLength(1);
    expect(res.entities[0]).toMatchObject({ packId: 'free5e', category: 'feat' });
    expect(res.entities[0]!.id.startsWith('free5e-')).toBe(true);
  });

  it('two packs that both carry "Test Spark" get different ids', async () => {
    stubGitHub({
      'Someone/pack-one': { sha: SHA_A, files: { 'pack.json': manifestJson({ id: 'pack-one', content: ['s.md'], characters: [] }), 's.md': SPELL_MD } },
      'Someone/pack-two': { sha: SHA_A, files: { 'pack.json': manifestJson({ id: 'pack-two', content: ['s.md'], characters: [] }), 's.md': SPELL_MD } },
    });
    const one = await fetchPackFromGitHub({ owner: 'Someone', repo: 'pack-one' });
    const two = await fetchPackFromGitHub({ owner: 'Someone', repo: 'pack-two' });
    expect(one.entities[0]!.id).toBe('pack-one:test-spark');
    expect(two.entities[0]!.id).toBe('pack-two:test-spark');
  });

  it('resolveCommitSha returns a full sha, or undefined when GitHub does not answer with one', async () => {
    stubGitHub({ 'Someone/a': { sha: SHA_A, files: {} }, 'Someone/b': { files: {} } });
    expect(await resolveCommitSha({ owner: 'Someone', repo: 'a' })).toBe(SHA_A);
    expect(await resolveCommitSha({ owner: 'Someone', repo: 'b' })).toBeUndefined();
    expect(await resolveCommitSha({ owner: 'Someone', repo: 'missing' })).toBeUndefined();
  });
});
