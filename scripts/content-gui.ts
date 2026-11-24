import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import { BUILTIN_CONTENT_PACKS } from '../src/engine/srd-packs';
import {
  convertCsvToSidererollList,
  convertMarkdownToSidererollList,
  convertRawEntityToSidereroll,
} from '../src/engine/content-converter';
import { buildCharacterFromDdbFields } from '../src/engine/ddb-pdf-importer';
import { extractPdfTextAndFields, validateCustomContentDir } from './content-tool';
import { CompendiumEntity, ItemCategory } from '../src/types/compendium';
import { Ruleset } from '../src/types/core';

const REPO_ROOT = process.cwd();
const PORT = 4179;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getOutputFolder(category: ItemCategory | 'character'): string {
  if (category === 'character') return 'characters';
  if (category === 'spell') return 'spells';
  if (category === 'monster') return 'monsters';
  if (category === 'feature' || category === 'feat' || category === 'infusion') return 'features';
  return 'items';
}

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sidereroll // Content Importer</title>
<style>
  :root { color-scheme: dark; --bg: #0d1117; --card: #161b22; --elev: #21262d; --border: #30363d; --text: #f0f6fc; --muted: #8b949e; --blue: #2563eb; --green: #2ea043; --amber: #d29922; --red: #f85149; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  .wrap { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  h1 { margin: 0; font-size: 20px; display: flex; align-items: center; justify-content: space-between; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
  input, select { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 10px; font-size: 13px; }
  .dropzone { border: 2px dashed var(--border); border-radius: 8px; padding: 22px; text-align: center; cursor: pointer; background: rgba(255,255,255,0.02); transition: border-color .15s; }
  .dropzone.over { border-color: #60a5fa; background: rgba(37,99,235,0.08); }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .btn { background: var(--elev); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn:hover { filter: brightness(1.12); }
  .btn-primary { background: var(--blue); border-color: #60a5fa; color: #fff; }
  .btn-green { background: #1f6feb; border-color: #58a6ff; color: #fff; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-size: 12px; max-height: 320px; overflow: auto; margin: 0; white-space: pre-wrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border); background: var(--elev); }
  .ok { color: #3fb950; border-color: rgba(63,185,80,.4); }
  .err { color: #f85149; border-color: rgba(248,81,73,.4); }
  .warn { color: #d29922; border-color: rgba(210,153,34,.4); }
</style>
</head>
<body>
  <div class="wrap">
    <div>
      <h1>
        <span>Sidereroll // Bulk Content Importer</span>
        <span class="badge">127.0.0.1:${PORT}</span>
      </h1>
      <div class="sub">Convert PDFs, Markdown (.md), TXT, CSV/TSV, or JSON into validated Sidereroll repo packs.</div>
    </div>

    <div class="card">
      <div id="dropzone" class="dropzone">
        <div style="font-weight:700; margin-bottom:4px;">Drop a file here or click to browse</div>
        <div class="sub" id="fileLabel">Supports .pdf, .md, .txt, .csv, .tsv, .json</div>
        <input id="fileInput" type="file" accept=".pdf,.md,.markdown,.txt,.csv,.tsv,.json" style="display:none" />
      </div>

      <div class="grid">
        <label>
          Category
          <select id="category">
            <option value="spell">Spell (spells/)</option>
            <option value="monster">Monster (monsters/)</option>
            <option value="weapon">Weapon (items/)</option>
            <option value="armor">Armor (items/)</option>
            <option value="gear">Gear / Magic Item (items/)</option>
            <option value="feat">Feat (features/)</option>
            <option value="feature">Class / Species Feature (features/)</option>
            <option value="character">Character Sheet PDF (characters/)</option>
          </select>
        </label>
        <label>
          Ruleset
          <select id="ruleset">
            <option value="2024">2024 (5.5e)</option>
            <option value="2014">2014 (5e)</option>
          </select>
        </label>
        <label>
          Source Book / Label
          <input id="source" type="text" value="Custom Repo" placeholder="PHB 2024, MM, Homebrew..." />
        </label>
        <label>
          Output Filename (optional)
          <input id="outName" type="text" placeholder="auto from input name" />
        </label>
      </div>

      <div class="grid">
        <label>
          Default Image URL / Path (optional)
          <input id="imageUrl" type="text" placeholder="./images/monsters/dragon.webp" />
        </label>
        <label style="justify-content:center;">
          <span style="display:flex;align-items:center;gap:8px;color:var(--text);cursor:pointer;margin-top:16px;">
            <input id="dumpText" type="checkbox" style="width:auto;" />
            Dump raw PDF text (.extracted.md)
          </span>
        </label>
      </div>

      <div class="row">
        <button id="convertBtn" class="btn btn-primary" type="button">Convert &amp; Verify into Repo</button>
        <button id="validateBtn" class="btn" type="button">Validate Repo Content</button>
        <button id="testBuildBtn" class="btn" type="button">Run Tests &amp; Build</button>
        <button id="openDirBtn" class="btn" type="button">Open custom-content/</button>
      </div>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <strong>Output &amp; Verification Log</strong>
        <span id="statusBadge" class="badge">Ready</span>
      </div>
      <pre id="output">Pick a file and click "Convert &amp; Verify into Repo", or click "Validate Repo Content".</pre>
    </div>
  </div>

<script>
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileLabel = document.getElementById('fileLabel');
  const output = document.getElementById('output');
  const statusBadge = document.getElementById('statusBadge');
  let selectedFile = null;

  function setStatus(text, cls) {
    statusBadge.textContent = text;
    statusBadge.className = 'badge ' + (cls || '');
  }

  function setFile(f) {
    selectedFile = f;
    fileLabel.textContent = f ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)' : 'Supports .pdf, .md, .txt, .csv, .tsv, .json';
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => setFile(e.target.files[0] || null));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });

  document.getElementById('convertBtn').addEventListener('click', async () => {
    if (!selectedFile) { setStatus('Pick a file first', 'warn'); return; }
    setStatus('Converting...', '');
    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('category', document.getElementById('category').value);
    fd.append('ruleset', document.getElementById('ruleset').value);
    fd.append('source', document.getElementById('source').value);
    fd.append('outName', document.getElementById('outName').value);
    fd.append('imageUrl', document.getElementById('imageUrl').value);
    fd.append('dumpText', document.getElementById('dumpText').checked ? '1' : '0');

    const res = await fetch('/api/convert', { method: 'POST', body: fd });
    const data = await res.json();
    setStatus(data.ok ? 'Converted & Verified' : 'Error', data.ok ? 'ok' : 'err');
    output.textContent = data.log + (data.preview ? '\\n\\n--- Preview ---\\n' + data.preview : '');
  });

  document.getElementById('validateBtn').addEventListener('click', async () => {
    setStatus('Validating...', '');
    const res = await fetch('/api/validate', { method: 'POST' });
    const data = await res.json();
    setStatus(data.ok ? 'Valid' : 'Errors Found', data.ok ? 'ok' : 'err');
    output.textContent = data.log;
  });

  document.getElementById('testBuildBtn').addEventListener('click', async () => {
    setStatus('Running tests & build...', '');
    output.textContent = 'Running bun run test && bun run build...';
    const res = await fetch('/api/test-build', { method: 'POST' });
    const data = await res.json();
    setStatus(data.ok ? 'Tests & Build Passed' : 'Failed', data.ok ? 'ok' : 'err');
    output.textContent = data.log;
  });

  document.getElementById('openDirBtn').addEventListener('click', async () => {
    await fetch('/api/open-dir', { method: 'POST' });
  });
</script>
</body>
</html>`;

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(HTML_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (req.method === 'POST' && url.pathname === '/api/validate') {
      const report = validateCustomContentDir(REPO_ROOT);
      const lines = [
        `Validated ${report.totalFiles} custom file(s), ${report.totalEntities} custom entities.`,
        `By category: ${JSON.stringify(report.byCategory)}`,
        ...report.warnings.map((w) => `[WARN] ${w.file}: ${w.message}`),
        ...report.errors.map((e) => `[ERR]  ${e.file}: ${e.message}`),
      ];
      return Response.json({ ok: report.errors.length === 0, log: lines.join('\n') });
    }

    if (req.method === 'POST' && url.pathname === '/api/open-dir') {
      const target = path.join(REPO_ROOT, 'src', 'custom-content');
      exec(`explorer "${target}"`);
      return Response.json({ ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/test-build') {
      const testProc = Bun.spawnSync(['bun', 'run', 'test'], { cwd: REPO_ROOT });
      const testOut = new TextDecoder().decode(testProc.stdout) + new TextDecoder().decode(testProc.stderr);
      if (testProc.exitCode !== 0) {
        return Response.json({ ok: false, log: testOut });
      }
      const buildProc = Bun.spawnSync(['bun', 'run', 'build'], { cwd: REPO_ROOT });
      const buildOut = new TextDecoder().decode(buildProc.stdout) + new TextDecoder().decode(buildProc.stderr);
      return Response.json({
        ok: buildProc.exitCode === 0,
        log: `${testOut}\n${buildOut}`,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/convert') {
      try {
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) {
          return Response.json({ ok: false, log: 'No file uploaded.' }, { status: 400 });
        }
        const category = String(form.get('category') || 'gear') as ItemCategory | 'character';
        const ruleset = (String(form.get('ruleset')) === '2024' ? '2024' : '2014') as Ruleset;
        const source = String(form.get('source') || '').trim() || undefined;
        const outNameRaw = String(form.get('outName') || '').trim();
        const imageUrl = String(form.get('imageUrl') || '').trim() || undefined;
        const dumpText = String(form.get('dumpText')) === '1';

        const ext = path.extname(file.name).toLowerCase();
        const baseNameNoExt = path.basename(file.name, ext);
        const outSlug = slugify(outNameRaw ? outNameRaw.replace(/\.json$/i, '') : baseNameNoExt) || 'imported-pack';
        const logLines: string[] = [];

        if (ext === '.pdf') {
          const tmpPdf = path.join(os.tmpdir(), `sidereroll-${Date.now()}-${slugify(baseNameNoExt)}.pdf`);
          fs.writeFileSync(tmpPdf, new Uint8Array(await file.arrayBuffer()));
          const { fields, pagesText } = await extractPdfTextAndFields(tmpPdf);
          fs.rmSync(tmpPdf, { force: true });

          const isChar = category === 'character' || Object.keys(fields).length >= 5;
          if (isChar) {
            const summary = buildCharacterFromDdbFields(fields, baseNameNoExt);
            const outPath = path.join(REPO_ROOT, 'src', 'custom-content', 'characters', `${outSlug}.json`);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, `${JSON.stringify(summary.character, null, 2)}\n`, 'utf8');
            logLines.push(`Extracted Character PDF (${summary.extractedFieldsCount} AcroForm fields) -> ${path.relative(REPO_ROOT, outPath)}`);
            for (const w of summary.warnings) logLines.push(`[WARN] ${w}`);
            return Response.json({
              ok: true,
              log: logLines.join('\n'),
              preview: JSON.stringify(summary.character, null, 2).slice(0, 3000),
            });
          }

          if (dumpText) {
            const txtOut = path.join(REPO_ROOT, 'src', 'custom-content', `${outSlug}.extracted.md`);
            fs.writeFileSync(txtOut, pagesText, 'utf8');
            logLines.push(`Dumped raw PDF text -> ${path.relative(REPO_ROOT, txtOut)}`);
          }

          const converted = convertMarkdownToSidererollList(pagesText, category as ItemCategory, ruleset, source);
          if (imageUrl) converted.forEach((e) => { if (!e.imageUrl) e.imageUrl = imageUrl; });
          const outPath = path.join(REPO_ROOT, 'src', 'custom-content', getOutputFolder(category), `${outSlug}.json`);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, `${JSON.stringify(converted, null, 2)}\n`, 'utf8');
          const report = validateCustomContentDir(REPO_ROOT);
          logLines.push(`Extracted ${converted.length} ${category} entities from PDF -> ${path.relative(REPO_ROOT, outPath)}`);
          for (const w of report.warnings) logLines.push(`[WARN] ${w.file}: ${w.message}`);
          for (const e of report.errors) logLines.push(`[ERR]  ${e.file}: ${e.message}`);
          return Response.json({
            ok: report.errors.length === 0,
            log: logLines.join('\n'),
            preview: JSON.stringify(converted.slice(0, 3), null, 2).slice(0, 3000),
          });
        }

        const rawText = await file.text();
        let converted: CompendiumEntity[] = [];
        if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
          converted = convertMarkdownToSidererollList(rawText, category as ItemCategory, ruleset, source);
        } else if (ext === '.csv' || ext === '.tsv') {
          converted = convertCsvToSidererollList(rawText, category as ItemCategory, ruleset, source, ext === '.tsv' ? '\t' : ',');
        } else {
          const rawJson = JSON.parse(rawText) as unknown;
          const rawList = Array.isArray(rawJson)
            ? rawJson
            : rawJson && typeof rawJson === 'object'
              ? ((['spell', 'monster', 'item', 'feat', 'feature', 'entries', 'items', 'results'].find((k) =>
                  Array.isArray((rawJson as Record<string, unknown>)[k])
                )
                  ? (rawJson as Record<string, unknown>)[
                      ['spell', 'monster', 'item', 'feat', 'feature', 'entries', 'items', 'results'].find((k) =>
                        Array.isArray((rawJson as Record<string, unknown>)[k])
                      )!
                    ]
                  : [rawJson]) as unknown[])
              : [];
          converted = rawList
            .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
            .map((item) => convertRawEntityToSidereroll(item, category as ItemCategory, ruleset, source))
            .filter((x): x is CompendiumEntity => x !== null);
        }

        if (imageUrl) converted.forEach((e) => { if (!e.imageUrl) e.imageUrl = imageUrl; });

        const knownIds = new Set<string>(BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities.map((e) => e.id)));
        const outPath = path.join(REPO_ROOT, 'src', 'custom-content', getOutputFolder(category), `${outSlug}.json`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(converted, null, 2)}\n`, 'utf8');

        const report = validateCustomContentDir(REPO_ROOT);
        logLines.push(`Converted ${converted.length} ${category} entities -> ${path.relative(REPO_ROOT, outPath)}`);
        for (const e of converted) {
          if (knownIds.has(e.id)) logLines.push(`[ERR]  Duplicate ID with built-in SRD: ${e.id}`);
        }
        for (const w of report.warnings) logLines.push(`[WARN] ${w.file}: ${w.message}`);
        for (const e of report.errors) logLines.push(`[ERR]  ${e.file}: ${e.message}`);

        return Response.json({
          ok: report.errors.length === 0,
          log: logLines.join('\n'),
          preview: JSON.stringify(converted.slice(0, 3), null, 2).slice(0, 3000),
        });
      } catch (err) {
        return Response.json({ ok: false, log: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  },
});

const url = `http://127.0.0.1:${server.port}`;
console.log(`Sidereroll Content Importer GUI running at ${url}`);
if (!process.argv.includes('--no-open')) {
  exec(`start "" "${url}"`);
}
