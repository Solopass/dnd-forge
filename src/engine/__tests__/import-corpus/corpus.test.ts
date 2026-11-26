import { describe, expect, it } from 'vitest';
import { buildImportReport, formatPackDoctor, runImportPipeline, summarizeReport } from '../../import-pipeline';
import { CORPUS } from './fixtures';
import { expectValidEntity } from './validate';

const matches = (text: string, want: string | RegExp) => (typeof want === 'string' ? text.includes(want) : want.test(text));

describe('import corpus: every fixture ends accepted, repaired or rejected with a reason', () => {
  it.each(CORPUS.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const r = runImportPipeline(fixture.input, fixture.opts);
    const want = fixture.expect;
    expect(r.format).toBe(want.format);
    expect(r.accepted).toHaveLength(want.accepted);
    expect(r.repaired).toHaveLength(want.repaired ?? 0);
    expect(r.characters).toHaveLength(want.characters ?? 0);
    const reasons = r.rejected.map((x) => x.reason);
    if (want.rejected) {
      expect(reasons).toHaveLength(want.rejected.length);
      want.rejected.forEach((w, i) => expect(matches(reasons[i] ?? '', w), `rejection ${i}: "${reasons[i]}" should match ${String(w)}`).toBe(true));
    } else {
      expect(reasons).toEqual([]);
    }
    const notes = r.repaired.flatMap((x) => x.notes);
    for (const w of want.notes ?? []) expect(notes.some((n) => matches(n, w)), `a note should match ${String(w)}; notes: ${notes.join(' | ')}`).toBe(true);
    // the rule behind the whole pipeline: a source with content never vanishes without a reason
    expect(r.accepted.length + r.characters.length + r.rejected.length + r.warnings.length).toBeGreaterThan(0);
    want.check?.(r);
  });

  it('the corpus is big enough to mean something', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(50);
    const formats = new Set(CORPUS.map((f) => f.expect.format));
    for (const f of ['empty', 'binary', 'invalid-json', 'pack-manifest', 'app-bundle', 'five-tools', 'entity-json', 'character-json', 'free5e-markdown', 'homebrew-markdown', 'csv', 'pdf-text', 'unknown'] as const) {
      expect(formats.has(f), `a fixture for ${f}`).toBe(true);
    }
  });

  it('accepted entities are valid: known category, spell level 0-9, monster stats, parsable formulas', () => {
    for (const f of CORPUS) for (const e of runImportPipeline(f.input, f.opts).accepted) expectValidEntity(e);
  });

  it('builds a pack doctor report with counts and top problems', () => {
    const r = runImportPipeline(CORPUS.find((f) => f.name.startsWith('numbers as strings'))!.input);
    const report = buildImportReport(r);
    expect(summarizeReport(report)).toBe('3 accepted (3 repaired), 0 rejected');
    expect(report.topProblems.length).toBeGreaterThan(0);
    expect(formatPackDoctor(report).join('\n')).toContain('Top problems');
  });
});
