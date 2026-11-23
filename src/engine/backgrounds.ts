import { AbilityKey, SkillKey } from '../types/core';

export interface SpeciesPreset {
  name: string;
  speed: number;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  traits: string[];
}

export interface BackgroundPreset {
  name: string;
  skills: SkillKey[];
  description: string;
}

export const SPECIES_PRESETS: SpeciesPreset[] = [
  {
    name: 'Human',
    speed: 30,
    abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    traits: ['Versatile (+1 to all abilities or Bonus Feat)'],
  },
  {
    name: 'Elf',
    speed: 30,
    abilityBonuses: { dex: 2, int: 1 },
    traits: ['Darkvision 60 ft', 'Fey Ancestry', 'Trance'],
  },
  {
    name: 'Dwarf',
    speed: 25,
    abilityBonuses: { con: 2, str: 2 },
    traits: ['Darkvision 60 ft', 'Dwarven Resilience (Poison)'],
  },
  {
    name: 'Halfling',
    speed: 25,
    abilityBonuses: { dex: 2, cha: 1 },
    traits: ['Lucky (reroll 1s)', 'Brave', 'Halfling Nimbleness'],
  },
  {
    name: 'Dragonborn',
    speed: 30,
    abilityBonuses: { str: 2, cha: 1 },
    traits: ['Draconic Ancestry', 'Breath Weapon', 'Damage Resistance'],
  },
  {
    name: 'Gnome',
    speed: 25,
    abilityBonuses: { int: 2, con: 1 },
    traits: ['Darkvision 60 ft', 'Gnome Cunning'],
  },
  {
    name: 'Half-Elf',
    speed: 30,
    abilityBonuses: { cha: 2, dex: 1, con: 1 },
    traits: ['Darkvision 60 ft', 'Fey Ancestry', 'Skill Versatility'],
  },
  {
    name: 'Half-Orc',
    speed: 30,
    abilityBonuses: { str: 2, con: 1 },
    traits: ['Darkvision 60 ft', 'Relentless Endurance', 'Savage Attacks'],
  },
  {
    name: 'Tiefling',
    speed: 30,
    abilityBonuses: { cha: 2, int: 1 },
    traits: ['Darkvision 60 ft', 'Hellish Resistance (Fire)', 'Infernal Legacy'],
  },
];

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    name: 'Acolyte',
    skills: ['insight', 'religion'],
    description: 'Shelter of the Faithful; raised in temple service.',
  },
  {
    name: 'Clan Crafter',
    skills: ['history', 'insight'],
    description: 'Master artisan trained in dwarven or guild workshops.',
  },
  {
    name: 'Criminal',
    skills: ['deception', 'stealth'],
    description: 'Criminal Contact; experienced in underworld networks.',
  },
  {
    name: 'Folk Hero',
    skills: ['animal_handling', 'survival'],
    description: 'Rustic Hospitality; defender of common folk.',
  },
  {
    name: 'Noble',
    skills: ['history', 'persuasion'],
    description: 'Position of Privilege; born to title and influence.',
  },
  {
    name: 'Outlander',
    skills: ['athletics', 'survival'],
    description: 'Wanderer; self-sufficient tracker of the wilds.',
  },
  {
    name: 'Sage',
    skills: ['arcana', 'history'],
    description: 'Researcher; scholar of arcane and historical lore.',
  },
  {
    name: 'Soldier',
    skills: ['athletics', 'intimidation'],
    description: 'Military Rank; veteran of organized warfare.',
  },
];
