import { describe, expect, it } from 'vitest';
import {
  canAdjustPointBuy,
  computePointBuyCost,
  computePointBuyTotal,
  DEFAULT_POINT_BUY_SCORES,
  POINT_BUY_BUDGET,
} from '../point-buy';
import { computeCharacterSheet } from '../rules-math';
import { buildCharacterFromPreset } from '../classes';
import { BUILTIN_CONTENT_PACKS, WILD_SHAPE_BEAST_FORMS } from '../srd-packs';
import {
  decodeCharacterShareCode,
  encodeCharacterShareCode,
  generateRoomCode,
  LiveTableMessage,
} from '../live-sync';

describe('Buckets 3, 4 & 5: Point Buy, Wild Shape, Prepared Spells, Rituals, Packs & Live Sync', () => {
  it('enforces 27-point Point Buy costs and 8-15 bounds accurately', () => {
    expect(computePointBuyCost(8)).toBe(0);
    expect(computePointBuyCost(13)).toBe(5);
    expect(computePointBuyCost(14)).toBe(7);
    expect(computePointBuyCost(15)).toBe(9);
    expect(computePointBuyTotal(DEFAULT_POINT_BUY_SCORES)).toBe(0);

    // Classic 15/15/15/8/8/8 uses all 27 points
    const maxed = { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 };
    expect(computePointBuyTotal(maxed)).toBe(POINT_BUY_BUDGET);
    expect(canAdjustPointBuy(maxed, 'int', 1)).toBe(false);
    expect(canAdjustPointBuy(maxed, 'str', 1)).toBe(false);
    expect(canAdjustPointBuy(maxed, 'str', -1)).toBe(true);
    expect(canAdjustPointBuy(maxed, 'int', -1)).toBe(false);
  });

  it('computes Wild Shape AC/Speed/attacks and prepared spell limits (excluding cantrips & alwaysPrepared)', () => {
    const druid = buildCharacterFromPreset({
      id: 'druid-ws-1',
      name: 'Sylva',
      className: 'Druid',
      level: 3,
      speciesName: 'Elf',
      backgroundName: 'Outlander',
      ruleset: '2014',
    });
    // Base Druid WIS = 15 => +2, Lv 3 => maxPrepared = 3 + 2 = 5
    const baseSheet = computeCharacterSheet(druid);
    expect(baseSheet.spellcasting.maxPrepared).toBe(5);
    expect(baseSheet.spellcasting.preparedCount).toBeGreaterThanOrEqual(1);

    // Cantrip does not count toward preparedCount; alwaysPrepared spells are excluded
    const cantripCount = druid.items.filter((i) => i.category === 'spell' && (i.spellLevel ?? 0) === 0).length;
    expect(cantripCount).toBeGreaterThanOrEqual(1);
    druid.items.push({
      id: 'always-prep-test',
      name: 'Circle Bonus Spell',
      source: 'Test',
      ruleset: '2014',
      category: 'spell',
      spellLevel: 2,
      prepared: true,
      alwaysPrepared: true,
      activities: [],
      entries: [],
    });
    expect(computeCharacterSheet(druid).spellcasting.preparedCount).toBe(baseSheet.spellcasting.preparedCount);

    // Wild Shape into Brown Bear (AC 11, HP 34, Speed 40, Bite/Claws)
    const brownBear = WILD_SHAPE_BEAST_FORMS.find((f) => f.name === 'Brown Bear');
    expect(brownBear).toBeDefined();
    druid.wildShapeForm = structuredClone(brownBear!);

    const beastSheet = computeCharacterSheet(druid);
    expect(beastSheet.ac.final).toBe(11);
    expect(beastSheet.ac.activeFormulaSource).toBe('Wild Shape: Brown Bear');
    expect(beastSheet.speed.final).toBe(40);
    expect(beastSheet.actionsByEconomy.action[0]?.name).toBe('Bite');
    expect(beastSheet.actionsByEconomy.action[0]?.computedAttackBonus).toBe(6);
  });

  it('includes ritual spell metadata, Metamagic/Invocations/Infusions, and SRD Beast packs', () => {
    const packIds = BUILTIN_CONTENT_PACKS.map((p) => p.id);
    expect(packIds).toContain('pack-srd-class-subsystems');
    expect(packIds).toContain('pack-srd-beasts');

    const all = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities);
    const detectMagic = all.find((e) => e.name === 'Detect Magic');
    expect(detectMagic?.ritual).toBe(true);
    expect(detectMagic?.range).toBe('Self (30 ft)');

    expect(all.some((e) => e.name === 'Metamagic: Quickened Spell')).toBe(true);
    expect(all.some((e) => e.name === 'Invocation: Agonizing Blast')).toBe(true);
    expect(all.some((e) => e.name === 'Infusion: Enhanced Defense (+1 AC)')).toBe(true);
    expect(all.some((e) => e.category === 'monster' && e.name === 'Brown Bear')).toBe(true);
    expect(all.some((e) => e.category === 'monster' && e.name === 'Giant Ape')).toBe(true);
  });

  it('encodes and decodes Unicode single-character share codes & #char URL hashes', () => {
    const monk = buildCharacterFromPreset({
      id: 'monk-utf8',
      name: 'Kaelen ★ Dragonfist — 嵐',
      className: 'Monk',
      level: 4,
      speciesName: 'Human',
      backgroundName: 'Hermit',
      ruleset: '2024',
    });

    const code = encodeCharacterShareCode(monk);
    expect(code.startsWith('DFC1:')).toBe(true);
    expect(decodeCharacterShareCode(code).name).toBe('Kaelen ★ Dragonfist — 嵐');
    expect(decodeCharacterShareCode(`https://solopass.github.io/dnd-forge/#char=${code}`).classes[0]?.level).toBe(4);
    expect(() => decodeCharacterShareCode('DFC1:not_valid_base64!')).toThrow();
  });

  it('generates valid FORGE-XXXX room codes and serializable sync messages', () => {
    const code = generateRoomCode();
    expect(code).toMatch(/^FORGE-[A-Z0-9]{4}$/);
    const msg: LiveTableMessage = {
      type: 'roll',
      senderId: 'peer-1',
      senderName: 'DM',
      text: 'Attack: 21',
      tone: 'roll',
      timestamp: 123456,
    };
    const roundTrip = JSON.parse(JSON.stringify(msg)) as LiveTableMessage;
    expect(roundTrip.type).toBe('roll');
  });
});
