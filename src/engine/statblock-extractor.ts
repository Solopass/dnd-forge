import type { ActionEconomy } from '../types/core';
import type { Activity, CompendiumEntity, CreatureSize, MonsterStatMeta } from '../types/compendium';
import type { AbilityKey } from '../types/core';
import { computeAbilityModifier } from './rules-math';

/**
 * Finds and parses 5e monster statblocks in plain text: the text of a PDF (including noisy OCR with
 * stray spaces like "1 0" for 10), a pasted statblock, or Markdown. Pure: no file access.
 */

export type StatblockProblem =
  | 'name not readable'
  | 'armor class unreadable'
  | 'hit points unreadable'
  | 'challenge rating missing'
  | 'ability scores incomplete'
  | 'no actions or traits found';

export interface ExtractedStatblock {
  /** 1-based line of the "Armor Class" anchor in the source text. */
  line: number;
  name: string;
  /** Set whenever AC and hit points could be read; `problems` lists what is still doubtful. */
  entity: CompendiumEntity | null;
  problems: StatblockProblem[];
}

export interface ExtractOptions {
  ruleset?: CompendiumEntity['ruleset'];
  source?: string;
  idPrefix?: string;
}

const SIZE_WORDS = /^(tiny|small|medium|large|huge|gargantuan)\b/i;
const SIZE_MAP: Record<string, CreatureSize> = {
  tiny: 'tiny', small: 'small', medium: 'medium', large: 'large', huge: 'huge', gargantuan: 'gargantuan',
};
const SAVE_ABILITY: Record<string, AbilityKey> = {
  strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha',
};

/** Repairs OCR digit confusion in a string that should be a number: "1 0" -> 10, "l3" -> 13, "4SO" -> 450. */
export function fixDigits(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/[lI|]/g, '1').replace(/[Oo]/g, '0').replace(/S/g, '5').replace(/,/g, '');
}

function toInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(fixDigits(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/** "8dl 2 + 40" -> "8d12 + 40" */
function fixDice(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/d[lI]/g, 'd1')
    .replace(/[lI]/g, '1')
    .replace(/O/g, '0')
    .replace(/([+-])/g, ' $1 ')
    .replace(/^\s+/, '')
    .trim();
}

function cleanLine(line: string): string {
  return line
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/^[\s>#*_|]+/, '')
    .replace(/[*_]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(name: string): string {
  const small = new Set(['of', 'the', 'and', 'in', 'on', 'a', 'an', 'to', 'for']);
  return name
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function readableName(line: string | undefined): string | null {
  if (!line) return null;
  const t = line.replace(/\s+/g, ' ').trim().replace(/(?<=[A-Za-z])0|0(?=[A-Za-z])/g, 'O');
  if (t.length < 3 || t.length > 60) return null;
  if (!/^[A-Za-z][A-Za-z' ,\-()]+$/.test(t)) return null;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '');
  const name = upper.length / letters.length > 0.8 ? titleCase(t) : t;
  return name;
}

function sectionOf(line: string): 'actions' | 'bonus' | 'reactions' | 'legendary' | 'lair' | null {
  const key = line.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (key === 'ACTIONS') return 'actions';
  if (key === 'BONUSACTIONS') return 'bonus';
  if (key === 'REACTIONS') return 'reactions';
  if (key === 'LEGENDARYACTIONS') return 'legendary';
  if (key === 'LAIRACTIONS') return 'lair';
  return null;
}

function isBlockEnd(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const odd = t.replace(/[A-Za-z0-9\s.,;:'"()\-+/%!?&]/g, '').length;
  if (t.length >= 4 && odd / t.length > 0.25) return true; // OCR garbage between a statblock and the next text
  if (letters.length >= 6 && letters === letters.toUpperCase() && !sectionOf(t)) return true; // next ALL-CAPS heading
  return false;
}

const ECONOMY: Record<string, ActionEconomy> = {
  actions: 'action', bonus: 'bonus_action', reactions: 'reaction', legendary: 'special', lair: 'special',
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface Para {
  name: string;
  text: string;
  section: string;
}

function parseActivity(para: Para, idBase: string, idx: number): Activity | null {
  const text = para.text;
  const hit = text.match(/([+-]\s*\d[\d\sOolI]*)\s*to\s*hit/i);
  const dmg = text.match(/\d[\d\s,]*\(\s*([\dOolI\s]+d\s*[\dOolI\s]+(?:\s*[+-]\s*[\dOolI\s]+)?)\s*\)\s*([a-z]+)(?:\s+or\s+[a-z]+)?\s+damage/i);
  const flat = text.match(/Hit:\s*(\d+)\s+([a-z]+)\s+damage/i);
  const plainDice = text.match(/(\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?)\s+([a-z]+)\s+damage/i);
  const dc = text.match(/DC\s*([\dOolIS\s]{1,4})\s*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*sav/i);
  const economy = ECONOMY[para.section] ?? 'action';
  const base = { id: `${idBase}-act-${idx}`, name: para.name, actionEconomy: economy, description: text };
  if (hit) {
    const bonus = fixDigits(hit[1]!.replace(/\s+/g, '')).replace(/^(\d)/, '+$1');
    return {
      ...base,
      type: 'attack',
      attackBonusFormula: bonus,
      ...(dmg ? { damageFormula: fixDice(dmg[1]!), damageType: dmg[2]!.toLowerCase() } : plainDice ? { damageFormula: fixDice(plainDice[1]!), damageType: plainDice[2]!.toLowerCase() } : flat ? { damageFormula: flat[1]!, damageType: flat[2]!.toLowerCase() } : {}),
    };
  }
  if (dc) {
    const dcNum = toInt(dc[1]);
    const ability = SAVE_ABILITY[dc[2]!.toLowerCase()];
    if (dcNum !== null && ability) {
      return {
        ...base,
        type: 'save',
        saveAbility: ability,
        saveDcFormula: String(dcNum),
        ...(dmg ? { damageFormula: fixDice(dmg[1]!), damageType: dmg[2]!.toLowerCase() } : {}),
      };
    }
  }
  return null;
}

function listField(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses one statblock whose lines (already cleaned) start at the size/type line or the Armor Class line. */
function parseBlock(
  name: string,
  sizeLine: string | undefined,
  lines: string[],
  anchorLine: number,
  opts: ExtractOptions
): ExtractedStatblock {
  const problems: StatblockProblem[] = [];
  const joined = lines.join('\n');
  const acMatch = lines[0]?.match(/Armor\s*Class\s*:?\s*([\dOolIS][\dOolIS\s]*)\s*(\(.*)?$/i);
  const ac = toInt(acMatch?.[1]);
  const hpLine = lines.find((l) => /^Hit\s*Points/i.test(l)) ?? '';
  const hpMatch = hpLine.match(/Hit\s*Points\s*:?\s*([\dOolIS][\dOolIS\s,]*)/i);
  const hp = toInt(hpMatch?.[1]);
  if (ac === null) problems.push('armor class unreadable');
  if (hp === null) problems.push('hit points unreadable');

  const chIdx = lines.findIndex((l) => /^Challenge\b/i.test(l));
  const crMatch = chIdx >= 0 ? lines[chIdx]!.match(/Challenge\s*:?\s*([\dOolI]+(?:\s*\/\s*[\dOolI]+)?|-)/i) : null;
  const cr = crMatch ? (crMatch[1] === '-' ? '0' : crMatch[1]!.replace(/\s+/g, '').replace(/[lI]/g, '1').replace(/O/g, '0')) : undefined;
  if (!cr) problems.push('challenge rating missing');

  const headerEnd = chIdx >= 0 ? chIdx : Math.min(lines.length, 40);
  // Ability lines hold only "score (mod)" values. In two-column PDF text some of them land after the Challenge line.
  const scores: number[] = [];
  const scoreLine = /^(?:[\dOolIS][\dOolIS ]{0,3} *[({]\s*[+-]\s*[\dOolIS]{1,2}\s*[)}]\s*)+$/;
  for (const l of lines.slice(0, Math.min(lines.length, headerEnd + 14))) {
    if (!scoreLine.test(l)) continue;
    for (const m of l.matchAll(/([\dOolIS][\dOolIS ]{0,3}) *[({]/g)) {
      const v = toInt(m[1]);
      if (v !== null && v >= 1 && v <= 30) scores.push(v);
    }
  }
  if (scores.length < 6) problems.push('ability scores incomplete');
  const dexScore = scores[1] ?? 10;

  const field = (label: string): string | undefined => {
    const re = new RegExp(`^${label}\\s*:?\\s+(.+)$`, 'i');
    for (let i = 0; i < headerEnd; i++) {
      const m = lines[i]!.match(re);
      if (m) {
        let v = m[1]!.trim();
        // a value wrapped onto the next line ends in a comma
        while (v.endsWith(',') && lines[i + 1]) v += ` ${lines[++i]!}`;
        return v;
      }
    }
    return undefined;
  };
  const speed = field('Speed');
  const saves = field('Saving Throws');
  const skills = field('Skills');
  const senses = (() => {
    const s = field('Senses');
    return s ? s.replace(/\bl\s*(\d)/g, '1$1') : undefined;
  })();
  const resist = field('Damage Resistances');
  const immune = field('Damage Immunities');
  const vuln = field('Damage Vulnerabilities');
  const condImmune = field('Condition Immunities');

  // traits, then sections of actions
  const paras: Para[] = [];
  let section = 'traits';
  let current: Para | null = null;
  let startAt = chIdx + 1;
  if (chIdx < 0) {
    // pasted text without a Challenge line: the traits/actions start after the last header or ability line
    const headerLine = /^(Armor\s*Class|Hit\s*Points|Speed|Saving Throws|Skills|Senses|Languages|Damage |Condition )/i;
    startAt = 0;
    lines.forEach((l, i) => {
      if (headerLine.test(l) || scoreLine.test(l) || /^(STR|DEX|CON|INT|WIS|CHA)\b/.test(l)) startAt = i + 1;
    });
    section = 'actions';
  }
  for (let i = startAt; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    const sec = sectionOf(line);
    if (sec) {
      section = sec;
      current = null;
      continue;
    }
    const nm = line.match(/^([A-Z][A-Za-z' \-]{1,38}(?:\s\([^)]{1,30}\))?)\.\s+(.*)$/);
    const looksLikeName = nm && nm[1]!.split(' ').length <= 6 && !/^(Hit|Melee|Ranged|Each|The|If|A|An|As|On|At|When)\b/.test(nm[1]!);
    if (looksLikeName && nm) {
      current = { name: nm[1]!.trim(), text: nm[2]!.trim(), section };
      paras.push(current);
    } else if (current) {
      current.text = `${current.text} ${line}`.replace(/\s+/g, ' ');
    }
  }
  for (const p of paras) if (p.text.length > 2500) p.text = `${p.text.slice(0, 2500)}...`;
  if (paras.length === 0) problems.push('no actions or traits found');

  const idBase = `${opts.idPrefix ?? 'custom'}-mob-${slug(name)}`;
  const activities: Activity[] = [];
  paras.forEach((p, i) => {
    const act = parseActivity(p, idBase, i);
    if (act) activities.push(act);
  });
  const multi = paras.find((p) => /^Multiattack/i.test(p.name));
  if (multi && !activities.some((a) => a.name === multi.name)) {
    activities.unshift({ id: `${idBase}-multiattack`, name: multi.name, type: 'utility', actionEconomy: 'action', description: multi.text });
  }
  if (activities.length === 0) {
    activities.push({ id: `${idBase}-act-0`, name: `Use ${name}`, type: 'utility', actionEconomy: 'action', description: name });
  }

  if (ac === null || hp === null) return { line: anchorLine, name, entity: null, problems };

  const meta: MonsterStatMeta = {
    ac,
    hp,
    dexModifier: computeAbilityModifier(dexScore),
    ...(cr ? { cr } : {}),
    ...(sizeLine && SIZE_MAP[sizeLine.split(' ')[0]!.toLowerCase()] ? { size: SIZE_MAP[sizeLine.split(' ')[0]!.toLowerCase()] } : {}),
    ...(speed ? { speeds: speed } : {}),
    ...(saves ? { saves } : {}),
    ...(skills ? { skills } : {}),
    ...(senses ? { senses } : {}),
    ...(resist ? { resistances: listField(resist) } : {}),
    ...(immune || condImmune ? { immunities: listField([immune, condImmune].filter(Boolean).join(', ')) } : {}),
    ...(vuln ? { vulnerabilities: listField(vuln) } : {}),
    ...(paras.some((p) => p.section === 'legendary') ? { legendaryActionsMax: 3 } : {}),
    traits: paras.filter((p) => p.section === 'traits').map((p) => p.name),
  };
  const entries = [
    ...(sizeLine ? [sizeLine] : []),
    ...paras.map((p) => `${p.name}: ${p.text}`),
  ];
  void joined;
  const entity: CompendiumEntity = {
    id: idBase,
    name,
    source: opts.source ?? 'Custom Import',
    ruleset: opts.ruleset ?? '2014',
    category: 'monster',
    equipped: false,
    prepared: true,
    monsterMeta: meta,
    activities,
    entries,
  };
  return { line: anchorLine, name, entity, problems };
}

/** Finds every statblock in `text` and parses it. Blocks that cannot be read still appear, with their problems. */
export function extractStatblocksFromText(text: string, opts: ExtractOptions = {}): ExtractedStatblock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(cleanLine);
  const anchors: number[] = [];
  lines.forEach((l, i) => {
    if (/^Armor\s*C\s*lass\b/i.test(l)) anchors.push(i);
  });
  const out: ExtractedStatblock[] = [];
  const usedIds = new Map<string, number>();
  anchors.forEach((a, k) => {
    // name: the line above the size line (or directly above, in pasted text without a size line)
    let sizeIdx = -1;
    let nameIdx = a - 1;
    if (a >= 1 && SIZE_WORDS.test(lines[a - 1] ?? '')) {
      sizeIdx = a - 1;
      nameIdx = a - 2;
    }
    let name = readableName(lines[nameIdx]);
    // a stray noise line between name and size line
    if (!name && sizeIdx >= 0) name = readableName(lines[nameIdx - 1]);
    const next = anchors[k + 1];
    const limit = next !== undefined ? Math.max(a + 1, next - 3) : lines.length;
    const block: string[] = [];
    let ended = false;
    let sawChallenge = false;
    for (let i = a; i < limit; i++) {
      const l = lines[i]!;
      if (l === '---') continue;
      if (/^Challenge\b/i.test(l)) sawChallenge = true;
      if (sawChallenge && i > a && isBlockEnd(l)) {
        ended = true;
        break;
      }
      block.push(l);
    }
    void ended;
    const nameOk = name !== null;
    const res = parseBlock(name ?? `Unnamed creature (line ${a + 1})`, sizeIdx >= 0 ? lines[sizeIdx] : undefined, block, a + 1, opts);
    if (!nameOk) res.problems.unshift('name not readable');
    if (res.entity) {
      const n = (usedIds.get(res.entity.id) ?? 0) + 1;
      usedIds.set(res.entity.id, n);
      if (n > 1) res.entity.id = `${res.entity.id}-${n}`;
    }
    out.push(res);
  });
  return out;
}

export interface ExtractionSummary {
  found: number;
  clean: number;
  withEntity: number;
  failureKinds: Array<{ kind: StatblockProblem; count: number }>;
}

/** Found vs parsed-cleanly counts and the most common problems, most frequent first. */
export function summarizeExtraction(results: readonly ExtractedStatblock[]): ExtractionSummary {
  const counts = new Map<StatblockProblem, number>();
  for (const r of results) for (const p of r.problems) counts.set(p, (counts.get(p) ?? 0) + 1);
  return {
    found: results.length,
    clean: results.filter((r) => r.entity && r.problems.length === 0).length,
    withEntity: results.filter((r) => r.entity).length,
    failureKinds: [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
  };
}
