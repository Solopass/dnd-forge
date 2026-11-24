import { CompendiumEntity, MonsterStatMeta } from '../types/compendium';
import type { ContentPack } from './srd-packs';
import { AbilityKey } from '../types/core';

function wpn(
  id: string,
  name: string,
  ability: AbilityKey,
  damage: string,
  damageType: string,
  notes: string
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'weapon',
    equipped: false,
    activities: [
      {
        id: `act-${id}`,
        name,
        type: 'attack',
        actionEconomy: 'action',
        attackAbility: ability,
        attackBonusFormula: '@mod+@prof',
        damageFormula: `${damage}+@mod`,
        damageType,
        description: notes,
      },
    ],
    entries: [notes],
  };
}

function gear(
  id: string,
  name: string,
  notes: string,
  opts?: {
    actionEconomy?: 'action' | 'bonus_action' | 'free';
    type?: 'heal' | 'attack' | 'save' | 'utility';
    damageFormula?: string;
    damageType?: string;
    saveAbility?: AbilityKey;
    saveDcFormula?: string;
  }
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'gear',
    equipped: true,
    activities: opts?.damageFormula || opts?.type
      ? [
          {
            id: `act-${id}`,
            name,
            type: opts.type ?? 'utility',
            actionEconomy: opts.actionEconomy ?? 'action',
            damageFormula: opts.damageFormula,
            damageType: opts.damageType,
            saveAbility: opts.saveAbility,
            saveDcFormula: opts.saveDcFormula,
            description: notes,
          },
        ]
      : [],
    entries: [notes],
  };
}

function spell(
  id: string,
  name: string,
  level: number,
  _school: string,
  castingTime: string,
  range: string,
  components: string,
  duration: string,
  description: string,
  opts?: {
    concentration?: boolean;
    ritual?: boolean;
    type?: 'attack' | 'save' | 'heal' | 'utility';
    actionEconomy?: 'action' | 'bonus_action' | 'reaction';
    saveAbility?: AbilityKey;
    damageFormula?: string;
    damageType?: string;
    upcastDicePerLevel?: string;
  }
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'spell',
    spellLevel: level,
    castingTime,
    range,
    components,
    duration,
    concentration: Boolean(opts?.concentration),
    ritual: Boolean(opts?.ritual),
    prepared: level === 0,
    activities: [
      {
        id: `act-${id}`,
        name,
        type: opts?.type ?? 'utility',
        actionEconomy: opts?.actionEconomy ?? 'action',
        attackBonusFormula: opts?.type === 'attack' ? '@prof+@spell' : undefined,
        saveAbility: opts?.saveAbility,
        saveDcFormula: opts?.type === 'save' ? '8+@prof+@spell' : undefined,
        damageFormula: opts?.damageFormula,
        damageType: opts?.damageType,
        upcastDicePerLevel: opts?.upcastDicePerLevel,
        resourceCost: level > 0 ? { poolId: `spell_slot_${level}`, amount: 1 } : undefined,
        description,
      },
    ],
    entries: [description],
  };
}

function monster(
  id: string,
  name: string,
  ac: number,
  hp: number,
  dexModifier: number,
  cr: string,
  attacks: Array<{
    name: string;
    type: 'attack' | 'save';
    bonusOrDc: string;
    damageFormula?: string;
    damageType?: string;
    saveAbility?: AbilityKey;
  }>,
  notes: string,
  meta?: Partial<Omit<MonsterStatMeta, 'ac' | 'hp' | 'dexModifier' | 'cr'>>
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'monster',
    activities: attacks.map((a, idx) => ({
      id: `${id}-act-${idx}`,
      name: a.name,
      type: a.type,
      actionEconomy: 'action',
      attackBonusFormula: a.type === 'attack' ? a.bonusOrDc : undefined,
      saveDcFormula: a.type === 'save' ? a.bonusOrDc : undefined,
      saveAbility: a.saveAbility,
      damageFormula: a.damageFormula,
      damageType: a.damageType,
    })),
    monsterMeta: {
      ac,
      hp,
      dexModifier,
      cr,
      ...meta,
    },
    entries: [notes],
  };
}

function feat(id: string, name: string, description: string): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'feat',
    activities: [],
    entries: [description],
  };
}

export const SRD_EXPANSION_PACKS: ContentPack[] = [
  {
    id: 'pack-srd-expanded-gear',
    name: 'SRD 5.1 Full Weapons, Potions & Adventuring Gear',
    ruleset: '2014',
    description:
      'Completes the base D&D 5e weapon list (Battleaxe, Flail, Glaive, Maul, Scimitar, Whip, Hand Crossbow, etc.), Healing Potions, and Adventuring Gear.',
    entities: [
      wpn('srd-wpn-club', 'Club', 'str', '1d4', 'bludgeoning', 'Light.'),
      wpn('srd-wpn-greatclub', 'Greatclub', 'str', '1d8', 'bludgeoning', 'Two-Handed.'),
      wpn('srd-wpn-light-hammer', 'Light Hammer', 'str', '1d4', 'bludgeoning', 'Light, Thrown (20/60).'),
      wpn('srd-wpn-sickle', 'Sickle', 'str', '1d4', 'slashing', 'Light.'),
      wpn('srd-wpn-dart', 'Dart', 'dex', '1d4', 'piercing', 'Finesse, Thrown (20/60).'),
      wpn('srd-wpn-sling', 'Sling', 'dex', '1d4', 'bludgeoning', 'Ammunition (30/120).'),
      wpn('srd-wpn-battleaxe', 'Battleaxe', 'str', '1d8', 'slashing', 'Versatile (1d10).'),
      wpn('srd-wpn-flail', 'Flail', 'str', '1d8', 'bludgeoning', 'Martial melee weapon.'),
      wpn('srd-wpn-glaive', 'Glaive', 'str', '1d10', 'slashing', 'Heavy, Reach, Two-Handed.'),
      wpn('srd-wpn-lance', 'Lance', 'str', '1d12', 'piercing', 'Reach, Special (disadvantage within 5 ft unless mounted).'),
      wpn('srd-wpn-maul', 'Maul', 'str', '2d6', 'bludgeoning', 'Heavy, Two-Handed.'),
      wpn('srd-wpn-morningstar', 'Morningstar', 'str', '1d8', 'piercing', 'Martial melee weapon.'),
      wpn('srd-wpn-pike', 'Pike', 'str', '1d10', 'piercing', 'Heavy, Reach, Two-Handed.'),
      wpn('srd-wpn-scimitar', 'Scimitar', 'dex', '1d6', 'slashing', 'Finesse, Light.'),
      wpn('srd-wpn-trident', 'Trident', 'str', '1d6', 'piercing', 'Thrown (20/60), Versatile (1d8).'),
      wpn('srd-wpn-war-pick', 'War Pick', 'str', '1d8', 'piercing', 'Martial melee weapon.'),
      wpn('srd-wpn-whip', 'Whip', 'dex', '1d4', 'slashing', 'Finesse, Reach.'),
      wpn('srd-wpn-blowgun', 'Blowgun', 'dex', '1', 'piercing', 'Ammunition (25/100), Loading.'),
      wpn('srd-wpn-hand-crossbow', 'Hand Crossbow', 'dex', '1d6', 'piercing', 'Ammunition (30/120), Light, Loading.'),
      {
        id: 'srd-arm-padded',
        name: 'Padded Armor',
        source: 'SRD 5.1',
        ruleset: '2014',
        category: 'armor',
        equipped: false,
        acFormula: { base: 11, dexCap: null },
        activities: [],
        entries: ['Light Armor: AC 11 + DEX modifier, Stealth disadvantage.'],
      },
      gear('srd-gear-potion-healing', 'Potion of Healing', 'Drink as an action to regain 2d4 + 2 hit points.', {
        type: 'heal',
        damageFormula: '2d4+2',
        damageType: 'healing',
      }),
      gear('srd-gear-potion-greater-healing', 'Potion of Greater Healing', 'Drink as an action to regain 4d4 + 4 hit points.', {
        type: 'heal',
        damageFormula: '4d4+4',
        damageType: 'healing',
      }),
      gear('srd-gear-potion-superior-healing', 'Potion of Superior Healing', 'Drink as an action to regain 8d4 + 8 hit points.', {
        type: 'heal',
        damageFormula: '8d4+8',
        damageType: 'healing',
      }),
      gear('srd-gear-potion-supreme-healing', 'Potion of Supreme Healing', 'Drink as an action to regain 10d4 + 20 hit points.', {
        type: 'heal',
        damageFormula: '10d4+20',
        damageType: 'healing',
      }),
      gear('srd-gear-alchemists-fire', "Alchemist's Fire", 'Ranged improvised attack (20 ft): 1d4 fire damage at the start of target turns until extinguished (DC 10 DEX).', {
        type: 'attack',
        damageFormula: '1d4',
        damageType: 'fire',
      }),
      gear('srd-gear-acid-vial', 'Acid (Vial)', 'Ranged improvised attack (20 ft): 2d6 acid damage on hit.', {
        type: 'attack',
        damageFormula: '2d6',
        damageType: 'acid',
      }),
      gear('srd-gear-holy-water', 'Holy Water (Flask)', 'Ranged attack (20 ft) against fiends or undead: 2d6 radiant damage.', {
        type: 'attack',
        damageFormula: '2d6',
        damageType: 'radiant',
      }),
      gear('srd-gear-healers-kit', "Healer's Kit", '10 uses. Stabilize a dying creature without making a Medicine check.'),
      gear('srd-gear-thieves-tools', "Thieves' Tools", 'Proficiency lets you add your Proficiency Bonus to checks to disarm traps or open locks.'),
      gear('srd-gear-arcane-focus', 'Arcane Focus', 'Crystal, orb, rod, staff, or wand used as a spellcasting focus.'),
      gear('srd-gear-holy-symbol', 'Holy Symbol', 'Amulet, emblem, or reliquary used by clerics and paladins.'),
      gear('srd-gear-explorers-pack', "Explorer's Pack", 'Backpack, bedroll, mess kit, tinderbox, 10 torches, 10 days rations, waterskin, 50 ft hempen rope.'),
    ],
  },
  {
    id: 'pack-srd-expanded-spells',
    name: 'SRD 5.1 Expanded Core Spells (Cantrips–5th)',
    ruleset: '2014',
    description:
      'Essential SRD 5.1 spells across Cantrips through 5th level: Guidance, Mage Hand, Minor Illusion, Sacred Flame, Bless, Command, Detect Magic, Faerie Fire, Identify, Mage Armor, Sleep, Aid, Hold Person, Invisibility, Lesser Restoration, Pass without Trace, Web, Counterspell, Dispel Magic, Fly, Haste, Hypnotic Pattern, Spirit Guardians, Banishment, Polymorph, Wall of Fire, Cone of Cold, Raise Dead, Wall of Force.',
    entities: [
      spell('srd-spl-guidance', 'Guidance', 0, 'Divination', '1 action', 'Touch', 'V, S', 'Concentration, 1 minute', 'Target adds {@dice 1d4} to one ability check of its choice.', { concentration: true }),
      spell('srd-spl-mage-hand', 'Mage Hand', 0, 'Conjuration', '1 action', '30 feet', 'V, S', '1 minute', 'A spectral floating hand manipulates objects up to 10 lb.'),
      spell('srd-spl-minor-illusion', 'Minor Illusion', 0, 'Illusion', '1 action', '30 feet', 'S, M', '1 minute', 'Create a sound or a 5-ft cube image.'),
      spell('srd-spl-prestidigitation', 'Prestidigitation', 0, 'Transmutation', '1 action', '10 feet', 'V, S', '1 hour', 'Perform minor magical tricks and sensory effects.'),
      spell('srd-spl-ray-of-frost', 'Ray of Frost', 0, 'Evocation', '1 action', '60 feet', 'V, S', 'Instantaneous', 'Ranged spell attack for {@damage @cantripd8} cold damage and -10 ft speed.', { type: 'attack', damageFormula: '@cantripd8', damageType: 'cold' }),
      spell('srd-spl-sacred-flame', 'Sacred Flame', 0, 'Evocation', '1 action', '60 feet', 'V, S', 'Instantaneous', 'DEX save or take {@damage @cantripd8} radiant damage (ignores cover).', { type: 'save', saveAbility: 'dex', damageFormula: '@cantripd8', damageType: 'radiant' }),
      spell('srd-spl-shocking-grasp', 'Shocking Grasp', 0, 'Evocation', '1 action', 'Touch', 'V, S', 'Instantaneous', 'Melee spell attack (advantage vs metal armor) for {@damage @cantripd8} lightning damage and no reactions.', { type: 'attack', damageFormula: '@cantripd8', damageType: 'lightning' }),
      spell('srd-spl-vicious-mockery', 'Vicious Mockery', 0, 'Enchantment', '1 action', '60 feet', 'V', 'Instantaneous', 'WIS save or {@damage @cantripd4} psychic damage and disadvantage on next attack.', { type: 'save', saveAbility: 'wis', damageFormula: '@cantripd4', damageType: 'psychic' }),
      spell('srd-spl-spare-the-dying', 'Spare the Dying', 0, 'Necromancy', '1 action', 'Touch', 'V, S', 'Instantaneous', 'A living creature with 0 HP becomes stable.'),
      spell('srd-spl-command', 'Command', 1, 'Enchantment', '1 action', '60 feet', 'V', '1 round', 'WIS save or follow a one-word command (Approach, Drop, Flee, Grovel, Halt).', { type: 'save', saveAbility: 'wis' }),
      spell('srd-spl-detect-magic', 'Detect Magic', 1, 'Divination', '1 action', 'Self', 'V, S', 'Concentration, 10 minutes', 'Sense magic within 30 feet and learn its school.', { concentration: true, ritual: true }),
      spell('srd-spl-faerie-fire', 'Faerie Fire', 1, 'Evocation', '1 action', '60 feet', 'V', 'Concentration, 1 minute', '20-ft cube: DEX save or outlined in light (attacks have advantage, cannot benefit from invisibility).', { concentration: true, type: 'save', saveAbility: 'dex' }),
      spell('srd-spl-feather-fall', 'Feather Fall', 1, 'Transmutation', '1 reaction', '60 feet', 'V, M', '1 minute', 'Up to 5 falling creatures descend at 60 ft/round safely.', { actionEconomy: 'reaction' }),
      spell('srd-spl-grease', 'Grease', 1, 'Conjuration', '1 action', '60 feet', 'V, S, M', '1 minute', '10-ft square of difficult terrain; DEX save or fall Prone.', { type: 'save', saveAbility: 'dex' }),
      spell('srd-spl-identify', 'Identify', 1, 'Divination', '1 minute', 'Touch', 'V, S, M', 'Instantaneous', 'Learn the properties of a magic item or active spells on a creature.', { ritual: true }),
      spell('srd-spl-mage-armor', 'Mage Armor', 1, 'Abjuration', '1 action', 'Touch', 'V, S, M', '8 hours', 'Unarmored target base AC becomes 13 + DEX modifier.'),
      spell('srd-spl-sleep', 'Sleep', 1, 'Enchantment', '1 action', '90 feet', 'V, S, M', '1 minute', 'Roll {@dice 5d8}; creatures in 20-ft radius fall Unconscious up to that HP total.', { damageFormula: '5d8', damageType: 'sleep HP', upcastDicePerLevel: '2d8' }),
      spell('srd-spl-thunderwave', 'Thunderwave', 1, 'Evocation', '1 action', 'Self (15-ft cube)', 'V, S', 'Instantaneous', 'CON save or {@damage 2d8} thunder damage and pushed 10 ft (half on save).', { type: 'save', saveAbility: 'con', damageFormula: '2d8', damageType: 'thunder', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-aid', 'Aid', 2, 'Abjuration', '1 action', '30 feet', 'V, S, M', '8 hours', 'Up to 3 creatures increase max HP and current HP by 5 (+5 per slot above 2nd).'),
      spell('srd-spl-darkness', 'Darkness', 2, 'Evocation', '1 action', '60 feet', 'V, M', 'Concentration, 10 minutes', '15-ft radius sphere of magical darkness.', { concentration: true }),
      spell('srd-spl-enhance-ability', 'Enhance Ability', 2, 'Transmutation', '1 action', 'Touch', 'V, S, M', 'Concentration, 1 hour', 'Grant advantage on checks with one chosen ability.', { concentration: true }),
      spell('srd-spl-heat-metal', 'Heat Metal', 2, 'Transmutation', '1 action', '60 feet', 'V, S, M', 'Concentration, 1 minute', 'Metal object glows red-hot for {@damage 2d8} fire damage and CON save or drop it.', { concentration: true, type: 'save', saveAbility: 'con', damageFormula: '2d8', damageType: 'fire', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-hold-person', 'Hold Person', 2, 'Enchantment', '1 action', '60 feet', 'V, S, M', 'Concentration, 1 minute', 'Humanoid makes WIS save or is Paralyzed.', { concentration: true, type: 'save', saveAbility: 'wis' }),
      spell('srd-spl-invisibility', 'Invisibility', 2, 'Illusion', '1 action', 'Touch', 'V, S, M', 'Concentration, 1 hour', 'Target becomes Invisible until it attacks or casts a spell.', { concentration: true }),
      spell('srd-spl-lesser-restoration', 'Lesser Restoration', 2, 'Abjuration', '1 action', 'Touch', 'V, S', 'Instantaneous', 'End one disease or condition (blinded, deafened, paralyzed, or poisoned).'),
      spell('srd-spl-mirror-image', 'Mirror Image', 2, 'Illusion', '1 action', 'Self', 'V, S', '1 minute', 'Three illusory duplicates divert incoming attacks.'),
      spell('srd-spl-pass-without-trace', 'Pass without Trace', 2, 'Abjuration', '1 action', 'Self (30-ft aura)', 'V, S, M', 'Concentration, 1 hour', 'Allies within 30 ft gain +10 to Dexterity (Stealth) checks.', { concentration: true }),
      spell('srd-spl-shatter', 'Shatter', 2, 'Evocation', '1 action', '60 feet', 'V, S, M', 'Instantaneous', '10-ft radius: CON save or {@damage 3d8} thunder damage (half on save).', { type: 'save', saveAbility: 'con', damageFormula: '3d8', damageType: 'thunder', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-web', 'Web', 2, 'Conjuration', '1 action', '60 feet', 'V, S, M', 'Concentration, 1 hour', '20-ft cube difficult terrain; DEX save or Restrained.', { concentration: true, type: 'save', saveAbility: 'dex' }),
      spell('srd-spl-call-lightning', 'Call Lightning', 3, 'Conjuration', '1 action', '120 feet', 'V, S', 'Concentration, 10 minutes', 'Each turn call a bolt: DEX save or {@damage 3d10} lightning damage.', { concentration: true, type: 'save', saveAbility: 'dex', damageFormula: '3d10', damageType: 'lightning', upcastDicePerLevel: '1d10' }),
      spell('srd-spl-dispel-magic', 'Dispel Magic', 3, 'Abjuration', '1 action', '120 feet', 'V, S', 'Instantaneous', 'End spells of 3rd level or lower on target (ability check for higher).'),
      spell('srd-spl-fly', 'Fly', 3, 'Transmutation', '1 action', 'Touch', 'V, S, M', 'Concentration, 10 minutes', 'Target gains a flying speed of 60 feet.', { concentration: true }),
      spell('srd-spl-haste', 'Haste', 3, 'Transmutation', '1 action', '30 feet', 'V, S, M', 'Concentration, 1 minute', 'Double speed, +2 AC, advantage on DEX saves, and 1 extra action.', { concentration: true }),
      spell('srd-spl-hypnotic-pattern', 'Hypnotic Pattern', 3, 'Illusion', '1 action', '120 feet', 'S, M', 'Concentration, 1 minute', '30-ft cube: WIS save or Charmed and Incapacitated (speed 0).', { concentration: true, type: 'save', saveAbility: 'wis' }),
      spell('srd-spl-slow', 'Slow', 3, 'Transmutation', '1 action', '120 feet', 'V, S, M', 'Concentration, 1 minute', 'Up to 6 creatures: WIS save or half speed, -2 AC/DEX saves, no reactions.', { concentration: true, type: 'save', saveAbility: 'wis' }),
      spell('srd-spl-spirit-guardians', 'Spirit Guardians', 3, 'Conjuration', '1 action', 'Self (15-ft aura)', 'V, S, M', 'Concentration, 10 minutes', 'Hostiles take {@damage 3d8} radiant/necrotic damage (WIS half) and half speed.', { concentration: true, type: 'save', saveAbility: 'wis', damageFormula: '3d8', damageType: 'radiant', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-banishment', 'Banishment', 4, 'Abjuration', '1 action', '60 feet', 'V, S, M', 'Concentration, 1 minute', 'CHA save or banished to a harmless demiplane (or home plane).', { concentration: true, type: 'save', saveAbility: 'cha' }),
      spell('srd-spl-greater-invisibility', 'Greater Invisibility', 4, 'Illusion', '1 action', 'Touch', 'V, S', 'Concentration, 1 minute', 'Target remains Invisible even while attacking or casting spells.', { concentration: true }),
      spell('srd-spl-polymorph', 'Polymorph', 4, 'Transmutation', '1 action', '60 feet', 'V, S, M', 'Concentration, 1 hour', 'WIS save or transform creature into a Beast of CR <= its level/CR.', { concentration: true, type: 'save', saveAbility: 'wis' }),
      spell('srd-spl-wall-of-fire', 'Wall of Fire', 4, 'Evocation', '1 action', '120 feet', 'V, S, M', 'Concentration, 1 minute', 'DEX save or {@damage 5d8} fire damage.', { concentration: true, type: 'save', saveAbility: 'dex', damageFormula: '5d8', damageType: 'fire', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-cone-of-cold', 'Cone of Cold', 5, 'Evocation', '1 action', 'Self (60-ft cone)', 'V, S, M', 'Instantaneous', 'CON save or {@damage 8d8} cold damage (half on save).', { type: 'save', saveAbility: 'con', damageFormula: '8d8', damageType: 'cold', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-mass-cure-wounds', 'Mass Cure Wounds', 5, 'Evocation', '1 action', '60 feet', 'V, S', 'Instantaneous', 'Up to 6 creatures regain {@dice 3d8+@spell} hit points.', { type: 'heal', damageFormula: '3d8+@spell', damageType: 'healing', upcastDicePerLevel: '1d8' }),
      spell('srd-spl-raise-dead', 'Raise Dead', 5, 'Necromancy', '1 hour', 'Touch', 'V, S, M', 'Instantaneous', 'Return a creature dead no longer than 10 days to life with 1 HP.'),
      spell('srd-spl-wall-of-force', 'Wall of Force', 5, 'Evocation', '1 action', '120 feet', 'V, S, M', 'Concentration, 10 minutes', 'Invisible impenetrable wall of force.', { concentration: true }),
    ],
  },
  {
    id: 'pack-srd-expanded-monsters',
    name: 'SRD 5.1 Expanded Bestiary (CR 1/8–CR 24)',
    ruleset: '2014',
    description:
      'Adds Guard, Acolyte, Animated Armor, Imp, Specter, Manticore, Minotaur, Mummy, Werewolf, Ettin, Ghost, Air/Fire Elemental, Wraith, Wyvern, Hydra, Fire Giant, Stone Golem, Vampire, Adult Red Dragon, Balor, and Ancient Red Dragon.',
    entities: [
      monster('srd-mob-guard', 'Guard', 16, 11, 1, '1/8', [
        { name: 'Spear', type: 'attack', bonusOrDc: '+3', damageFormula: '1d6+1', damageType: 'piercing' },
      ], 'Medium humanoid town guard.', { skills: 'Perception +2' }),
      monster('srd-mob-acolyte', 'Acolyte', 10, 9, 0, '1/4', [
        { name: 'Club', type: 'attack', bonusOrDc: '+2', damageFormula: '1d4', damageType: 'bludgeoning' },
        { name: 'Sacred Flame', type: 'save', bonusOrDc: '12', saveAbility: 'dex', damageFormula: '1d8', damageType: 'radiant' },
      ], '1st-level spellcaster (Bless, Cure Wounds, Sanctuary).'),
      monster('srd-mob-animated-armor', 'Animated Armor', 18, 33, 0, '1', [
        { name: 'Slam', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'bludgeoning' },
      ], 'Multiattack (2 Slams). Antimagic Susceptibility.', { immunities: ['poison', 'psychic'], senses: 'Blindsight 60 ft' }),
      monster('srd-mob-imp', 'Imp', 13, 10, 3, '1', [
        { name: 'Sting', type: 'attack', bonusOrDc: '+5', damageFormula: '1d4+3+3d6', damageType: 'piercing + poison' },
      ], 'Devil Sight, Magic Resistance, Shapechanger, Invisibility.', { size: 'tiny', speeds: '20 ft, Fly 40 ft', immunities: ['fire', 'poison'] }),
      monster('srd-mob-specter', 'Specter', 12, 22, 2, '1', [
        { name: 'Life Drain', type: 'attack', bonusOrDc: '+4', damageFormula: '3d6', damageType: 'necrotic' },
      ], 'Incorporeal Movement. Target DC 10 CON save or max HP reduced.', { speeds: '0 ft, Fly 50 ft (hover)', immunities: ['necrotic', 'poison'] }),
      monster('srd-mob-manticore', 'Manticore', 14, 68, 3, '3', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+5', damageFormula: '1d8+3', damageType: 'piercing' },
        { name: 'Tail Spike', type: 'attack', bonusOrDc: '+5', damageFormula: '1d8+3', damageType: 'piercing' },
      ], 'Multiattack (3 attacks: Bite + 2 Claws, or 3 Tail Spikes).', { size: 'large', speeds: '30 ft, Fly 50 ft' }),
      monster('srd-mob-minotaur', 'Minotaur', 14, 76, 0, '3', [
        { name: 'Greataxe', type: 'attack', bonusOrDc: '+6', damageFormula: '2d12+4', damageType: 'slashing' },
        { name: 'Gore', type: 'attack', bonusOrDc: '+6', damageFormula: '2d8+4', damageType: 'piercing' },
      ], 'Reckless, Labyrinthine Recall, Charge (+2d8 piercing + DC 14 STR vs Prone).', { size: 'large', speeds: '40 ft' }),
      monster('srd-mob-werewolf', 'Werewolf', 12, 58, 1, '3', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+4', damageFormula: '1d8+2', damageType: 'piercing' },
        { name: 'Claws', type: 'attack', bonusOrDc: '+4', damageFormula: '2d4+2', damageType: 'slashing' },
      ], 'Immune to nonmagical/nonsilvered B/P/S.', { immunities: ['nonmagical B/P/S (not silvered)'] }),
      monster('srd-mob-ettin', 'Ettin', 12, 85, -1, '4', [
        { name: 'Battleaxe', type: 'attack', bonusOrDc: '+7', damageFormula: '2d8+5', damageType: 'slashing' },
        { name: 'Morningstar', type: 'attack', bonusOrDc: '+7', damageFormula: '2d8+5', damageType: 'piercing' },
      ], 'Two Heads: Advantage on Perception and saves vs Blinded/Charmed/Deafened/Frightened/Stunned.', { size: 'large', speeds: '40 ft' }),
      monster('srd-mob-ghost', 'Ghost', 11, 45, 1, '4', [
        { name: 'Withering Touch', type: 'attack', bonusOrDc: '+5', damageFormula: '4d6+3', damageType: 'necrotic' },
        { name: 'Horrifying Visage', type: 'save', bonusOrDc: '13', saveAbility: 'wis' },
      ], 'Etherealness, Possession (DC 13 CHA).', { speeds: '0 ft, Fly 40 ft (hover)', immunities: ['cold', 'necrotic', 'poison'] }),
      monster('srd-mob-fire-elemental', 'Fire Elemental', 13, 102, 3, '5', [
        { name: 'Touch', type: 'attack', bonusOrDc: '+6', damageFormula: '2d6+3', damageType: 'fire' },
      ], 'Multiattack (2 Touch). Fire Form ignites targets (1d10 fire/turn).', { size: 'large', speeds: '50 ft', immunities: ['fire', 'poison'] }),
      monster('srd-mob-wraith', 'Wraith', 13, 67, 3, '5', [
        { name: 'Life Drain', type: 'attack', bonusOrDc: '+6', damageFormula: '4d8+3', damageType: 'necrotic' },
      ], 'Incorporeal Movement, Sunlight Sensitivity.', { speeds: '0 ft, Fly 60 ft (hover)', immunities: ['necrotic', 'poison'] }),
      monster('srd-mob-wyvern', 'Wyvern', 13, 110, 0, '6', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+7', damageFormula: '2d6+4', damageType: 'piercing' },
        { name: 'Stinger', type: 'attack', bonusOrDc: '+7', damageFormula: '2d6+4+7d6', damageType: 'piercing + poison' },
      ], 'Multiattack (Bite + Stinger; CON save DC 15 half poison).', { size: 'large', speeds: '20 ft, Fly 80 ft' }),
      monster('srd-mob-hydra', 'Hydra', 15, 172, 1, '8', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+8', damageFormula: '1d10+5', damageType: 'piercing' },
      ], 'Multiple Heads (5 bites). Regrows two heads unless it took fire damage.', { size: 'huge', speeds: '30 ft, Swim 30 ft' }),
      monster('srd-mob-fire-giant', 'Fire Giant', 18, 162, -1, '9', [
        { name: 'Greatsword', type: 'attack', bonusOrDc: '+11', damageFormula: '6d6+7', damageType: 'slashing' },
        { name: 'Rock', type: 'attack', bonusOrDc: '+11', damageFormula: '4d10+7', damageType: 'bludgeoning' },
      ], 'Multiattack (2 Greatsword attacks).', { size: 'huge', speeds: '30 ft', immunities: ['fire'], saves: 'DEX +3, CON +10, CHA +5' }),
      monster('srd-mob-stone-golem', 'Stone Golem', 17, 178, -1, '10', [
        { name: 'Slam', type: 'attack', bonusOrDc: '+10', damageFormula: '3d8+6', damageType: 'bludgeoning' },
        { name: 'Slow (Recharge 5-6)', type: 'save', bonusOrDc: '17', saveAbility: 'wis' },
      ], 'Immutable Form, Magic Resistance.', { size: 'large', immunities: ['poison', 'psychic', 'nonmagical B/P/S (not adamantine)'] }),
      monster('srd-mob-vampire', 'Vampire', 16, 144, 4, '13', [
        { name: 'Unarmed Strike', type: 'attack', bonusOrDc: '+9', damageFormula: '1d8+4', damageType: 'bludgeoning' },
        { name: 'Bite', type: 'attack', bonusOrDc: '+9', damageFormula: '1d6+4+3d6', damageType: 'piercing + necrotic' },
      ], 'Legendary Resistance (3/day), Regeneration 20 HP/turn, Charm (DC 17 WIS).', { saves: 'DEX +9, WIS +7, CHA +9', resistances: ['necrotic', 'nonmagical B/P/S'], legendaryActionsMax: 3 }),
      monster('srd-mob-adult-red-dragon', 'Adult Red Dragon', 19, 256, 0, '17', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+14', damageFormula: '2d10+8+2d6', damageType: 'piercing + fire' },
        { name: 'Claw', type: 'attack', bonusOrDc: '+14', damageFormula: '2d6+8', damageType: 'slashing' },
        { name: 'Fire Breath (Recharge 5-6)', type: 'save', bonusOrDc: '21', saveAbility: 'dex', damageFormula: '18d6', damageType: 'fire' },
      ], 'Legendary Resistance (3/day). Frightful Presence (DC 19 WIS).', { size: 'huge', speeds: '40 ft, Climb 40 ft, Fly 80 ft', immunities: ['fire'], legendaryActionsMax: 3 }),
      monster('srd-mob-balor', 'Balor', 19, 262, 2, '19', [
        { name: 'Longsword', type: 'attack', bonusOrDc: '+14', damageFormula: '3d8+8+3d8', damageType: 'slashing + lightning' },
        { name: 'Whip', type: 'attack', bonusOrDc: '+14', damageFormula: '2d6+8+3d6', damageType: 'slashing + fire' },
      ], 'Fire Aura (3d6 fire at start of turn), Death Throes (20d6 fire+bludgeoning).', { size: 'huge', speeds: '40 ft, Fly 80 ft', immunities: ['fire', 'poison'] }),
      monster('srd-mob-ancient-red-dragon', 'Ancient Red Dragon', 22, 546, 0, '24', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+17', damageFormula: '2d10+10+4d6', damageType: 'piercing + fire' },
        { name: 'Claw', type: 'attack', bonusOrDc: '+17', damageFormula: '2d6+10', damageType: 'slashing' },
        { name: 'Fire Breath (Recharge 5-6)', type: 'save', bonusOrDc: '24', saveAbility: 'dex', damageFormula: '26d6', damageType: 'fire' },
      ], 'Legendary Resistance (3/day). Frightful Presence (DC 21 WIS).', { size: 'gargantuan', speeds: '40 ft, Climb 40 ft, Fly 80 ft', immunities: ['fire'], legendaryActionsMax: 3 }),
    ],
  },
  {
    id: 'pack-srd-expanded-feats',
    name: 'Core 5e Feats Pack',
    ruleset: '2014',
    description:
      'Popular 5e build-defining feats: Great Weapon Master, Sharpshooter, Polearm Master, Sentinel, Resilient, Mobile, Spell Sniper, Dual Wielder, Heavy Armor Master.',
    entities: [
      feat('srd-feat-gwm', 'Great Weapon Master', 'On a crit or reducing a creature to 0 HP with a melee weapon, make one melee weapon attack as a bonus action. Before attacking with a heavy weapon, you may take -5 to hit for +10 damage.'),
      feat('srd-feat-sharpshooter', 'Sharpshooter', 'Attacking at long range imposes no disadvantage; ranged weapon attacks ignore half and three-quarters cover; you may take -5 to hit for +10 damage.'),
      feat('srd-feat-pam', 'Polearm Master', 'When attacking with a glaive, halberd, quarterstaff, or spear, use a bonus action for a 1d4 bludgeoning butt-end attack; enemies entering your reach provoke an opportunity attack.'),
      feat('srd-feat-sentinel', 'Sentinel', 'Opportunity attacks reduce target speed to 0; Disengage does not prevent your opportunity attacks; react to attack a creature within 5 ft attacking an ally.'),
      feat('srd-feat-resilient', 'Resilient', 'Increase one chosen ability score by 1 and gain proficiency in saving throws using that ability.'),
      feat('srd-feat-mobile', 'Mobile', 'Speed increases by 10 feet; Dash ignores difficult terrain; melee attacks prevent opportunity attacks from that target for the rest of your turn.'),
      feat('srd-feat-spell-sniper', 'Spell Sniper', 'Double range of attack-roll spells; ranged spell attacks ignore half/three-quarters cover; learn one attack-roll cantrip.'),
      feat('srd-feat-dual-wielder', 'Dual Wielder', '+1 AC while wielding a separate melee weapon in each hand; use two-weapon fighting with non-light one-handed weapons; draw/stow two weapons.'),
      feat('srd-feat-heavy-armor-master', 'Heavy Armor Master', 'Increase STR by 1 (max 20); while wearing heavy armor, nonmagical bludgeoning, piercing, and slashing damage is reduced by 3.'),
    ],
  },
];
