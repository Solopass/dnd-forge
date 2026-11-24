import { ClassLevel, RawCharacterState, ResourcePool } from '../types/character';
import { CompendiumEntity } from '../types/compendium';
import { AbilityKey, Ruleset, SkillKey } from '../types/core';
import { BACKGROUND_PRESETS, SPECIES_PRESETS } from './backgrounds';
import { computeAbilityModifier, createBlankCharacter, syncSpellSlotPools } from './rules-math';
import { BUILTIN_CONTENT_PACKS } from './srd-packs';

export interface SubclassPreset {
  name: string;
  summary: string;
  bonusEntityIds?: string[];
}

export interface ClassDefinition {
  className: string;
  hitDie: 6 | 8 | 10 | 12;
  casterProgression: ClassLevel['casterProgression'];
  primaryAbility: AbilityKey;
  saveProficiencies: AbilityKey[];
  recommendedArray: Record<AbilityKey, number>;
  defaultSkills: SkillKey[];
  unarmoredDefense?: { extraAbility: AbilityKey; label: string };
  startingEntityIds: string[];
  subclassPresets: SubclassPreset[];
  resourcePoolsForLevel: (level: number, abilities?: Record<AbilityKey, number>) => ResourcePool[];
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export const CLASS_DEFINITIONS: ClassDefinition[] = [
  {
    className: 'Artificer',
    hitDie: 8,
    casterProgression: 'half_up',
    primaryAbility: 'int',
    saveProficiencies: ['con', 'int'],
    recommendedArray: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    defaultSkills: ['arcana', 'investigation'],
    startingEntityIds: ['srd-arm-scale-mail', 'srd-arm-shield', 'srd-wpn-light-crossbow', 'srd-spell-fire-bolt', 'srd-spell-cure-wounds', 'srd-spell-faerie-fire'],
    subclassPresets: [
      { name: 'Armorer', summary: 'Arcane Armor, Thunder Gauntlets & Defensive Field.' },
      { name: 'Battle Smith', summary: 'Steel Defender companion & INT-based weapon attacks.' },
    ],
    resourcePoolsForLevel: (level) =>
      level >= 3
        ? [{ id: 'auto_class_defensive_field', name: 'Defensive Field / Infusions', current: Math.max(2, Math.ceil(level / 2)), max: Math.max(2, Math.ceil(level / 2)), recovery: 'long_rest', isAutoClassPool: true }]
        : [],
  },
  {
    className: 'Barbarian',
    hitDie: 12,
    casterProgression: 'none',
    primaryAbility: 'str',
    saveProficiencies: ['str', 'con'],
    recommendedArray: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    defaultSkills: ['athletics', 'perception'],
    unarmoredDefense: { extraAbility: 'con', label: 'Unarmored Defense (CON)' },
    startingEntityIds: ['srd-wpn-greataxe', 'srd-wpn-handaxe', 'srd-wpn-javelin', 'srd-feat-rage'],
    subclassPresets: [
      { name: 'Path of the Berserker', summary: 'Frenzy bonus-action attacks & Mindless Rage.' },
      { name: 'Path of the Totem Warrior', summary: 'Bear/Eagle/Wolf totem resistances and aura.' },
    ],
    resourcePoolsForLevel: (level) => {
      const rages = level >= 20 ? 99 : level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2;
      return [{ id: 'auto_class_rage', name: 'Rage', current: rages, max: rages, recovery: 'long_rest', isAutoClassPool: true }];
    },
  },
  {
    className: 'Bard',
    hitDie: 8,
    casterProgression: 'full',
    primaryAbility: 'cha',
    saveProficiencies: ['dex', 'cha'],
    recommendedArray: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    defaultSkills: ['performance', 'persuasion', 'deception'],
    startingEntityIds: ['srd-arm-leather', 'srd-wpn-rapier', 'srd-wpn-dagger', 'srd-spell-vicious-mockery', 'srd-spell-healing-word', 'srd-spell-faerie-fire', 'srd-feat-bardic-inspiration'],
    subclassPresets: [
      { name: 'College of Lore', summary: 'Cutting Words & extra Magical Secrets.' },
      { name: 'College of Valor', summary: 'Medium armor, shields, martial weapons & Extra Attack.' },
    ],
    resourcePoolsForLevel: (level, abilities) => {
      const chaMod = abilities ? Math.max(1, computeAbilityModifier(abilities.cha)) : 3;
      return [{
        id: 'auto_class_bardic_insp',
        name: 'Bardic Inspiration',
        current: chaMod,
        max: chaMod,
        recovery: level >= 5 ? 'short_rest' : 'long_rest',
        isAutoClassPool: true,
      }];
    },
  },
  {
    className: 'Blood Hunter',
    hitDie: 10,
    casterProgression: 'pact',
    primaryAbility: 'dex',
    saveProficiencies: ['dex', 'int'],
    recommendedArray: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
    defaultSkills: ['acrobatics', 'investigation'],
    startingEntityIds: ['srd-arm-studded-leather', 'srd-wpn-rapier', 'srd-wpn-light-crossbow'],
    subclassPresets: [
      { name: 'Order of the Ghostslayer', summary: 'Radiant Rite & Curse Specialist.' },
      { name: 'Order of the Profane Soul', summary: 'Pact Magic casting & Rite Focus.' },
    ],
    resourcePoolsForLevel: (level) => [
      { id: 'auto_class_blood_maledict', name: 'Blood Maledict', current: level >= 17 ? 4 : level >= 13 ? 3 : level >= 6 ? 2 : 1, max: level >= 17 ? 4 : level >= 13 ? 3 : level >= 6 ? 2 : 1, recovery: 'short_rest', isAutoClassPool: true },
    ],
  },
  {
    className: 'Cleric',
    hitDie: 8,
    casterProgression: 'full',
    primaryAbility: 'wis',
    saveProficiencies: ['wis', 'cha'],
    recommendedArray: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    defaultSkills: ['insight', 'religion'],
    startingEntityIds: ['srd-arm-scale-mail', 'srd-arm-shield', 'srd-wpn-mace', 'srd-spell-sacred-flame', 'srd-spell-guidance', 'srd-spell-bless', 'srd-spell-guiding-bolt', 'srd-spell-healing-word', 'srd-feat-channel-divinity'],
    subclassPresets: [
      { name: 'Life Domain', summary: 'Heavy armor, Disciple of Life (+2+lvl healing) & Preserve Life.' },
      { name: 'Light Domain', summary: 'Warding Flare & Radiance of the Dawn.' },
    ],
    resourcePoolsForLevel: (level) => {
      if (level < 2) return [];
      const cd = level >= 18 ? 3 : level >= 6 ? 2 : 1;
      return [{ id: 'auto_class_channel_divinity', name: 'Channel Divinity', current: cd, max: cd, recovery: 'short_rest', isAutoClassPool: true }];
    },
  },
  {
    className: 'Druid',
    hitDie: 8,
    casterProgression: 'full',
    primaryAbility: 'wis',
    saveProficiencies: ['int', 'wis'],
    recommendedArray: { str: 8, dex: 13, con: 14, int: 12, wis: 15, cha: 10 },
    defaultSkills: ['nature', 'perception'],
    startingEntityIds: ['srd-arm-leather', 'srd-arm-shield', 'srd-wpn-quarterstaff', 'srd-spell-guidance', 'srd-spell-cure-wounds', 'srd-spell-faerie-fire', 'srd-feat-wild-shape'],
    subclassPresets: [
      { name: 'Circle of the Land', summary: 'Natural Recovery & Circle Spells.' },
      { name: 'Circle of the Moon', summary: 'Combat Wild Shape (bonus action, higher CR beasts).' },
    ],
    resourcePoolsForLevel: (level) =>
      level >= 2
        ? [{ id: 'auto_class_wild_shape', name: 'Wild Shape', current: 2, max: 2, recovery: 'short_rest', isAutoClassPool: true }]
        : [],
  },
  {
    className: 'Fighter',
    hitDie: 10,
    casterProgression: 'none',
    primaryAbility: 'str',
    saveProficiencies: ['str', 'con'],
    recommendedArray: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    defaultSkills: ['athletics', 'intimidation'],
    startingEntityIds: ['srd-arm-chain-mail', 'srd-arm-shield', 'srd-wpn-longsword', 'srd-wpn-javelin', 'srd-feat-second-wind', 'srd-feat-action-surge'],
    subclassPresets: [
      { name: 'Champion', summary: 'Improved Critical (19–20) & Remarkable Athlete.' },
      { name: 'Battle Master', summary: 'Superiority Dice & tactical combat maneuvers.' },
    ],
    resourcePoolsForLevel: (level) => {
      const pools: ResourcePool[] = [
        { id: 'auto_class_second_wind', name: 'Second Wind', current: 1, max: 1, recovery: 'short_rest', isAutoClassPool: true },
      ];
      if (level >= 2) {
        const surge = level >= 17 ? 2 : 1;
        pools.push({ id: 'auto_class_action_surge', name: 'Action Surge', current: surge, max: surge, recovery: 'short_rest', isAutoClassPool: true });
      }
      return pools;
    },
  },
  {
    className: 'Monk',
    hitDie: 8,
    casterProgression: 'none',
    primaryAbility: 'dex',
    saveProficiencies: ['str', 'dex'],
    recommendedArray: { str: 8, dex: 15, con: 13, int: 10, wis: 14, cha: 12 },
    defaultSkills: ['acrobatics', 'stealth'],
    unarmoredDefense: { extraAbility: 'wis', label: 'Unarmored Defense (WIS)' },
    startingEntityIds: ['srd-wpn-shortsword', 'srd-wpn-dagger', 'srd-feat-flurry-of-blows'],
    subclassPresets: [
      { name: 'Way of the Open Hand', summary: 'Open Hand Technique (knock prone / push on Flurry).' },
      { name: 'Way of Shadow', summary: 'Shadow Arts spells & Shadow Step teleport.' },
    ],
    resourcePoolsForLevel: (level) =>
      level >= 2
        ? [{ id: 'auto_class_ki', name: 'Focus / Ki Points', current: level, max: level, recovery: 'short_rest', isAutoClassPool: true }]
        : [],
  },
  {
    className: 'Paladin',
    hitDie: 10,
    casterProgression: 'half',
    primaryAbility: 'str',
    saveProficiencies: ['wis', 'cha'],
    recommendedArray: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
    defaultSkills: ['athletics', 'persuasion'],
    startingEntityIds: ['srd-arm-chain-mail', 'srd-arm-shield', 'srd-wpn-longsword', 'srd-wpn-javelin', 'srd-spell-bless', 'srd-spell-cure-wounds', 'srd-feat-lay-on-hands', 'srd-feat-divine-smite'],
    subclassPresets: [
      { name: 'Oath of Devotion', summary: 'Sacred Weapon (+CHA to hit) & Turn the Unholy.' },
      { name: 'Oath of Vengeance', summary: 'Vow of Enmity (advantage) & Misty Step.' },
    ],
    resourcePoolsForLevel: (level) => {
      const pools: ResourcePool[] = [
        { id: 'auto_class_lay_on_hands', name: 'Lay on Hands (HP Pool)', current: level * 5, max: level * 5, recovery: 'long_rest', isAutoClassPool: true },
      ];
      if (level >= 3) {
        pools.push({ id: 'auto_class_channel_divinity', name: 'Channel Divinity', current: 1, max: 1, recovery: 'short_rest', isAutoClassPool: true });
      }
      return pools;
    },
  },
  {
    className: 'Ranger',
    hitDie: 10,
    casterProgression: 'half',
    primaryAbility: 'dex',
    saveProficiencies: ['str', 'dex'],
    recommendedArray: { str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 12 },
    defaultSkills: ['perception', 'stealth', 'survival'],
    startingEntityIds: ['srd-arm-scale-mail', 'srd-wpn-longbow', 'srd-wpn-shortsword', 'srd-spell-hunters-mark', 'srd-spell-cure-wounds'],
    subclassPresets: [
      { name: 'Hunter', summary: 'Colossus Slayer (+1d8) or Horde Breaker.' },
      { name: 'Gloom Stalker', summary: 'Dread Ambusher (+WIS to Init, extra opening attack) & Umbral Sight.' },
    ],
    resourcePoolsForLevel: () => [],
  },
  {
    className: 'Rogue',
    hitDie: 8,
    casterProgression: 'none',
    primaryAbility: 'dex',
    saveProficiencies: ['dex', 'int'],
    recommendedArray: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
    defaultSkills: ['acrobatics', 'sleight_of_hand', 'stealth', 'perception'],
    startingEntityIds: ['srd-arm-leather', 'srd-wpn-rapier', 'srd-wpn-shortbow', 'srd-wpn-dagger', 'srd-feat-sneak-attack', 'srd-feat-cunning-action'],
    subclassPresets: [
      { name: 'Thief', summary: 'Fast Hands bonus-action Sleight of Hand / Use Object.' },
      { name: 'Assassin', summary: 'Assassinate (advantage & auto-crit vs surprised foes).' },
    ],
    resourcePoolsForLevel: () => [],
  },
  {
    className: 'Sorcerer',
    hitDie: 6,
    casterProgression: 'full',
    primaryAbility: 'cha',
    saveProficiencies: ['con', 'cha'],
    recommendedArray: { str: 8, dex: 13, con: 14, int: 10, wis: 12, cha: 15 },
    defaultSkills: ['arcana', 'persuasion'],
    startingEntityIds: ['srd-wpn-dagger', 'srd-wpn-light-crossbow', 'srd-spell-fire-bolt', 'srd-spell-mage-hand', 'srd-spell-magic-missile', 'srd-spell-shield', 'srd-spell-mage-armor'],
    subclassPresets: [
      { name: 'Draconic Bloodline', summary: 'Draconic Resilience (13 + DEX AC) & +1 HP/level.' },
      { name: 'Wild Magic', summary: 'Tides of Chaos advantage & Wild Magic Surge.' },
    ],
    resourcePoolsForLevel: (level) =>
      level >= 2
        ? [{ id: 'auto_class_sorcery_points', name: 'Sorcery Points', current: level, max: level, recovery: 'long_rest', isAutoClassPool: true }]
        : [],
  },
  {
    className: 'Warlock',
    hitDie: 8,
    casterProgression: 'pact',
    primaryAbility: 'cha',
    saveProficiencies: ['wis', 'cha'],
    recommendedArray: { str: 8, dex: 13, con: 14, int: 12, wis: 10, cha: 15 },
    defaultSkills: ['arcana', 'deception'],
    startingEntityIds: ['srd-arm-leather', 'srd-wpn-dagger', 'srd-wpn-light-crossbow', 'srd-spell-eldritch-blast', 'srd-spell-mage-hand', 'srd-spell-hex'],
    subclassPresets: [
      { name: 'The Fiend', summary: 'Dark One’s Blessing (temp HP on kill) & Fireball access.' },
      { name: 'The Hexblade', summary: 'Hexblade’s Curse & CHA-based martial weapons + shield.' },
    ],
    resourcePoolsForLevel: () => [],
  },
  {
    className: 'Wizard',
    hitDie: 6,
    casterProgression: 'full',
    primaryAbility: 'int',
    saveProficiencies: ['int', 'wis'],
    recommendedArray: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    defaultSkills: ['arcana', 'investigation'],
    startingEntityIds: ['srd-wpn-quarterstaff', 'srd-spell-fire-bolt', 'srd-spell-mage-hand', 'srd-spell-ray-of-frost', 'srd-spell-magic-missile', 'srd-spell-shield', 'srd-spell-mage-armor'],
    subclassPresets: [
      { name: 'School of Evocation', summary: 'Sculpt Spells (protect allies from AoE) & Empowered Evocation.' },
      { name: 'School of Abjuration', summary: 'Arcane Ward barrier & improved Counterspell/Dispel.' },
    ],
    resourcePoolsForLevel: () => [
      { id: 'auto_class_arcane_recovery', name: 'Arcane Recovery', current: 1, max: 1, recovery: 'long_rest', isAutoClassPool: true },
    ],
  },
];

export function getClassDefinition(className: string): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find((c) => c.className.toLowerCase() === className.toLowerCase());
}

export function getSubclassPresets(className: string): SubclassPreset[] {
  return getClassDefinition(className)?.subclassPresets ?? [];
}

/**
 * Computes standard fixed HP for a class stack: Level 1 = max hit die + CON mod;
 * Levels 2..N = (hitDie / 2 + 1 + CON mod) per level (min 1 HP per level).
 * Adds +2 HP per total level when the Tough feat is present.
 */
export function computeFixedMaxHp(
  classes: ClassLevel[],
  conScore: number,
  items?: CompendiumEntity[]
): number {
  const conMod = computeAbilityModifier(conScore);
  let totalHp = 0;
  let totalLevel = 0;
  let isFirstLevel = true;
  for (const cls of classes) {
    for (let i = 0; i < cls.level; i++) {
      const baseGain = isFirstLevel ? cls.hitDie : cls.hitDie / 2 + 1;
      totalHp += Math.max(1, baseGain + conMod);
      totalLevel += 1;
      isFirstLevel = false;
    }
  }
  if (items?.some((i) => i.name.toLowerCase().includes('tough'))) {
    totalHp += 2 * totalLevel;
  }
  return Math.max(1, totalHp);
}

/**
 * Syncs auto-managed class resource pools and hit dice pool when classes/levels change,
 * preserving user-added pools and keeping spent `current` counts clamped to new `max`.
 */
export function syncClassResourcePools(
  classes: ClassLevel[],
  existingPools: ResourcePool[],
  abilities?: Record<AbilityKey, number>
): ResourcePool[] {
  const prevMap = new Map(existingPools.map((p) => [p.id, p]));
  const preservedSpellSlots = existingPools.filter((p) => p.isAutoSpellSlot);
  const customPools = existingPools.filter(
    (p) => !p.isAutoSpellSlot && !p.isAutoClassPool && p.id !== 'hit_dice'
  );

  const totalLevel = Math.max(1, classes.reduce((s, c) => s + c.level, 0));
  const prevHitDice = prevMap.get('hit_dice');
  const hitDicePool: ResourcePool = {
    id: 'hit_dice',
    name: 'Hit Dice',
    current: prevHitDice ? Math.min(totalLevel, prevHitDice.current) : totalLevel,
    max: totalLevel,
    recovery: 'long_rest',
    isAutoClassPool: true,
  };

  const autoClassPools: ResourcePool[] = [];
  const seenIds = new Set<string>();
  for (const cls of classes) {
    const def = getClassDefinition(cls.className);
    if (!def) continue;
    for (const pool of def.resourcePoolsForLevel(cls.level, abilities)) {
      if (seenIds.has(pool.id)) continue;
      seenIds.add(pool.id);
      const prev = prevMap.get(pool.id);
      autoClassPools.push({
        ...pool,
        current: prev ? Math.min(pool.max, prev.current) : pool.max,
      });
    }
  }

  return [...preservedSpellSlots, hitDicePool, ...autoClassPools, ...customPools];
}

export interface NewCharacterPresetInput {
  id: string;
  name: string;
  className: string;
  level: number;
  speciesName: string;
  backgroundName: string;
  ruleset: Ruleset;
  baseAbilities?: Record<AbilityKey, number>;
}

export function buildCharacterFromPreset(input: NewCharacterPresetInput): RawCharacterState {
  const classDef = getClassDefinition(input.className) ?? CLASS_DEFINITIONS[6]!; // Fighter fallback
  const species = SPECIES_PRESETS.find((s) => s.name === input.speciesName) ?? SPECIES_PRESETS[0]!;
  const background = BACKGROUND_PRESETS.find((b) => b.name === input.backgroundName) ?? BACKGROUND_PRESETS[7]!;

  const level = Math.max(1, Math.min(20, input.level));
  const char = createBlankCharacter(input.id, input.name.trim() || `${species.name} ${classDef.className}`);
  char.ruleset = input.ruleset;
  char.species = species.name;
  char.background = background.name;
  char.classes = [
    {
      className: classDef.className,
      level,
      hitDie: classDef.hitDie,
      casterProgression: classDef.casterProgression,
    },
  ];
  char.baseAbilities = input.baseAbilities ? { ...input.baseAbilities } : { ...classDef.recommendedArray };
  char.bonusAbilities = {
    str: species.abilityBonuses.str ?? 0,
    dex: species.abilityBonuses.dex ?? 0,
    con: species.abilityBonuses.con ?? 0,
    int: species.abilityBonuses.int ?? 0,
    wis: species.abilityBonuses.wis ?? 0,
    cha: species.abilityBonuses.cha ?? 0,
  };
  char.saveProficiencies = [...classDef.saveProficiencies];

  for (const sk of classDef.defaultSkills) {
    char.skillProficiencies[sk] = 1;
  }
  for (const sk of background.skills) {
    char.skillProficiencies[sk] = 1;
  }

  const totalCon = char.baseAbilities.con + char.bonusAbilities.con;
  const maxHp = computeFixedMaxHp(char.classes, totalCon);
  char.hp = { current: maxHp, max: maxHp, temp: 0 };

  const allPackEntities = new Map<string, CompendiumEntity>(
    BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).map((e) => [e.id, e])
  );
  const items: CompendiumEntity[] = [];
  for (const entityId of classDef.startingEntityIds) {
    const found = allPackEntities.get(entityId);
    if (!found) continue;
    const clone = structuredClone(found);
    clone.ruleset = input.ruleset;
    if (clone.category === 'armor' || clone.category === 'shield' || clone.category === 'weapon') {
      clone.equipped = true;
    }
    if (clone.category === 'spell') {
      clone.prepared = true;
    }
    if (clone.id === 'srd-feat-sneak-attack') {
      const sneakDice = `${Math.ceil(level / 2)}d6`;
      clone.entries = [`Rogue: Deal extra ${sneakDice} damage once per turn with a finesse or ranged weapon.`];
      if (clone.activities[0]) {
        clone.activities[0].damageFormula = sneakDice;
        clone.activities[0].description = `Rogue: Deal extra {@damage ${sneakDice}} damage once per turn with finesse/ranged weapon.`;
      }
    }
    items.push(clone);
  }

  if (classDef.unarmoredDefense) {
    items.push({
      id: `feat-unarmored-${classDef.className.toLowerCase()}`,
      name: classDef.unarmoredDefense.label,
      source: 'SRD 5.1',
      ruleset: input.ruleset,
      category: 'feat',
      equipped: true,
      acFormula: {
        base: 10,
        dexCap: null,
        extraAbility: classDef.unarmoredDefense.extraAbility,
        requiresUnarmored: true,
      },
      activities: [],
      entries: [`While wearing no armor, your AC equals 10 + DEX + ${classDef.unarmoredDefense.extraAbility.toUpperCase()}.`],
    });
  }

  char.items = items;

  const totalAbilities: Record<AbilityKey, number> = {
    str: char.baseAbilities.str + char.bonusAbilities.str,
    dex: char.baseAbilities.dex + char.bonusAbilities.dex,
    con: char.baseAbilities.con + char.bonusAbilities.con,
    int: char.baseAbilities.int + char.bonusAbilities.int,
    wis: char.baseAbilities.wis + char.bonusAbilities.wis,
    cha: char.baseAbilities.cha + char.bonusAbilities.cha,
  };
  const classPools = syncClassResourcePools(char.classes, [], totalAbilities);
  char.resources = syncSpellSlotPools(char.classes, classPools);

  if (species.speed !== 30) {
    char.overrides.speed = species.speed;
  }

  return char;
}
