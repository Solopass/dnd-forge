import { describe, expect, it } from 'vitest';

// Number of `style={{` occurrences allowed in src/**/*.tsx.
// Lower this when you move more inline styles into CSS classes.
// Never raise it without a reason (a truly computed value is fine inline,
// a static value belongs in utilities.css / components.css).
const INLINE_STYLE_BUDGET = 210;

const sources = import.meta.glob<string>('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true });

describe('inline style budget', () => {
  it('does not grow past the budget', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    let count = 0;
    for (const text of Object.values(sources)) count += text.split('style={{').length - 1;
    expect(count).toBeLessThanOrEqual(INLINE_STYLE_BUDGET);
  });
});
