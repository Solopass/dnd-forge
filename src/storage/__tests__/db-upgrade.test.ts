// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DndForgeDatabase, CURRENT_SCHEMA_VERSION } from '../db';
import { moveSourceTier, readStoredSourcePriority, saveSourcePriority } from '../source-priority';

describe('Dexie v3 -> v6 (Duplicates decisions + content fixes + packs)', () => {
  it('keeps every existing record and adds an empty dupDecisions table', async () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(6);
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
    expect(db.verno).toBe(6);
    expect((await db.characters.get('c1'))?.name).toBe('Old Hero');
    expect((await db.compendium.get('e1'))?.name).toBe('Old Spell');
    expect(await db.dupDecisions.count()).toBe(0);
    await db.dupDecisions.put({ id: 'a|b', memberIds: ['a', 'b'], action: 'keep-both', decidedAt: 'now' });
    expect((await db.dupDecisions.get('a|b'))?.action).toBe('keep-both');
    expect(await db.packs.count()).toBe(0);
    db.close();
    await Dexie.delete(name);
  });
});

describe('Dexie v4 -> v6 (content fixes table, then packs)', () => {
  it('keeps every existing record (including duplicate decisions) and adds an empty contentFixes table', async () => {
    const name = 'dnd-forge-local-db';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(4).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
      dupDecisions: 'id',
    });
    await old.open();
    await old.table('characters').put({ id: 'c1', name: 'Old Hero', ruleset: '2014', items: [{ id: 'i1', name: '+1 Longsword' }] });
    await old.table('compendium').put({ id: 'e1', name: 'Old Spell', category: 'spell', source: 'Mine', ruleset: '2014', searchTokens: 'old spell' });
    await old.table('dupDecisions').put({ id: 'a|b', memberIds: ['a', 'b'], action: 'keep-both', decidedAt: 'then' });
    old.close();

    const db = new DndForgeDatabase();
    await db.open();
    expect(db.verno).toBe(6);
    expect((await db.characters.get('c1'))?.name).toBe('Old Hero');
    expect(((await db.characters.get('c1')) as unknown as { items: Array<{ name: string }> }).items[0]!.name).toBe('+1 Longsword');
    expect((await db.compendium.get('e1'))?.name).toBe('Old Spell');
    expect((await db.dupDecisions.get('a|b'))?.action).toBe('keep-both');
    expect(await db.contentFixes.count()).toBe(0);
    await db.contentFixes.put({
      id: 'fix-1', entityId: 'e1', baseSnapshotHash: 'h', patch: { range: '60 feet' }, note: 'typo', author: 'Player',
      status: 'proposed', createdAt: 'now', reviewedAt: null,
    });
    expect((await db.contentFixes.where('entityId').equals('e1').toArray()).length).toBe(1);
    expect((await db.contentFixes.where('status').equals('proposed').toArray()).length).toBe(1);
    db.close();
    await Dexie.delete(name);
  });
});

describe('Dexie v5 -> v6 (packs table + packId index)', () => {
  it('keeps every record, stamps legacy Free5e entries with the free5e pack and indexes packId', async () => {
    const name = 'dnd-forge-local-db';
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(5).stores({
      characters: 'id, name, ruleset',
      compendium: 'id, name, category, source, ruleset, searchTokens',
      encounters: 'id, name',
      campaigns: 'id, name',
      scenes: 'id, name',
      dupDecisions: 'id',
      contentFixes: 'id, entityId, status',
    });
    await old.open();
    await old.table('characters').put({ id: 'c1', name: 'Old Hero', ruleset: '2014' });
    await old.table('compendium').bulkPut([
      { id: 'e1', name: 'Old Spell', category: 'spell', source: 'Mine', ruleset: '2014', searchTokens: 'old spell' },
      { id: 'free5e-spl-alarm', name: 'Alarm', category: 'spell', source: 'Free5e (Solopass/free5e)', ruleset: '2014', searchTokens: 'alarm' },
    ]);
    await old.table('dupDecisions').put({ id: 'a|b', memberIds: ['a', 'b'], action: 'keep-both', decidedAt: 'then' });
    await old.table('contentFixes').put({
      id: 'fix-1', entityId: 'e1', baseSnapshotHash: 'h', patch: { range: '60 feet' }, note: 'typo', author: 'Player',
      status: 'proposed', createdAt: 'now', reviewedAt: null,
    });
    old.close();

    const db = new DndForgeDatabase();
    await db.open();
    expect(db.verno).toBe(6);
    expect((await db.characters.get('c1'))?.name).toBe('Old Hero');
    expect((await db.compendium.get('e1'))?.name).toBe('Old Spell');
    expect((await db.compendium.get('e1'))?.packId).toBeUndefined();
    expect((await db.compendium.get('free5e-spl-alarm'))?.packId).toBe('free5e');
    expect((await db.dupDecisions.get('a|b'))?.action).toBe('keep-both');
    expect((await db.contentFixes.get('fix-1'))?.status).toBe('proposed');
    const packs = await db.packs.toArray();
    expect(packs.map((p) => p.id)).toEqual(['free5e']);
    expect(packs[0]?.repo).toBe('Solopass/free5e');
    expect((await db.compendium.where('packId').equals('free5e').toArray()).map((e) => e.id)).toEqual(['free5e-spl-alarm']);
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
