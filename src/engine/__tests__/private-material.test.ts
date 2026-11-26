// @ts-nocheck - local-only test: uses Node fs/path and the Bun content script, which the app tsconfig has no types for
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCustomContentJson, loadCustomRepoEntities } from '../custom-content-loader';
import { getClassDefinition } from '../classes';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { BACKGROUND_PRESETS } from '../backgrounds';
import { planEntityImport } from '../import-preview';
import { extractStatblocksFromText, summarizeExtraction } from '../statblock-extractor';
import type { CompendiumEntity } from '../../types/compendium';

// LOCAL-ONLY: these read the user's own gitignored material in "DnD content/" / "local-content/".
// They are skipped when the files are missing (CI). Nothing from the books is committed or printed
// except counts; extracted output goes to local-content/ only.
const root = path.resolve(__dirname, '../../..');
// Which local files to use is configured in local-content/private-tests.json (gitignored), e.g.
// { "packDir": "local-content/my-pack", "monsterPdf": "DnD content/<book>.pdf" }, so this public
// repo never names the user's private material.
const localConfigPath = path.join(root, 'local-content', 'private-tests.json');
const localConfig: { packDir?: string; monsterPdf?: string } = fs.existsSync(localConfigPath)
  ? (JSON.parse(fs.readFileSync(localConfigPath, 'utf8')) as { packDir?: string; monsterPdf?: string })
  : {};
const packDir = localConfig.packDir ? path.join(root, localConfig.packDir) : path.join(root, 'local-content', '__none__');
const vrPdf = localConfig.monsterPdf ? path.join(root, localConfig.monsterPdf) : path.join(root, 'local-content', '__none__.pdf');

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...jsonFiles(p));
    else if (f.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const top = (m: Map<string, number>, n = 3) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k.slice(0, 50)} x${v}`).join('; ') || 'none';

describe.skipIf(!fs.existsSync(packDir))('LOCAL custom content pack import', () => {
  it('every file is accepted or rejected with a reason; backgrounds match SRD ones', async () => {
    const srd = [
      ...BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities),
      ...(await loadCustomRepoEntities()),
      ...BACKGROUND_PRESETS.map<CompendiumEntity>((b) => ({
        id: `srd-bg-${b.name}`, name: b.name, source: 'SRD 5.1', ruleset: '2014', category: 'background', activities: [], entries: [b.description],
      })),
    ];
    const files = jsonFiles(packDir);
    const all = new Map<string, CompendiumEntity>();
    let characters = 0;
    let rejected = 0;
    const reasons = new Map<string, number>();
    const warns = new Map<string, number>();
    for (const f of files) {
      const r = parseCustomContentJson(fs.readFileSync(f, 'utf8'), (id) => all.get(id), getClassDefinition);
      r.entities.forEach((e) => all.set(e.id, e));
      characters += r.characters.length;
      rejected += r.rejected.length;
      r.rejected.forEach((x) => reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1));
      r.warnings.forEach((w) => warns.set(w.replace(/^.*?: /, '').replace(/"[^"]*"/, '"?"'), (warns.get(w) ?? 0) + 1));
    }
    const entities = [...all.values()];
    const plan = planEntityImport(entities, srd);
    const bgs = entities.filter((e) => e.category === 'background');
    const bgNear = plan.near.filter((n) => n.incoming.category === 'background').length;
    const bgExact = plan.exact.filter((n) => n.incoming.category === 'background').length;
    console.log(
      `LOCAL pack: ${files.length} files, ${entities.length} unique entities accepted, ${characters} characters, ${rejected} rejected; ` +
        `plan: ${plan.summary}; backgrounds ${bgs.length}: ${bgExact} exact + ${bgNear} near SRD; ` +
        `reject kinds: ${top(reasons)}; warning kinds: ${top(warns)}`
    );
    expect(files.length).toBeGreaterThan(100);
    expect(entities.length + characters + rejected).toBeGreaterThan(150);
    expect(bgNear + bgExact).toBeGreaterThan(0); // "Noble (...)" matches the SRD "Noble"
  });
});

describe.skipIf(!fs.existsSync(vrPdf))('LOCAL monster book PDF (bulk PDF -> monsters)', () => {
  it('finds and parses the bestiary statblocks; output goes to local-content/ only', async () => {
    const toolPath = path.join(root, 'scripts', 'content-tool.ts'); // variable path: keeps scripts/ out of the app type-check
    const { extractPdfTextAndFields } = await import(/* @vite-ignore */ toolPath);
    const { pagesText } = await extractPdfTextAndFields(vrPdf);
    const pages = pagesText.split('\n---\n').filter((p) => /Armor\s*Class/i.test(p));
    const res = extractStatblocksFromText(pages.join('\n---\n'), { source: 'Local Test', ruleset: '2024' });
    const s = summarizeExtraction(res);
    fs.writeFileSync(path.join(root, 'local-content', 'vr-statblocks.json'), JSON.stringify(res.flatMap((r) => (r.entity ? [r.entity] : []))), 'utf8');
    console.log(
      `LOCAL monster pdf: ${pages.length} pages with Armor Class, ${s.found} statblocks found, ${s.clean} parsed cleanly, ` +
        `${s.withEntity} usable; top failures: ${s.failureKinds.slice(0, 3).map((k) => `${k.kind} x${k.count}`).join('; ') || 'none'}`
    );
    expect(s.found).toBeGreaterThan(20);
    expect(s.clean).toBeGreaterThan(s.found / 2);
  }, 60000);
});
