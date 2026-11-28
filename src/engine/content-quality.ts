import type { Activity, CompendiumEntity } from '../types/compendium';
import { areNearDuplicates, normalizeEntityName, stripPossessiveAndNotes } from './compendium-dedupe';
import { normalizeFormula, normalizeTags } from './import-normalize';

/**
 * Content quality scoring and the Markdown quality report (pure: no DOM, no storage, no clock).
 *
 * Fields the app's entity model does not have are not checked: spells carry no school, items carry no cost
 * and monsters carry no ability scores, so those rules from a 5e checklist have nothing to look at here.
 */

export type QualitySeverity = 'high' | 'medium' | 'low';

export interface QualityIssue {
  code: string;
  message: string;
  severity: QualitySeverity;
}

export interface QualityScore {
  /** 0-100, 100 = nothing to flag. */
  score: number;
  issues: QualityIssue[];
}

const PENALTY: Record<QualitySeverity, number> = { high: 25, medium: 10, low: 3 };
const SEVERITY_ORDER: Record<QualitySeverity, number> = { high: 0, medium: 1, low: 2 };

const blank = (v: string | undefined): boolean => v === undefined || v.trim() === '';

/** Two words glued together ("AjarNette"), digits inside a word ("Sw0rd") or stray symbols: a typical OCR / copy-paste scar. */
const GLUED_WORD = /^(?!(?:Mc|Mac|De|Di|La|Le|Von|Van|O)[A-Z])[A-Z][a-z]{2,}[A-Z][a-z]{2,}$/;
const DIGIT_IN_WORD = /[A-Za-z][0-9][A-Za-z]|[A-Za-z][|¢©®¶][A-Za-z]/;

export function looksOcrDamaged(name: string): boolean {
  if (DIGIT_IN_WORD.test(name)) return true;
  return name.split(/[\s\-/]+/).some((w) => GLUED_WORD.test(w));
}

function activityFormulas(a: Activity): string[] {
  return [a.attackBonusFormula, a.saveDcFormula, a.damageFormula, a.upcastDicePerLevel].filter((f): f is string => typeof f === 'string' && f !== '');
}

export function scoreEntity(e: CompendiumEntity): QualityScore {
  const issues: QualityIssue[] = [];
  const add = (code: string, severity: QualitySeverity, message: string) => issues.push({ code, severity, message });
  const text = e.entries.join('\n');
  const activities = e.activities ?? [];

  switch (e.category) {
    case 'spell': {
      if (e.spellLevel === undefined) add('spell-no-level', 'high', 'Spell level is missing.');
      if (!e.classes || e.classes.length === 0) add('spell-no-classes', 'medium', 'No class list: the spell only shows with "All classes".');
      if (blank(e.components)) add('spell-no-components', 'medium', 'Components are missing.');
      if (blank(e.range)) add('spell-no-range', 'medium', 'Range is missing.');
      if (blank(e.duration)) add('spell-no-duration', 'medium', 'Duration is missing.');
      if (blank(e.castingTime)) add('spell-no-casting-time', 'low', 'Casting time is missing.');
      if (activities.length === 0) add('spell-no-activity', 'medium', 'No damage, heal, save or utility activity: no cast button.');
      break;
    }
    case 'monster': {
      const m = e.monsterMeta;
      if (!m) {
        add('monster-no-stats', 'high', 'monsterMeta (AC, HP) is missing.');
      } else {
        if (!(m.ac > 0)) add('monster-no-ac', 'high', 'AC is missing or zero.');
        if (!(m.hp > 0)) add('monster-no-hp', 'high', 'HP is missing or zero.');
        if (blank(m.cr)) add('monster-no-cr', 'medium', 'Challenge rating is missing.');
        if (m.size === undefined) add('monster-no-size', 'low', 'Size is missing.');
        if (blank(m.speeds)) add('monster-no-speed', 'medium', 'Speed is missing.');
        if (blank(m.senses)) add('monster-no-senses', 'low', 'Senses are missing.');
        if (blank(m.saves)) add('monster-no-saves', 'low', 'Saving throws are missing.');
      }
      if (activities.length === 0 && text.trim() === '') add('monster-no-actions', 'high', 'No actions: neither activities nor a description.');
      break;
    }
    case 'weapon': {
      if (!activities.some((a) => !!a.damageFormula)) add('weapon-no-damage', 'high', 'No damage formula on any activity.');
      if (e.weight === undefined) add('item-no-weight', 'low', 'Weight is missing.');
      break;
    }
    case 'armor':
    case 'shield': {
      if (!e.acFormula && e.acFlatBonus === undefined) add('armor-no-ac', 'high', 'No AC formula or flat AC bonus.');
      if (e.weight === undefined) add('item-no-weight', 'low', 'Weight is missing.');
      break;
    }
    case 'gear': {
      if (e.weight === undefined) add('item-no-weight', 'low', 'Weight is missing.');
      break;
    }
    default:
      break;
  }

  if (e.category !== 'monster' && text.trim() === '' && !activities.some((a) => !blank(a.description))) {
    add('no-description', 'medium', 'The description is empty.');
  }
  for (const a of activities) {
    const bad = activityFormulas(a).find((f) => {
      const r = normalizeFormula(f);
      return r.kind !== 'ok' || r.value !== f;
    });
    if (bad !== undefined) {
      add('bad-dice', 'medium', `Activity "${a.name}": "${bad}" is not a clean dice expression.`);
      break;
    }
  }
  const allText = [text, ...activities.map((a) => a.description ?? '')].join('\n');
  if (allText.includes('{@') && normalizeTags(allText) !== allText) add('leftover-tags', 'medium', 'Leftover {@...} formatting tags in the text.');
  if (blank(e.imageUrl)) add('no-image', 'low', 'No image.');
  if (looksOcrDamaged(e.name)) add('name-ocr', 'low', `The name "${e.name}" looks OCR-damaged (glued words or stray symbols).`);

  const penalty = issues.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code));
  return { score: Math.max(0, 100 - penalty), issues };
}

// ---------------------------------------------------------------- clashes

export interface QualityClash {
  kind: 'exact' | 'near';
  entity: CompendiumEntity;
  other: CompendiumEntity;
}

const nameKey = (e: CompendiumEntity): string => `${normalizeEntityName(e.name)}|${e.category}`;

/** Pack entries that share a name with an entry of `against` (exact), or are possible near duplicates of one. */
export function findCrossPackClashes(entities: readonly CompendiumEntity[], against: readonly CompendiumEntity[]): QualityClash[] {
  const byKey = new Map<string, CompendiumEntity>();
  for (const o of against) if (!byKey.has(nameKey(o))) byKey.set(nameKey(o), o);
  const byCat = new Map<string, Array<{ e: CompendiumEntity; len: number }>>();
  for (const o of against) {
    const list = byCat.get(o.category) ?? [];
    list.push({ e: o, len: normalizeEntityName(stripPossessiveAndNotes(o.name)).length });
    byCat.set(o.category, list);
  }
  const out: QualityClash[] = [];
  for (const e of entities) {
    const exact = byKey.get(nameKey(e));
    if (exact) {
      out.push({ kind: 'exact', entity: e, other: exact });
      continue;
    }
    const len = normalizeEntityName(stripPossessiveAndNotes(e.name)).length;
    const near = (byCat.get(e.category) ?? []).find((o) => o.len <= len * 1.4 + 2 && len <= o.len * 1.4 + 2 && areNearDuplicates(e, o.e));
    if (near) out.push({ kind: 'near', entity: e, other: near.e });
  }
  return out;
}

// ---------------------------------------------------------------- report

export interface QualityDoctorInput {
  files?: number;
  accepted?: number;
  repaired?: number;
  rejected?: ReadonlyArray<{ source: string; reason: string }>;
  unreadable?: readonly string[];
  warnings?: readonly string[];
}

export interface QualityReportInput {
  packName: string;
  entities: readonly CompendiumEntity[];
  characters?: readonly unknown[];
  doctor?: QualityDoctorInput;
  /** Entries to compare against: the SRD built-ins and optionally other packs. */
  against?: readonly CompendiumEntity[];
}

export const REPORT_ROW_CAP = 200;
const CLASH_ROW_CAP = 100;

const cell = (s: string): string => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildQualityReport(input: QualityReportInput): string {
  const { packName, entities, characters = [], doctor, against = [] } = input;
  const scored = entities.map((e) => ({ e, ...scoreEntity(e) }));
  const average = scored.length === 0 ? 0 : Math.round((scored.reduce((s, x) => s + x.score, 0) / scored.length) * 10) / 10;
  const byCode = new Map<string, { count: number; severity: QualitySeverity }>();
  for (const s of scored) {
    for (const i of s.issues) {
      const cur = byCode.get(i.code);
      byCode.set(i.code, { count: (cur?.count ?? 0) + 1, severity: i.severity });
    }
  }
  const codes = [...byCode.entries()].sort((a, b) => b[1].count - a[1].count || cmp(a[0], b[0]));
  const byCategory = new Map<string, number>();
  for (const e of entities) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);

  const lines: string[] = [];
  lines.push(`# Content quality report: ${packName}`, '', '## Summary', '');
  lines.push(`- Entries: ${entities.length}`);
  lines.push(`- Characters: ${characters.length}`);
  lines.push(`- Average score: ${average.toFixed(1)} / 100`);
  lines.push(`- Entries with no issues: ${scored.filter((s) => s.issues.length === 0).length}`);
  const cats = [...byCategory.entries()].sort((a, b) => cmp(a[0], b[0])).map(([c, n]) => `${c} ${n}`);
  lines.push(`- By category: ${cats.length > 0 ? cats.join(', ') : 'none'}`);
  if (doctor) {
    lines.push(`- Import check: ${doctor.accepted ?? entities.length} accepted, ${doctor.repaired ?? 0} auto-repaired, ${doctor.rejected?.length ?? 0} rejected, ${doctor.unreadable?.length ?? 0} unreadable file(s)`);
  }
  lines.push('');
  if (codes.length > 0) {
    lines.push('### Issues by code', '', '| Code | Severity | Entries |', '|---|---|---:|');
    for (const [code, v] of codes) lines.push(`| ${code} | ${v.severity} | ${v.count} |`);
    lines.push('');
  } else {
    lines.push('No issues found.', '');
  }

  if (doctor && ((doctor.rejected?.length ?? 0) > 0 || (doctor.unreadable?.length ?? 0) > 0)) {
    lines.push('## Import problems', '');
    for (const f of doctor.unreadable ?? []) lines.push(`- Unreadable: ${cell(f)}`);
    for (const r of (doctor.rejected ?? []).slice(0, 20)) lines.push(`- Rejected ${cell(r.source)}: ${cell(r.reason)}`);
    if ((doctor.rejected?.length ?? 0) > 20) lines.push(`- ...and ${(doctor.rejected?.length ?? 0) - 20} more rejected`);
    lines.push('');
  }

  const clashes = findCrossPackClashes(entities, against).sort(
    (a, b) => cmp(a.kind, b.kind) || cmp(a.entity.name.toLowerCase(), b.entity.name.toLowerCase()) || cmp(a.entity.id, b.entity.id)
  );
  const exactCount = clashes.filter((c) => c.kind === 'exact').length;
  lines.push('## Cross-pack clashes', '');
  lines.push(`Compared with ${against.length} entries (SRD built-ins and any other packs given): ${exactCount} exact name match(es), ${clashes.length - exactCount} near duplicate(s).`, '');
  if (clashes.length > 0) {
    lines.push('| Kind | Category | This pack | Other | Other source |', '|---|---|---|---|---|');
    for (const c of clashes.slice(0, CLASH_ROW_CAP)) {
      lines.push(`| ${c.kind} | ${c.entity.category} | ${cell(c.entity.name)} | ${cell(c.other.name)} | ${cell(c.other.source)} (${c.other.ruleset}) |`);
    }
    if (clashes.length > CLASH_ROW_CAP) lines.push('', `...and ${clashes.length - CLASH_ROW_CAP} more`);
    lines.push('');
  }

  const worst = [...scored].sort(
    (a, b) => a.score - b.score || cmp(a.e.category, b.e.category) || cmp(a.e.name.toLowerCase(), b.e.name.toLowerCase()) || cmp(a.e.id, b.e.id)
  );
  lines.push('## Entries, worst first', '');
  if (worst.length === 0) {
    lines.push('No entries.');
  } else {
    lines.push('| Score | Category | Name | File | Top issues |', '|---:|---|---|---|---|');
    for (const s of worst.slice(0, REPORT_ROW_CAP)) {
      const top = s.issues.slice(0, 3).map((i) => i.code).join(', ');
      lines.push(`| ${s.score} | ${s.e.category} | ${cell(s.e.name)} | ${cell(s.e.packFile ?? '')} | ${top} |`);
    }
    if (worst.length > REPORT_ROW_CAP) lines.push('', `...and ${worst.length - REPORT_ROW_CAP} more`);
  }
  return `${lines.join('\n')}\n`;
}

/** One line for logs / PR bodies: "Pack: N entries, average X, top issues a x3, b x2". */
export function summarizeQuality(entities: readonly CompendiumEntity[]): string {
  const scored = entities.map(scoreEntity);
  const avg = scored.length === 0 ? 0 : scored.reduce((s, x) => s + x.score, 0) / scored.length;
  const counts = new Map<string, number>();
  for (const s of scored) for (const i of s.issues) counts.set(i.code, (counts.get(i.code) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 3);
  return `${entities.length} entries, average score ${avg.toFixed(1)}, top issues: ${top.map(([c, n]) => `${c} x${n}`).join(', ') || 'none'}`;
}
