import { describe, expect, it } from 'vitest';
import { parseCharacterJson } from '../character-json';

describe('parseCharacterJson (audit C5)', () => {
  it('accepts a complete character and fills the optional parts', () => {
    const r = parseCharacterJson(
      JSON.stringify({
        name: 'Ayla',
        classes: [{ className: 'Fighter', level: 3, hitDie: 10, casterProgression: 'none' }],
        baseAbilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
        hp: { current: 28, max: 28 },
      })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.character.id).toBe('custom-char-ayla');
      expect(r.character.items).toEqual([]);
      expect(r.character.hp.temp).toBe(0);
    }
  });
  it('rejects a character that would crash the sheet (no abilities / hp / valid class)', () => {
    const r = parseCharacterJson('{"name":"Ayla","classes":[{"className":"Fighter","level":99}]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/missing abilities.*level from 1 to 20.*hp needs/);
  });
  it('explains malformed JSON', () => {
    const r = parseCharacterJson('{nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not valid JSON/);
  });
  it('names the missing fields', () => {
    const r = parseCharacterJson('{"hp":3}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/missing name and classes/);
    const r2 = parseCharacterJson('{"name":"x"}');
    if (!r2.ok) expect(r2.reason).toMatch(/missing classes/);
  });
  it('rejects arrays and non-objects', () => {
    expect(parseCharacterJson('[1]').ok).toBe(false);
    expect(parseCharacterJson('42').ok).toBe(false);
  });
});
