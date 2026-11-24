import { Activity, CompendiumEntity, ItemCategory } from '../types/compendium';
import { AbilityKey, ActionEconomy } from '../types/core';
import { computeAbilityModifier } from './rules-math';

function flatten5eToolsEntries(rawEntries: unknown): string[] {
  if (!Array.isArray(rawEntries)) return [];
  const result: string[] = [];

  for (const item of rawEntries) {
    if (typeof item === 'string') {
      result.push(item);
    } else if (typeof item === 'object' && item !== null) {
      const obj = item as { name?: unknown; entries?: unknown };
      if (typeof obj.name === 'string') {
        const nested = flatten5eToolsEntries(obj.entries).join(' ');
        result.push(`${obj.name}: ${nested}`.trim());
      } else if (Array.isArray(obj.entries)) {
        result.push(...flatten5eToolsEntries(obj.entries));
      }
    }
  }
  return result;
}

function map5eToolsCastingTime(timeArr: unknown): ActionEconomy {
  if (!Array.isArray(timeArr) || timeArr.length === 0) return 'action';
  const first = timeArr[0] as { unit?: unknown };
  const unit = typeof first?.unit === 'string' ? first.unit.toLowerCase() : '';
  if (unit === 'bonus') return 'bonus_action';
  if (unit === 'reaction') return 'reaction';
  if (unit === 'free') return 'free';
  return 'action';
}

function parseMonsterActions(rawActions: unknown, mobSlug: string): Activity[] {
  if (!Array.isArray(rawActions)) return [];
  const parsed: Activity[] = [];

  rawActions.forEach((rawAct, idx) => {
    if (typeof rawAct !== 'object' || rawAct === null) return;
    const act = rawAct as { name?: unknown; entries?: unknown };
    if (typeof act.name !== 'string') return;

    const text = flatten5eToolsEntries(act.entries).join(' ');
    const hitMatch = text.match(/\{@hit\s+([+-]?\d+)\}/i);
    const dmgMatch = text.match(/\{@damage\s+([^}|]+)(?:\|[^}]*)?\}/i);
    const dcMatch = text.match(/\{@dc\s+(\d+)\}/i);

    const attackBonusFormula = hitMatch?.[1]
      ? hitMatch[1].startsWith('+') || hitMatch[1].startsWith('-')
        ? hitMatch[1]
        : `+${hitMatch[1]}`
      : undefined;
    const damageFormula = dmgMatch?.[1]?.trim();

    parsed.push({
      id: `5et-act-${mobSlug}-${idx}`,
      name: act.name,
      type: attackBonusFormula ? 'attack' : dcMatch?.[1] ? 'save' : 'utility',
      actionEconomy: 'action',
      attackBonusFormula,
      saveDcFormula: dcMatch?.[1],
      damageFormula,
      description: text || act.name,
    });
  });

  return parsed;
}

function classify5eToolsItem(
  rec: Record<string, unknown>,
  fallbackCategory: ItemCategory,
  entries: string[],
  slug: string
): {
  category: ItemCategory;
  acFormula?: CompendiumEntity['acFormula'];
  acFlatBonus?: number;
  activities: Activity[];
} {
  const itemType = typeof rec.type === 'string' ? rec.type.toUpperCase() : '';
  const propList = Array.isArray(rec.property) ? rec.property.map((p) => String(p).toUpperCase()) : [];

  if (itemType === 'M' || itemType === 'R') {
    const ability: AbilityKey = propList.includes('F') || itemType === 'R' ? 'dex' : 'str';
    const dmg = typeof rec.dmg1 === 'string' ? rec.dmg1 : '1d6';
    return {
      category: 'weapon',
      activities: [
        {
          id: `5et-wpn-${slug}`,
          name: String(rec.name),
          type: 'attack',
          actionEconomy: 'action',
          attackAbility: ability,
          attackBonusFormula: `@${ability} + @prof`,
          damageFormula: `${dmg} + @${ability}`,
          description: entries[0] ?? String(rec.name),
        },
      ],
    };
  }

  if (itemType === 'LA' || itemType === 'MA' || itemType === 'HA') {
    const base = typeof rec.ac === 'number' ? rec.ac : itemType === 'LA' ? 11 : itemType === 'MA' ? 13 : 16;
    const dexCap = itemType === 'LA' ? null : itemType === 'MA' ? 2 : 0;
    return {
      category: 'armor',
      acFormula: { base, dexCap },
      activities: [],
    };
  }

  if (itemType === 'S') {
    return {
      category: 'shield',
      acFlatBonus: typeof rec.ac === 'number' ? rec.ac : 2,
      activities: [],
    };
  }

  return {
    category: fallbackCategory,
    activities: [
      {
        id: `act-${slug}`,
        name: String(rec.name),
        type: 'utility',
        actionEconomy: 'action',
        description: entries[0] ?? String(rec.name),
      },
    ],
  };
}

export function adapt5eToolsPayload(rawJson: unknown): {
  entities: CompendiumEntity[];
  skipped: number;
} {
  if (typeof rawJson !== 'object' || rawJson === null) {
    return { entities: [], skipped: 1 };
  }

  const root = rawJson as Record<string, unknown>;
  const entities: CompendiumEntity[] = [];
  let skipped = 0;

  const ingestList = (list: unknown, category: ItemCategory) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) {
        skipped += 1;
        continue;
      }
      const rec = raw as Record<string, unknown>;
      if (typeof rec.name !== 'string') {
        skipped += 1;
        continue;
      }

      const source = typeof rec.source === 'string' ? rec.source : '5e.tools';
      const slug = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const entries = flatten5eToolsEntries(rec.entries);
      const economy = category === 'spell' ? map5eToolsCastingTime(rec.time) : 'action';
      const isConc =
        Array.isArray(rec.duration) &&
        rec.duration.some(
          (d) => typeof d === 'object' && d !== null && Boolean((d as { concentration?: unknown }).concentration)
        );

      let resolvedCategory: ItemCategory = category;
      let acFormula: CompendiumEntity['acFormula'];
      let acFlatBonus: number | undefined;
      let activities: Activity[] = [
        {
          id: `act-${slug}`,
          name: rec.name,
          type: 'utility',
          actionEconomy: economy,
          description: entries[0] ?? rec.name,
        },
      ];
      let monsterMeta: CompendiumEntity['monsterMeta'];

      if (category === 'gear') {
        const classified = classify5eToolsItem(rec, category, entries, slug);
        resolvedCategory = classified.category;
        acFormula = classified.acFormula;
        acFlatBonus = classified.acFlatBonus;
        activities = classified.activities;
      } else if (category === 'monster') {
        const acRaw = Array.isArray(rec.ac) ? rec.ac[0] : rec.ac;
        const acVal =
          typeof acRaw === 'number'
            ? acRaw
            : typeof acRaw === 'object' && acRaw !== null && typeof (acRaw as { ac?: unknown }).ac === 'number'
            ? (acRaw as { ac: number }).ac
            : 12;
        const hpObj = rec.hp as { average?: unknown } | undefined;
        const hpVal = typeof hpObj?.average === 'number' ? hpObj.average : 20;
        const dexScore = typeof rec.dex === 'number' ? rec.dex : 10;
        const crVal =
          typeof rec.cr === 'string'
            ? rec.cr
            : typeof rec.cr === 'object' && rec.cr !== null && typeof (rec.cr as { cr?: unknown }).cr === 'string'
            ? (rec.cr as { cr: string }).cr
            : undefined;
        monsterMeta = {
          ac: acVal,
          hp: hpVal,
          dexModifier: computeAbilityModifier(dexScore),
          cr: crVal,
        };
        const parsedActions = parseMonsterActions(rec.action, slug);
        if (parsedActions.length > 0) {
          activities = parsedActions;
        }
      }

      entities.push({
        id: `5et-${resolvedCategory}-${slug}-${source.toLowerCase()}`,
        name: rec.name,
        source,
        ruleset: source.startsWith('X') ? '2024' : '2014',
        category: resolvedCategory,
        equipped: false,
        prepared: true,
        concentration: isConc,
        spellLevel: typeof rec.level === 'number' ? rec.level : undefined,
        weight: typeof rec.weight === 'number' ? rec.weight : undefined,
        acFormula,
        acFlatBonus,
        monsterMeta,
        activities,
        entries,
      });
    }
  };

  ingestList(root.spell, 'spell');
  ingestList(root.item, 'gear');
  ingestList(root.feat, 'feat');
  ingestList(root.monster, 'monster');

  return { entities, skipped };
}
