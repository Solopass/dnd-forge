import { normalizeEntries } from './entries';
import { parseHomebrewMarkdownBlock } from './statblock-parser';
import { Activity, CompendiumEntity, CreatureSize, ItemCategory } from '../types/compendium';
import { AbilityKey, Ruleset } from '../types/core';

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

function extractComponentsString(rawComp: unknown, rawMaterial?: unknown): string | undefined {
  if (typeof rawComp === 'string') {
    if (typeof rawMaterial === 'string' && rawMaterial.trim() && !rawComp.includes('(')) {
      return `${rawComp} (${rawMaterial.trim()})`;
    }
    return rawComp;
  }
  if (Array.isArray(rawComp)) {
    const parts = rawComp.map((c) => String(c).trim()).filter(Boolean);
    if (typeof rawMaterial === 'string' && rawMaterial.trim()) {
      const mIdx = parts.findIndex((p) => p.toUpperCase() === 'M');
      if (mIdx >= 0) parts[mIdx] = `M (${rawMaterial.trim()})`;
    }
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
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

function asCommaOrArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((v) => String(v).trim()).filter(Boolean);
  if (typeof val === 'string' && val.trim()) {
    return val.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function formatObjectMap(val: unknown): string | undefined {
  if (typeof val === 'string') return val.trim() || undefined;
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const parts = Object.entries(val as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' ? `${v} ft.` : String(v)}`);
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
        : typeof raw.level_int === 'number'
          ? raw.level_int
          : typeof raw.level === 'number'
            ? raw.level
            : 0;
    const srdDc = (raw.dc as Record<string, unknown> | undefined)?.dc_type as Record<string, unknown> | undefined;
    const saves = asStringArray(raw.savingThrow ?? srdDc?.index ?? srdDc?.name);
    const srdDamage = raw.damage as Record<string, unknown> | undefined;
    const slotDmgMap = (srdDamage?.damage_at_slot_level ?? srdDamage?.damage_at_character_level) as
      | Record<string, string>
      | undefined;
    const firstSlotDmg = slotDmgMap ? Object.values(slotDmgMap)[0] : undefined;
    const dmgMatch =
      firstSlotDmg
        ? [firstSlotDmg, firstSlotDmg]
        : joined.match(/\{@damage\s+([^}|]+)/i) ?? joined.match(/(\d+d\d+(?:\s*[+-]\s*\d+)?)/);
    const srdDmgType = (srdDamage?.damage_type as Record<string, unknown> | undefined)?.name;
    const dmgTypes = asStringArray(raw.damageInflict ?? srdDmgType);
    const saveAb = (saves[0]?.slice(0, 3).toLowerCase() ?? '') as AbilityKey;
    const isAttack =
      (Array.isArray(raw.spellAttack) && raw.spellAttack.length > 0) ||
      typeof raw.attack_type === 'string';
    const isHeal =
      Boolean(raw.heal_at_slot_level) ||
      (dmgTypes.length === 0 && /regain|heal|hit points/i.test(joined) && Boolean(dmgMatch));

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
        damageType: dmgTypes[0]?.toLowerCase(),
        resourceCost: level > 0 ? { poolId: `spell_slot_${level}`, amount: 1 } : undefined,
        description: entries[0],
      },
    ];
  }

  if (category === 'weapon') {
    const srdDmg = raw.damage as Record<string, unknown> | undefined;
    const dmg =
      typeof raw.dmg1 === 'string'
        ? raw.dmg1
        : typeof srdDmg?.damage_dice === 'string'
          ? srdDmg.damage_dice
          : typeof raw.damage_dice === 'string'
            ? raw.damage_dice
            : '1d8';
    const srdProps = Array.isArray(raw.properties)
      ? raw.properties.map((p) => String((p as Record<string, unknown>)?.index ?? p).toLowerCase())
      : [];
    const isFinesse =
      (Array.isArray(raw.property) && raw.property.includes('F')) || srdProps.includes('finesse');
    const isRanged = raw.type === 'R' || /ranged/i.test(String(raw.weapon_range ?? raw.category_range ?? ''));
    const ab: AbilityKey = isRanged ? 'dex' : isFinesse ? 'dex' : 'str';
    const srdDmgType = (srdDmg?.damage_type as Record<string, unknown> | undefined)?.name;
    return [
      {
        id: `act-${id}`,
        name,
        type: 'attack',
        actionEconomy: 'action',
        attackAbility: ab,
        attackBonusFormula: '@mod+@prof',
        damageFormula: `${dmg}+@mod`,
        damageType:
          typeof raw.dmgType === 'string'
            ? raw.dmgType
            : typeof srdDmgType === 'string'
              ? srdDmgType.toLowerCase()
              : 'slashing',
        description: entries[0],
      },
    ];
  }

  if (category === 'monster' && Array.isArray(raw.actions)) {
    return (raw.actions as Array<Record<string, unknown>>)
      .filter((a) => typeof a?.name === 'string')
      .map((a, idx) => {
        const aName = String(a.name).trim();
        const aDesc = typeof a.desc === 'string' ? a.desc : '';
        const atkBonus = typeof a.attack_bonus === 'number' ? a.attack_bonus : undefined;
        const srdActionDmg = Array.isArray(a.damage) ? (a.damage[0] as Record<string, unknown> | undefined) : undefined;
        const dmgFormula =
          typeof srdActionDmg?.damage_dice === 'string'
            ? srdActionDmg.damage_dice
            : typeof a.damage_dice === 'string'
              ? a.damage_dice
              : undefined;
        const dmgType = (srdActionDmg?.damage_type as Record<string, unknown> | undefined)?.name;
        const dcObj = a.dc as Record<string, unknown> | undefined;
        const dcType = (dcObj?.dc_type as Record<string, unknown> | undefined)?.index;
        const dcVal = typeof dcObj?.dc_value === 'number' ? dcObj.dc_value : undefined;
        return {
          id: `act-${id}-${idx}`,
          name: aName,
          type: atkBonus !== undefined ? 'attack' : dcVal !== undefined ? 'save' : 'utility',
          actionEconomy: 'action',
          attackBonusFormula: atkBonus !== undefined ? String(atkBonus) : undefined,
          saveAbility: typeof dcType === 'string' ? (dcType.slice(0, 3).toLowerCase() as AbilityKey) : undefined,
          saveDcFormula: dcVal !== undefined ? String(dcVal) : undefined,
          damageFormula: dmgFormula,
          damageType: typeof dmgType === 'string' ? dmgType.toLowerCase() : undefined,
          description: aDesc || undefined,
        };
      });
  }

  return [];
}

export function convertRawEntityToSidereroll(
  raw: Record<string, unknown>,
  defaultCategory: ItemCategory,
  ruleset: Ruleset = '2014',
  sourceOverride?: string,
  idPrefix = 'custom'
): CompendiumEntity | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const rawEquipCat = String(
    (raw.equipment_category as Record<string, unknown> | undefined)?.index ?? ''
  ).toLowerCase();
  const inferredCat =
    rawEquipCat === 'weapon'
      ? 'weapon'
      : rawEquipCat === 'armor'
        ? 'armor'
        : defaultCategory;
  const category = (typeof raw.category === 'string' ? raw.category : inferredCat) as ItemCategory;
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
      : `${idPrefix}-${prefix}-${slugify(name)}`;

  const baseEntries = normalizeEntries(raw.entries ?? raw.desc, raw.description);
  const higherEntries = normalizeEntries(raw.higher_level);
  const entries = [
    ...baseEntries,
    ...higherEntries.map((h) => (h.startsWith('At Higher Levels') ? h : `At Higher Levels: ${h}`)),
  ];
  const { duration, concentration } = extractDurationString(raw.duration);
  const rawImg = [raw.imageUrl, raw.image, raw.img, raw.portraitUrl, raw.tokenUrl].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );

  const resolvedSource =
    sourceOverride ??
    (typeof raw.source === 'string' && raw.source.trim()
      ? raw.source
      : typeof raw.document__title === 'string' && raw.document__title.trim()
        ? raw.document__title
        : 'Custom Repo');

  const entity: CompendiumEntity = {
    id,
    name,
    source: resolvedSource,
    ruleset: raw.ruleset === '2024' ? '2024' : ruleset,
    category,
    imageUrl: rawImg?.trim(),
    entries: entries.length > 0 ? entries : [name],
    activities: inferActivitiesFromRaw(raw, id, name, category, entries),
  };

  if (typeof raw.weight === 'number') {
    entity.weight = raw.weight;
  }

  if (category === 'armor' && raw.armor_class && typeof raw.armor_class === 'object') {
    const acObj = raw.armor_class as Record<string, unknown>;
    if (typeof acObj.base === 'number') {
      entity.acFormula = {
        base: acObj.base,
        dexCap: acObj.dex_bonus ? (typeof acObj.max_bonus === 'number' ? acObj.max_bonus : null) : 0,
      };
    }
  }

  if (category === 'spell') {
    const lvl =
      typeof raw.spellLevel === 'number'
        ? raw.spellLevel
        : typeof raw.level_int === 'number'
          ? raw.level_int
          : typeof raw.level === 'number'
            ? raw.level
            : 0;
    entity.spellLevel = lvl;
    entity.castingTime = extractTimeString(raw.castingTime ?? raw.casting_time ?? raw.time);
    entity.range = extractRangeString(raw.range);
    entity.components = extractComponentsString(raw.components, raw.material);
    entity.duration = duration;
    entity.concentration = Boolean(raw.concentration ?? raw.requires_concentration ?? concentration);
    entity.ritual = Boolean(
      raw.ritual ?? raw.requires_ritual ?? (raw.meta as Record<string, unknown> | undefined)?.ritual
    );
  }

  if (category === 'monster') {
    const existingMeta = raw.monsterMeta as Record<string, unknown> | undefined;
    if (existingMeta) {
      entity.monsterMeta = raw.monsterMeta as CompendiumEntity['monsterMeta'];
    } else {
      const acSource = raw.ac ?? raw.armor_class;
      const acRaw = Array.isArray(acSource)
        ? ((acSource[0] as Record<string, unknown>)?.value ??
          (acSource[0] as Record<string, unknown>)?.ac ??
          acSource[0])
        : acSource;
      const hpRaw = (raw.hp as Record<string, unknown> | undefined)?.average ?? raw.hp ?? raw.hit_points;
      const dexScore =
        typeof raw.dex === 'number' ? raw.dex : typeof raw.dexterity === 'number' ? raw.dexterity : 10;
      const sizeRaw = Array.isArray(raw.size)
        ? String(raw.size[0]).toLowerCase()
        : String(raw.size ?? 'medium').toLowerCase();
      const sizeMap: Record<string, CreatureSize> = {
        t: 'tiny',
        s: 'small',
        m: 'medium',
        l: 'large',
        h: 'huge',
        g: 'gargantuan',
      };
      const crSource = raw.cr ?? raw.challenge_rating;
      const crStr =
        typeof crSource === 'number'
          ? String(crSource)
          : typeof crSource === 'string'
            ? crSource
            : typeof (crSource as Record<string, unknown> | undefined)?.cr === 'string'
              ? String((crSource as Record<string, unknown>).cr)
              : '1';
      const traitsList = Array.isArray(raw.special_abilities)
        ? (raw.special_abilities as Array<Record<string, unknown>>)
            .filter((t) => typeof t?.name === 'string')
            .map((t) => `${t.name}: ${String(t.desc ?? '').trim()}`)
        : undefined;

      entity.monsterMeta = {
        ac: typeof acRaw === 'number' ? acRaw : 12,
        hp: typeof hpRaw === 'number' ? hpRaw : 22,
        dexModifier: Math.floor((dexScore - 10) / 2),
        cr: crStr,
        size: (sizeMap[sizeRaw] ??
          (['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].includes(sizeRaw)
            ? sizeRaw
            : 'medium')) as CreatureSize,
        speeds: formatObjectMap(raw.speed),
        resistances: asCommaOrArray(raw.resist ?? raw.damage_resistances),
        immunities: asCommaOrArray(raw.immune ?? raw.damage_immunities),
        vulnerabilities: asCommaOrArray(raw.vulnerable ?? raw.damage_vulnerabilities),
        senses: formatObjectMap(raw.senses),
        traits: traitsList && traitsList.length > 0 ? traitsList : undefined,
      };
    }
  }

  return entity;
}

export function splitMarkdownBlocks(rawText: string): string[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  // Split by horizontal rules (`---`) first if present
  const hrParts = normalized
    .split(/\n-{3,}\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (hrParts.length > 1) return hrParts;

  // Otherwise split on top-level `# ` or `## ` headings when multiple headings exist
  const headingParts = normalized
    .split(/\n(?=#{1,2}\s+[^\n]+)/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (headingParts.length > 1) return headingParts;

  return [normalized];
}

export function convertMarkdownToSidererollList(
  rawText: string,
  defaultCategory: ItemCategory,
  ruleset: Ruleset = '2014',
  sourceOverride?: string
): CompendiumEntity[] {
  const blocks = splitMarkdownBlocks(rawText);
  const out: CompendiumEntity[] = [];
  const seenIds = new Set<string>();

  for (const block of blocks) {
    const parsed = parseHomebrewMarkdownBlock(block, defaultCategory, ruleset);
    const entity = parsed.data;
    if (!entity.name || entity.name === 'Unnamed Homebrew Entry') continue;
    if (sourceOverride) entity.source = sourceOverride;
    entity.ruleset = ruleset;

    let finalId = entity.id;
    let suffix = 2;
    while (seenIds.has(finalId)) {
      finalId = `${entity.id}-${suffix++}`;
    }
    seenIds.add(finalId);
    entity.id = finalId;
    out.push(entity);
  }
  return out;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function convertCsvToSidererollList(
  rawText: string,
  defaultCategory: ItemCategory,
  ruleset: Ruleset = '2014',
  sourceOverride?: string,
  delimiter = ','
): CompendiumEntity[] {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!, delimiter).map((h) => h.trim());
  const out: CompendiumEntity[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = splitCsvLine(lines[i]!, delimiter);
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const val = values[idx];
      if (val !== undefined && val !== '') {
        row[h] = /^\d+$/.test(val) ? Number.parseInt(val, 10) : val;
      }
    });
    const entity = convertRawEntityToSidereroll(row, defaultCategory, ruleset, sourceOverride);
    if (entity) out.push(entity);
  }
  return out;
}
