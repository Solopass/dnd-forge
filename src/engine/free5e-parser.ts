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

function parseMarkdownTableRows(md: string): string[][] {
  const rows: string[][] = [];
  for (const line of md.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue; // separator row
    const cells = trimmed
      .slice(1, trimmed.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((c) => c.trim());
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

export function parseFree5eWeaponsTable(
  md: string,
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity[] {
  const out: CompendiumEntity[] = [];
  let inRanged = false;
  for (const cells of parseMarkdownTableRows(md)) {
    const rawName = cells[0] ?? '';
    if (!rawName || rawName.toLowerCase() === 'name') continue;
    if (rawName.startsWith('**') && rawName.endsWith('**')) {
      inRanged = rawName.toLowerCase().includes('ranged');
      continue;
    }
    const cost = cells[1] ?? '';
    const dmgCell = cells[2] ?? '';
    const props = cells[4] ?? '';
    const dmgMatch = dmgCell.match(/^(\S+)\s+([a-zA-Z]+)/);
    const dmgDice = dmgMatch?.[1] ?? '1d4';
    const dmgType = dmgMatch?.[2]?.toLowerCase() ?? 'bludgeoning';
    const isFinesse = props.toLowerCase().includes('finesse');
    const isRanged = inRanged || props.toLowerCase().includes('ammunition');
    const attackAbility: AbilityKey = isRanged ? 'dex' : isFinesse ? 'dex' : 'str';

    out.push({
      id: `free5e-wpn-${slugify(rawName)}`,
      name: rawName,
      source: sourceLabel,
      ruleset: '2014',
      category: 'weapon',
      activities: [
        {
          id: `act-f5e-${slugify(rawName)}`,
          name: rawName,
          type: 'attack',
          actionEconomy: 'action',
          attackAbility,
          attackBonusFormula: `@${attackAbility} + @prof`,
          damageFormula: `${dmgDice} + @${attackAbility}`,
          damageType: dmgType,
        },
      ],
      entries: [
        `${dmgCell}${props && props !== '—' ? ` • ${props}` : ''}${cost && cost !== '—' ? ` • Cost: ${cost}` : ''}`,
      ],
    });
  }
  return out;
}

export function parseFree5eArmorTable(
  md: string,
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity[] {
  const out: CompendiumEntity[] = [];
  for (const cells of parseMarkdownTableRows(md)) {
    const rawName = cells[0] ?? '';
    if (!rawName || rawName.toLowerCase() === 'armor') continue;
    if (rawName.startsWith('**') && rawName.endsWith('**')) continue;

    const cost = cells[1] ?? '';
    const acCell = cells[2] ?? '';
    const strReq = cells[3] ?? '';
    const stealth = cells[4] ?? '';
    const isShield = rawName.toLowerCase() === 'shield' || acCell.trim().startsWith('+');
    const baseMatch = acCell.match(/(\d+)/);
    const baseAc = baseMatch?.[1] ? Number.parseInt(baseMatch[1], 10) : 11;
    const hasDex = acCell.toLowerCase().includes('dex');
    const dexCap = !hasDex ? 0 : acCell.toLowerCase().includes('max 2') ? 2 : null;

    out.push({
      id: `free5e-${isShield ? 'shd' : 'arm'}-${slugify(rawName)}`,
      name: rawName,
      source: sourceLabel,
      ruleset: '2014',
      category: isShield ? 'shield' : 'armor',
      acFormula: isShield ? undefined : { base: baseAc, dexCap },
      acFlatBonus: isShield ? 2 : undefined,
      activities: [],
      entries: [
        `AC ${acCell}${strReq && strReq !== '—' ? ` • ${strReq}` : ''}${stealth && stealth !== '—' ? ` • Stealth: ${stealth}` : ''}${cost && cost !== '—' ? ` • Cost: ${cost}` : ''}`,
      ],
    });
  }
  return out;
}

export function parseFree5eGearTable(
  md: string,
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity[] {
  const out: CompendiumEntity[] = [];
  for (const cells of parseMarkdownTableRows(md)) {
    const rawName = cells[0] ?? '';
    if (!rawName || /^(item|name|tool)$/i.test(rawName)) continue;
    if (rawName.startsWith('**') && rawName.endsWith('**')) continue;
    const rest = cells.slice(1).filter((c) => c && c !== '—').join(' • ');
    out.push({
      id: `free5e-gear-${slugify(rawName)}`,
      name: rawName,
      source: sourceLabel,
      ruleset: '2014',
      category: 'gear',
      activities: [],
      entries: [rest || rawName],
    });
  }
  return out;
}

export function parseFree5eMarkdownBatch(
  md: string,
  fallbackCategory: ItemCategory = 'gear',
  sourceLabel = 'Free5e (CC-BY-4.0)'
): CompendiumEntity[] {
  if (fallbackCategory === 'weapon' && /\|\s*Damage\s*\|/i.test(md)) {
    return parseFree5eWeaponsTable(md, sourceLabel);
  }
  if (fallbackCategory === 'armor' && /\|\s*Armor Class/i.test(md)) {
    return parseFree5eArmorTable(md, sourceLabel);
  }
  if (fallbackCategory === 'gear' && /^\|.+\|$/m.test(md) && !/\[_metadata_:/i.test(md)) {
    return parseFree5eGearTable(md, sourceLabel);
  }
  const single = parseFree5eMarkdownAuto(md, fallbackCategory, sourceLabel);
  return single ? [single] : [];
}
