// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ImportPreviewModal } from '../ImportPreviewModal';
import { installDialogPolyfill } from './dialogPolyfill';
import { planEntityImport } from '../../engine/import-preview';
import { buildImportReport, runImportPipeline } from '../../engine/import-pipeline';

installDialogPolyfill();

describe('import preview: pack doctor report', () => {
  it('shows accepted / repaired / rejected counts with an expandable list of notes and reasons', () => {
    const piped = runImportPipeline(
      JSON.stringify([
        { name: 'Preview Rat', category: 'monster', monsterMeta: { ac: 12, hp: 5, dexModifier: 1, cr: 0.25 } },
        { name: 'Preview Doom', category: 'spell', spellLevel: 12 },
        { name: 'Preview Lamp', category: 'gear' },
      ])
    );
    const report = buildImportReport(piped);
    const plan = planEntityImport(piped.accepted, []);
    render(<ImportPreviewModal pending={{ label: 'test', plan, report, commit: async () => undefined }} onImport={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('import-report-summary').textContent).toBe('2 accepted (1 repaired), 1 rejected');
    const repaired = screen.getByTestId('import-repaired');
    expect(within(repaired).getByText('1 repaired (fixed automatically)')).toBeTruthy();
    expect(repaired.textContent).toContain('Preview Rat (monster): challenge rating 0.25 written as "1/4"');
    const rejected = screen.getByTestId('import-rejected');
    expect(rejected.textContent).toContain('Preview Doom: spell level "12" is not 0-9');
    expect(screen.queryByTestId('import-unreadable')).toBeNull();
  });

  it('lists unreadable files and how many entries were kept', () => {
    const piped = runImportPipeline(JSON.stringify([{ name: 'Kept Lamp', category: 'gear' }]));
    const report = { ...buildImportReport(piped), unreadable: ['items/broken.json'], keptEntries: 3 };
    render(<ImportPreviewModal pending={{ label: 'update', plan: planEntityImport(piped.accepted, []), report, commit: async () => undefined }} onImport={vi.fn()} onCancel={vi.fn()} />);
    const box = screen.getByTestId('import-unreadable');
    expect(box.textContent).toContain('1 file unreadable');
    expect(box.textContent).toContain('3 entries kept as they were');
    expect(box.textContent).toContain('items/broken.json');
  });
});
