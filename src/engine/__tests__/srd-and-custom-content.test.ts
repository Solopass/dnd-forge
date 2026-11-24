import { describe, expect, it } from 'vitest';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import {
  normalizeCustomCharacter,
  normalizeCustomEntity,
  parseCustomContentJson,
} from '../custom-content-loader';
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
});
