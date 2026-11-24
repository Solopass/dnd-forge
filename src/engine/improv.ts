import { CampaignEntry } from '../types/campaign';
import { CR_XP_TABLE, evaluateEncounterDifficulty } from './encounter-math';
import { BUILTIN_CONTENT_PACKS } from './srd-packs';

export interface GeneratedEncounter {
  title: string;
  environment: string;
  hook: string;
  difficulty: string;
  adjustedXp: number;
  monsters: Array<{ name: string; cr: string; count: number }>;
}

const NPC_FIRST_NAMES = [
  'Kaelen', 'Lyra', 'Thorek', 'Vaelen', 'Sera', 'Bramwell', 'Nyx', 'Garrick',
  'Elara', 'Dorian', 'Mirella', 'Oakhart', 'Zeph', 'Isolde', 'Tavin', 'Rhea',
];

const NPC_SURNAMES = [
  'Ashvane', 'Ironfoot', 'Vael', 'Blackwood', 'Thorne', 'Caskmaker',
  'Glimmerstone', 'Frostmantle', 'Duskwalker', 'Coppervein', 'Brightshield',
];

const NPC_ANCESTRIES = ['Human', 'Dwarf', 'High Elf', 'Tiefling', 'Halfling', 'Dragonborn', 'Gnome', 'Half-Orc'];
const NPC_ROLES = [
  'Runesmith', 'Archivist', 'Caravan Guard', 'Alchemist', 'Innkeeper',
  'Harbor Master', 'Bounty Tracker', 'Temple Acolyte', 'Cartographer', 'Fence',
];
const NPC_QUIRKS = [
  'Counts copper coins nervously while speaking.',
  'Always refers to past adventures in the third person.',
  'Keeps a Clockwork sparrow perched on their shoulder.',
  'Speaks in hushed whispers even in empty rooms.',
  'Smells faintly of ozone and scorched parchment.',
  'Never sits with their back to a door or window.',
];
const NPC_SECRETS = [
  'Secretly owes a blood debt to the local thieves’ guild.',
  'Hiding a cracked signet ring belonging to a fallen royal house.',
  'Knows the hidden back entrance into the nearby sunken keep.',
  'Has been passing coded messages to a rival faction.',
  'Carries a cursed map that updates whenever someone lies nearby.',
];

const TAVERN_PREFIX = ['The Gilded', 'The Rusty', 'The Whispering', 'The Sleeping', 'The Crimson', 'The Shattered', 'The Copper'];
const TAVERN_NOUN = ['Anvil', 'Lantern', 'Wyvern', 'Goblet', 'Compass', 'Stag', 'Anchor', 'Raven'];
const TAVERN_DRINKS = [
  'Spiced Honeymead (4 sp)',
  'Dwarven Ember-Stout (5 sp)',
  'Moonberry Cordial (1 gp)',
  'Smoked Rye & Cider (3 sp)',
  'Frostmint Tonic (8 sp)',
];
const TAVERN_RUMORS = [
  'A merchant caravan vanished three miles east of the old stone bridge.',
  'Strange blue lights were spotted rising from the flooded quarry at midnight.',
  'The magistrate is quietly hiring discreet blades for an off-the-books escort.',
  'A local prospector found a dwarven key stamped with a sunburst.',
];

const ENCOUNTER_HOOKS: Record<string, string[]> = {
  Forest: [
    'Twisted vines choke the trail ahead while distant crows scatter.',
    'A toppled supply cart blocks the muddy logging road.',
  ],
  Dungeon: [
    'Cold air drafts from behind a half-collapsed masonry archway.',
    'Scratched warning runes glow faintly along the flagstones.',
  ],
  Urban: [
    'Lanterns flicker out down a narrow cobblestone alley as boots close in.',
    'Shouts erupt from a warehouse roof overlooking the canal.',
  ],
  Underdark: [
    'Bioluminescent spores pulse across the cavern ceiling above a chasm.',
    'Chisel-marks and recent drag trails vanish into a stalagmite cluster.',
  ],
};

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}

export function generateRandomNpc(rng: () => number = Math.random): Omit<CampaignEntry, 'id' | 'updatedAt'> {
  const fullName = `${pick(NPC_FIRST_NAMES, rng)} ${pick(NPC_SURNAMES, rng)}`;
  const ancestry = pick(NPC_ANCESTRIES, rng);
  const role = pick(NPC_ROLES, rng);
  const quirk = pick(NPC_QUIRKS, rng);
  const secret = pick(NPC_SECRETS, rng);

  return {
    category: 'npc',
    title: fullName,
    summary: `${ancestry} ${role}`,
    body: `**Quirk:** ${quirk}\n\n**DM Secret:** ${secret}`,
    tags: [ancestry.toLowerCase(), role.toLowerCase().replace(/\s+/g, '-'), 'improv'],
    status: 'active',
  };
}

export function generateRandomTavern(rng: () => number = Math.random): Omit<CampaignEntry, 'id' | 'updatedAt'> {
  const name = `${pick(TAVERN_PREFIX, rng)} ${pick(TAVERN_NOUN, rng)}`;
  const barkeep = `${pick(NPC_FIRST_NAMES, rng)} ${pick(NPC_SURNAMES, rng)}`;
  const drink = pick(TAVERN_DRINKS, rng);
  const rumor = pick(TAVERN_RUMORS, rng);

  return {
    category: 'location',
    title: name,
    summary: `Tavern & Inn • Barkeep: ${barkeep}`,
    body: `**House Specialty:** ${drink}\n\n**Overheard Rumor:** ${rumor}`,
    tags: ['tavern', 'location', 'improv'],
    status: 'active',
  };
}

export function generateRandomEncounter(
  partyLevels: number[],
  environment: 'Forest' | 'Dungeon' | 'Urban' | 'Underdark' = 'Dungeon',
  rng: () => number = Math.random
): GeneratedEncounter {
  const levels = partyLevels.length > 0 ? partyLevels : [3, 3, 3, 3];
  const avgLevel = levels.reduce((s, n) => s + n, 0) / levels.length;

  const allMonsters = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).filter((e) => e.category === 'monster');
  const maxXp = avgLevel <= 2 ? 450 : avgLevel <= 4 ? 1100 : avgLevel <= 8 ? 3900 : avgLevel <= 12 ? 8400 : 18000;
  const minXp = avgLevel <= 2 ? 25 : avgLevel <= 4 ? 100 : avgLevel <= 8 ? 450 : 1800;

  const candidates = allMonsters.filter((m) => {
    const xp = CR_XP_TABLE[m.monsterMeta?.cr ?? '1'] ?? 200;
    return xp >= minXp && xp <= maxXp;
  });
  const pool = candidates.length > 0 ? candidates : allMonsters;
  const primary = pick(pool, rng);
  const primaryCr = primary?.monsterMeta?.cr ?? '1';
  const primaryXp = CR_XP_TABLE[primaryCr] ?? 200;
  const targetMedium = evaluateEncounterDifficulty(levels, []).thresholds.medium;
  const count = Math.max(1, Math.min(6, Math.round(targetMedium / Math.max(50, primaryXp * 1.5))));
  const crs = Array.from({ length: count }, () => primaryCr);
  const diff = evaluateEncounterDifficulty(levels, crs);
  const hooks = ENCOUNTER_HOOKS[environment] ?? ENCOUNTER_HOOKS.Dungeon!;

  return {
    title: `${environment} Ambush: ${count}× ${primary?.name ?? 'Goblin'}`,
    environment,
    hook: pick(hooks, rng),
    difficulty: diff.rating,
    adjustedXp: diff.adjustedXp,
    monsters: [{ name: primary?.name ?? 'Goblin', cr: primaryCr, count }],
  };
}
