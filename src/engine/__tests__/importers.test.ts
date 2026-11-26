// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCustomContentJson } from '../custom-content-loader';
import { getClassDefinition } from '../classes';
import { parseHomebrewMarkdownBlock } from '../statblock-parser';
import { extractStatblocksFromText, summarizeExtraction } from '../statblock-extractor';
import { adapt5eToolsPayload } from '../five-tools-adapter';
import {
  parseFree5eFeatMarkdown,
  parseFree5eMarkdownAuto,
  parseFree5eMarkdownBatch,
} from '../free5e-parser';
import { buildCharacterFromDdbFields } from '../ddb-pdf-importer';
import { buildCampaignPackExport, fetchCampaignPackFromGitHub } from '../campaign-repo-sync';
import { createDefaultCampaign } from '../dm-tools';
import { planEntityImport } from '../import-preview';
import { db, exportFullBundle, importBackupBundle, upsertCompendiumEntities } from '../../storage/db';
import type { CompendiumEntity } from '../../types/compendium';

const ent = (id: string, name: string, extra: Partial<CompendiumEntity> = {}): CompendiumEntity => ({
  id, name, source: 'Test Book', ruleset: '2014', category: 'gear', activities: [], entries: ['x'], ...extra,
});

describe('a. app JSON + batch JSON', () => {
  const batch = JSON.stringify([
    { id: 'b-1', name: 'Synthetic Blade', category: 'weapon', source: 'Test Book', ruleset: '2014', activities: [], entries: ['Sharp.'] },
    { id: 'b-2', name: 'Test Noble', category: 'background', source: 'Test Book', entries: ['Rich.'] },
    { id: 'b-3', name: 'No Meta Beast', category: 'monster', entries: ['x'] },
    { id: 'b-4', category: 'gear' },
    { id: 'b-5', name: 'Odd Thing', category: 'vehicle' },
    {
      id: 'c-1', name: 'Test Hero', ruleset: '2014', level: 2, species: 'Human', background: 'Noble',
      classes: [{ name: 'Fighter', subclass: 'Champion', level: 2, hitDie: 'd10' }],
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      hp: { current: 20, max: 20, temp: 0 }, ac: 16, speed: 30, proficiencyBonus: 2,
      savingThrows: ['str', 'con'], skills: ['athletics', 'bogus'],
      resourcePools: [{ id: 'ki', name: 'Ki', current: 2, max: 2, resetOn: 'short' }],
      equipment: ['b-1', 'missing-id'], features: [], spells: [],
    },
    { name: 'Broken Hero', abilities: { str: 10 }, classes: [] },
  ]);

  it('accepts or rejects every entry with a reason, and converts the simple character shape', () => {
    const r = parseCustomContentJson(batch, () => undefined, getClassDefinition);
    expect(r.entities.map((e) => e.id)).toEqual(['b-1', 'b-2']);
    expect(r.rejected.map((x) => x.name)).toEqual(['No Meta Beast', 'entry 4', 'Odd Thing', 'Broken Hero']);
    expect(r.rejected[0]!.reason).toMatch(/monsterMeta/);
    expect(r.rejected[2]!.reason).toMatch(/unknown category/);
    expect(r.rejected[3]!.reason).toMatch(/missing abilities|missing classes/);
    const hero = r.characters[0]!;
    expect(hero.baseAbilities.str).toBe(16);
    expect(hero.classes[0]).toMatchObject({ className: 'Fighter', subclassName: 'Champion', hitDie: 10 });
    expect(hero.items.map((i) => i.id)).toEqual(['b-1']);
    expect(hero.skillProficiencies.athletics).toBe(1);
    expect(hero.resources[0]).toMatchObject({ id: 'ki', recovery: 'short_rest' });
    expect(r.warnings.join(' ')).toMatch(/missing-id.*not found/);
    expect(r.warnings.join(' ')).toMatch(/bogus/);
  });
});

describe('b. Markdown paste', () => {
  it('SRD-style monster statblock: AC, HP, CR, DEX, attack and save activities', () => {
    const md = `**Test Wraith**
*Medium undead, neutral evil*
**Armor Class** 13
**Hit Points** 45 (6d8 + 18)
**Speed** 0 ft., fly 60 ft.
STR DEX CON INT WIS CHA
6 (-2) 16 (+3) 16 (+3) 12 (+1) 14 (+2) 15 (+2)
**Challenge** 5 (1,800 XP)
***Life Drain.*** *Melee Weapon Attack:* +6 to hit, reach 5 ft., one creature. *Hit:* 21 (4d8 + 3) necrotic damage.
***Wail.*** Each creature within 30 feet must succeed on a DC 13 Wisdom saving throw or be frightened.`;
    const { data, confidence } = parseHomebrewMarkdownBlock(md);
    expect(data.category).toBe('monster');
    expect(data.name).toBe('Test Wraith');
    expect(data.monsterMeta).toMatchObject({ ac: 13, hp: 45, dexModifier: 3, cr: '5', size: 'medium' });
    const drain = data.activities.find((a) => a.name === 'Life Drain')!;
    expect(drain).toMatchObject({ type: 'attack', attackBonusFormula: '+6', damageFormula: '4d8 + 3', damageType: 'necrotic' });
    expect(data.activities.find((a) => a.name === 'Wail')).toMatchObject({ type: 'save', saveAbility: 'wis', saveDcFormula: '13' });
    expect(confidence).toBe('high');
    expect(parseHomebrewMarkdownBlock(md).data.id).toBe(data.id); // same text, same id: re-pasting replaces
  });

  it('spell: level, fields, save, damage and the slot it costs', () => {
    const md = `### Test Flare
*3rd-level evocation*
**Casting Time:** 1 action
**Range:** 60 feet
**Components:** V, S
**Duration:** Concentration, up to 1 minute
Each creature in a 10-foot sphere must make a Dexterity saving throw. A target takes 6d6 fire damage on a failed save.`;
    const { data } = parseHomebrewMarkdownBlock(md);
    expect(data).toMatchObject({ category: 'spell', spellLevel: 3, range: '60 feet', concentration: true });
    expect(data.activities[0]).toMatchObject({
      type: 'save', saveAbility: 'dex', damageFormula: '6d6', damageType: 'fire',
      resourceCost: { poolId: 'spell_slot_3', amount: 1 },
    });
  });

  it('items: weapon damage and armor AC (armor is not a monster)', () => {
    const w = parseHomebrewMarkdownBlock('### Test Blade\nType: weapon\nDamage: 1d8 slashing\nA finesse blade.').data;
    expect(w.category).toBe('weapon');
    expect(w.activities[0]).toMatchObject({ type: 'attack', damageFormula: '1d8 + @dex', damageType: 'slashing' });
    const a = parseHomebrewMarkdownBlock('### Test Mail\nType: armor\nAC: 14 + Dex (max 2)\nHeavy-ish.').data;
    expect(a.category).toBe('armor');
    expect(a.monsterMeta).toBeUndefined();
    expect(a.acFormula).toEqual({ base: 14, dexCap: 2 });
  });
});

describe('c. 5e.tools JSON and backup', () => {
  it('maps a 5etools-shaped spell (damage, save, slot, class list) and monster', () => {
    const { entities, skipped } = adapt5eToolsPayload({
      spell: [{
        name: 'Test Bolt', source: 'PHB', level: 2, time: [{ number: 1, unit: 'action' }],
        range: { type: 'point', distance: { type: 'feet', amount: 60 } },
        components: { v: true, s: true }, duration: [{ type: 'instant' }],
        savingThrow: ['dexterity'],
        entries: ['A target takes {@damage 4d6} fire damage on a failed save.'],
        classes: { fromClassList: [{ name: 'Wizard', source: 'PHB' }] },
      }, { name: 'Test Mend', level: 1, entries: ['The target regains {@dice 2d8} hit points.'] }, 5],
      monster: [{
        name: 'Test Imp', source: 'XMM', ac: [{ ac: 13 }], hp: { average: 22 }, dex: 16, cr: '1', size: ['T'],
        action: [{ name: 'Sting', entries: ['{@atk mw} {@hit 5} to hit, 5 ft. Hit: {@damage 1d4+3} piercing.'] }],
      }],
    });
    expect(skipped).toBe(1);
    const bolt = entities.find((e) => e.name === 'Test Bolt')!;
    expect(bolt).toMatchObject({ spellLevel: 2, castingTime: '1 action', range: '60 feet', components: 'V, S', classes: ['Wizard'] });
    expect(bolt.activities[0]).toMatchObject({ type: 'save', saveAbility: 'dex', damageFormula: '4d6', resourceCost: { poolId: 'spell_slot_2', amount: 1 } });
    expect(entities.find((e) => e.name === 'Test Mend')!.activities[0]).toMatchObject({ type: 'heal', damageFormula: '2d8' });
    const imp = entities.find((e) => e.name === 'Test Imp')!;
    expect(imp.ruleset).toBe('2024');
    expect(imp.monsterMeta).toMatchObject({ ac: 13, hp: 22, dexModifier: 3, cr: '1', size: 'tiny' });
    expect(imp.activities[0]).toMatchObject({ type: 'attack', attackBonusFormula: '+5', damageFormula: '1d4+3' });
  });

  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  afterEach(() => vi.restoreAllMocks());

  it('backup round trip: export -> wipe -> import gives identical data', async () => {
    await upsertCompendiumEntities([ent('rt-1', 'Round Trip', { entries: ['a', 'b'], spellLevel: 1 })]);
    await db.characters.put({ id: 'rt-c', name: 'Rounder', ruleset: '2014' } as never);
    await db.dupDecisions.put({ id: 'a|b', memberIds: ['a', 'b'], action: 'keep-both', decidedAt: 'x' });
    const first = await exportFullBundle();
    await db.delete();
    await db.open();
    const res = await importBackupBundle(JSON.parse(JSON.stringify(first)), 'merge');
    expect(res.importedEntities).toBe(1);
    const second = await exportFullBundle();
    expect({ ...second, exportedAt: '' }).toEqual({ ...first, exportedAt: '' });
  });
});

const SPELL = `#### Test Mend
[_metadata_:spell_name]:- "Test Mend"
[_metadata_:spell_level]:- "2"
[_metadata_:casting_time_amount]:- "1"
[_metadata_:casting_time_unit]:- "action"
[_metadata_:range]:- "Touch"

A creature you touch regains 2d8 hit points.
`;
const FEAT = `### Test Sturdy

You gain 2 extra hit points per level.
`;
const WEAPONS = `| Name | Cost | Damage | Weight | Properties |
|---|---|---|---|---|
| **Melee Weapons** | | | | |
| Test Rapier | 25 gp | 1d8 piercing | 2 lb. | Finesse |
| **Ranged Weapons** | | | | |
| Test Bow | 50 gp | 1d6 piercing | 2 lb. | Ammunition |
`;
const ARMOR = `| Armor | Cost | Armor Class (AC) | Strength | Stealth |
|---|---|---|---|---|
| Test Scale | 50 gp | 14 + Dex modifier (max 2) | — | Disadvantage |
| Test Plate | 1500 gp | 18 | Str 15 | Disadvantage |
| Test Shield | 10 gp | +2 | — | — |
`;

describe('d. Free5e sync', () => {
  it('parses a spell (slot + healing), a feat, and the weapons / armor tables', () => {
    const spell = parseFree5eMarkdownAuto(SPELL, 'spell')!;
    expect(spell.activities[0]).toMatchObject({ type: 'heal', damageFormula: '2d8', resourceCost: { poolId: 'spell_slot_2', amount: 1 } });
    const feat = parseFree5eFeatMarkdown(FEAT)!;
    expect(feat).toMatchObject({ id: 'free5e-feat-test-sturdy', category: 'feat' });
    const w = parseFree5eMarkdownBatch(WEAPONS, 'weapon');
    expect(w.map((e) => [e.name, e.activities[0]!.attackAbility])).toEqual([['Test Rapier', 'dex'], ['Test Bow', 'dex']]);
    const a = parseFree5eMarkdownBatch(ARMOR, 'armor');
    expect(a.map((e) => e.category)).toEqual(['armor', 'armor', 'shield']);
    expect(a[0]!.acFormula).toEqual({ base: 14, dexCap: 2 });
    expect(a[1]!.acFormula).toEqual({ base: 18, dexCap: 0 });
  });

  it('g. sync through mocked GitHub responses (tree + raw files), no network', async () => {
    const base = 'en-US/Characters_Codex/';
    const files: Record<string, string> = {
      [`${base}06_Spellcasting/Spell_Descriptions/T/Test_Mend.md`]: SPELL,
      [`${base}06_Spellcasting/Spell_Descriptions/T/_T.md`]: '### T\n\n[Test Mend](./Test_Mend.md)\n',
      [`${base}03_Creating_a_Character/Feats/Feats/Test_Sturdy.md`]: FEAT,
      [`${base}03_Creating_a_Character/Equipment/Weapons_table.md`]: WEAPONS,
      [`${base}03_Creating_a_Character/Equipment/Armor_table.md`]: ARMOR,
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('git/trees')) {
        return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
      }
      const path = String(url).replace('https://raw.githubusercontent.com/Solopass/free5e/main/', '');
      return path in files ? new Response(files[path]!, { status: 200 }) : new Response('no', { status: 404 });
    });
    const res = await fetchCampaignPackFromGitHub({ owner: 'Solopass', repo: 'free5e', branch: 'main' });
    vi.unstubAllGlobals();
    expect(res.entities.map((e) => e.name).sort()).toEqual(
      ['Test Bow', 'Test Mend', 'Test Plate', 'Test Rapier', 'Test Scale', 'Test Shield', 'Test Sturdy']
    );
    expect(res.entities.every((e) => e.source === 'Free5e (Solopass/free5e)')).toBe(true);
    expect(calls.every((c) => c.startsWith('https://'))).toBe(true);
  });

  it('push pack: payload builder keeps manifest refs and adds the custom entities (no push)', () => {
    const campaign = createDefaultCampaign();
    const text = buildCampaignPackExport(campaign, [ent('p-1', 'Pushed Thing')], {
      name: 'Old', entities: ['monsters/a.json', { path: 'x.json' }, { id: 'inline' }], characters: ['chars/a.json'],
    } as never);
    const m = JSON.parse(text) as { name: string; entities: unknown[]; characters: string[]; entries: unknown[] };
    expect(m.name).toBe(campaign.name);
    expect(m.entities).toHaveLength(3); // 2 preserved refs + 1 custom entity
    expect(m.entities[0]).toBe('monsters/a.json');
    expect((m.entities[2] as { id: string }).id).toBe('p-1');
    expect(m.characters).toEqual(['chars/a.json']);
  });
});

describe('e. D&D Beyond PDF (synthetic field data; needs a real DDB PDF to confirm)', () => {
  it('builds a character from form fields', () => {
    const { character, extractedFieldsCount } = buildCharacterFromDdbFields(
      { CharacterName: 'Synth Hero', Race: 'Elf', Background: 'Sage', MaxHP: '31', CurrentHP: '20', AC: '15', STR: '10', DEX: '16', CON: '12', INT: '14', WIS: '10', CHA: '8', 'Acrobatics Prof': 'Yes', 'STR Save Prof': 'Yes' },
      'fallback'
    );
    expect(extractedFieldsCount).toBeGreaterThan(5);
    expect(character).toMatchObject({ name: 'Synth Hero', species: 'Elf', background: 'Sage' });
    expect(character.hp).toMatchObject({ max: 31, current: 20 });
    expect(character.overrides.ac).toBe(15);
    expect(character.skillProficiencies.acrobatics).toBe(1);
    expect(character.saveProficiencies).toContain('str');
  });
});

describe('statblock extractor and import preview', () => {
  const BLOCK = `TEST GHOUL
Medium Undead
Armor Class 1 2
Hit Points 2 2 (5d8)
Speed 30 ft.
STR
1 3 (+1)
DEX
1 5 (+2)
CON
1 0 (+O)
I NT
7 (-2)
WIS
1 0 (+O)
CHA
6 (-2)
Challenge 1 (200 XP)
Stench. Creatures nearby are poisoned.
ACTIONS
Claws. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 9 (2d6 + 2) slashing damage.
NEXT HEADING IN CAPS`;
  it('reads OCR-noisy two-column statblocks and summarizes found vs clean', () => {
    const res = extractStatblocksFromText(`lore text\n${BLOCK}\n\nQ\nSECOND\nMedium Beast\nArmor Class 10\nHit Points 5 (1d8)\nSpeed 20 ft.`, { source: 'Synthetic' });
    expect(res).toHaveLength(2);
    const g = res[0]!.entity!;
    expect(g.name).toBe('Test Ghoul');
    expect(g.monsterMeta).toMatchObject({ ac: 12, hp: 22, dexModifier: 2, cr: '1', size: 'medium' });
    expect(g.activities[0]).toMatchObject({ name: 'Claws', attackBonusFormula: '+4', damageFormula: '2d6 + 2' });
    expect(summarizeExtraction(res)).toMatchObject({ found: 2, clean: 1 });
    expect(res[1]!.problems).toContain('challenge rating missing');
  });

  it('import preview counts new, exact and possible duplicates', () => {
    const existing = [ent('s1', 'Fireball', { category: 'spell', source: 'SRD 5.1', spellLevel: 3 })];
    const plan = planEntityImport(
      [
        ent('n1', 'Fresh Thing', { category: 'spell', spellLevel: 1 }),
        ent('n2', 'Fireball', { category: 'spell', spellLevel: 3 }),
        ent('n3', "Tasha's Fireball", { category: 'spell', spellLevel: 3 }),
      ],
      existing
    );
    expect(plan.summary).toBe('1 new, 1 exact duplicate (will fold into Test Book), 1 possible duplicate (review)');
  });
});
