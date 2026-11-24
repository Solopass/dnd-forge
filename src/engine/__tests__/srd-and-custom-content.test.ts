import { describe, expect, it } from 'vitest';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import {
  normalizeCustomCharacter,
  normalizeCustomEntity,
  parseCustomContentJson,
} from '../custom-content-loader';
import { parse5eToolsEntries } from '../tags';
import {
  convertCsvToSidererollList,
  convertMarkdownToSidererollList,
  convertRawEntityToSidereroll,
} from '../content-converter';
import monsterTemplate from '../../custom-content/_templates/monster.json';
import itemTemplate from '../../custom-content/_templates/item.json';
import spellTemplate from '../../custom-content/_templates/spell.json';
import featureTemplate from '../../custom-content/_templates/feature.json';
import characterTemplate from '../../custom-content/_templates/character.json';

describe('Expanded D&D 5e SRD Packs', () => {
  it('contains expanded weapons, potions, spells, monsters, and feats with unique IDs', () => {
    const allEntities = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const ids = allEntities.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    expect(uniqueIds.has('srd-wpn-scimitar')).toBe(true);
    expect(uniqueIds.has('srd-gear-potion-healing')).toBe(true);
    expect(uniqueIds.has('srd-spl-spirit-guardians')).toBe(true);
    expect(uniqueIds.has('srd-mob-ancient-red-dragon')).toBe(true);
    expect(uniqueIds.has('srd-feat-gwm')).toBe(true);
  });
});

describe('Custom Content Templates & JSON Loader', () => {
  it('normalizes all _templates files cleanly', () => {
    const mob = normalizeCustomEntity(monsterTemplate as Record<string, unknown>, 'monster');
    const item = normalizeCustomEntity(itemTemplate as Record<string, unknown>, 'gear');
    const spl = normalizeCustomEntity(spellTemplate as Record<string, unknown>, 'spell');
    const feat = normalizeCustomEntity(featureTemplate as Record<string, unknown>, 'feature');
    const ch = normalizeCustomCharacter(characterTemplate as Record<string, unknown>);

    expect(mob?.category).toBe('monster');
    expect(mob?.monsterMeta?.cr).toBe('3');
    expect(item?.weaponMastery).toBe('Sap');
    expect(spl?.spellLevel).toBe(2);
    expect(feat?.modifiers?.length).toBe(1);
    expect(ch?.classes[0]?.className).toBe('Fighter');
  });

  it('parses single entity, array of entities, and character JSON via parseCustomContentJson', () => {
    const single = parseCustomContentJson(JSON.stringify(monsterTemplate));
    expect(single.entities).toHaveLength(1);
    expect(single.characters).toHaveLength(0);

    const batch = parseCustomContentJson(JSON.stringify([itemTemplate, spellTemplate]));
    expect(batch.entities).toHaveLength(2);

    const pc = parseCustomContentJson(JSON.stringify(characterTemplate));
    expect(pc.characters).toHaveLength(1);
    expect(pc.characters[0]?.name).toBe('Kaelen Voss');
  });

  it('flattens nested entry blocks, lists, and description fallbacks and parses 5e tags', () => {
    const richItem = normalizeCustomEntity(
      {
        name: 'Solar Flare',
        category: 'spell',
        entries: [
          'Target makes a {@dc 15} DEX save or takes {@damage 8d6} fire damage.',
          { type: 'entries', name: 'At Higher Levels', entries: ['Deals {@scaledamage 8d6|3-9|1d6} extra.'] },
          { type: 'list', items: ['Bright light 30 ft', 'Ignites flammable objects'] },
        ],
      },
      'spell'
    );
    expect(richItem?.entries).toEqual([
      'Target makes a {@dc 15} DEX save or takes {@damage 8d6} fire damage.',
      'At Higher Levels: Deals {@scaledamage 8d6|3-9|1d6} extra.',
      '• Bright light 30 ft',
      '• Ignites flammable objects',
    ]);

    const descFallback = normalizeCustomEntity(
      { name: 'Note Ring', description: 'First paragraph.\n\nSecond paragraph.' },
      'gear'
    );
    expect(descFallback?.entries).toEqual(['First paragraph.', 'Second paragraph.']);

    const segs = parse5eToolsEntries('Save {@dc 15} or {@scaledamage 8d6|3-9|1d6}');
    expect(segs.some((s) => s.kind === 'save' && s.display === 'DC 15')).toBe(true);
    expect(segs.some((s) => s.kind === 'roll' && s.display === '+1d6/lvl')).toBe(true);

    const withImg = normalizeCustomEntity(
      { name: 'Moonblade', image: './images/items/moonblade.webp' },
      'weapon'
    );
    expect(withImg?.imageUrl).toBe('./images/items/moonblade.webp');
  });

  it('converts external 5e-style spells/monsters and validates repo custom-content', () => {
    const convertedSpell = convertRawEntityToSidereroll(
      {
        name: 'Chromatic Orb',
        level: 1,
        time: [{ number: 1, unit: 'action' }],
        range: { distance: { amount: 90, type: 'feet' } },
        components: { v: true, s: true, m: 'a diamond worth at least 50 gp' },
        duration: [{ type: 'instant' }],
        spellAttack: ['R'],
        damageInflict: ['acid'],
        entries: ['You hurl a 4-inch-diameter sphere of energy. On a hit, the target takes {@damage 3d8} acid damage.'],
      },
      'spell',
      '2014',
      'PHB'
    );
    expect(convertedSpell?.id).toBe('custom-spl-chromatic-orb');
    expect(convertedSpell?.spellLevel).toBe(1);
    expect(convertedSpell?.castingTime).toBe('1 action');
    expect(convertedSpell?.range).toBe('90 feet');
    expect(convertedSpell?.activities[0]?.type).toBe('attack');
    expect(convertedSpell?.activities[0]?.damageFormula).toBe('3d8');

    const mdMulti = `# Frost Bolt\n1st-level evocation\nMake a ranged spell attack dealing 2d8 cold damage.\n---\n# Shadow Hound\nAC 14 HP 33 CR 1\nBite: +5 to hit, 1d8+3 piercing damage.`;
    const fromMd = convertMarkdownToSidererollList(mdMulti, 'spell', '2024', 'Custom MD');
    expect(fromMd).toHaveLength(2);
    expect(fromMd[0]?.name).toBe('Frost Bolt');
    expect(fromMd[1]?.name).toBe('Shadow Hound');

    const csvRaw = `name,damageFormula,description\nSilver Dagger,1d4+@mod,Counts as silvered.\nRope of Climbing,,60 feet of silk rope.`;
    const fromCsv = convertCsvToSidererollList(csvRaw, 'gear', '2014', 'Custom CSV');
    expect(fromCsv).toHaveLength(2);
    expect(fromCsv[0]?.name).toBe('Silver Dagger');
    expect(fromCsv[1]?.entries[0]).toBe('60 feet of silk rope.');

    const srdApiMonster = convertRawEntityToSidereroll(
      {
        name: 'Adult Black Dragon',
        size: 'Huge',
        armor_class: [{ type: 'natural', value: 19 }],
        hit_points: 195,
        dexterity: 14,
        challenge_rating: 14,
        damage_immunities: ['Acid'],
        senses: { darkvision: '120 ft.', blindsight: '60 ft.' },
        speed: { walk: '40 ft.', fly: '80 ft.' },
        actions: [{ name: 'Bite', desc: 'Melee Weapon Attack.', attack_bonus: 11, damage: [{ damage_dice: '2d10+6', damage_type: { name: 'Piercing' } }] }],
      },
      'monster',
      '2014',
      '5e-SRD-API'
    );
    expect(srdApiMonster?.monsterMeta?.ac).toBe(19);
    expect(srdApiMonster?.monsterMeta?.hp).toBe(195);
    expect(srdApiMonster?.monsterMeta?.dexModifier).toBe(2);
    expect(srdApiMonster?.monsterMeta?.cr).toBe('14');
    expect(srdApiMonster?.activities[0]?.attackBonusFormula).toBe('11');
    expect(srdApiMonster?.activities[0]?.damageFormula).toBe('2d10+6');

    const open5eSpell = convertRawEntityToSidereroll(
      {
        name: 'Guiding Bolt',
        level_int: 1,
        casting_time: '1 action',
        range: '120 feet',
        components: 'V, S',
        duration: '1 round',
        requires_concentration: false,
        desc: 'A flash of light streaks toward a creature. On a hit, the target takes 4d6 radiant damage.',
        higher_level: 'The damage increases by 1d6 for each slot level above 1st.',
        document__title: '5e Core Rules',
      },
      'spell',
      '2014'
    );
    expect(open5eSpell?.spellLevel).toBe(1);
    expect(open5eSpell?.source).toBe('5e Core Rules');
    expect(open5eSpell?.entries[1]).toContain('At Higher Levels:');
  });
});
