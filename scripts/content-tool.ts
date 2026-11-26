import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_CONTENT_PACKS } from '../src/engine/srd-packs';
import {
  convertCsvToSidererollList,
  convertMarkdownToSidererollList,
  convertRawEntityToSidereroll,
} from '../src/engine/content-converter';
import { extractStatblocksFromText, summarizeExtraction } from '../src/engine/statblock-extractor';
import { buildCharacterFromDdbFields } from '../src/engine/ddb-pdf-importer';
import { CompendiumEntity, ItemCategory } from '../src/types/compendium';
import { Ruleset } from '../src/types/core';

export interface ValidationIssue {
  file: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationReport {
  totalFiles: number;
  totalEntities: number;
  byCategory: Record<string, number>;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const FOLDER_CATEGORY_MAP: Record<string, ItemCategory> = {
  spells: 'spell',
  items: 'gear',
  monsters: 'monster',
  features: 'feature',
};

export function validateCustomContentDir(repoRoot: string): ValidationReport {
  const customRoot = path.join(repoRoot, 'src', 'custom-content');
  const publicDir = path.join(repoRoot, 'public');
  const knownIds = new Set<string>(
    BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities.map((e) => e.id))
  );

  const report: ValidationReport = {
    totalFiles: 0,
    totalEntities: 0,
    byCategory: {},
    errors: [],
    warnings: [],
  };

  for (const [folder, defaultCategory] of Object.entries(FOLDER_CATEGORY_MAP)) {
    const dir = path.join(customRoot, folder);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      report.totalFiles += 1;
      const relFile = path.relative(repoRoot, path.join(dir, file));
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      } catch (err) {
        report.errors.push({
          file: relFile,
          severity: 'error',
          message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const list = Array.isArray(parsed) ? parsed : [parsed];
      list.forEach((rawItem, idx) => {
        if (!rawItem || typeof rawItem !== 'object') {
          report.errors.push({ file: relFile, severity: 'error', message: `Entry #${idx} is not an object.` });
          return;
        }
        const obj = rawItem as Record<string, unknown>;
        const name = typeof obj.name === 'string' ? obj.name.trim() : '';
        if (!name) {
          report.errors.push({ file: relFile, severity: 'error', message: `Entry #${idx} is missing "name".` });
          return;
        }
        const category = (typeof obj.category === 'string' ? obj.category : defaultCategory) as string;
        const id =
          typeof obj.id === 'string' && obj.id.trim()
            ? obj.id.trim()
            : `custom-${category}-${slugify(name)}`;

        if (knownIds.has(id)) {
          report.errors.push({
            file: relFile,
            severity: 'error',
            message: `Duplicate id "${id}" (already exists in SRD or another custom file).`,
          });
        } else {
          knownIds.add(id);
        }

        if (category === 'monster' && (!obj.monsterMeta || typeof obj.monsterMeta !== 'object')) {
          report.errors.push({
            file: relFile,
            severity: 'error',
            message: `Monster "${name}" (${id}) is missing "monsterMeta" (ac, hp, dexModifier).`,
          });
        }

        const img = [obj.imageUrl, obj.image, obj.img, obj.portraitUrl, obj.tokenUrl].find(
          (v): v is string => typeof v === 'string' && v.trim().length > 0
        );
        if (img && img.startsWith('./')) {
          const assetPath = path.join(publicDir, img.slice(2));
          if (!fs.existsSync(assetPath)) {
            report.warnings.push({
              file: relFile,
              severity: 'warning',
              message: `Local image "${img}" not found at ${path.relative(repoRoot, assetPath)}.`,
            });
          }
        }

        if ((category === 'spell' || category === 'weapon') && (!Array.isArray(obj.activities) || obj.activities.length === 0)) {
          report.warnings.push({
            file: relFile,
            severity: 'warning',
            message: `${category} "${name}" has no activities[] (won't have a roll/cast button).`,
          });
        }

        report.totalEntities += 1;
        report.byCategory[category] = (report.byCategory[category] ?? 0) + 1;
      });
    }
  }

  return report;
}

export async function extractPdfTextAndFields(pdfPath: string): Promise<{
  fields: Record<string, string>;
  pagesText: string;
}> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data: bytes, verbosity: 0 });
  const pdf = await loadingTask.promise;

  const fields: Record<string, string> = {};
  const pageBlocks: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const annotations = await page.getAnnotations();
    for (const ann of annotations) {
      const fieldName = typeof ann.fieldName === 'string' ? ann.fieldName : '';
      if (!fieldName) continue;
      if (typeof ann.fieldValue === 'string' && ann.fieldValue.trim() !== '') {
        fields[fieldName] = ann.fieldValue.trim();
      } else if (typeof ann.buttonValue === 'string' && ann.checkBox && ann.fieldValue !== 'Off') {
        fields[fieldName] = 'Yes';
      }
    }

    const textContent = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const str = item.str;
      const transform = (item as { transform?: number[] }).transform;
      const y = transform ? transform[5] ?? null : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = str;
      } else {
        currentLine += (currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
      }
      if (y !== null) lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    if (lines.length > 0) {
      pageBlocks.push(lines.join('\n'));
    }
  }

  return { fields, pagesText: pageBlocks.join('\n---\n') };
}

function getOutputFolder(category: ItemCategory | 'character'): string {
  if (category === 'character') return 'characters';
  if (category === 'spell') return 'spells';
  if (category === 'monster') return 'monsters';
  if (category === 'feature' || category === 'feat' || category === 'infusion') return 'features';
  return 'items';
}

function verifyConvertedOutput(
  converted: CompendiumEntity[],
  repoRoot: string,
  outPath: string
): void {
  const relOut = path.relative(repoRoot, outPath);
  if (converted.length === 0) {
    console.warn(`[WARN] ${relOut}: 0 entities were extracted. Try --dump-text to inspect raw text.`);
    return;
  }

  const knownIds = new Set<string>(
    BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities.map((e) => e.id))
  );
  const localIds = new Set<string>();
  let errorCount = 0;

  for (const entity of converted) {
    if (knownIds.has(entity.id) || localIds.has(entity.id)) {
      console.error(`[ERR]  ${relOut}: Duplicate id "${entity.id}" (${entity.name}).`);
      errorCount += 1;
    }
    localIds.add(entity.id);

    if (entity.category === 'monster' && !entity.monsterMeta) {
      console.error(`[ERR]  ${relOut}: Monster "${entity.name}" is missing monsterMeta.`);
      errorCount += 1;
    }
    if ((entity.category === 'spell' || entity.category === 'weapon') && entity.activities.length === 0) {
      console.warn(`[WARN] ${relOut}: ${entity.category} "${entity.name}" has no rollable activities[].`);
    }
  }

  const fullReport = validateCustomContentDir(repoRoot);
  for (const e of fullReport.errors) {
    console.error(`[ERR]  ${e.file}: ${e.message}`);
    errorCount += 1;
  }

  if (errorCount > 0) {
    console.error(`Verification failed with ${errorCount} error(s).`);
    process.exit(1);
  }
  console.log(`Verified ${converted.length} converted entities in ${relOut} (0 errors).`);
}

async function runCli() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'validate';
  const repoRoot = process.cwd();

  if (cmd === 'validate') {
    const report = validateCustomContentDir(repoRoot);
    console.log(`Validated ${report.totalFiles} custom file(s), ${report.totalEntities} custom entities.`);
    if (Object.keys(report.byCategory).length > 0) {
      console.log('By category:', report.byCategory);
    }
    for (const w of report.warnings) console.warn(`[WARN] ${w.file}: ${w.message}`);
    for (const e of report.errors) console.error(`[ERR]  ${e.file}: ${e.message}`);
    if (report.errors.length > 0) process.exit(1);
    console.log('OK: All custom content passed validation.');
    return;
  }

  if (cmd === 'convert') {
    const inputPath = args[1];
    if (!inputPath) {
      console.error(
        'Usage: bun run content:convert <input.(json|md|txt|csv|tsv|pdf)> [--category spell|weapon|gear|monster|feature|feat|character] [--out <output.json>] [--ruleset 2014|2024] [--source "..."] [--dump-text]'
      );
      process.exit(1);
    }
    const getFlag = (flag: string): string | undefined => {
      const idx = args.indexOf(flag);
      return idx >= 0 ? args[idx + 1] : undefined;
    };
    const hasFlag = (flag: string): boolean => args.includes(flag);

    const resolvedInput = path.resolve(inputPath);
    const ext = path.extname(resolvedInput).toLowerCase();
    const explicitCategory = getFlag('--category');
    const category = (explicitCategory ?? 'gear') as ItemCategory | 'character';
    const ruleset = (getFlag('--ruleset') === '2024' ? '2024' : '2014') as Ruleset;
    const source = getFlag('--source');
    const idPrefix = getFlag('--id-prefix') ?? 'custom';
    const baseNameNoExt = path.basename(resolvedInput, ext);

    if (ext === '.pdf') {
      const { fields, pagesText } = await extractPdfTextAndFields(resolvedInput);
      const isCharPdf =
        category === 'character' || (!explicitCategory && Object.keys(fields).length >= 5);

      if (isCharPdf) {
        const summary = buildCharacterFromDdbFields(fields, baseNameNoExt);
        const outPath = path.resolve(
          getFlag('--out') ??
            path.join(repoRoot, 'src', 'custom-content', 'characters', `${slugify(baseNameNoExt)}.json`)
        );
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, `${JSON.stringify(summary.character, null, 2)}\n`, 'utf8');
        console.log(
          `Extracted Character PDF (${summary.extractedFieldsCount} fields) -> ${path.relative(repoRoot, outPath)}`
        );
        for (const w of summary.warnings) console.warn(`[WARN] ${w}`);
        return;
      }

      if (hasFlag('--dump-text')) {
        const txtOut = path.resolve(
          path.join(repoRoot, 'src', 'custom-content', `${slugify(baseNameNoExt)}.extracted.md`)
        );
        fs.writeFileSync(txtOut, pagesText, 'utf8');
        console.log(`Dumped extracted PDF text -> ${path.relative(repoRoot, txtOut)}`);
      }

      let converted: CompendiumEntity[];
      if (category === 'monster') {
        const found = extractStatblocksFromText(pagesText, { ruleset, source, idPrefix });
        const sum = summarizeExtraction(found);
        converted = found.flatMap((r) => (r.entity ? [r.entity] : []));
        console.log(
          `Statblocks: ${sum.found} found, ${sum.clean} parsed cleanly, ${sum.withEntity} usable; problems: ${sum.failureKinds.map((k) => `${k.kind} x${k.count}`).join('; ') || 'none'}`
        );
      } else {
        converted = convertMarkdownToSidererollList(pagesText, category as ItemCategory, ruleset, source);
      }
      const outPath = path.resolve(
        getFlag('--out') ??
          path.join(
            repoRoot,
            'src',
            'custom-content',
            getOutputFolder(category),
            `${slugify(baseNameNoExt)}.json`
          )
      );
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(converted, null, 2)}\n`, 'utf8');
      console.log(
        `Extracted ${converted.length} ${category} entities from PDF -> ${path.relative(repoRoot, outPath)}`
      );
      verifyConvertedOutput(converted, repoRoot, outPath);
      return;
    }

    const rawText = fs.readFileSync(resolvedInput, 'utf8');
    let converted: CompendiumEntity[] = [];

    if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
      converted = convertMarkdownToSidererollList(
        rawText,
        category as ItemCategory,
        ruleset,
        source
      );
    } else if (ext === '.csv' || ext === '.tsv') {
      converted = convertCsvToSidererollList(
        rawText,
        category as ItemCategory,
        ruleset,
        source,
        ext === '.tsv' ? '\t' : ','
      );
    } else {
      const rawJson = JSON.parse(rawText) as unknown;
      let rawList: unknown[] = [];
      if (Array.isArray(rawJson)) {
        rawList = rawJson;
      } else if (rawJson && typeof rawJson === 'object') {
        const obj = rawJson as Record<string, unknown>;
        const arrayProp = ['spell', 'monster', 'item', 'feat', 'feature', 'entries', 'items', 'results'].find((k) =>
          Array.isArray(obj[k])
        );
        rawList = arrayProp ? (obj[arrayProp] as unknown[]) : [obj];
      }
      const rawConverted = rawList
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
        .map((item) => convertRawEntityToSidereroll(item, category as ItemCategory, ruleset, source, idPrefix))
        .filter((x): x is CompendiumEntity => x !== null);
      const seenIds = new Set<string>();
      converted = rawConverted.map((entity) => {
        let finalId = entity.id;
        let suffix = 2;
        while (seenIds.has(finalId)) {
          finalId = `${entity.id}-${suffix++}`;
        }
        seenIds.add(finalId);
        return finalId === entity.id ? entity : { ...entity, id: finalId };
      });
    }

    const outPath = path.resolve(
      getFlag('--out') ??
        path.join(
          repoRoot,
          'src',
          'custom-content',
          getOutputFolder(category),
          `${slugify(baseNameNoExt)}.json`
        )
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(converted, null, 2)}\n`, 'utf8');
    console.log(`Converted ${converted.length} ${category} entities -> ${path.relative(repoRoot, outPath)}`);
    verifyConvertedOutput(converted, repoRoot, outPath);
    return;
  }

  console.error(`Unknown command "${cmd}". Use "validate" or "convert".`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
