import type { RawCharacterState, ResourcePool } from '../types/character';
import type { CompendiumEntity } from '../types/compendium';
import type { AbilityKey, RecoveryTrigger, Ruleset, SkillKey } from '../types/core';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILLS: SkillKey[] = [
  'acrobatics', 'animal_handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation',
  'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion',
  'sleight_of_hand', 'stealth', 'survival',
];

/** Optional class lookup (pass `getClassDefinition`); kept as a parameter so this file never imports classes.ts (import cycle through srd-packs). */
export type ClassLookup = (className: string) => { hitDie: 6 | 8 | 10 | 12; casterProgression: RawCharacterState['classes'][number]['casterProgression'] } | undefined;

export interface IncomingCharacterResult {
  character: RawCharacterState | null;
  /** Why it was rejected (empty when accepted). */
  problems: string[];
  /** Things that were dropped or guessed while accepting it. */
  warnings: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function abilityMap(v: unknown): Record<AbilityKey, number> | null {
  if (!isObj(v)) return null;
  if (!ABILITIES.every((a) => isNum(v[a]))) return null;
  return Object.fromEntries(ABILITIES.map((a) => [a, v[a] as number])) as Record<AbilityKey, number>;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toRecovery(v: unknown): RecoveryTrigger {
  const s = String(v ?? '').toLowerCase();
  if (s.startsWith('short')) return 'short_rest';
  if (s === 'dawn') return 'dawn';
  if (s === 'manual') return 'manual';
  return 'long_rest';
}

function parseHitDie(v: unknown): 6 | 8 | 10 | 12 | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? '').replace(/^d/i, ''), 10);
  return n === 6 || n === 8 || n === 10 || n === 12 ? n : null;
}

/**
 * Accepts a character in either shape and returns a complete RawCharacterState:
 *  - the app's own export (baseAbilities, classes[].className ...): missing optional parts are filled in;
 *  - the simple AI/handbook shape (abilities, classes[].name + hitDie "d8", equipment/features/spells id lists,
 *    resourcePools, savingThrows, skills[]): converted, with the id lists resolved through `resolve`.
 * Characters that cannot be made safe to open are rejected with a reason instead of crashing the sheet later.
 */
export function normalizeIncomingCharacter(
  raw: Obj,
  resolve: (id: string) => CompendiumEntity | undefined = () => undefined,
  getClassDefinition: ClassLookup = () => undefined
): IncomingCharacterResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) problems.push('missing name');
  if (!Array.isArray(raw.classes) || raw.classes.length === 0) problems.push('missing classes');

  const native = raw.baseAbilities !== undefined;
  const base = abilityMap(native ? raw.baseAbilities : raw.abilities);
  if (!base) problems.push(native ? 'baseAbilities needs str, dex, con, int, wis and cha numbers' : 'missing abilities (str, dex, con, int, wis, cha)');

  const classes: RawCharacterState['classes'] = [];
  if (Array.isArray(raw.classes)) {
    raw.classes.forEach((c, i) => {
      if (!isObj(c)) {
        problems.push(`class ${i + 1} is not an object`);
        return;
      }
      const className = String(c.className ?? c.name ?? '').trim();
      const level = Number(c.level);
      if (!className) problems.push(`class ${i + 1} has no name`);
      if (!Number.isInteger(level) || level < 1 || level > 20) problems.push(`class ${className || i + 1} needs a level from 1 to 20`);
      const def = className ? getClassDefinition(className) : undefined;
      const hitDie = parseHitDie(c.hitDie) ?? def?.hitDie ?? null;
      if (!hitDie) problems.push(`class ${className || i + 1} needs a hit die (d6, d8, d10 or d12)`);
      const sub = c.subclassName ?? c.subclass;
      if (className && Number.isInteger(level) && hitDie) {
        classes.push({
          className,
          ...(typeof sub === 'string' && sub ? { subclassName: sub } : {}),
          level,
          hitDie,
          casterProgression: (c.casterProgression as RawCharacterState['classes'][number]['casterProgression']) ?? def?.casterProgression ?? 'none',
        });
      }
    });
  }

  const hp = isObj(raw.hp) ? raw.hp : null;
  if (!hp || !isNum(hp.max) || !isNum(hp.current)) problems.push('hp needs current and max numbers');
  if (problems.length > 0 || !base || !hp) return { character: null, problems, warnings };

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `custom-char-${slug(name)}`;
  const ruleset: Ruleset = raw.ruleset === '2024' || raw.ruleset === 'homebrew' ? raw.ruleset : '2014';

  if (native) {
    const skillProficiencies = Object.fromEntries(SKILLS.map((s) => [s, 0])) as RawCharacterState['skillProficiencies'];
    if (isObj(raw.skillProficiencies)) Object.assign(skillProficiencies, raw.skillProficiencies);
    const character: RawCharacterState = {
      ...(raw as unknown as RawCharacterState),
      id,
      name,
      ruleset,
      species: typeof raw.species === 'string' ? raw.species : '',
      background: typeof raw.background === 'string' ? raw.background : '',
      classes,
      baseAbilities: base,
      bonusAbilities: abilityMap(raw.bonusAbilities) ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      saveProficiencies: Array.isArray(raw.saveProficiencies) ? (raw.saveProficiencies as AbilityKey[]) : [],
      skillProficiencies,
      hp: { current: hp.current as number, max: hp.max as number, temp: isNum(hp.temp) ? hp.temp : 0 },
      deathSaves: isObj(raw.deathSaves) ? (raw.deathSaves as RawCharacterState['deathSaves']) : { successes: 0, failures: 0 },
      exhaustion: isNum(raw.exhaustion) ? raw.exhaustion : 0,
      conditions: Array.isArray(raw.conditions) ? (raw.conditions as string[]) : [],
      resources: Array.isArray(raw.resources) ? (raw.resources as ResourcePool[]) : [],
      items: Array.isArray(raw.items) ? (raw.items as CompendiumEntity[]) : [],
      overrides: isObj(raw.overrides) ? (raw.overrides as RawCharacterState['overrides']) : {},
    };
    return { character, problems, warnings };
  }

  // simple shape
  const skillProficiencies = Object.fromEntries(SKILLS.map((s) => [s, 0])) as RawCharacterState['skillProficiencies'];
  for (const s of Array.isArray(raw.skills) ? raw.skills : []) {
    if (SKILLS.includes(s as SkillKey)) skillProficiencies[s as SkillKey] = 1;
    else warnings.push(`unknown skill "${String(s)}" ignored`);
  }
  const resources: ResourcePool[] = [];
  for (const r of Array.isArray(raw.resourcePools) ? raw.resourcePools : []) {
    if (!isObj(r) || typeof r.id !== 'string' || !isNum(r.max)) {
      warnings.push('a resource pool without id/max was ignored');
      continue;
    }
    resources.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : r.id,
      current: isNum(r.current) ? r.current : r.max,
      max: r.max,
      recovery: toRecovery(r.resetOn ?? r.recovery),
    });
  }
  const items: CompendiumEntity[] = [];
  const addIds = (key: 'equipment' | 'features' | 'spells', equipped: boolean) => {
    for (const ref of Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []) {
      const found = typeof ref === 'string' ? resolve(ref) : undefined;
      if (!found) {
        warnings.push(`${key} "${String(ref)}" was not found in the compendium and was skipped`);
        continue;
      }
      items.push({ ...structuredClone(found), ...(equipped ? { equipped: true } : {}), ...(key === 'spells' ? { prepared: true } : {}) });
    }
  };
  addIds('equipment', true);
  addIds('features', false);
  addIds('spells', false);

  const overrides: RawCharacterState['overrides'] = {};
  if (isNum(raw.ac)) overrides.ac = raw.ac;
  if (isNum(raw.proficiencyBonus)) overrides.proficiencyBonus = raw.proficiencyBonus;
  const character: RawCharacterState = {
    id,
    name,
    ruleset,
    species: typeof raw.species === 'string' ? raw.species : '',
    background: typeof raw.background === 'string' ? raw.background : '',
    classes,
    baseAbilities: base,
    bonusAbilities: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    saveProficiencies: (Array.isArray(raw.savingThrows) ? raw.savingThrows : []).filter((a): a is AbilityKey => ABILITIES.includes(a as AbilityKey)),
    skillProficiencies,
    hp: { current: hp.current as number, max: hp.max as number, temp: isNum(hp.temp) ? hp.temp : 0 },
    deathSaves: { successes: 0, failures: 0 },
    exhaustion: 0,
    conditions: [],
    resources,
    items,
    overrides,
    ...(isNum(raw.speed) ? { speeds: { walk: raw.speed } } : {}),
    ...(typeof raw.notes === 'string' && raw.notes ? { notes: { bio: '', campaign: raw.notes, proficiencies: '' } } : {}),
  };
  return { character, problems, warnings };
}
