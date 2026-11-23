import { CompendiumEntity, ItemCategory } from '../types/compendium';
import { ActionEconomy } from '../types/core';
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
      const entries = flatten5eToolsEntries(rec.entries);
      const economy = category === 'spell' ? map5eToolsCastingTime(rec.time) : 'action';
      const isConc =
        Array.isArray(rec.duration) &&
        rec.duration.some(
          (d) => typeof d === 'object' && d !== null && Boolean((d as { concentration?: unknown }).concentration)
        );

      let monsterMeta: CompendiumEntity['monsterMeta'];
      if (category === 'monster') {
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
        monsterMeta = {
          ac: acVal,
          hp: hpVal,
          dexModifier: computeAbilityModifier(dexScore),
          cr: typeof rec.cr === 'string' ? rec.cr : undefined,
        };
      }

      entities.push({
        id: `5et-${category}-${rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${source.toLowerCase()}`,
        name: rec.name,
        source,
        ruleset: source.startsWith('X') ? '2024' : '2014',
        category,
        equipped: false,
        prepared: true,
        concentration: isConc,
        spellLevel: typeof rec.level === 'number' ? rec.level : undefined,
        acFlatBonus: typeof rec.ac === 'number' && category === 'shield' ? rec.ac : undefined,
        monsterMeta,
        activities: [
          {
            id: `act-${rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: rec.name,
            type: 'utility',
            actionEconomy: economy,
            description: entries[0] ?? rec.name,
          },
        ],
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
