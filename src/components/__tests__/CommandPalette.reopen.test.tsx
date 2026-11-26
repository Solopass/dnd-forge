// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette } from '../SummonCombatDrawer';
import { installDialogPolyfill } from './dialogPolyfill';

installDialogPolyfill();

const noop = async () => {};
function palette(isOpen: boolean) {
  return (
    <CommandPalette
      isOpen={isOpen}
      onClose={() => {}}
      initialCategory="spell"
      searchCompendium={() => []}
      onAddCompendiumItem={() => {}}
      onInstallContentPack={noop}
      onImportDdbPdf={noop}
      onImportHomebrew={noop}
      onImportJsonText={noop}
    />
  );
}

describe('Compendium dialog reopen (audit P1)', () => {
  afterEach(cleanup);

  it('clears the search box when reopened', () => {
    const view = render(palette(true));
    const box = screen.getByLabelText('Search compendium') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'fire' } });
    expect(box.value).toBe('fire');
    view.rerender(palette(false));
    view.rerender(palette(true));
    expect((screen.getByLabelText('Search compendium') as HTMLInputElement).value).toBe('');
  });
});
