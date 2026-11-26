import { describe, expect, it } from 'vitest';
import { computeCharacterSheet, createBlankCharacter } from '../rules-math';
import { BUILTIN_CONTENT_PACKS } from '../srd-packs';
import { loadCustomRepoEntities } from '../custom-content-loader';
import { findNearDuplicates } from '../compendium-dedupe';
import {
  buildVariantBaseIndex,
  displayItemName,
  foldMagicVariants,
  migrateCharacterVariants,
  parseVariantName,
} from '../magic-variants';
import type { CompendiumEntity } from '../../types/compendium';

function weapon(extra: Partial<CompendiumEntity> = {}): CompendiumEntity {
  return {
    id: 'w1',
    name: 'Longsword',
    source: 'Test',
    ruleset: '2014',
    category: 'weapon',
    equipped: true,
    activities: [
      {
        id: 'w1-atk',
        name: 'Longsword',
        type: 'attack',
        actionEconomy: 'action',
        attackAbility: 'str',
        attackBonusFormula: '@str + @prof',
        damageFormula: '1d8 + @str',
        damageType: 'slashing',
      },
    ],
    entries: ['x'],
    ...extra,
  };
}
const armor = (extra: Partial<CompendiumEntity> = {}): CompendiumEntity => ({
  id: 'a1', name: 'Plate Armor', source: 'Test', ruleset: '2014', category: 'armor', equipped: true,
  acFormula: { base: 18, dexCap: 0 }, activities: [], entries: ['x'], ...extra,
});
const shield = (extra: Partial<CompendiumEntity> = {}): CompendiumEntity => ({
  id: 's1', name: 'Shield', source: 'Test', ruleset: '2014', category: 'shield', equipped: true,
  acFlatBonus: 2, activities: [], entries: ['x'], ...extra,
});
function sheetWith(items: CompendiumEntity[]) {
  return computeCharacterSheet({ ...createBlankCharacter('c', 'Tester'), items });
}
const atk = (s: ReturnType<typeof sheetWith>, id = 'w1') => s.actionsByEconomy.action.find((a) => a.parentItemId === id)!;

describe('magic bonus in rules-math', () => {
  it('a +2 weapon adds 2 to the attack roll and to damage', () => {
    const plain = atk(sheetWith([weapon()]));
    const magic = atk(sheetWith([weapon({ magicBonus: 2 })]));
    expect(magic.computedAttackBonus).toBe(plain.computedAttackBonus! + 2);
    expect(plain.computedDamage).toBe('1d8 + 2');
    expect(magic.computedDamage).toBe('1d8 + 4');
    expect(magic.parentItemName).toBe('+2 Longsword');
  });

  it('armor +1 and shield +2 together add 3 AC', () => {
    const plain = sheetWith([armor(), shield()]).ac.final;
    const both = sheetWith([armor({ magicBonus: 1 }), shield({ magicBonus: 2 })]);
    expect(both.ac.final).toBe(plain + 3);
  });

  it('+0 or unequipped items add nothing', () => {
    const plain = sheetWith([armor(), shield()]).ac.final;
    expect(sheetWith([armor({ magicBonus: 0 }), shield()]).ac.final).toBe(plain);
    expect(sheetWith([armor(), shield({ magicBonus: 3, equipped: false })]).ac.final).toBe(sheetWith([armor()]).ac.final);
  });

  it('display name: custom name wins, else "+N base"', () => {
    expect(displayItemName(weapon({ magicBonus: 1 }))).toBe('+1 Longsword');
    expect(displayItemName(weapon({ magicBonus: 1, customName: 'Dawnbreaker' }))).toBe('Dawnbreaker');
    expect(displayItemName(weapon())).toBe('Longsword');
  });
});

describe('variant names', () => {
  it('parses +N X, X +N, X, +N and the umbrella form', () => {
    expect(parseVariantName('+1 Longsword')).toEqual({ base: 'Longsword', bonus: 1 });
    expect(parseVariantName('Armor +2')).toEqual({ base: 'Armor', bonus: 2 });
    expect(parseVariantName('Ammunition, +3')).toEqual({ base: 'Ammunition', bonus: 3 });
    expect(parseVariantName('Weapon, +1, +2, or +3')).toEqual({ base: 'Weapon', bonus: null });
    expect(parseVariantName('Longsword')).toBeNull();
    expect(parseVariantName('Shield (+2 AC)')).toBeNull();
  });

  it('are not near duplicates of their base', () => {
    const mk = (id: string, name: string, category: CompendiumEntity['category']): CompendiumEntity => ({
      id, name, source: 'SRD 5.1', ruleset: '2014', category, activities: [], entries: ['x'],
    });
    const groups = findNearDuplicates([
      mk('1', 'Longsword', 'weapon'), mk('2', '+1 Longsword', 'weapon'),
      mk('3', 'Shield (+2 AC)', 'shield'), mk('4', '+1 Shield (+3 AC)', 'shield'),
      mk('5', 'Ammunition', 'gear'), mk('6', 'Ammunition, +1', 'gear'), mk('7', 'Ammunition +2', 'gear'),
    ]);
    expect(groups).toEqual([]);
    // a real near duplicate still shows
    expect(findNearDuplicates([mk('8', 'Longsword', 'weapon'), mk('9', 'Longswords', 'weapon')]).length).toBe(1);
  });

  it('shipped content: no near-duplicate group contains a "+N" variant any more', async () => {
    const all = [...BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities), ...(await loadCustomRepoEntities())];
    for (const g of findNearDuplicates(all)) {
      const hit = g.members.filter((m) => parseVariantName(m.name));
      expect(hit.map((m) => m.name), g.members.map((m) => m.name).join(' / ')).toEqual([]);
    }
  }, 30000);
});

describe('folding and migration', () => {
  it('hides +N entries whose base exists, keeps the rest', () => {
    const base = weapon({ id: 'b', equipped: undefined });
    const plus = weapon({ id: 'p', name: '+1 Longsword', equipped: undefined });
    const orphan = weapon({ id: 'o', name: '+1 Zzzblade', equipped: undefined });
    const shieldPlus = shield({ id: 'sp', name: '+1 Shield (+3 AC)', equipped: undefined });
    const shieldBase = shield({ id: 'sb', name: 'Shield (+2 AC)', equipped: undefined });
    const out = foldMagicVariants([base, plus, orphan, shieldPlus, shieldBase]).map((e) => e.id);
    expect(out).toEqual(['b', 'o', 'sb']);
  });

  it('shipped built-ins: +1 Longsword / Rapier / Longbow / Plate / Shield leave search, nothing is deleted', () => {
    const all = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const visible = new Set(foldMagicVariants(all).map((e) => e.id));
    for (const id of ['srd-item-plus1-longsword', 'srd-item-plus1-rapier', 'srd-item-plus1-longbow', 'srd-item-plus1-plate', 'srd-item-plus1-shield']) {
      expect(all.some((e) => e.id === id)).toBe(true);
      expect(visible.has(id)).toBe(false);
    }
  });

  it('migrates an old "+1 Longsword" sheet item to base + magicBonus with the same attack math', () => {
    const all = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const old = structuredClone(all.find((e) => e.id === 'srd-item-plus1-longsword')!);
    old.equipped = true;
    old.quantity = 1;
    const orphan = weapon({ id: 'stay', name: '+1 Zzzblade' });
    const char = { ...createBlankCharacter('c', 'Old'), items: [old, orphan] };
    const before = atk(computeCharacterSheet(char), old.id);
    const m = migrateCharacterVariants(char, buildVariantBaseIndex(all));
    expect(m.changed).toBe(true);
    const migrated = m.character.items[0]!;
    expect(migrated.id).toBe(old.id);
    expect(migrated.name).toBe('Longsword');
    expect(migrated.magicBonus).toBe(1);
    expect(migrated.equipped).toBe(true);
    expect(m.character.items[1]!.name).toBe('+1 Zzzblade');
    const after = atk(computeCharacterSheet(m.character), old.id);
    expect(after.computedAttackBonus).toBe(before.computedAttackBonus);
    // the built-in had the +1 baked in as "1d8 + @str + 1"; now it is "1d8 + 2" plus the bonus, merged
    expect(before.computedDamage?.replace(/\s/g, '')).toBe('1d8+2+1');
    expect(after.computedDamage?.replace(/\s/g, '')).toBe('1d8+3');
    expect(migrateCharacterVariants(m.character, buildVariantBaseIndex(all)).changed).toBe(false);
  });
});
