import { ActionEconomy, Ruleset } from '../types/core';
import { Activity, CompendiumEntity, ItemCategory, MonsterStatMeta } from '../types/compendium';
import { extractStatblocksFromText } from './statblock-extractor';

export interface ParseWarning {
  line: number;
  raw: string;
  reason: string;
}

export interface ParseResult<T> {
  data: T;
  warnings: ParseWarning[];
  confidence: 'high' | 'partial' | 'low';
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2212/g, '-');
}

function detectActionEconomy(text: string): ActionEconomy {
  const lower = text.toLowerCase();
  if (lower.includes('bonus action')) return 'bonus_action';
  if (lower.includes('reaction')) return 'reaction';
  if (lower.includes('free action') || lower.includes('no action')) return 'free';
  return 'action';
}

export function parseHomebrewMarkdownBlock(
  rawText: string,
  defaultCategory: ItemCategory = 'feature',
  ruleset: Ruleset = 'homebrew'
): ParseResult<CompendiumEntity> {
  const normalized = normalizeText(rawText);

  // A standard monster statblock (Armor Class / Hit Points lines, with or without colons or Markdown bold)
  // goes through the statblock extractor, which also reads sizes, speeds, saves, traits and every action.
  if (/Armor\s*Class\b/i.test(normalized) && /Hit\s*Points\b/i.test(normalized) && !/^\W*type\W*:\s*(spell|weapon|armor|shield|feat)/im.test(normalized)) {
    const first = extractStatblocksFromText(normalized, { ruleset, source: 'Custom Homebrew', idPrefix: 'hb' })[0];
    if (first?.entity) {
      const problems = first.problems;
      return {
        data: first.entity,
        warnings: problems.map((reason) => ({ line: first.line, raw: first.name, reason })),
        confidence: problems.length === 0 ? 'high' : 'partial',
      };
    }
  }

  const lines = normalized.split('\n');
  const warnings: ParseWarning[] = [];

  let name = 'Unnamed Homebrew Entry';
  let source = 'Custom Homebrew';
  let category: ItemCategory = defaultCategory;
  let acFlatBonus: number | undefined;
  let concentration = false;
  let spellLevel: number | undefined;
  let monsterAc: number | undefined;
  let monsterHp: number | undefined;
  let monsterDexMod = 0;
  let monsterCr: string | undefined;
  let explicitCategory = false;
  let armorBase: number | undefined;
  let armorDexCap: number | null = 0;
  let castingTime: string | undefined;
  let range: string | undefined;
  let components: string | undefined;
  let duration: string | undefined;
  let classes: string[] | undefined;
  let weaponDamage: string | undefined;
  let weaponDamageType: string | undefined;
  let ritual = false;
  const activities: Activity[] = [];
  const entries: string[] = [];

  let matchedFields = 0;

  lines.forEach((rawLine, index) => {
    const lineNum = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch && headingMatch[1] && matchedFields === 0) {
      name = headingMatch[1].trim();
      matchedFields += 1;
      return;
    }

    const levelLine = trimmed.replace(/[*_]/g, '').match(/^(?:(\d+)(?:st|nd|rd|th)[- ]level\s+[a-z]+|[a-z]+\s+cantrip)(\s*\(ritual\))?$/i);
    if (levelLine && !headingMatch) {
      spellLevel = levelLine[1] ? Number.parseInt(levelLine[1], 10) : 0;
      ritual = Boolean(levelLine[2]);
      category = 'spell';
      explicitCategory = true;
      matchedFields += 1;
      return;
    }

    const statRowMatch = trimmed.match(
      /\d+\s*\([+-]?\d+\)\s+\d+\s*\(([+-]?\d+)\)\s+\d+\s*\([+-]?\d+\)/
    );
    if (statRowMatch && statRowMatch[1]) {
      monsterDexMod = Number.parseInt(statRowMatch[1], 10) || 0;
      category = 'monster';
      matchedFields += 2;
      entries.push(trimmed);
      return;
    }

    const kvMatch = trimmed.match(/^\*{0,2}([A-Za-z\s]+?)(?::\*{1,2}|\*{1,2}:|:)\s*(.+)$/);
    if (kvMatch && kvMatch[1] && kvMatch[2]) {
      const key = kvMatch[1].trim().toLowerCase();
      const val = kvMatch[2].trim();

      if (key === 'name') {
        name = val;
        matchedFields += 1;
        return;
      }
      if (key === 'source') {
        source = val;
        matchedFields += 1;
        return;
      }
      if (key === 'casting time') {
        castingTime = val;
        matchedFields += 1;
        return;
      }
      if (key === 'range') {
        range = val;
        matchedFields += 1;
        return;
      }
      if (key === 'components') {
        components = val;
        matchedFields += 1;
        return;
      }
      if (key === 'duration') {
        duration = val;
        if (/^concentration/i.test(val)) concentration = true;
        matchedFields += 1;
        return;
      }
      if (key === 'classes' || key === 'class') {
        classes = val.split(/[,/]/).map((c) => c.trim()).filter(Boolean);
        matchedFields += 1;
        return;
      }
      if (key === 'damage' && /\d+d\d+/i.test(val)) {
        const dm = val.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*([a-z]+)?/i);
        weaponDamage = dm?.[1]?.replace(/\s+/g, ' ');
        weaponDamageType = dm?.[2]?.toLowerCase();
        if (category === 'feature') category = 'weapon';
        matchedFields += 1;
        return;
      }
      if (key === 'type' || key === 'category') {
        explicitCategory = true;
        const lowerVal = val.toLowerCase();
        if (lowerVal.includes('weapon')) category = 'weapon';
        else if (lowerVal.includes('armor')) category = 'armor';
        else if (lowerVal.includes('shield')) category = 'shield';
        else if (lowerVal.includes('spell')) category = 'spell';
        else if (lowerVal.includes('feat')) category = 'feat';
        else if (lowerVal.includes('infusion')) category = 'infusion';
        else if (lowerVal.includes('monster')) category = 'monster';
        matchedFields += 1;
        return;
      }
      if (key === 'ac' || key === 'armor class') {
        const signedMatch = val.match(/^([+-]\d+)/);
        const absAcMatch = val.match(/^(\d+)/);
        if (signedMatch && signedMatch[1]) {
          acFlatBonus = Number.parseInt(signedMatch[1], 10);
          matchedFields += 1;
        } else if (absAcMatch && absAcMatch[1] && explicitCategory && category === 'armor') {
          armorBase = Number.parseInt(absAcMatch[1], 10);
          armorDexCap = /\+\s*dex[^()]*\(max\s*(\d)\)/i.test(val) ? Number.parseInt(val.match(/max\s*(\d)/i)![1]!, 10) : /dex/i.test(val) ? null : 0;
          matchedFields += 1;
        } else if (absAcMatch && absAcMatch[1]) {
          monsterAc = Number.parseInt(absAcMatch[1], 10);
          category = 'monster';
          matchedFields += 1;
        } else {
          warnings.push({
            line: lineNum,
            raw: trimmed,
            reason: 'Could not extract numeric AC value; skipped AC field.',
          });
        }
        return;
      }
      if (key === 'hp' || key === 'hit points') {
        const hpMatch = val.match(/^(\d+)/);
        if (hpMatch && hpMatch[1]) {
          monsterHp = Number.parseInt(hpMatch[1], 10);
          category = 'monster';
          matchedFields += 1;
        }
        return;
      }
      if (key === 'challenge' || key === 'cr') {
        monsterCr = val;
        category = 'monster';
        matchedFields += 1;
        return;
      }
      if (key === 'concentration') {
        concentration = val.toLowerCase().startsWith('y') || val.toLowerCase() === 'true';
        matchedFields += 1;
        return;
      }
      if (key === 'level' || key === 'spell level') {
        const lvl = Number.parseInt(val, 10);
        if (!Number.isNaN(lvl)) {
          spellLevel = lvl;
          category = 'spell';
          matchedFields += 1;
        }
        return;
      }
    }

    const attackMatch = trimmed.match(/([+-]\d+)\s+to\s+hit/i);
    const damageMatch = trimmed.match(/(\d+d\d+(?:\s*[+-]\s*(?:\d+|@[a-z]+))?)\s+([a-z]+)\s+damage/i);

    if (attackMatch || damageMatch) {
      const actionLabelMatch = trimmed.match(/^\*{0,2}([^.:*]+)\*{0,2}\./);
      const actionName = actionLabelMatch?.[1]?.trim() || `${name} Strike`;
      activities.push({
        id: `act-${lineNum}-${Math.random().toString(36).slice(2, 6)}`,
        name: actionName,
        type: 'attack',
        actionEconomy: detectActionEconomy(trimmed),
        attackBonusFormula: attackMatch?.[1],
        damageFormula: damageMatch?.[1],
        damageType: damageMatch?.[2]?.toLowerCase(),
        description: trimmed,
      });
      matchedFields += 1;
    }

    entries.push(trimmed);
  });

  const fullText = entries.join(' ');
  const spellSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (category === 'spell') {
    // a rollable activity from the spell text: save, spell attack, healing or plain damage, plus the slot it costs
    activities.length = 0;
    const dmg = fullText.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([a-z]+)\s+damage/i);
    const heals = /\bregains?\b[^.]*\bhit points\b/i.test(fullText);
    const healDice = heals ? fullText.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/) : null;
    const save = fullText.match(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw/i);
    const isAttack = /\b(ranged|melee)\s+spell\s+attack\b/i.test(fullText);
    const level = spellLevel ?? 0;
    const abilityKey = save?.[1] ? (save[1].slice(0, 3).toLowerCase() as 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha') : undefined;
    const formula = (heals ? healDice?.[1] : dmg?.[1])?.replace(/\s+/g, '');
    activities.push({
      id: `act-spell-${spellSlug}`,
      name,
      type: heals ? 'heal' : abilityKey ? 'save' : isAttack ? 'attack' : 'utility',
      actionEconomy: castingTime ? detectActionEconomy(castingTime) : 'action',
      ...(abilityKey ? { saveAbility: abilityKey, saveDcFormula: '8+@prof+@spell' } : {}),
      ...(isAttack ? { attackBonusFormula: '@prof+@spell' } : {}),
      ...(formula ? { damageFormula: formula } : {}),
      ...(!heals && dmg?.[2] ? { damageType: dmg[2].toLowerCase() } : {}),
      ...(level > 0 ? { resourceCost: { poolId: `spell_slot_${level}`, amount: 1 } } : {}),
      description: entries[0] ?? name,
    });
  } else if (category === 'weapon' && weaponDamage) {
    activities.length = 0;
    const ability = /finesse/i.test(fullText) ? 'dex' : 'str';
    activities.push({
      id: `act-wpn-${spellSlug}`,
      name,
      type: 'attack',
      actionEconomy: 'action',
      attackAbility: ability,
      attackBonusFormula: `@${ability} + @prof`,
      damageFormula: `${weaponDamage} + @${ability}`,
      ...(weaponDamageType ? { damageType: weaponDamageType } : {}),
      description: entries[0] ?? name,
    });
  }

  if (activities.length === 0) {
    activities.push({
      id: `act-util-${Math.random().toString(36).slice(2, 6)}`,
      name: `Use ${name}`,
      type: 'utility',
      actionEconomy: detectActionEconomy(normalized),
      description: entries[0] ?? name,
    });
  }

  const monsterMeta: MonsterStatMeta | undefined =
    category === 'monster' || monsterHp !== undefined || monsterAc !== undefined
      ? {
          ac: monsterAc ?? 13,
          hp: monsterHp ?? 22,
          dexModifier: monsterDexMod,
          cr: monsterCr,
        }
      : undefined;

  if (monsterMeta) {
    category = 'monster';
  }

  const confidence: ParseResult<CompendiumEntity>['confidence'] =
    matchedFields >= 3 ? 'high' : matchedFields >= 1 ? 'partial' : 'low';

  return {
    data: {
      id: `hb-${category}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      source,
      ruleset,
      category,
      equipped: category !== 'monster',
      prepared: true,
      concentration,
      spellLevel,
      acFlatBonus,
      ...(armorBase !== undefined ? { acFormula: { base: armorBase, dexCap: armorDexCap } } : {}),
      ...(category === 'spell'
        ? { castingTime, range, components, duration, ritual, ...(classes ? { classes } : {}) }
        : {}),
      monsterMeta,
      activities,
      entries,
    },
    warnings,
    confidence,
  };
}
