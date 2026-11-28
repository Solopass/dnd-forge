// @ts-nocheck - uses Node fs/os/path and the Bun content script, which the app tsconfig has no types for
// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectIds, fixPackJson } from '../pack-autofix';

const manifest = { format: 'dnd-forge-pack@1', id: 'synth', name: 'Synth Pack', version: '1.0.0', content: ['monsters/*', 'spells/*'] };
const spells = [
  {
    name: 'Spark',
    category: 'spell',
    spellLevel: 1,
    entries: ['A {@b bright} spark deals {@damage 1D6 + 2} fire. {@atk ms}'],
    activities: [{ id: 'a1', name: 'Cast', type: 'attack', actionEconomy: 'action', damageFormula: '1d6 + 2', description: '{@i bold}' }],
  },
  { id: 'keep-me', name: 'Kept Id', category: 'spell', spellLevel: 0, entries: ['Plain.'] },
];
const monsters = [{ name: 'Mouse', category: 'monster', monsterMeta: { ac: 11, hp: 3, dexModifier: 2, cr: 0.125 }, entries: ['Squeak.'], activities: [] }];
const mdMonster = '## Moss Wraith\n\n*Medium undead*\n\n**Armor Class** 12\n**Hit Points** 20\n';

interface Tool {
  runPackFix(dir: string): Promise<{ changed: string[]; lines: string[] }>;
  runPackReport(dir: string): Promise<{ markdown: string; summary: string; againstCount: number }>;
}
// variable path: keeps scripts/ out of the app type-check (same trick as private-material.test.ts)
const toolPath = path.join(process.cwd(), 'scripts', 'content-tool.ts');
const loadTool = async (): Promise<Tool> => (await import(/* @vite-ignore */ toolPath)) as Tool;

const dirs: string[] = [];
function makePack(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-fix-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'spells'));
  fs.mkdirSync(path.join(dir, 'monsters'));
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'spells', 's.json'), `﻿${JSON.stringify(spells, null, 4).replace(/\n/g, '\r\n')}`);
  fs.writeFileSync(path.join(dir, 'monsters', 'm.json'), JSON.stringify(monsters));
  fs.writeFileSync(path.join(dir, 'monsters', 'wraith.md'), mdMonster);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const snapshot = (dir: string) =>
  Object.fromEntries(['pack.json', 'spells/s.json', 'monsters/m.json', 'monsters/wraith.md'].map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

describe('fixPackJson', () => {
  it('applies only the safe repairs, keeps key order, and returns null when nothing is wrong', () => {
    const ok = JSON.stringify([{ id: 'x:y', name: 'Y', category: 'gear', entries: ['fine'] }], null, 2);
    expect(fixPackJson(ok, { packId: 'x', usedIds: new Set() }).text).toBeNull();
    const res = fixPackJson(JSON.stringify(monsters), { packId: 'synth', usedIds: new Set() });
    expect(res.counts).toEqual({ 'cr-fraction': 1, 'id-slug': 1 });
    const out = JSON.parse(res.text ?? '[]') as Array<Record<string, unknown>>;
    expect(Object.keys(out[0] ?? {})).toEqual(['id', 'name', 'category', 'monsterMeta', 'entries', 'activities']);
    expect(out[0]?.id).toBe('synth:mouse');
    expect(res.text?.endsWith(']\n')).toBe(true);
  });

  it('does not add an id on a name clash and reports invalid JSON', () => {
    const used = new Set(collectIds(JSON.stringify([{ id: 'synth:mouse', name: 'Mouse', category: 'monster' }])));
    expect(used.has('synth:mouse')).toBe(true);
    const res = fixPackJson(JSON.stringify(monsters), { packId: 'synth', usedIds: used });
    expect(res.skippedIds).toEqual(['Mouse']);
    expect(res.text).not.toContain('"id"');
    expect(fixPackJson('[{"name"', { usedIds: new Set() }).invalid).toBeDefined();
  });
});

describe('content:validate --fix on a temp pack', () => {
  it('fixes JSON, leaves Markdown and the manifest alone, and is idempotent', async () => {
    const dir = makePack();
    const before = snapshot(dir);
    const first = await (await loadTool()).runPackFix(dir);
    expect(first.changed.sort()).toEqual(['monsters/m.json', 'spells/s.json']);
    const after = snapshot(dir);
    expect(after['monsters/wraith.md']).toBe(before['monsters/wraith.md']);
    expect(after['pack.json']).toBe(before['pack.json']);
    const fixedSpells = JSON.parse(after['spells/s.json'] ?? '[]') as Array<{ id: string; activities: Array<{ damageFormula: string }> }>;
    expect(after['spells/s.json']).not.toContain('\r');
    expect(after['spells/s.json']?.startsWith('[\n  {')).toBe(true);
    expect(fixedSpells[0]?.id).toBe('synth:spark');
    expect(fixedSpells[1]?.id).toBe('keep-me');
    const first0 = JSON.stringify(fixedSpells[0]);
    expect(first0).not.toContain('{@b');
    expect(first0).not.toContain('{@atk');
    expect(first0).toContain('{@damage 1d6+2}');
    expect(fixedSpells[0]?.activities[0]?.damageFormula).toBe('1d6+2');
    const mouse = JSON.parse(after['monsters/m.json'] ?? '[]') as Array<{ monsterMeta: { cr: string } }>;
    expect(mouse[0]?.monsterMeta.cr).toBe('1/8');
    expect(first.lines.join('\n')).toContain('Fixable by hand (not a JSON file)');

    const second = await (await loadTool()).runPackFix(dir);
    expect(second.changed).toEqual([]);
    expect(snapshot(dir)).toEqual(after);
  });

  it('reports a pack entry named like a bundled SRD JSON monster as a clash', async () => {
    const srd = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'custom-content', 'monsters', 'srd-2014-monsters.json'), 'utf8')) as Array<{ name: string }>;
    const name = srd[0]?.name ?? '';
    expect(name).not.toBe('');
    const dir = makePack();
    fs.writeFileSync(path.join(dir, 'monsters', 'm.json'), JSON.stringify([{ id: 'synth:clash', name, category: 'monster', monsterMeta: { ac: 11, hp: 3, dexModifier: 0 }, entries: ['x'], activities: [] }]));
    const res = await (await loadTool()).runPackReport(dir);
    expect(res.againstCount).toBeGreaterThan(1000);
    expect(res.markdown).toContain(`| exact | monster | ${name} |`);
  });

  it('builds a deterministic report for the pack against the SRD built-ins', async () => {
    const dir = makePack();
    const res = await (await loadTool()).runPackReport(dir);
    expect(res.markdown).toContain('# Content quality report: Synth Pack');
    expect(res.againstCount).toBeGreaterThan(100);
    expect(res.summary).toMatch(/^\d+ entries, average score/);
    expect(res.markdown).toBe((await (await loadTool()).runPackReport(dir)).markdown);
  });
});
