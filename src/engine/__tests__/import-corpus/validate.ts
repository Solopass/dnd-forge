import { expect } from 'vitest';
import type { CompendiumEntity } from '../../../types/compendium';

const FORMULA = /^[+-]?(?:\d*d\d+(?:k[hl]\d+)?|\d+|@\w+)(?:[+-](?:\d*d\d+(?:k[hl]\d+)?|\d+|@\w+))*$/;
const CATEGORIES = ['weapon', 'armor', 'shield', 'gear', 'spell', 'feature', 'feat', 'infusion', 'monster', 'background', 'species'];

/** What every entity that leaves the pipeline must satisfy, whatever went in. */
export function expectValidEntity(e: CompendiumEntity): void {
  expect(typeof e.id).toBe('string');
  expect(e.id.length).toBeGreaterThan(0);
  expect(typeof e.name).toBe('string');
  expect(e.name.length).toBeGreaterThan(0);
  expect(e.name.length).toBeLessThanOrEqual(200);
  expect(CATEGORIES).toContain(e.category);
  expect(['2014', '2024', 'homebrew']).toContain(e.ruleset);
  expect(typeof e.source).toBe('string');
  expect(Array.isArray(e.entries)).toBe(true);
  for (const line of e.entries) {
    expect(typeof line).toBe('string');
    expect(line.length).toBeLessThanOrEqual(20010);
  }
  expect(Array.isArray(e.activities)).toBe(true);
  if (e.category === 'spell') expect(Number.isInteger(e.spellLevel) && e.spellLevel! >= 0 && e.spellLevel! <= 9).toBe(true);
  if (e.category === 'monster') {
    expect(Number.isFinite(e.monsterMeta?.ac)).toBe(true);
    expect(Number.isFinite(e.monsterMeta?.hp)).toBe(true);
    expect(Number.isFinite(e.monsterMeta?.dexModifier)).toBe(true);
  }
  if (e.monsterMeta?.cr !== undefined) expect(e.monsterMeta.cr).toMatch(/^(?:1\/8|1\/4|1\/2|\d+)$/);
  const ids = new Set<string>();
  for (const a of e.activities) {
    expect(typeof a.id).toBe('string');
    expect(ids.has(a.id)).toBe(false);
    ids.add(a.id);
    for (const k of ['attackBonusFormula', 'saveDcFormula', 'damageFormula', 'upcastDicePerLevel'] as const) {
      if (a[k] !== undefined) expect(a[k]).toMatch(FORMULA);
    }
  }
  // it must survive the database's structured clone and JSON
  expect(() => structuredClone(e)).not.toThrow();
  expect(() => JSON.stringify(e)).not.toThrow();
}
