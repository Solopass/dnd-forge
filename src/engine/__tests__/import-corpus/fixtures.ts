import { expect } from 'vitest';
import type { DetectedFormat, PipelineOptions } from '../../import-pipeline';

/**
 * Synthetic import corpus: every fixture is made up for this repo (no book or pack content). Each says
 * what the pipeline must do with it, so "works with nearly anything" is a number, not a feeling.
 */
export interface CorpusExpectation {
  format: DetectedFormat;
  /** How many entities come out (clean + repaired). */
  accepted: number;
  /** How many of them needed a repair (default 0). */
  repaired?: number;
  /** Every one of these must appear in some repair note (string = substring). */
  notes?: Array<string | RegExp>;
  /** One reason per rejected entry, in order (string = substring). */
  rejected?: Array<string | RegExp>;
  characters?: number;
  /** Extra checks on the result. */
  check?: (r: import('../../import-pipeline').PipelineResult) => void;
}

export interface CorpusFixture {
  name: string;
  input: string;
  opts?: PipelineOptions;
  expect: CorpusExpectation;
}

const j = (v: unknown): string => JSON.stringify(v);
const gear = (name: string, extra: Record<string, unknown> = {}) => ({ id: `t-${name.toLowerCase().replace(/\W+/g, '-')}`, name, category: 'gear', source: 'Corpus', ruleset: '2014', entries: [`${name} text.`], ...extra });
const spell = (name: string, extra: Record<string, unknown> = {}) => ({ name, category: 'spell', spellLevel: 1, entries: [`${name} text.`], ...extra });
const beast = (name: string, meta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name, category: 'monster', entries: ['A beast.'], monsterMeta: meta, ...extra });

const SIMPLE_STATBLOCK = `**Corpus Wraith**
*Medium undead, neutral evil*
**Armor Class** 13
**Hit Points** 45 (6d8 + 18)
**Speed** 0 ft., fly 60 ft.
STR DEX CON INT WIS CHA
6 (-2) 16 (+3) 16 (+3) 12 (+1) 14 (+2) 15 (+2)
**Challenge** 5 (1,800 XP)
***Life Drain.*** *Melee Weapon Attack:* +6 to hit, reach 5 ft., one creature. *Hit:* 21 (4d8 + 3) necrotic damage.`;

const FREE5E_SPELL = `#### Corpus Spark
[_metadata_:spell_name]:- "Corpus Spark"
[_metadata_:spell_level]:- "1"
[_metadata_:spell_school]:- "evocation"
[_metadata_:ritual]:- "false"
[_metadata_:casting_time_amount]:- "1"
[_metadata_:casting_time_unit]:- "action"

A harmless synthetic spark.
`;

export const CORPUS: CorpusFixture[] = [
  // ------------------------------------------------------------ formats
  { name: 'json: batch array of clean entities', input: j([gear('Rope'), gear('Lamp')]), expect: { format: 'entity-json', accepted: 2 } },
  { name: 'json: single object', input: j(gear('Anchor')), expect: { format: 'entity-json', accepted: 1 } },
  {
    name: 'json: wrapper with a plural key gives the category',
    input: j({ spells: [{ name: 'Zap', spellLevel: 2, entries: ['Zaps.'] }] }),
    expect: { format: 'entity-json', accepted: 1, check: (r) => expect(r.accepted[0]!.category).toBe('spell') },
  },
  {
    name: 'json: app backup bundle',
    input: j({ app: 'dnd-forge', version: 1, compendium: [gear('Bundled Item')], characters: [] }),
    expect: { format: 'app-bundle', accepted: 1, check: (r) => expect((r.bundle as { compendium: unknown[] }).compendium).toHaveLength(1) },
  },
  {
    name: 'json: pack.json given as a loose file is explained, not parsed',
    input: j({ format: 'dnd-forge-pack@1', id: 'x', name: 'X', version: '1', content: [] }),
    expect: { format: 'pack-manifest', accepted: 0, rejected: [/pack\.json/] },
  },
  {
    name: '5e.tools: spell with rollable tags keeps them, drops formatting tags',
    input: j({ spell: [{ name: 'Tag Bolt', source: 'XPHB', level: 1, school: 'V', time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 60 } }, components: { v: true, s: true }, duration: [{ type: 'instant' }], entries: ['{@b Bold} {@atk rs} deals {@damage 2d6 + STR} fire damage, see {@spell fireball|phb}.'] }] }),
    expect: {
      format: 'five-tools',
      accepted: 1,
      repaired: 1,
      notes: [/damageFormula formula "2d6 \+ STR" read as "2d6\+@str"/],
      check: (r) => {
        const text = r.accepted[0]!.entries.join(' ');
        expect(text).toContain('Bold Ranged Spell Attack:');
        expect(text).toContain('{@damage 2d6+@str}');
        expect(text).toContain('{@spell fireball|phb}');
        expect(text).not.toContain('{@b');
      },
    },
  },
  {
    name: '5e.tools: monster with fractional CR keeps a clean CR',
    input: j({ monster: [{ name: 'Tag Rat', source: 'MM', size: ['T'], ac: [12], hp: { average: 4 }, dex: 14, cr: '1/8', action: [{ name: 'Bite', entries: ['{@atk mw} {@hit 4} to hit. {@h}{@damage 1d4+2} piercing.'] }] }] }),
    expect: { format: 'five-tools', accepted: 1, check: (r) => expect(r.accepted[0]!.monsterMeta?.cr).toBe('1/8') },
  },
  { name: 'free5e markdown: spell with metadata', input: FREE5E_SPELL, expect: { format: 'free5e-markdown', accepted: 1, check: (r) => expect(r.accepted[0]!.category).toBe('spell') } },
  {
    name: 'free5e markdown: an index page (links only) is skipped quietly',
    input: '### A\n\n[Acid Splash](./Acid_Splash.md)\n\n[Aid](./Aid.md)\n',
    expect: { format: 'free5e-markdown', accepted: 0, check: (r) => expect(r.warnings.join(' ')).toMatch(/index page/) },
  },
  {
    name: 'free5e markdown: weapons table',
    input: '| Name | Cost | Damage | Weight | Properties |\n|---|---|---|---|---|\n| Corpus Club | 1 sp | 1d4 bludgeoning | 2 lb. | Light |\n| Corpus Pike | 5 gp | 1d10 piercing | 18 lb. | Heavy, reach |\n',
    opts: { categoryHint: 'weapon' },
    expect: { format: 'free5e-markdown', accepted: 2 },
  },
  { name: 'markdown: SRD-style statblock', input: SIMPLE_STATBLOCK, expect: { format: 'homebrew-markdown', accepted: 1, check: (r) => expect(r.accepted[0]!.monsterMeta).toMatchObject({ ac: 13, hp: 45, cr: '5' }) } },
  {
    name: 'markdown: homebrew key/value item',
    input: '# Corpus Blade\n\nType: weapon\nSource: Corpus\n\nA sword that exists for tests.',
    expect: { format: 'homebrew-markdown', accepted: 1, repaired: 0 },
  },
  { name: 'csv: gear table', input: 'Name,Cost,Weight,Description\nRope,1 gp,10 lb.,Fifty feet\n"Lamp, hooded",5 gp,2,"Burns oil\nfor six hours"\n', expect: { format: 'csv', accepted: 2, check: (r) => { expect(r.accepted[1]!.name).toBe('Lamp, hooded'); expect(r.accepted[1]!.entries.join(' ')).toContain('for six hours'); } } },
  {
    name: 'csv: weapons table builds an attack activity',
    input: 'Name,Type,Damage,Damage Type,Properties,Weight\nCorpus Sword,Martial Melee,1d8,slashing,Versatile,3\nCorpus Rapier,Martial Melee,1d8 + 1,piercing,Finesse,2\n',
    expect: { format: 'csv', accepted: 2, check: (r) => { expect(r.accepted[0]!.category).toBe('weapon'); expect(r.accepted[0]!.activities[0]).toMatchObject({ type: 'attack', damageFormula: '1d8+@mod', damageType: 'slashing' }); expect(r.accepted[1]!.activities[0]!.attackAbility).toBe('dex'); } },
  },
  {
    name: 'csv: armor table reads the AC column',
    input: 'Name,AC,Cost\nCorpus Leather,11 + Dex modifier,10 gp\nCorpus Mail,14 + Dex modifier (max 2),50 gp\nCorpus Plate,18,1500 gp\n',
    opts: { categoryHint: 'armor' },
    expect: { format: 'csv', accepted: 3, check: (r) => { expect(r.accepted[0]!.acFormula).toEqual({ base: 11, dexCap: null }); expect(r.accepted[1]!.acFormula).toEqual({ base: 14, dexCap: 2 }); expect(r.accepted[2]!.acFormula).toEqual({ base: 18, dexCap: 0 }); } },
  },
  {
    name: 'csv: spells with level words, semicolons and a bad row',
    input: 'Name;Level;School;Casting Time;Classes\nCorpus Glow;cantrip;Evocation;1 action;Wizard, Sorcerer\nCorpus Ward;3rd;Abjuration;1 action;Cleric\nCorpus Doom;12;Necromancy;1 hour;Wizard\n;1;Evocation;;\n',
    expect: { format: 'csv', accepted: 2, repaired: 2, notes: [/spell level "cantrip" read as 0/, /spell level "3rd" read as 3/], rejected: [/missing name/, /spell level/] },
  },
  { name: 'csv: tab separated', input: 'Name\tWeight\nCorpus Anvil\t50\n', expect: { format: 'csv', accepted: 1, repaired: 0 } },
  { name: 'csv: no name column is explained', input: 'Foo,Bar\n1,2\n', expect: { format: 'unknown', accepted: 0, rejected: [/not recognized/] } },
  {
    name: 'pdf text: statblocks across pages',
    input: `${SIMPLE_STATBLOCK}\n---\n**Corpus Imp**\n*Tiny fiend, lawful evil*\n**Armor Class** 13\n**Hit Points** 10 (3d4 + 3)\n**Speed** 20 ft.\nSTR DEX CON INT WIS CHA\n6 (-2) 17 (+3) 13 (+1) 11 (+0) 12 (+1) 14 (+2)\n**Challenge** 1 (200 XP)\n***Sting.*** *Melee Weapon Attack:* +5 to hit. *Hit:* 5 (1d4 + 3) piercing damage.`,
    opts: { assumeFormat: 'pdf-text' },
    expect: { format: 'pdf-text', accepted: 2 },
  },
  {
    name: 'character json: simple shape is converted',
    input: j({ name: 'Corpus Hero', abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, classes: [{ name: 'Fighter', level: 1, hitDie: 'd10' }], hp: { current: 10, max: 10, temp: 0 }, ac: 10, speed: 30, proficiencyBonus: 2 }),
    expect: { format: 'character-json', accepted: 0, characters: 1 },
  },

  // ------------------------------------------------------------ cosmetic clean-up (no repair notes)
  { name: 'cosmetic: BOM + CRLF + non-breaking spaces + zero-width characters', input: `\uFEFF${JSON.stringify([gear('Tidy\u00A0Rope\u200B', { entries: ['Line one.\r\nLine\u00A0two.'] })], null, 2).replace(/\n/g, '\r\n')}`, expect: { format: 'entity-json', accepted: 1, repaired: 0, check: (r) => { expect(r.accepted[0]!.name).toBe('Tidy Rope'); expect(r.accepted[0]!.entries[0]).toBe('Line one.\nLine two.'); } } },
  { name: 'cosmetic: HTML and entities in text', input: j([gear('Html Lamp', { entries: ['<p>Hello&nbsp;<b>world</b> &amp; friends</p><ul><li>one</li><li>two</li></ul>'] })]), expect: { format: 'entity-json', accepted: 1, repaired: 0, check: (r) => expect(r.accepted[0]!.entries.join('\n')).toMatch(/^Hello world & friends/) } },
  { name: 'cosmetic: junk control characters and replacement characters inside a value', input: j([gear('Junk Lamp', { entries: ['Clean\u0000 te\u0007xt�� here'] })]), expect: { format: 'entity-json', accepted: 1, repaired: 0, check: (r) => expect(r.accepted[0]!.entries[0]).toBe('Clean text here') } },
  { name: 'cosmetic: "1d8 + 3" and "1D8" are tidied without a note', input: j([{ name: 'Tidy Blade', category: 'weapon', activities: [{ id: 'a', name: 'Hit', type: 'attack', actionEconomy: 'action', damageFormula: '1D8 + 3' }] }]), expect: { format: 'entity-json', accepted: 1, repaired: 0, check: (r) => expect(r.accepted[0]!.activities[0]!.damageFormula).toBe('1d8+3') } },
  { name: 'cosmetic: category hint from the file name means no "category missing" note', input: j([{ name: 'Hinted Orb', entries: ['x'] }]), opts: { name: 'items/orbs.json' }, expect: { format: 'entity-json', accepted: 1, repaired: 0 } },

  // ------------------------------------------------------------ repairs
  { name: 'missing fields: only a name', input: j([{ name: 'Bare' }]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: ['category missing: filed as gear'], check: (r) => expect(r.accepted[0]).toMatchObject({ id: 'custom-gear-bare', category: 'gear', ruleset: '2014', activities: [], entries: [] }) } },
  { name: 'odd dice: STR token, trailing words, nonsense', input: j([{ name: 'Odd Dice', category: 'weapon', activities: [{ id: 'a', name: 'A', type: 'attack', actionEconomy: 'action', damageFormula: '2d6+STR' }, { id: 'b', name: 'B', type: 'attack', actionEconomy: 'action', damageFormula: '1d8 slashing' }, { id: 'c', name: 'C', type: 'attack', actionEconomy: 'action', damageFormula: 'lots of damage', attackBonusFormula: '+5' }] }]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: [/damageFormula formula "2d6\+STR" read as "2d6\+@str"/, /damageFormula formula "1d8 slashing" trimmed to "1d8"/, /damageFormula removed/], check: (r) => { const a = r.accepted[0]!.activities; expect(a[0]!.damageFormula).toBe('2d6+@str'); expect(a[1]!.damageFormula).toBe('1d8'); expect(a[2]!.damageFormula).toBeUndefined(); expect(a[2]!.attackBonusFormula).toBe('+5'); } } },
  { name: 'fractional CR: 0.25 and 0.5 and "CR 5"', input: j([beast('Quarter', { ac: 12, hp: 9, dexModifier: 1, cr: '0.25' }), beast('Half', { ac: 12, hp: 9, dexModifier: 1, cr: 0.5 }), beast('Five', { ac: 12, hp: 9, dexModifier: 1, cr: 'CR 5 (1,800 XP)' }), beast('Fine', { ac: 12, hp: 9, dexModifier: 1, cr: '1/4' })]), expect: { format: 'entity-json', accepted: 4, repaired: 3, notes: [/written as "1\/4"/, /written as "1\/2"/, /written as "5"/], check: (r) => expect(r.accepted.map((e) => e.monsterMeta!.cr)).toEqual(['1/4', '1/2', '5', '1/4']) } },
  { name: 'unreadable CR is removed, not guessed', input: j([beast('Lost CR', { ac: 12, hp: 9, dexModifier: 1, cr: 'very high' })]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: [/not a CR: removed/], check: (r) => expect(r.accepted[0]!.monsterMeta!.cr).toBeUndefined() } },
  { name: 'numbers as strings', input: j([beast('Stringy', { ac: '15 (natural armor)', hp: '45', dexModifier: '+2', cr: '2' }), gear('Heavy Pot', { weight: '2 lb.', quantity: 'three' }), spell('Late Spell', { spellLevel: '3rd' })]), expect: { format: 'entity-json', accepted: 3, repaired: 3, notes: [/ac "15 \(natural armor\)" read as 15/, /quantity "three" is not a number: dropped/, /spell level "3rd" read as 3/], check: (r) => { expect(r.accepted[0]!.monsterMeta).toMatchObject({ ac: 15, hp: 45, dexModifier: 2 }); expect(r.accepted[1]).toMatchObject({ weight: 2 }); expect(r.accepted[1]!.quantity).toBeUndefined(); } } },
  { name: 'category alias is repaired, unknown category is rejected', input: j([{ name: 'Aliased', category: 'Spells', spellLevel: 1 }, { name: 'Odd', category: 'vehicle' }, { name: 'Numeric', category: 7 }]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: ['category "Spells" read as spell'], rejected: [/unknown category "vehicle"/, /unknown category "7"/] } },
  { name: 'ruleset: numbers are accepted, nonsense is repaired', input: j([gear('Edition Number', { ruleset: 2024 }), gear('Edition Junk', { ruleset: 'third' })]), expect: { format: 'entity-json', accepted: 2, repaired: 1, notes: [/ruleset "third" unknown/], check: (r) => expect(r.accepted.map((e) => e.ruleset)).toEqual(['2024', '2014']) } },
  { name: 'spell level: missing is a cantrip with a note, 12 is rejected', input: j([{ name: 'Levelless', category: 'spell' }, spell('Too High', { spellLevel: 12 })]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: ['spell level missing: set to 0 (cantrip)'], rejected: [/spell level "12" is not 0-9/] } },
  { name: 'activities: junk, bad types and duplicate ids', input: j([{ name: 'Junky', category: 'gear', activities: ['nope', { id: 'x', name: 'One', type: 'blast', actionEconomy: 'sometimes' }, { id: 'x', name: 'Two', type: 'utility', actionEconomy: 'action' }] }, { name: 'No List', category: 'gear', activities: 'none' }]), expect: { format: 'entity-json', accepted: 2, repaired: 2, notes: [/activity #1 is not an object/, /type "blast" unknown/, /action type "sometimes" unknown/, /activity id "x" was used twice/, /activities was not a list/], check: (r) => expect(r.accepted[0]!.activities.map((a) => a.id)).toEqual(['x', 'x-2']) } },
  { name: 'numeric id is kept as text with a note', input: j([gear('Numbered', { id: 42 })]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: ['id was a number: kept as text'], check: (r) => expect(r.accepted[0]!.id).toBe('42') } },
  { name: 'very long text is shortened, not rejected', input: j([gear('Wall Of Text', { entries: ['word '.repeat(30000)] })]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: [/longer than 20000 characters/], check: (r) => expect(r.accepted[0]!.entries[0]!.length).toBeLessThan(20010) } },
  { name: 'very long name is shortened', input: j([gear('N'.repeat(900))]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: [/name longer than 200/] } },
  { name: 'duplicate ids: identical dropped, different renamed', input: j([gear('Twin', { id: 'same' }), gear('Twin', { id: 'same' }), gear('Cousin', { id: 'same', entries: ['different'] })]), expect: { format: 'entity-json', accepted: 2, repaired: 1, notes: [/id "same" was already used in this import: renamed to "same-2"/], rejected: [/exact duplicate of an earlier entry/], check: (r) => expect(r.accepted.map((e) => e.id)).toEqual(['same', 'same-2']) } },
  { name: 'entries given as nested objects and arrays are flattened', input: j([{ name: 'Nested', category: 'feature', entries: [['Inner one'], { name: 'Heading', entries: ['Body text'] }, { type: 'list', items: ['a', 'b'] }] }]), expect: { format: 'entity-json', accepted: 1, check: (r) => expect(r.accepted[0]!.entries).toEqual(['Inner one', 'Heading: Body text', '• a', '• b']) } },
  { name: 'nested arrays of entities', input: j([[gear('Deep A')], [[gear('Deep B')]], gear('Flat C')]), expect: { format: 'entity-json', accepted: 3 } },
  { name: 'booleans as words', input: j([spell('Wordy', { concentration: 'yes', ritual: 'no' })]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: [/concentration "yes" read as true/], check: (r) => expect(r.accepted[0]).toMatchObject({ concentration: true, ritual: false }) } },
  { name: 'classes as a comma string', input: j([spell('Classy', { classes: 'Wizard, Sorcerer' })]), expect: { format: 'entity-json', accepted: 1, repaired: 1, notes: [/classes was text/], check: (r) => expect(r.accepted[0]!.classes).toEqual(['Wizard', 'Sorcerer']) } },

  // ------------------------------------------------------------ rejections
  { name: 'empty file', input: '', expect: { format: 'empty', accepted: 0, rejected: [/empty/] } },
  { name: 'whitespace only', input: '  \n\t \r\n', expect: { format: 'empty', accepted: 0, rejected: [/empty/] } },
  { name: 'empty JSON array', input: '[]', expect: { format: 'entity-json', accepted: 0, rejected: [/no entries/] } },
  { name: 'truncated JSON', input: '[{"name": "Cut Of', expect: { format: 'invalid-json', accepted: 0, rejected: [/not valid JSON/] } },
  { name: 'missing name', input: j([{ category: 'gear', entries: ['x'] }, { name: '   ', category: 'gear' }]), expect: { format: 'entity-json', accepted: 0, rejected: [/missing name/, /missing name/] } },
  { name: 'monster without monsterMeta, AC or HP', input: j([{ name: 'Naked', category: 'monster' }, beast('No AC', { hp: 5, dexModifier: 0 }), beast('No HP', { ac: 5, dexModifier: 0 }), beast('Mad AC', { ac: 999, hp: 5, dexModifier: 0 })]), expect: { format: 'entity-json', accepted: 0, rejected: [/monsterMeta/, /AC is missing/, /hit points are missing/, /AC 999 is out of range/] } },
  { name: 'non-object entries inside an array', input: j([null, 5, true, gear('Survivor')]), expect: { format: 'entity-json', accepted: 1, rejected: [/not an object/, /not an object/, /not an object/] } },
  { name: 'file references inside a loose file are explained', input: j({ entities: ['items/a.json', gear('Inline')] }), expect: { format: 'entity-json', accepted: 1, rejected: [/file reference/] } },
  { name: 'object with only unknown fields', input: j({ foo: 1, bar: [1, 2] }), expect: { format: 'entity-json', accepted: 0, rejected: [/missing name/] } },
  { name: 'prose is not an import', input: 'Hello there, this is just a sentence about nothing.', expect: { format: 'unknown', accepted: 0, rejected: [/not recognized/] } },
  { name: 'binary junk', input: 'PK\u0003\u0004\u0000\u0000��\u0001garbage', expect: { format: 'binary', accepted: 0, rejected: [/binary/] } },
  { name: 'a PDF handed over as text', input: '%PDF-1.7\n1 0 obj\n<<>>', expect: { format: 'binary', accepted: 0, rejected: [/binary/] } },
  { name: 'a character that cannot be opened', input: j({ name: 'Hollow', abilities: { str: 10 }, classes: [] }), expect: { format: 'character-json', accepted: 0, rejected: [/missing/] } },
];
