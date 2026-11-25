import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { isFree5eIndexPage, parseFree5eMarkdownAuto, parseFree5eMarkdownBatch } from '../free5e-parser';
import { db, removeFree5eIndexJunk, upsertCompendiumEntities } from '../../storage/db';
import type { CompendiumEntity } from '../../types/compendium';

// Regression tests for audit item C2: Free5e's alphabetical index pages
// (Spell_Descriptions/A/_A.md ...) were parsed as spells named "A", "B", "C"...

// Copied from Solopass/free5e en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/A/_A.md
const INDEX_PAGE = `### A

[Acid Splash](./Acid_Splash.md)

[Aid](./Aid.md)

[Alarm](./Alarm.md)
`;

// Start of .../Spell_Descriptions/A/Aid.md
const REAL_SPELL = `#### Aid
<!-- markdownlint-disable link-image-reference-definitions -->
[_metadata_:spell_name]:- "Aid"
[_metadata_:spell_level]:- "2"
[_metadata_:spell_school]:- "abjuration"
[_metadata_:ritual]:- "false"
[_metadata_:casting_time_amount]:- "1"
[_metadata_:casting_time_unit]:- "action"

Your spell bolsters your allies with toughness and resolve.
`;

describe('Free5e index pages', () => {
  it('recognises index pages by file name and by content', () => {
    expect(isFree5eIndexPage('', 'en-US/x/Spell_Descriptions/A/_A.md')).toBe(true);
    expect(isFree5eIndexPage(INDEX_PAGE)).toBe(true);
    expect(isFree5eIndexPage(REAL_SPELL, 'en-US/x/Spell_Descriptions/A/Aid.md')).toBe(false);
  });

  it('never turns an index page into a spell, but still parses real spells', () => {
    expect(parseFree5eMarkdownAuto(INDEX_PAGE, 'spell')).toBeNull();
    expect(parseFree5eMarkdownBatch(INDEX_PAGE, 'spell')).toEqual([]);
    const aid = parseFree5eMarkdownAuto(REAL_SPELL, 'spell');
    expect(aid?.name).toBe('Aid');
    expect(aid?.category).toBe('spell');
  });

  it('removes junk one-letter spells left by older syncs and keeps real ones', async () => {
    const junk = (letter: string): CompendiumEntity => ({
      id: `free5e-spl-${letter}`,
      name: letter.toUpperCase(),
      source: 'Free5e (Solopass/free5e)',
      ruleset: '2014',
      category: 'spell',
      activities: [],
      entries: [],
    });
    const real = parseFree5eMarkdownAuto(REAL_SPELL, 'spell');
    expect(real).not.toBeNull();
    await upsertCompendiumEntities([junk('a'), junk('m'), real!]);

    expect(await removeFree5eIndexJunk()).toBe(2);
    expect(await db.compendium.get('free5e-spl-a')).toBeUndefined();
    expect(await db.compendium.get(real!.id)).toBeDefined();
    expect(await removeFree5eIndexJunk()).toBe(0);
  });
});
