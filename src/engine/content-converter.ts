import { normalizeEntries } from './entries';
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
