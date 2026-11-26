// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EncounterBuilderModal } from '../EncounterBuilderModal';
import { installDialogPolyfill } from './dialogPolyfill';
import type { CompendiumEntity } from '../../types/compendium';

installDialogPolyfill();

function mob(id: string, name: string, cr: string): CompendiumEntity {
  return {
    id,
    name,
    source: 'Homebrew',
    ruleset: 'homebrew',
    category: 'monster',
    monsterMeta: { ac: 12, hp: 10, dexModifier: 0, cr, size: 'medium' },
    activities: [],
    entries: [],
  } as CompendiumEntity;
}

describe('Encounter Builder staging (audit D4)', () => {
  afterEach(cleanup);

  it('staging twice on the same row stages the same monster twice and keeps the table where it is', () => {
    render(
      <EncounterBuilderModal
        isOpen
        onClose={() => {}}
        partyLevels={[3, 3]}
        compendiumMonsters={[mob('m-a', 'Alpha Beast', '1/4'), mob('m-b', 'Beta Beast', '0.5')]}
        onSpawnMonsters={() => {}}
        onCreateCustomMonster={() => {}}
      />
    );
    const table = screen.getByRole('table');
    const rowsBefore = within(table).getAllByRole('row').map((r) => r.textContent);
    const row = within(table).getByText('Alpha Beast').closest('tr')!;
    const firstStage = within(row).getByRole('button', { name: '+ Stage' });
    fireEvent.click(firstStage);
    // the row and its button are the same elements, still in the same place
    expect(within(table).getByText('Alpha Beast').closest('tr')).toBe(row);
    expect(within(row).getByRole('button', { name: '+ Stage' })).toBe(firstStage);
    fireEvent.click(firstStage);
    const chip = screen.getByTitle('Click to remove one');
    expect(chip.textContent).toContain('2× Alpha Beast');
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual(rowsBefore);
    // the staged list comes after the table in the page, not before it
    expect(table.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
