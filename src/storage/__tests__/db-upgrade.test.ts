// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DndForgeDatabase, CURRENT_SCHEMA_VERSION } from '../db';
import { moveSourceTier, readStoredSourcePriority, saveSourcePriority } from '../source-priority';

describe('Dexie v3 -> v4 (Duplicates decisions table)', () => {
  it('keeps every existing record and adds an empty dupDecisions table', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
    const name = 'dnd-forge-local-db';
    await Dexie.delete(name);
    // an old install: schema version 3, with data
    const old = new Dexie(name);
    old.version(3).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
    });
    await old.open();
    await old.table('characters').put({ id: 'c1', name: 'Old Hero', ruleset: '2014' });
    await old.table('compendium').put({ id: 'e1', name: 'Old Spell', category: 'spell', source: 'Mine', ruleset: '2014', searchTokens: 'old spell' });
    old.close();

    const db = new DndForgeDatabase();
    await db.open();
    expect(db.verno).toBe(4);
    expect((await db.characters.get('c1'))?.name).toBe('Old Hero');
    expect((await db.compendium.get('e1'))?.name).toBe('Old Spell');
    expect(await db.dupDecisions.count()).toBe(0);
    await db.dupDecisions.put({ id: 'a|b', memberIds: ['a', 'b'], action: 'keep-both', decidedAt: 'now' });
    expect((await db.dupDecisions.get('a|b'))?.action).toBe('keep-both');
    db.close();
    await Dexie.delete(name);
  });
});

describe('source priority setting', () => {
  it('defaults to Mine > SRD 2024 > SRD 2014 > Free5e, saves, reloads and repairs bad data', () => {
    localStorage.clear();
    expect(readStoredSourcePriority()).toEqual(['mine', 'srd2024', 'srd2014', 'free5e']);
    saveSourcePriority(moveSourceTier(readStoredSourcePriority(), 'free5e', -1));
    expect(readStoredSourcePriority()).toEqual(['mine', 'srd2024', 'free5e', 'srd2014']);
    localStorage.setItem('dnd-forge-source-priority', '{oops');
    expect(readStoredSourcePriority()).toEqual(['mine', 'srd2024', 'srd2014', 'free5e']);
    expect(moveSourceTier(['mine', 'srd2024'], 'mine', -1)).toEqual(['mine', 'srd2024']);
  });
});
