import { describe, expect, it } from 'vitest';
import { loadCustomRepoEntities } from '../custom-content-loader';
import monsters2014 from '../../custom-content/monsters/srd-2014-monsters.json';
import monsters2024 from '../../custom-content/monsters/srd-2024-monsters.json';
import spells2014 from '../../custom-content/spells/srd-2014-spells.json';
import spells2024 from '../../custom-content/spells/srd-2024-spells.json';

// Regression test for audit item C1: the loader used to guard its import.meta.glob calls with
// `typeof import.meta.glob === 'function'`, which is false at runtime, so nothing in
// src/custom-content was ever loaded and no test noticed.
describe('custom-content loader', () => {
  it('loads every SRD monster and spell shipped in src/custom-content', async () => {
    const entities = await loadCustomRepoEntities();
    const count = (cat: string) => entities.filter((e) => e.category === cat).length;

    expect(count('monster')).toBe(monsters2014.length + monsters2024.length);
    expect(count('spell')).toBe(spells2014.length + spells2024.length);
    expect(count('feature')).toBeGreaterThan(0);
    expect(entities.some((e) => e.name === 'Aboleth' && e.ruleset === '2014')).toBe(true);
  });
});
