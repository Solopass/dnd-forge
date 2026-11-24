import { AcFormulaRule, CompendiumEntity, PassiveModifierRule } from '../types/compendium';
import { AbilityKey, ActionEconomy, Ruleset } from '../types/core';

export interface ContentPack {
  id: string;
  name: string;
  ruleset: Ruleset;
  description: string;
  entities: CompendiumEntity[];
}

function makeSpell(
  id: string,
  name: string,
  spellLevel: number,
  actionEconomy: ActionEconomy,
  opts: {
    concentration?: boolean;
    attack?: boolean;
    saveAbility?: AbilityKey;
    damageFormula?: string;
    damageType?: string;
    heal?: boolean;
    acFormula?: AcFormulaRule;
    description: string;
    entries?: string[];
  }
): CompendiumEntity {
  const poolId = spellLevel > 0 ? `spell_slot_${spellLevel}` : undefined;
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'spell',
    spellLevel,
    concentration: opts.concentration,
    prepared: true,
    acFormula: opts.acFormula,
    activities: [
      {
        id: `act-${id}`,
        name: spellLevel === 0 ? name : `Cast ${name} (${spellLevel})`,
        type: opts.heal
          ? 'heal'
          : opts.attack
          ? 'attack'
          : opts.saveAbility
          ? 'save'
          : 'utility',
        actionEconomy,
        resourceCost: poolId ? { poolId, amount: 1 } : undefined,
        attackBonusFormula: opts.attack ? '@spell + @prof' : undefined,
        saveAbility: opts.saveAbility,
        saveDcFormula: opts.saveAbility ? '8 + @prof + @spell' : undefined,
        damageFormula: opts.damageFormula,
        damageType: opts.damageType,
        description: opts.description,
      },
    ],
    entries: opts.entries ?? [opts.description],
  };
}

function makeWeapon(
  id: string,
  name: string,
  ability: AbilityKey,
  damageFormula: string,
  damageType: string,
  notes: string,
  ruleset: Ruleset = '2014',
  source = 'SRD 5.1'
): CompendiumEntity {
  return {
    id,
    name,
    source,
    ruleset,
    category: 'weapon',
    equipped: false,
    activities: [
      {
        id: `act-${id}`,
        name,
        type: 'attack',
        actionEconomy: 'action',
        attackAbility: ability,
        attackBonusFormula: `@${ability} + @prof`,
        damageFormula: `${damageFormula} + @${ability}`,
        damageType,
        description: notes,
      },
    ],
    entries: [notes],
  };
}

function makeArmor(
  id: string,
  name: string,
  base: number,
  dexCap: number | null,
  notes: string,
  category: 'armor' | 'shield' = 'armor',
  acFlatBonus?: number
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category,
    equipped: false,
    acFormula: category === 'armor' ? { base, dexCap } : undefined,
    acFlatBonus,
    activities: [],
    entries: [notes],
  };
}

function makeFeature(
  id: string,
  name: string,
  actionEconomy: ActionEconomy,
  description: string,
  opts?: {
    damageFormula?: string;
    damageType?: string;
    heal?: boolean;
    resourceCost?: { poolId: string; amount: number };
    modifiers?: PassiveModifierRule[];
  }
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'feat',
    equipped: true,
    modifiers: opts?.modifiers,
    activities: [
      {
        id: `act-${id}`,
        name,
        type: opts?.heal ? 'heal' : 'utility',
        actionEconomy,
        resourceCost: opts?.resourceCost,
        damageFormula: opts?.damageFormula,
        damageType: opts?.damageType,
        description,
      },
    ],
    entries: [description],
  };
}

function makeMonster(
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
    saveAbility?: AbilityKey;
    damageFormula: string;
    damageType: string;
  }>,
  notes: string
): CompendiumEntity {
  return {
    id,
    name,
    source: 'SRD 5.1',
    ruleset: '2014',
    category: 'monster',
    monsterMeta: { ac, hp, dexModifier, cr },
    activities: attacks.map((atk, idx) => ({
      id: `mob-${id}-${idx}`,
      name: atk.name,
      type: atk.type,
      actionEconomy: 'action',
      attackBonusFormula: atk.type === 'attack' ? atk.bonusOrDc : undefined,
      saveAbility: atk.saveAbility,
      saveDcFormula: atk.type === 'save' ? atk.bonusOrDc : undefined,
      damageFormula: atk.damageFormula,
      damageType: atk.damageType,
    })),
    entries: [notes],
  };
}

export const BUILTIN_CONTENT_PACKS: ContentPack[] = [
  {
    id: 'pack-srd-core-spells',
    name: 'SRD Core Spells (Cantrips – 5th Level)',
    ruleset: '2014',
    description: 'Essential D&D 5e SRD spells from cantrips through 5th level (Fire Bolt, Eldritch Blast, Magic Missile, Shield, Healing Word, Bless, Misty Step, Spiritual Weapon, Fireball, Counterspell, Haste, Spirit Guardians, Polymorph, Wall of Force).',
    entities: [
      makeSpell('srd-spell-fire-bolt', 'Fire Bolt', 0, 'action', {
        attack: true,
        damageFormula: '@cantripd10',
        damageType: 'fire',
        description: 'Ranged spell attack (120 ft). Deals {@damage @cantripd10} fire damage.',
      }),
      makeSpell('srd-spell-eldritch-blast', 'Eldritch Blast', 0, 'action', {
        attack: true,
        damageFormula: '1d10',
        damageType: 'force',
        description: 'Beam of crackling energy (120 ft). Deals {@damage 1d10} force damage per beam.',
      }),
      makeSpell('srd-spell-sacred-flame', 'Sacred Flame', 0, 'action', {
        saveAbility: 'dex',
        damageFormula: '@cantripd8',
        damageType: 'radiant',
        description: '60 ft. {@save dex} or take {@damage @cantripd8} radiant damage (ignores cover).',
      }),
      makeSpell('srd-spell-ray-of-frost', 'Ray of Frost', 0, 'action', {
        attack: true,
        damageFormula: '@cantripd8',
        damageType: 'cold',
        description: '60 ft. {@damage @cantripd8} cold damage and speed reduced by 10 ft until start of next turn.',
      }),
      makeSpell('srd-spell-vicious-mockery', 'Vicious Mockery', 0, 'action', {
        saveAbility: 'wis',
        damageFormula: '@cantripd4',
        damageType: 'psychic',
        description: '60 ft. {@save wis} or take {@damage @cantripd4} psychic damage and disadvantage on next attack.',
      }),
      makeSpell('srd-spell-guidance', 'Guidance', 0, 'action', {
        concentration: true,
        description: 'Touch. Target can add {@dice 1d4} to one ability check of its choice.',
      }),
      makeSpell('srd-spell-mage-hand', 'Mage Hand', 0, 'action', {
        description: '30 ft. Conjure a spectral floating hand that manipulates objects up to 10 lb.',
      }),
      makeSpell('srd-spell-magic-missile', 'Magic Missile', 1, 'action', {
        damageFormula: '3d4 + 3',
        damageType: 'force',
        description: 'Three darts of magical force automatically hit for {@damage 3d4+3} force damage.',
      }),
      makeSpell('srd-spell-shield', 'Shield', 1, 'reaction', {
        description: 'Reaction when hit by an attack: +5 bonus to AC until the start of your next turn.',
      }),
      makeSpell('srd-spell-healing-word', 'Healing Word', 1, 'bonus_action', {
        heal: true,
        damageFormula: '1d4 + @spell',
        damageType: 'healing',
        description: 'Range 60 ft. Restores {@dice 1d4+@spell} hit points.',
      }),
      makeSpell('srd-spell-cure-wounds', 'Cure Wounds', 1, 'action', {
        heal: true,
        damageFormula: '1d8 + @spell',
        damageType: 'healing',
        description: 'Touch. Restores {@dice 1d8+@spell} hit points.',
      }),
      makeSpell('srd-spell-bless', 'Bless', 1, 'action', {
        concentration: true,
        description: 'Up to 3 creatures add {@dice 1d4} to attack rolls and saving throws.',
      }),
      makeSpell('srd-spell-mage-armor', 'Mage Armor', 1, 'action', {
        acFormula: { base: 13, dexCap: null, requiresUnarmored: true },
        description: 'Touch. Unarmored target AC becomes 13 + DEX modifier for 8 hours.',
      }),
      makeSpell('srd-spell-faerie-fire', 'Faerie Fire', 1, 'action', {
        concentration: true,
        saveAbility: 'dex',
        description: '20-ft cube. {@save dex} or outlined in light; attacks against affected targets have advantage.',
      }),
      makeSpell('srd-spell-guiding-bolt', 'Guiding Bolt', 1, 'action', {
        attack: true,
        damageFormula: '4d6',
        damageType: 'radiant',
        description: '120 ft. {@damage 4d6} radiant damage; next attack against target has advantage.',
      }),
      makeSpell('srd-spell-burning-hands', 'Burning Hands', 1, 'action', {
        saveAbility: 'dex',
        damageFormula: '3d6',
        damageType: 'fire',
        description: '15-ft cone. {@save dex} or take {@damage 3d6} fire damage (half on success).',
      }),
      makeSpell('srd-spell-thunderwave', 'Thunderwave', 1, 'action', {
        saveAbility: 'con',
        damageFormula: '2d8',
        damageType: 'thunder',
        description: '15-ft cube. {@save con} or take {@damage 2d8} thunder damage and pushed 10 ft.',
      }),
      makeSpell('srd-spell-hex', 'Hex', 1, 'bonus_action', {
        concentration: true,
        damageFormula: '1d6',
        damageType: 'necrotic',
        description: '90 ft. Deal extra {@damage 1d6} necrotic damage on hits; target has disadvantage on one ability check.',
      }),
      makeSpell('srd-spell-hunters-mark', "Hunter's Mark", 1, 'bonus_action', {
        concentration: true,
        damageFormula: '1d6',
        damageType: 'piercing',
        description: '90 ft. Deal extra {@damage 1d6} weapon damage on hits against marked quarry.',
      }),
      makeSpell('srd-spell-misty-step', 'Misty Step', 2, 'bonus_action', {
        description: 'Teleport up to 30 feet to an unoccupied space that you can see.',
      }),
      makeSpell('srd-spell-spiritual-weapon', 'Spiritual Weapon', 2, 'bonus_action', {
        attack: true,
        damageFormula: '1d8 + @spell',
        damageType: 'force',
        description: '60 ft. Spectral weapon strikes for {@damage 1d8+@spell} force damage.',
      }),
      makeSpell('srd-spell-hold-person', 'Hold Person', 2, 'action', {
        concentration: true,
        saveAbility: 'wis',
        description: '60 ft. {@save wis} or humanoid is Paralyzed for up to 1 minute.',
      }),
      makeSpell('srd-spell-scorching-ray', 'Scorching Ray', 2, 'action', {
        attack: true,
        damageFormula: '2d6',
        damageType: 'fire',
        description: '120 ft. Three rays of fire; each hit deals {@damage 2d6} fire damage.',
      }),
      makeSpell('srd-spell-mirror-image', 'Mirror Image', 2, 'action', {
        description: 'Three illusory duplicates appear in your space for 1 minute.',
      }),
      makeSpell('srd-spell-web', 'Web', 2, 'action', {
        concentration: true,
        saveAbility: 'dex',
        description: '20-ft cube. Difficult terrain; {@save dex} or Restrained.',
      }),
      makeSpell('srd-spell-aid', 'Aid', 2, 'action', {
        description: 'Up to 3 allies gain +5 current and maximum HP for 8 hours.',
      }),
      makeSpell('srd-spell-fireball', 'Fireball', 3, 'action', {
        saveAbility: 'dex',
        damageFormula: '8d6',
        damageType: 'fire',
        description: '20-ft radius sphere. {@save dex} or take {@damage 8d6} fire damage (half on success).',
      }),
      makeSpell('srd-spell-counterspell', 'Counterspell', 3, 'reaction', {
        description: '60 ft. Interrupt a creature casting a spell of 3rd level or lower (ability check for higher).',
      }),
      makeSpell('srd-spell-haste', 'Haste', 3, 'action', {
        concentration: true,
        description: 'Doubles speed, +2 AC, advantage on DEX saves, and 1 additional action each turn.',
      }),
      makeSpell('srd-spell-revivify', 'Revivify', 3, 'action', {
        description: 'Touch a creature that died within the last minute; it returns to life with 1 HP.',
      }),
      makeSpell('srd-spell-spirit-guardians', 'Spirit Guardians', 3, 'action', {
        concentration: true,
        saveAbility: 'wis',
        damageFormula: '3d8',
        damageType: 'radiant',
        description: '15-ft emanation. {@save wis} or take {@damage 3d8} radiant/necrotic damage and half speed.',
      }),
      makeSpell('srd-spell-dispel-magic', 'Dispel Magic', 3, 'action', {
        description: '120 ft. End spells of 3rd level or lower on a creature, object, or magical effect.',
      }),
      makeSpell('srd-spell-lightning-bolt', 'Lightning Bolt', 3, 'action', {
        saveAbility: 'dex',
        damageFormula: '8d6',
        damageType: 'lightning',
        description: '100-ft line. {@save dex} or take {@damage 8d6} lightning damage (half on success).',
      }),
      makeSpell('srd-spell-fly', 'Fly', 3, 'action', {
        concentration: true,
        description: 'Touch. Target gains a flying speed of 60 feet for up to 10 minutes.',
      }),
      makeSpell('srd-spell-polymorph', 'Polymorph', 4, 'action', {
        concentration: true,
        saveAbility: 'wis',
        description: '60 ft. Transform a creature into a beast of CR <= target level/CR.',
      }),
      makeSpell('srd-spell-banishment', 'Banishment', 4, 'action', {
        concentration: true,
        saveAbility: 'cha',
        description: '60 ft. {@save cha} or banish target to a harmless demiplane or home plane.',
      }),
      makeSpell('srd-spell-dimension-door', 'Dimension Door', 4, 'action', {
        description: 'Teleport yourself and up to one willing creature up to 500 feet.',
      }),
      makeSpell('srd-spell-greater-invisibility', 'Greater Invisibility', 4, 'action', {
        concentration: true,
        description: 'Touch. Target is Invisible for 1 minute, even when attacking or casting.',
      }),
      makeSpell('srd-spell-wall-of-force', 'Wall of Force', 5, 'action', {
        concentration: true,
        description: '120 ft. Invisible wall of force immune to all damage.',
      }),
      makeSpell('srd-spell-cone-of-cold', 'Cone of Cold', 5, 'action', {
        saveAbility: 'con',
        damageFormula: '8d8',
        damageType: 'cold',
        description: '60-ft cone. {@save con} or take {@damage 8d8} cold damage (half on success).',
      }),
      makeSpell('srd-spell-hold-monster', 'Hold Monster', 5, 'action', {
        concentration: true,
        saveAbility: 'wis',
        description: '90 ft. {@save wis} or creature is Paralyzed for up to 1 minute.',
      }),
    ],
  },
  {
    id: 'pack-srd-weapons-armor',
    name: 'SRD 5.1 Core Weapons & Armor',
    ruleset: '2014',
    description: 'Complete base set of D&D 5e SRD simple/martial weapons, light/medium/heavy armor, and shields.',
    entities: [
      makeWeapon('srd-wpn-dagger', 'Dagger', 'dex', '1d4', 'piercing', 'Finesse, Light, Thrown (20/60).'),
      makeWeapon('srd-wpn-shortsword', 'Shortsword', 'dex', '1d6', 'piercing', 'Finesse, Light.'),
      makeWeapon('srd-wpn-longsword', 'Longsword', 'str', '1d8', 'slashing', 'Versatile (1d10).'),
      makeWeapon('srd-wpn-greatsword', 'Greatsword', 'str', '2d6', 'slashing', 'Heavy, Two-Handed.'),
      makeWeapon('srd-wpn-greataxe', 'Greataxe', 'str', '1d12', 'slashing', 'Heavy, Two-Handed.'),
      makeWeapon('srd-wpn-rapier', 'Rapier', 'dex', '1d8', 'piercing', 'Finesse.'),
      makeWeapon('srd-wpn-quarterstaff', 'Quarterstaff', 'str', '1d6', 'bludgeoning', 'Versatile (1d8).'),
      makeWeapon('srd-wpn-mace', 'Mace', 'str', '1d6', 'bludgeoning', 'Simple melee weapon.'),
      makeWeapon('srd-wpn-handaxe', 'Handaxe', 'str', '1d6', 'slashing', 'Light, Thrown (20/60).'),
      makeWeapon('srd-wpn-spear', 'Spear', 'str', '1d6', 'piercing', 'Thrown (20/60), Versatile (1d8).'),
      makeWeapon('srd-wpn-warhammer', 'Warhammer', 'str', '1d8', 'bludgeoning', 'Versatile (1d10).'),
      makeWeapon('srd-wpn-halberd', 'Halberd', 'str', '1d10', 'slashing', 'Heavy, Reach, Two-Handed.'),
      makeWeapon('srd-wpn-shortbow', 'Shortbow', 'dex', '1d6', 'piercing', 'Ammunition (80/320), Two-Handed.'),
      makeWeapon('srd-wpn-longbow', 'Longbow', 'dex', '1d8', 'piercing', 'Ammunition (150/600), Heavy, Two-Handed.'),
      makeWeapon('srd-wpn-light-crossbow', 'Light Crossbow', 'dex', '1d8', 'piercing', 'Ammunition (80/320), Loading, Two-Handed.'),
      makeWeapon('srd-wpn-heavy-crossbow', 'Heavy Crossbow', 'dex', '1d10', 'piercing', 'Ammunition (100/400), Heavy, Loading, Two-Handed.'),
      makeWeapon('srd-wpn-javelin', 'Javelin', 'str', '1d6', 'piercing', 'Thrown (30/120).'),
      makeArmor('srd-arm-leather', 'Leather Armor', 11, null, 'Light Armor: AC 11 + DEX modifier.'),
      makeArmor('srd-arm-studded-leather', 'Studded Leather Armor', 12, null, 'Light Armor: AC 12 + DEX modifier.'),
      makeArmor('srd-arm-hide', 'Hide Armor', 12, 2, 'Medium Armor: AC 12 + DEX modifier (max 2).'),
      makeArmor('srd-arm-chain-shirt', 'Chain Shirt', 13, 2, 'Medium Armor: AC 13 + DEX modifier (max 2).'),
      makeArmor('srd-arm-scale-mail', 'Scale Mail', 14, 2, 'Medium Armor: AC 14 + DEX (max 2), Stealth disadvantage.'),
      makeArmor('srd-arm-breastplate', 'Breastplate', 14, 2, 'Medium Armor: AC 14 + DEX modifier (max 2).'),
      makeArmor('srd-arm-half-plate', 'Half Plate', 15, 2, 'Medium Armor: AC 15 + DEX (max 2), Stealth disadvantage.'),
      makeArmor('srd-arm-ring-mail', 'Ring Mail', 14, 0, 'Heavy Armor: AC 14, Stealth disadvantage.'),
      makeArmor('srd-arm-chain-mail', 'Chain Mail', 16, 0, 'Heavy Armor: AC 16 (STR 13), Stealth disadvantage.'),
      makeArmor('srd-arm-splint', 'Splint Armor', 17, 0, 'Heavy Armor: AC 17 (STR 15), Stealth disadvantage.'),
      makeArmor('srd-arm-plate', 'Plate Armor', 18, 0, 'Heavy Armor: AC 18 (STR 15), Stealth disadvantage.'),
      makeArmor('srd-arm-shield', 'Shield (+2 AC)', 0, null, 'Grants +2 bonus to Armor Class while wielded.', 'shield', 2),
    ],
  },
  {
    id: 'pack-srd-features-feats',
    name: 'SRD Core Class Features & Feats',
    ruleset: '2014',
    description: 'Core class actions and feats: Second Wind, Action Surge, Rage, Sneak Attack, Cunning Action, Lay on Hands, Divine Smite, Wild Shape, Bardic Inspiration, Tough, War Caster, Alert, Lucky.',
    entities: [
      makeFeature('srd-feat-second-wind', 'Second Wind', 'bonus_action', 'Fighter: Regain {@dice 1d10+@lvl} HP once per short/long rest.', {
        heal: true,
        damageFormula: '1d10 + @lvl',
        damageType: 'healing',
        resourceCost: { poolId: 'auto_class_second_wind', amount: 1 },
      }),
      makeFeature('srd-feat-action-surge', 'Action Surge', 'free', 'Fighter: Take one additional action on your turn (1/short rest).', {
        resourceCost: { poolId: 'auto_class_action_surge', amount: 1 },
      }),
      makeFeature('srd-feat-rage', 'Rage', 'bonus_action', 'Barbarian: Advantage on STR checks/saves, bonus melee damage, resistance to B/P/S.', {
        resourceCost: { poolId: 'auto_class_rage', amount: 1 },
      }),
      makeFeature('srd-feat-sneak-attack', 'Sneak Attack', 'free', 'Rogue: Deal extra {@damage 3d6} damage once per turn with finesse/ranged weapon.', { damageFormula: '3d6', damageType: 'piercing' }),
      makeFeature('srd-feat-cunning-action', 'Cunning Action', 'bonus_action', 'Rogue: Dash, Disengage, or Hide as a bonus action.'),
      makeFeature('srd-feat-lay-on-hands', 'Lay on Hands', 'action', 'Paladin: Restore HP from a pool equal to 5 x Paladin level, or cure disease/poison.', {
        heal: true,
        damageFormula: '5',
        damageType: 'healing',
        resourceCost: { poolId: 'auto_class_lay_on_hands', amount: 5 },
      }),
      makeFeature('srd-feat-divine-smite', 'Divine Smite', 'free', 'Paladin: Expend a 1st-level slot on melee hit for {@damage 2d8} radiant damage (+1d8 vs undead/fiend).', {
        damageFormula: '2d8',
        damageType: 'radiant',
        resourceCost: { poolId: 'spell_slot_1', amount: 1 },
      }),
      makeFeature('srd-feat-wild-shape', 'Wild Shape', 'action', 'Druid: Magically assume the shape of a beast you have seen before.', {
        resourceCost: { poolId: 'auto_class_wild_shape', amount: 1 },
      }),
      makeFeature('srd-feat-bardic-inspiration', 'Bardic Inspiration', 'bonus_action', 'Bard: Grant an ally within 60 ft an Inspiration die ({@dice 1d8}).', {
        resourceCost: { poolId: 'auto_class_bardic_insp', amount: 1 },
      }),
      makeFeature('srd-feat-channel-divinity', 'Channel Divinity', 'action', 'Cleric/Paladin: Channel divine energy for Turn Undead or subclass effect.', {
        resourceCost: { poolId: 'auto_class_channel_divinity', amount: 1 },
      }),
      makeFeature('srd-feat-flurry-of-blows', 'Flurry of Blows', 'bonus_action', 'Monk: Spend 1 Ki/Focus point to make two unarmed strikes as a bonus action.', {
        resourceCost: { poolId: 'auto_class_ki', amount: 1 },
      }),
      makeFeature('srd-feat-war-caster', 'War Caster (Feat)', 'free', 'Advantage on CON saves for concentration; cast spell as opportunity attack.'),
      makeFeature('srd-feat-tough', 'Tough (Feat)', 'free', 'Hit point maximum increases by 2 for every level you have gained.'),
      makeFeature('srd-feat-alert', 'Alert (Feat)', 'free', '+5 bonus to initiative; cannot be surprised while conscious.', {
        modifiers: [{ target: 'initiative', value: 5 }],
      }),
      makeFeature('srd-feat-lucky', 'Lucky (Feat)', 'free', '3 Luck points per long rest to roll an extra d20 on attack, check, or save.'),
    ],
  },
  {
    id: 'pack-2024-weapon-mastery',
    name: '2024 SRD 5.2 Weapons & Mastery Gear',
    ruleset: '2024',
    description: '2024 ruleset weapons with Weapon Mastery properties (Graze, Vex, Sap, Push, Topple, Cleave, Slow, Nick).',
    entities: [
      makeWeapon('srd24-greatsword', 'Greatsword (Graze)', 'str', '2d6', 'slashing', 'Heavy, Two-Handed. Mastery (Graze): On a miss, still deal {@str} slashing damage.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-rapier', 'Rapier (Vex)', 'dex', '1d8', 'piercing', 'Finesse. Mastery (Vex): On hit, gain Advantage on your next attack roll against that target.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-longsword', 'Longsword (Sap)', 'str', '1d8', 'slashing', 'Versatile (1d10). Mastery (Sap): Target has Disadvantage on its next attack roll.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-warhammer', 'Warhammer (Push)', 'str', '1d8', 'bludgeoning', 'Versatile (1d10). Mastery (Push): Push Large or smaller target up to 10 ft.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-quarterstaff', 'Quarterstaff (Topple)', 'str', '1d6', 'bludgeoning', 'Versatile (1d8). Mastery (Topple): CON save or target falls Prone.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-halberd', 'Halberd (Cleave)', 'str', '1d10', 'slashing', 'Heavy, Reach. Mastery (Cleave): Make an extra melee attack against a second adjacent creature.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-longbow', 'Longbow (Slow)', 'dex', '1d8', 'piercing', 'Heavy, Two-Handed. Mastery (Slow): Reduce target speed by 10 ft until start of your next turn.', '2024', 'SRD 5.2'),
      makeWeapon('srd24-dagger', 'Dagger (Nick)', 'dex', '1d4', 'piercing', 'Finesse, Light, Thrown. Mastery (Nick): Make extra Light-weapon attack as part of Attack action.', '2024', 'SRD 5.2'),
    ],
  },
  {
    id: 'pack-srd-monsters',
    name: 'SRD 5.1 Encounter Monsters Pack',
    ruleset: '2014',
    description: 'Core D&D 5e SRD monsters from CR 1/8 to CR 14 (Kobold, Goblin, Goblin Boss, Skeleton, Zombie, Wolf, Dire Wolf, Orc, Bugbear, Gelatinous Cube, Mimic, Ogre, Owlbear, Troll, Vampire Spawn, Young Red Dragon, Adult Black Dragon).',
    entities: [
      makeMonster('srd-mob-kobold', 'Kobold', 12, 5, 2, '1/8', [
        { name: 'Dagger', type: 'attack', bonusOrDc: '+4', damageFormula: '1d4+2', damageType: 'piercing' },
        { name: 'Sling', type: 'attack', bonusOrDc: '+4', damageFormula: '1d4+2', damageType: 'bludgeoning' },
      ], 'Pack Tactics, Sunlight Sensitivity.'),
      makeMonster('srd-mob-goblin', 'Goblin', 15, 7, 2, '1/4', [
        { name: 'Scimitar', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'slashing' },
        { name: 'Shortbow', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'piercing' },
      ], 'Nimble Escape: Disengage or Hide as a bonus action.'),
      makeMonster('srd-mob-goblin-boss', 'Goblin Boss', 17, 21, 2, '1', [
        { name: 'Scimitar', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'slashing' },
        { name: 'Javelin', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'piercing' },
      ], 'Multiattack (2 scimitar attacks). Redirect Attack reaction.'),
      makeMonster('srd-mob-skeleton', 'Skeleton', 13, 13, 2, '1/4', [
        { name: 'Shortsword', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'piercing' },
        { name: 'Shortbow', type: 'attack', bonusOrDc: '+4', damageFormula: '1d6+2', damageType: 'piercing' },
      ], 'Vulnerable to bludgeoning; immune to poison.'),
      makeMonster('srd-mob-zombie', 'Zombie', 8, 22, -2, '1/4', [
        { name: 'Slam', type: 'attack', bonusOrDc: '+3', damageFormula: '1d6+1', damageType: 'bludgeoning' },
      ], 'Undead Fortitude: CON save (DC 5 + damage) to drop to 1 HP instead of 0.'),
      makeMonster('srd-mob-wolf', 'Wolf', 13, 11, 2, '1/4', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+4', damageFormula: '2d4+2', damageType: 'piercing' },
      ], 'Pack Tactics. Target makes DC 11 STR save or knocked Prone.'),
      makeMonster('srd-mob-dire-wolf', 'Dire Wolf', 14, 37, 2, '1', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+5', damageFormula: '2d6+3', damageType: 'piercing' },
      ], 'Pack Tactics. Target makes DC 13 STR save or knocked Prone.'),
      makeMonster('srd-mob-orc', 'Orc', 13, 15, 1, '1/2', [
        { name: 'Greataxe', type: 'attack', bonusOrDc: '+5', damageFormula: '1d12+3', damageType: 'slashing' },
        { name: 'Javelin', type: 'attack', bonusOrDc: '+5', damageFormula: '1d6+3', damageType: 'piercing' },
      ], 'Aggressive: Bonus action move toward a hostile creature.'),
      makeMonster('srd-mob-bugbear', 'Bugbear', 16, 27, 2, '1', [
        { name: 'Morningstar', type: 'attack', bonusOrDc: '+4', damageFormula: '2d8+2', damageType: 'piercing' },
        { name: 'Javelin', type: 'attack', bonusOrDc: '+4', damageFormula: '2d6+2', damageType: 'piercing' },
      ], 'Brute (+1 weapon damage die); Surprise Attack (+2d6).'),
      makeMonster('srd-mob-gelatinous-cube', 'Gelatinous Cube', 6, 84, -4, '2', [
        { name: 'Pseudopod', type: 'attack', bonusOrDc: '+4', damageFormula: '3d6', damageType: 'acid' },
        { name: 'Engulf (DC 12 DEX)', type: 'save', bonusOrDc: '12', saveAbility: 'dex', damageFormula: '6d6', damageType: 'acid' },
      ], 'Transparent (DC 15 Perception). Engulfs creatures in its space.'),
      makeMonster('srd-mob-mimic', 'Mimic', 12, 58, 1, '2', [
        { name: 'Pseudopod', type: 'attack', bonusOrDc: '+5', damageFormula: '1d8+3', damageType: 'bludgeoning' },
        { name: 'Bite', type: 'attack', bonusOrDc: '+5', damageFormula: '1d8+3+1d8', damageType: 'piercing + acid' },
      ], 'Adhesive: Grappled on hit (Escape DC 13).'),
      makeMonster('srd-mob-ogre', 'Ogre', 11, 59, -1, '2', [
        { name: 'Greatclub', type: 'attack', bonusOrDc: '+6', damageFormula: '2d8+4', damageType: 'bludgeoning' },
        { name: 'Javelin', type: 'attack', bonusOrDc: '+6', damageFormula: '2d6+4', damageType: 'piercing' },
      ], 'Large giant.'),
      makeMonster('srd-mob-owlbear', 'Owlbear', 13, 59, 1, '3', [
        { name: 'Beak', type: 'attack', bonusOrDc: '+7', damageFormula: '1d10+5', damageType: 'piercing' },
        { name: 'Claws', type: 'attack', bonusOrDc: '+7', damageFormula: '2d8+5', damageType: 'slashing' },
      ], 'Multiattack: The owlbear makes two attacks: one with its beak and one with its claws.'),
      makeMonster('srd-mob-troll', 'Troll', 15, 84, 1, '5', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+7', damageFormula: '1d6+4', damageType: 'piercing' },
        { name: 'Claw', type: 'attack', bonusOrDc: '+7', damageFormula: '2d6+4', damageType: 'slashing' },
      ], 'Regeneration 10 HP/turn unless it took acid or fire damage.'),
      makeMonster('srd-mob-vampire-spawn', 'Vampire Spawn', 15, 82, 3, '5', [
        { name: 'Claws', type: 'attack', bonusOrDc: '+6', damageFormula: '2d4+3', damageType: 'slashing' },
        { name: 'Bite', type: 'attack', bonusOrDc: '+6', damageFormula: '1d6+3+2d6', damageType: 'piercing + necrotic' },
      ], 'Regeneration 10 HP/turn; Spider Climb.'),
      makeMonster('srd-mob-young-red-dragon', 'Young Red Dragon', 18, 178, 0, '10', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+10', damageFormula: '2d10+6+1d6', damageType: 'piercing + fire' },
        { name: 'Claw', type: 'attack', bonusOrDc: '+10', damageFormula: '2d6+6', damageType: 'slashing' },
        { name: 'Fire Breath (Recharge 5-6)', type: 'save', bonusOrDc: '17', saveAbility: 'dex', damageFormula: '16d6', damageType: 'fire' },
      ], 'Multiattack (1 Bite, 2 Claws). Fire Breath (Recharge 5-6): DC 17 DEX save, 16d6 fire damage.'),
      makeMonster('srd-mob-adult-black-dragon', 'Adult Black Dragon', 19, 195, 2, '14', [
        { name: 'Bite', type: 'attack', bonusOrDc: '+11', damageFormula: '2d10+6+1d8', damageType: 'piercing + acid' },
        { name: 'Claw', type: 'attack', bonusOrDc: '+11', damageFormula: '2d6+6', damageType: 'slashing' },
        { name: 'Acid Breath (Recharge 5-6)', type: 'save', bonusOrDc: '18', saveAbility: 'dex', damageFormula: '12d8', damageType: 'acid' },
      ], 'Legendary Resistance (3/day). Multiattack + Legendary Actions.'),
    ],
  },
  {
    id: 'pack-srd-high-level-spells',
    name: 'SRD High-Level Spells (6th–9th Level)',
    ruleset: '2014',
    description: 'High-tier SRD 5.1 spells from 6th to 9th level (Chain Lightning, Disintegrate, Heal, Sunbeam, Finger of Death, Forcecage, Sunburst, Meteor Swarm, Power Word Kill, Wish).',
    entities: [
      makeSpell('srd-spell-chain-lightning', 'Chain Lightning', 6, 'action', {
        saveAbility: 'dex',
        damageFormula: '10d8',
        damageType: 'lightning',
        description: '150 ft. Bolt leaps to 3 additional targets. {@save dex} or take {@damage 10d8} lightning damage (half on success).',
      }),
      makeSpell('srd-spell-disintegrate', 'Disintegrate', 6, 'action', {
        saveAbility: 'dex',
        damageFormula: '10d6 + 40',
        damageType: 'force',
        description: '60 ft. {@save dex} or take {@damage 10d6+40} force damage; turns target to dust at 0 HP.',
      }),
      makeSpell('srd-spell-heal', 'Heal', 6, 'action', {
        heal: true,
        damageFormula: '70',
        damageType: 'healing',
        description: '60 ft. Target regains 70 hit points and ends blindness, deafness, and any diseases.',
      }),
      makeSpell('srd-spell-sunbeam', 'Sunbeam', 6, 'action', {
        concentration: true,
        saveAbility: 'con',
        damageFormula: '6d8',
        damageType: 'radiant',
        description: '60-ft line. {@save con} or take {@damage 6d8} radiant damage and Blinded until your next turn.',
      }),
      makeSpell('srd-spell-globe-of-invulnerability', 'Globe of Invulnerability', 6, 'action', {
        concentration: true,
        description: '10-ft radius barrier blocks spells of 5th level or lower.',
      }),
      makeSpell('srd-spell-finger-of-death', 'Finger of Death', 7, 'action', {
        saveAbility: 'con',
        damageFormula: '7d8 + 30',
        damageType: 'necrotic',
        description: '60 ft. {@save con} or take {@damage 7d8+30} necrotic damage (half on success).',
      }),
      makeSpell('srd-spell-fire-storm', 'Fire Storm', 7, 'action', {
        saveAbility: 'dex',
        damageFormula: '7d10',
        damageType: 'fire',
        description: 'Up to ten 10-ft cubes. {@save dex} or take {@damage 7d10} fire damage.',
      }),
      makeSpell('srd-spell-forcecage', 'Forcecage', 7, 'action', {
        description: '100 ft. Trap creatures inside an immobile invisible cage/box of force for 1 hour.',
      }),
      makeSpell('srd-spell-teleport', 'Teleport', 7, 'action', {
        description: 'Instantly transport yourself and up to eight willing creatures to a known destination.',
      }),
      makeSpell('srd-spell-resurrection', 'Resurrection', 7, 'action', {
        description: 'Touch a dead creature (dead <= 100 years) to restore it to life with full HP.',
      }),
      makeSpell('srd-spell-power-word-stun', 'Power Word Stun', 8, 'action', {
        description: '60 ft. Creature with 150 HP or fewer is Stunned.',
      }),
      makeSpell('srd-spell-sunburst', 'Sunburst', 8, 'action', {
        saveAbility: 'con',
        damageFormula: '12d6',
        damageType: 'radiant',
        description: '60-ft radius sphere. {@save con} or take {@damage 12d6} radiant damage and Blinded for 1 minute.',
      }),
      makeSpell('srd-spell-mind-blank', 'Mind Blank', 8, 'action', {
        description: '24 hours. Immune to psychic damage, mind reading, and charmed condition.',
      }),
      makeSpell('srd-spell-dominate-monster', 'Dominate Monster', 8, 'action', {
        concentration: true,
        saveAbility: 'wis',
        description: '60 ft. {@save wis} or creature is Charmed and obeys telepathic commands.',
      }),
      makeSpell('srd-spell-meteor-swarm', 'Meteor Swarm', 9, 'action', {
        saveAbility: 'dex',
        damageFormula: '20d6 + 20d6',
        damageType: 'fire + bludgeoning',
        description: 'Four 40-ft radius spheres (1 mile). {@save dex} or take {@damage 20d6+20d6} fire + bludgeoning damage.',
      }),
      makeSpell('srd-spell-power-word-kill', 'Power Word Kill', 9, 'action', {
        description: '60 ft. If target has 100 HP or fewer, it dies instantaneously.',
      }),
      makeSpell('srd-spell-wish', 'Wish', 9, 'action', {
        description: 'Duplicate any spell of 8th level or lower without components, or reshape reality.',
      }),
      makeSpell('srd-spell-true-resurrection', 'True Resurrection', 9, 'action', {
        description: 'Restore a creature dead up to 200 years to life with full HP and new body if needed.',
      }),
      makeSpell('srd-spell-foresight', 'Foresight', 9, 'action', {
        description: '8 hours. Target cannot be surprised and has advantage on attacks, checks, and saves.',
      }),
    ],
  },
];
