import { describe, expect, it } from 'vitest';
import { parseCharacterJson } from '../character-json';

describe('parseCharacterJson (audit C5)', () => {
  it('accepts an object with name and classes', () => {
    const r = parseCharacterJson('{"name":"Ayla","classes":[]}');
    expect(r.ok).toBe(true);
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
