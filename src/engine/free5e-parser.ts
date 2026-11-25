import { Activity, CompendiumEntity, ItemCategory } from '../types/compendium';
import { AbilityKey } from '../types/core';
import { parseHomebrewMarkdownBlock } from './statblock-parser';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ABILITY_MAP: Record<string, AbilityKey> = {
  strength: 'str',
  str: 'str',
  dexterity: 'dex',
  dex: 'dex',
  constitution: 'con',
  con: 'con',
  intelligence: 'int',
  int: 'int',
  wisdom: 'wis',
  wis: 'wis',
  charisma: 'cha',
  cha: 'cha',
};

function stripMarkdownNoise(raw: string): string[] {
  const withoutComments = raw.replace(/<!--[\s\S]*?-->/g, '');
  const lines = withoutComments
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[_metadata_:[^\]]+\]:-/.test(line))
    .filter((line) => !/^\s*#{1,6}\s+/.test(line));

  return lines
    .join('\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\\\s*\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((block) => block.length > 0 && !/^_.*_$/.test(block));
}

export function extractFree5eMetadata(md: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const regex = /^\s*\[_metadata_:([^\]]+)\]:-\s*"([^"]*)"/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(md)) !== null) {
    if (match[1]) {
      meta[match[1].trim().toLowerCase()] = (match[2] ?? '').trim();
    }
  }
  return meta;
}

export function parseFree5eSpellMarkdown(
  md: string,
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity | null {
  const meta = extractFree5eMetadata(md);
  const headingMatch = md.match(/^\s*#{1,6}\s+(.+)$/m);
  const name = meta.spell_name || headingMatch?.[1]?.trim() || '';
  if (!name) return null;

  const spellLevel = Number.parseInt(meta.spell_level ?? '0', 10);
  const safeLevel = Number.isNaN(spellLevel) ? 0 : Math.max(0, Math.min(9, spellLevel));
  const ritual = meta.ritual === 'true';
  const concentration = meta.concentration === 'true';
  const castingTime =
    meta.casting_time_amount && meta.casting_time_unit
      ? `${meta.casting_time_amount} ${meta.casting_time_unit}`
      : undefined;

  const entries = stripMarkdownNoise(md);
  const activities: Activity[] = [];
  const saveKey = meta.saving_throw ? ABILITY_MAP[meta.saving_throw.toLowerCase()] : undefined;
  const dmgFormula = meta.damage_formula || undefined;
  const dmgType = meta.damage_type || undefined;

  if (saveKey || dmgFormula) {
    activities.push({
      id: `act-f5e-${slugify(name)}`,
      name,
      type: saveKey ? 'save' : 'attack',
      actionEconomy: 'action',
      saveAbility: saveKey,
      saveDcFormula: saveKey ? '@spell_dc' : undefined,
      attackBonusFormula: !saveKey && dmgFormula ? '@spell_atk' : undefined,
      damageFormula: dmgFormula,
      damageType: dmgType,
      description: entries[0] ?? name,
    });
  }

  return {
    id: `free5e-spl-${slugify(name)}`,
    name,
    source: sourceLabel,
    ruleset: '2014',
    category: 'spell',
    spellLevel: safeLevel,
    castingTime,
    range: meta.range || undefined,
    duration: meta.duration || undefined,
    ritual,
    concentration,
    activities,
    entries: entries.length > 0 ? entries : [name],
  };
}

export function parseFree5eFeatMarkdown(
  md: string,
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity | null {
  const headingMatch = md.match(/^\s*#{1,6}\s+(.+)$/m);
  const name = headingMatch?.[1]?.trim() || '';
  if (!name || name.toLowerCase() === 'feats') return null;

  const entries = stripMarkdownNoise(md);
  if (entries.length === 0) return null;

  return {
    id: `free5e-feat-${slugify(name)}`,
    name,
    source: sourceLabel,
    ruleset: '2014',
    category: 'feat',
    activities: [],
    entries,
  };
}

export function parseFree5eMarkdownAuto(
  md: string,
  fallbackCategory: ItemCategory = 'gear',
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity | null {
  if (/\[_metadata_:spell_name\]:-/i.test(md)) {
    return parseFree5eSpellMarkdown(md, sourceLabel);
  }
  if (fallbackCategory === 'feat') {
    return parseFree5eFeatMarkdown(md, sourceLabel);
  }
  if (fallbackCategory === 'spell') {
    const asSpell = parseFree5eSpellMarkdown(md, sourceLabel);
    if (asSpell) return asSpell;
  }

  const hb = parseHomebrewMarkdownBlock(md);
  if (hb?.data) {
    return {
      ...hb.data,
      id: `free5e-${hb.data.category}-${slugify(hb.data.name)}`,
      source: sourceLabel,
    };
  }
  return null;
}
