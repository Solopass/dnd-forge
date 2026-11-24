import { CampaignRecord, WorldClockState } from '../types/campaign';
import { CreatureSize } from '../types/compendium';
import { evaluateDiceExpression } from './dice';
import { BUILTIN_CONTENT_PACKS } from './srd-packs';

export const LEVEL_XP_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

export function getXpForNextLevel(currentLevel: number): number | null {
  if (currentLevel >= 20) return null;
  const next = Math.max(2, Math.min(20, Math.floor(currentLevel) + 1));
  return LEVEL_XP_THRESHOLDS[next] ?? null;
}

export function createDefaultCampaign(
  id = 'camp-default-01',
  name = 'The Shattered Crown'
): CampaignRecord {
  const now = new Date().toISOString();
  return {
    id,
    name,
    setting: 'Sword Coast & Borderlands',
    clock: {
      day: 1,
      hour: 8,
      minute: 0,
      calendarName: 'Harptos',
      weather: 'Clear Skies',
      activeTimers: [],
    },
    partyXpTotal: 0,
    partyLootGp: 120,
    partyLootItems: ['Map of Phandalin Ruins', 'Silvered Signet Ring'],
    createdAt: now,
    entries: [
      {
        id: 'entry-session-1',
        category: 'session',
        title: 'Session 1 — Road to Oakhaven',
        summary: 'Met patron Gundren at the tavern and cleared a goblin ambush.',
        body: 'The party escorted the supply wagon south along the High Road. Discovered a black seal stamped on the ambushers’ arrows.',
        tags: ['intro', 'ambush'],
        status: 'completed',
        pinned: true,
        updatedAt: now,
      },
      {
        id: 'entry-npc-1',
        category: 'npc',
        title: 'Sister Linene Vael',
        summary: 'Temple curator and local quest giver in Oakhaven.',
        body: 'Friendly cleric of light. Pays 150 GP for recovering stolen temple relics from the sunken vault.',
        tags: ['ally', 'oakhaven'],
        status: 'active',
        updatedAt: now,
      },
      {
        id: 'entry-loc-1',
        category: 'location',
        title: 'Sunken Vault of Thornwatch',
        summary: 'Flooded keep two days east of Oakhaven.',
        body: 'Guarded by skeletons and a gelatinous cube in the lower cistern. Secret door behind the altar (DC 15 Investigation).',
        tags: ['dungeon', 'tier-1'],
        status: 'active',
        updatedAt: now,
      },
      {
        id: 'entry-quest-1',
        category: 'quest',
        title: 'Recover the Sun Chalice',
        summary: 'Retrieve the relic before the next full moon.',
        body: 'Reward: 250 GP + Potion of Greater Healing.',
        tags: ['main-quest'],
        status: 'active',
        pinned: true,
        updatedAt: now,
      },
    ],
  };
}

export function formatWorldClock(clock: WorldClockState): string {
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  return `Day ${clock.day} • ${hh}:${mm}`;
}

export function advanceWorldClock(
  clock: WorldClockState,
  deltaMinutes: number
): { clock: WorldClockState; expiredTimers: string[] } {
  const safeDelta = Math.max(0, Math.round(deltaMinutes));
  const totalMinutes = clock.hour * 60 + clock.minute + safeDelta;
  const daysAdded = Math.floor(totalMinutes / 1440);
  const remDayMinutes = totalMinutes % 1440;
  const nextHour = Math.floor(remDayMinutes / 60);
  const nextMinute = remDayMinutes % 60;

  const expiredTimers: string[] = [];
  const nextTimers = clock.activeTimers
    .map((t) => ({ ...t, remainingMinutes: t.remainingMinutes - safeDelta }))
    .filter((t) => {
      if (t.remainingMinutes <= 0) {
        expiredTimers.push(t.label);
        return false;
      }
      return true;
    });

  return {
    clock: {
      ...clock,
      day: clock.day + daysAdded,
      hour: nextHour,
      minute: nextMinute,
      activeTimers: nextTimers,
    },
    expiredTimers,
  };
}

export type TreasureTier = '0-4' | '5-10' | '11-16' | '17+';

export interface TreasureRollResult {
  tier: TreasureTier;
  mode: 'individual' | 'hoard';
  coins: { cp: number; sp: number; ep: number; gp: number; pp: number };
  totalGpValue: number;
  valuables: string[];
  magicItems: string[];
}

const ART_BY_TIER: Record<TreasureTier, string[]> = {
  '0-4': ['10 gp Azurite Gem', '25 gp Carved Bone Statuette', '50 gp Silver Ewer'],
  '5-10': ['100 gp Pearl', '250 gp Gold Music Box', '250 gp Velvet Mantle Stitched with Silver'],
  '11-16': ['500 gp Black Pearl', '750 gp Jeweled Gold Crown', '1,000 gp Opal Gem'],
  '17+': ['2,500 gp Platinum Dragon Necklace', '5,000 gp Diamond Ring', '7,500 gp Jeweled Imperial Scepter'],
};

export function rollTreasure(tier: TreasureTier, mode: 'individual' | 'hoard'): TreasureRollResult {
  const coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const valuables: string[] = [];
  const magicItems: string[] = [];

  if (mode === 'individual') {
    if (tier === '0-4') {
      coins.sp = evaluateDiceExpression('4d6', 'normal').total;
      coins.gp = evaluateDiceExpression('2d6', 'normal').total;
    } else if (tier === '5-10') {
      coins.ep = evaluateDiceExpression('3d6', 'normal').total * 10;
      coins.gp = evaluateDiceExpression('4d6', 'normal').total * 10;
    } else if (tier === '11-16') {
      coins.gp = evaluateDiceExpression('2d6', 'normal').total * 100;
      coins.pp = evaluateDiceExpression('2d6', 'normal').total * 10;
    } else {
      coins.gp = evaluateDiceExpression('2d6', 'normal').total * 500;
      coins.pp = evaluateDiceExpression('2d6', 'normal').total * 100;
    }
  } else {
    if (tier === '0-4') {
      coins.cp = evaluateDiceExpression('6d6', 'normal').total * 100;
      coins.sp = evaluateDiceExpression('3d6', 'normal').total * 100;
      coins.gp = evaluateDiceExpression('2d6', 'normal').total * 10;
    } else if (tier === '5-10') {
      coins.cp = evaluateDiceExpression('2d6', 'normal').total * 100;
      coins.sp = evaluateDiceExpression('2d6', 'normal').total * 1000;
      coins.gp = evaluateDiceExpression('6d6', 'normal').total * 100;
      coins.pp = evaluateDiceExpression('3d6', 'normal').total * 10;
    } else if (tier === '11-16') {
      coins.gp = evaluateDiceExpression('4d6', 'normal').total * 1000;
      coins.pp = evaluateDiceExpression('5d6', 'normal').total * 100;
    } else {
      coins.gp = evaluateDiceExpression('12d6', 'normal').total * 1000;
      coins.pp = evaluateDiceExpression('8d6', 'normal').total * 1000;
    }

    const artPool = ART_BY_TIER[tier];
    const artCount = tier === '0-4' ? 1 : 2;
    for (let i = 0; i < artCount; i++) {
      const pick = artPool[Math.floor(Math.random() * artPool.length)];
      if (pick) valuables.push(pick);
    }

    const magicPack = BUILTIN_CONTENT_PACKS.find((p) => p.id === 'pack-srd-magic-items')?.entities ?? [];
    if (magicPack.length > 0) {
      const magicCount = tier === '0-4' ? 1 : tier === '5-10' ? 2 : 3;
      for (let i = 0; i < magicCount; i++) {
        const chosen = magicPack[Math.floor(Math.random() * magicPack.length)];
        if (chosen) magicItems.push(chosen.name);
      }
    }
  }

  const totalGpValue = Number(
    (coins.pp * 10 + coins.gp + coins.ep * 0.5 + coins.sp * 0.1 + coins.cp * 0.01).toFixed(2)
  );
  return { tier, mode, coins, totalGpValue, valuables, magicItems };
}

export interface ShopItem {
  id: string;
  entityId?: string;
  name: string;
  category: string;
  rarity: 'Common' | 'Uncommon' | 'Rare';
  priceGp: number;
  notes: string;
}

const CATALOG_ITEMS: Array<ShopItem & { minTier: 'village' | 'town' | 'city' }> = [
  { id: 'shop-dagger', entityId: 'srd-wpn-dagger', name: 'Dagger', category: 'Weapon', rarity: 'Common', priceGp: 2, notes: 'Finesse, Light, Thrown (20/60)', minTier: 'village' },
  { id: 'shop-shortbow', entityId: 'srd-wpn-shortbow', name: 'Shortbow', category: 'Weapon', rarity: 'Common', priceGp: 25, notes: 'Ammunition (80/320)', minTier: 'village' },
  { id: 'shop-longsword', entityId: 'srd-wpn-longsword', name: 'Longsword', category: 'Weapon', rarity: 'Common', priceGp: 15, notes: 'Versatile (1d10)', minTier: 'village' },
  { id: 'shop-leather', entityId: 'srd-arm-leather', name: 'Leather Armor', category: 'Armor', rarity: 'Common', priceGp: 10, notes: 'AC 11 + DEX', minTier: 'village' },
  { id: 'shop-shield', entityId: 'srd-arm-shield', name: 'Shield (+2 AC)', category: 'Shield', rarity: 'Common', priceGp: 10, notes: '+2 AC while wielded', minTier: 'village' },
  { id: 'shop-healing', entityId: 'srd-item-potion-healing', name: 'Potion of Healing', category: 'Potion', rarity: 'Common', priceGp: 50, notes: 'Restore 2d4 + 2 HP', minTier: 'village' },
  { id: 'shop-studded', entityId: 'srd-arm-studded-leather', name: 'Studded Leather Armor', category: 'Armor', rarity: 'Common', priceGp: 45, notes: 'AC 12 + DEX', minTier: 'town' },
  { id: 'shop-chainmail', entityId: 'srd-arm-chain-mail', name: 'Chain Mail', category: 'Armor', rarity: 'Common', priceGp: 75, notes: 'Heavy AC 16', minTier: 'town' },
  { id: 'shop-breastplate', entityId: 'srd-arm-breastplate', name: 'Breastplate', category: 'Armor', rarity: 'Common', priceGp: 400, notes: 'Medium AC 14 + DEX (max 2)', minTier: 'town' },
  { id: 'shop-greater-heal', entityId: 'srd-item-potion-greater-healing', name: 'Potion of Greater Healing', category: 'Potion', rarity: 'Uncommon', priceGp: 150, notes: 'Restore 4d4 + 4 HP', minTier: 'town' },
  { id: 'shop-bag', entityId: 'srd-item-bag-of-holding', name: 'Bag of Holding', category: 'Wondrous', rarity: 'Uncommon', priceGp: 400, notes: 'Holds 500 lb interior', minTier: 'town' },
  { id: 'shop-cloak-prot', entityId: 'srd-item-cloak-of-protection', name: 'Cloak of Protection', category: 'Wondrous', rarity: 'Uncommon', priceGp: 600, notes: '+1 AC & Saving Throws (Attunement)', minTier: 'city' },
  { id: 'shop-plus1-sword', entityId: 'srd-item-plus1-longsword', name: '+1 Longsword', category: 'Magic Weapon', rarity: 'Uncommon', priceGp: 500, notes: '+1 attack & damage rolls', minTier: 'city' },
  { id: 'shop-plus1-bow', entityId: 'srd-item-plus1-longbow', name: '+1 Longbow', category: 'Magic Weapon', rarity: 'Uncommon', priceGp: 500, notes: '+1 attack & damage rolls', minTier: 'city' },
  { id: 'shop-wand-mm', entityId: 'srd-item-wand-magic-missiles', name: 'Wand of Magic Missiles', category: 'Wand', rarity: 'Uncommon', priceGp: 650, notes: '7 charges; 3d4 + 3 force', minTier: 'city' },
  { id: 'shop-plate', entityId: 'srd-arm-plate', name: 'Plate Armor', category: 'Armor', rarity: 'Common', priceGp: 1500, notes: 'Heavy AC 18 (STR 15)', minTier: 'city' },
  { id: 'shop-bracers', entityId: 'srd-item-bracers-of-defense', name: 'Bracers of Defense', category: 'Wondrous', rarity: 'Rare', priceGp: 2200, notes: '+2 AC unarmored/no shield', minTier: 'city' },
  { id: 'shop-ring-prot', entityId: 'srd-item-ring-of-protection', name: 'Ring of Protection', category: 'Ring', rarity: 'Rare', priceGp: 2000, notes: '+1 AC & Saving Throws', minTier: 'city' },
  { id: 'shop-flametongue', entityId: 'srd-item-flame-tongue', name: 'Flame Tongue Greatsword', category: 'Magic Weapon', rarity: 'Rare', priceGp: 3500, notes: '+2d6 fire damage ablaze', minTier: 'city' },
];

export function generateShopInventory(tier: 'village' | 'town' | 'city'): ShopItem[] {
  const rank = tier === 'village' ? 1 : tier === 'town' ? 2 : 3;
  return CATALOG_ITEMS.filter((item) => {
    const req = item.minTier === 'village' ? 1 : item.minTier === 'town' ? 2 : 3;
    return req <= rank;
  });
}

export interface DmScreenRow {
  topic: string;
  rule: string;
  detail: string;
  diceExpr?: string;
}

export interface DmScreenSection {
  id: string;
  title: string;
  caption: string;
  headers: [string, string, string];
  rows: DmScreenRow[];
}

export const DM_SCREEN_SECTIONS: DmScreenSection[] = [
  {
    id: 'dm-cover-light',
    title: 'Cover, Light & Obscurement',
    caption: 'SRD tactical modifiers for cover and lighting',
    headers: ['Condition / Cover', 'Mechanical Effect', 'Notes'],
    rows: [
      { topic: 'Half Cover', rule: '+2 AC & +2 DEX Saves', detail: 'Low wall, furniture, or another creature in the way.' },
      { topic: 'Three-Quarters Cover', rule: '+5 AC & +5 DEX Saves', detail: 'Portcullis, arrow slit, or thick tree trunk.' },
      { topic: 'Total Cover', rule: 'Cannot be targeted directly', detail: 'Completely concealed by an obstacle.' },
      { topic: 'Dim Light / Lightly Obscured', rule: 'Disadvantage on Perception (sight)', detail: 'Shadows, patchy fog, twilight, dense foliage.' },
      { topic: 'Darkness / Heavily Obscured', rule: 'Effectively Blinded (sight)', detail: 'Opaque darkness, thick fog, heavy smoke.' },
    ],
  },
  {
    id: 'dm-dcs-social',
    title: 'Typical Difficulty Classes & Social Reactions',
    caption: 'Standard 5e DCs and NPC starting attitude thresholds',
    headers: ['Difficulty / Attitude', 'Target DC', 'Guideline'],
    rows: [
      { topic: 'Very Easy / Friendly Aid', rule: 'DC 5 / DC 10', detail: 'Routine task or Friendly NPC accepting minor risk.' },
      { topic: 'Easy / Indifferent Info', rule: 'DC 10', detail: 'Indifferent NPC offering help with no personal risk.' },
      { topic: 'Medium / Hostile Restraint', rule: 'DC 15', detail: 'Trained challenge; Hostile NPC refraining from harm.' },
      { topic: 'Hard / Indifferent Sacrifice', rule: 'DC 20', detail: 'Major sacrifice by Friendly NPC or Hostile aid.' },
      { topic: 'Very Hard / Nearly Impossible', rule: 'DC 25 / DC 30', detail: 'Heroic feat; legendary skill check.' },
    ],
  },
  {
    id: 'dm-travel-pace',
    title: 'Travel Pace & Vision',
    caption: 'Overland travel speed by minute, hour, and 8-hour day',
    headers: ['Pace', 'Distance / Hour & Day', 'Perception & Stealth'],
    rows: [
      { topic: 'Fast', rule: '4 mi/hr • 30 mi/day', detail: '-5 penalty to Passive Perception; Stealth impossible.' },
      { topic: 'Normal', rule: '3 mi/hr • 24 mi/day', detail: 'Standard Passive Perception; Stealth only in cover.' },
      { topic: 'Slow', rule: '2 mi/hr • 18 mi/day', detail: 'Able to use Stealth while traveling overland.' },
    ],
  },
  {
    id: 'dm-objects',
    title: 'Object Armor Class & Hit Points',
    caption: 'Quick AC and HP by material and size',
    headers: ['Material / Size', 'Armor Class / Base HP', 'Notes'],
    rows: [
      { topic: 'Cloth / Paper / Rope', rule: 'AC 11', detail: 'Fragile: Tiny 2 (1d4), Medium 4 (1d8), Large 5 (1d10).' },
      { topic: 'Wood / Bone', rule: 'AC 15', detail: 'Resilient: Tiny 5 (2d4), Small 10 (3d6), Medium 18 (4d8), Large 27 (5d10).' },
      { topic: 'Stone', rule: 'AC 17', detail: 'Damage Threshold 10–15 for fortress walls.' },
      { topic: 'Iron / Steel / Mithral', rule: 'AC 19 / AC 21', detail: 'Doors/locks typical DC 15–20 to pick or force.' },
    ],
  },
  {
    id: 'dm-improvised-dmg',
    title: 'Improvised Damage by Level Tier',
    caption: 'Rollable improvised trap, hazard, and falling damage dice',
    headers: ['Severity / Hazard', 'Dice Pool', 'Typical Examples'],
    rows: [
      { topic: 'Setback (Lv 1–4)', rule: '1d10 / 2d10', detail: 'Burned by coals, tumbled down rubble, stumbling trap.', diceExpr: '2d10' },
      { topic: 'Dangerous (Lv 5–10)', rule: '4d10', detail: 'Struck by collapsing ceiling, falling into acid pit.', diceExpr: '4d10' },
      { topic: 'Deadly (Lv 11–16)', rule: '10d10', detail: 'Crushed by fortress gate, waded through lava stream.', diceExpr: '10d10' },
      { topic: 'Catastrophic (Lv 17–20)', rule: '18d10 / 24d10', detail: 'Submerged in lava, crushed by flying citadel.', diceExpr: '18d10' },
    ],
  },
];

export function getQualitativeHealthLabel(
  current: number,
  max: number
): 'Down' | 'Critical' | 'Bloodied' | 'Wounded' | 'Healthy' {
  if (current <= 0) return 'Down';
  const ratio = max > 0 ? current / max : 0;
  if (ratio <= 0.25) return 'Critical';
  if (ratio <= 0.5) return 'Bloodied';
  if (ratio <= 0.75) return 'Wounded';
  return 'Healthy';
}

export function sizeToGridCells(size?: CreatureSize): number {
  if (size === 'large') return 2;
  if (size === 'huge') return 3;
  if (size === 'gargantuan') return 4;
  return 1;
}

export function exportCampaignToMarkdown(campaign: CampaignRecord): string {
  const lines: string[] = [
    `# ${campaign.name}`,
    '',
    `- **Setting:** ${campaign.setting}`,
    `- **World Clock:** ${formatWorldClock(campaign.clock)} (${campaign.clock.weather})`,
    `- **Party XP Total:** ${campaign.partyXpTotal.toLocaleString()} XP`,
    `- **Party Stash:** ${campaign.partyLootGp} GP`,
    '',
  ];

  if (campaign.partyLootItems.length > 0) {
    lines.push('## Party Loot Items', '');
    for (const item of campaign.partyLootItems) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  const order: Array<{ key: CampaignRecord['entries'][number]['category']; heading: string }> = [
    { key: 'session', heading: 'Session Recaps' },
    { key: 'quest', heading: 'Quests' },
    { key: 'npc', heading: 'NPCs' },
    { key: 'location', heading: 'Locations' },
    { key: 'faction', heading: 'Factions' },
    { key: 'handout', heading: 'Handouts' },
  ];

  for (const sec of order) {
    const group = campaign.entries.filter((e) => e.category === sec.key);
    if (group.length === 0) continue;
    lines.push(`## ${sec.heading}`, '');
    for (const entry of group) {
      lines.push(`### ${entry.title} (${entry.status})`, '');
      if (entry.summary) lines.push(`*${entry.summary}*`, '');
      if (entry.body) lines.push(entry.body, '');
    }
  }

  return lines.join('\n');
}
