import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILTIN_CONTENT_PACKS } from '../src/engine/srd-packs';
import { convertRawEntityToSidereroll } from '../src/engine/content-converter';
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

function asStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((v) => String(v)).filter(Boolean);
  if (typeof val === 'string' && val.trim()) return [val.trim()];
  return [];
}

function extractTimeString(rawTime: unknown): string | undefined {
  if (typeof rawTime === 'string') return rawTime;
  if (Array.isArray(rawTime) && rawTime[0] && typeof rawTime[0] === 'object') {
    const t = rawTime[0] as Record<string, unknown>;
    return `${t.number ?? 1} ${t.unit ?? 'action'}`;
  }
  return undefined;
}

function extractRangeString(rawRange: unknown): string | undefined {
  if (typeof rawRange === 'string') return rawRange;
  if (rawRange && typeof rawRange === 'object') {
    const r = rawRange as Record<string, unknown>;
    const dist = r.distance as Record<string, unknown> | undefined;
    if (dist?.amount && dist?.type) return `${dist.amount} ${dist.type}`;
    if (dist?.type) return String(dist.type);
    if (r.type) return String(r.type);
  }
  return undefined;
}

function extractDurationString(rawDuration: unknown): { duration?: string; concentration: boolean } {
  if (typeof rawDuration === 'string') {
    return { duration: rawDuration, concentration: /concentration/i.test(rawDuration) };
  }
  if (Array.isArray(rawDuration) && rawDuration[0] && typeof rawDuration[0] === 'object') {
    const d = rawDuration[0] as Record<string, unknown>;
    const conc = Boolean(d.concentration);
    const durObj = d.duration as Record<string, unknown> | undefined;
    if (durObj?.amount && durObj?.type) {
      return {
        duration: `${conc ? 'Concentration, up to ' : ''}${durObj.amount} ${durObj.type}`,
        concentration: conc,
      };
    }
    if (d.type) return { duration: String(d.type), concentration: conc };
  }
  return { concentration: false };
}

function extractComponentsString(rawComp: unknown): string | undefined {
  if (typeof rawComp === 'string') return rawComp;
  if (rawComp && typeof rawComp === 'object') {
    const c = rawComp as Record<string, unknown>;
    const parts: string[] = [];
    if (c.v) parts.push('V');
    if (c.s) parts.push('S');
    if (c.m) {
      const mText = typeof c.m === 'string' ? c.m : (c.m as Record<string, unknown>).text;
      parts.push(mText ? `M (${mText})` : 'M');
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
  return undefined;
}

function inferActivitiesFromRaw(
  raw: Record<string, unknown>,
  id: string,
  name: string,
  category: ItemCategory,
  entries: string[]
): Activity[] {
  if (Array.isArray(raw.activities) && raw.activities.length > 0) {
    return raw.activities as Activity[];
  }

  const joined = entries.join(' ');
  if (category === 'spell') {
    const level =
      typeof raw.spellLevel === 'number'
        ? raw.spellLevel
        : typeof raw.level === 'number'
          ? raw.level
          : 0;
    const saves = asStringArray(raw.savingThrow);
    const dmgMatch = joined.match(/\{@damage\s+([^}|]+)/i) ?? joined.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/);
    const dmgTypes = asStringArray(raw.damageInflict);
    const saveAb = (saves[0]?.slice(0, 3).toLowerCase() ?? '') as AbilityKey;
    const isAttack = Array.isArray(raw.spellAttack) && raw.spellAttack.length > 0;
    const isHeal = dmgTypes.length === 0 && /regain|heal|hit points/i.test(joined) && Boolean(dmgMatch);

    return [
      {
        id: `act-${id}`,
        name,
        type: isHeal ? 'heal' : saveAb ? 'save' : isAttack ? 'attack' : 'utility',
        actionEconomy: 'action',
        attackBonusFormula: isAttack ? '@prof+@spell' : undefined,
        saveAbility: saveAb || undefined,
        saveDcFormula: saveAb ? '8+@prof+@spell' : undefined,
        damageFormula: dmgMatch?.[1]?.replace(/\s+/g, '') ?? undefined,
        damageType: dmgTypes[0],
        resourceCost: level > 0 ? { poolId: `spell_slot_${level}`, amount: 1 } : undefined,
        description: entries[0],
      },
    ];
  }

  if (category === 'weapon') {
    const dmg = typeof raw.dmg1 === 'string' ? raw.dmg1 : '1d8';
    const isFinesse = Array.isArray(raw.property) && raw.property.includes('F');
    const isRanged = raw.type === 'R';
    const ab: AbilityKey = isRanged ? 'dex' : isFinesse ? 'dex' : 'str';
    return [
      {
        id: `act-${id}`,
        name,
        type: 'attack',
        actionEconomy: 'action',
        attackAbility: ab,
        attackBonusFormula: '@mod+@prof',
        damageFormula: `${dmg}+@mod`,
        damageType: typeof raw.dmgType === 'string' ? raw.dmgType : 'slashing',
        description: entries[0],
      },
    ];
  }

  return [];
}

export function convertRawEntityToSidereroll(
  raw: Record<string, unknown>,
  defaultCategory: ItemCategory,
  ruleset: Ruleset = '2014',
  sourceOverride?: string
): CompendiumEntity | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const category = (typeof raw.category === 'string' ? raw.category : defaultCategory) as ItemCategory;
  const prefix =
    category === 'spell'
      ? 'spl'
      : category === 'monster'
        ? 'mob'
        : category === 'weapon'
          ? 'wpn'
          : category === 'armor'
            ? 'arm'
            : category === 'feat'
              ? 'feat'
              : category === 'feature'
                ? 'ftr'
                : 'gear';
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `custom-${prefix}-${slugify(name)}`;

  const entries = normalizeEntries(raw.entries, raw.description);
  const { duration, concentration } = extractDurationString(raw.duration);
  const rawImg = [raw.imageUrl, raw.image, raw.img, raw.portraitUrl, raw.tokenUrl].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );

  const entity: CompendiumEntity = {
    id,
    name,
    source: sourceOverride ?? (typeof raw.source === 'string' && raw.source.trim() ? raw.source : 'Custom Repo'),
    ruleset: raw.ruleset === '2024' ? '2024' : ruleset,
    category,
    imageUrl: rawImg?.trim(),
    entries: entries.length > 0 ? entries : [name],
    activities: inferActivitiesFromRaw(raw, id, name, category, entries),
  };

  if (category === 'spell') {
    const lvl = typeof raw.spellLevel === 'number' ? raw.spellLevel : typeof raw.level === 'number' ? raw.level : 0;
    entity.spellLevel = lvl;
    entity.castingTime = extractTimeString(raw.castingTime ?? raw.time);
    entity.range = extractRangeString(raw.range);
    entity.components = extractComponentsString(raw.components);
    entity.duration = duration;
    entity.concentration = Boolean(raw.concentration ?? concentration);
    entity.ritual = Boolean(raw.ritual ?? (raw.meta as Record<string, unknown> | undefined)?.ritual);
  }

  if (category === 'monster') {
    const existingMeta = raw.monsterMeta as Record<string, unknown> | undefined;
    if (existingMeta) {
      entity.monsterMeta = raw.monsterMeta as CompendiumEntity['monsterMeta'];
    } else {
      const acRaw = Array.isArray(raw.ac) ? (raw.ac[0] as Record<string, unknown>)?.ac ?? raw.ac[0] : raw.ac;
      const hpRaw = (raw.hp as Record<string, unknown> | undefined)?.average ?? raw.hp;
      const dexScore = typeof raw.dex === 'number' ? raw.dex : 10;
      const sizeRaw = Array.isArray(raw.size) ? String(raw.size[0]).toLowerCase() : String(raw.size ?? 'medium').toLowerCase();
      const sizeMap: Record<string, CreatureSize> = {
        t: 'tiny',
        s: 'small',
        m: 'medium',
        l: 'large',
        h: 'huge',
        g: 'gargantuan',
      };
      entity.monsterMeta = {
        ac: typeof acRaw === 'number' ? acRaw : 12,
        hp: typeof hpRaw === 'number' ? hpRaw : 22,
        dexModifier: Math.floor((dexScore - 10) / 2),
        cr: typeof raw.cr === 'string' ? raw.cr : typeof (raw.cr as Record<string, unknown>)?.cr === 'string' ? String((raw.cr as Record<string, unknown>).cr) : '1',
        size: (sizeMap[sizeRaw] ?? (['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].includes(sizeRaw) ? sizeRaw : 'medium')) as CreatureSize,
        resistances: asStringArray(raw.resist),
        immunities: asStringArray(raw.immune),
        vulnerabilities: asStringArray(raw.vulnerable),
        senses: asStringArray(raw.senses).join(', ') || undefined,
      };
    }
  }

  return entity;
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

function runCli() {
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
      console.error('Usage: bun run content:convert <input.json> --category <spell|weapon|gear|monster|feature|feat> [--out <output.json>] [--ruleset 2014|2024] [--source "..."]');
      process.exit(1);
    }
    const getFlag = (flag: string): string | undefined => {
      const idx = args.indexOf(flag);
      return idx >= 0 ? args[idx + 1] : undefined;
    };
    const category = (getFlag('--category') ?? 'gear') as ItemCategory;
    const ruleset = (getFlag('--ruleset') === '2024' ? '2024' : '2014') as Ruleset;
    const source = getFlag('--source');
    const rawJson = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8')) as unknown;

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

    const converted = rawList
      .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'))
      .map((item) => convertRawEntityToSidereroll(item, category, ruleset, source))
      .filter((x): x is CompendiumEntity => x !== null);

    const folder =
      category === 'spell'
        ? 'spells'
        : category === 'monster'
          ? 'monsters'
          : category === 'feature' || category === 'feat' || category === 'infusion'
            ? 'features'
            : 'items';
    const defaultOut = path.join(
      repoRoot,
      'src',
      'custom-content',
      folder,
      path.basename(inputPath)
    );
    const outPath = path.resolve(getFlag('--out') ?? defaultOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(converted, null, 2)}\n`, 'utf8');
    console.log(`Converted ${converted.length} ${category} entities -> ${path.relative(repoRoot, outPath)}`);
    return;
  }

  console.error(`Unknown command "${cmd}". Use "validate" or "convert".`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
