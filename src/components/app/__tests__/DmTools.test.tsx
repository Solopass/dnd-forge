// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../../App';
import { db, saveEncounter } from '../../../storage/db';
import { expectedCompendiumSize, waitForFullCompendiumInDb } from '../../../state/__tests__/compendiumReady';
import { SEED_ENCOUNTER } from '../../../state/seed';
import type { CombatEncounterState } from '../../../types/combat';

vi.setConfig({ testTimeout: 30_000 });

beforeEach(async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  localStorage.setItem('sidereroll-free5e-autosynced', '1');
  localStorage.setItem('dnd-forge-table-role', 'dm');
  await db.delete();
  await db.open();
});

afterEach(async () => {
  cleanup();
  await db.transaction('rw', db.tables, () => undefined);
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function openDmTab(label: string) {
  await expectedCompendiumSize();
  render(<App />);
  await waitForFullCompendiumInDb(waitFor);
  const nav = await screen.findByLabelText('DM Studio navigation');
  fireEvent.click(within(nav).getByRole('button', { name: new RegExp(label) }));
}

function twoGoblins(): CombatEncounterState {
  const mob = (id: string) => ({
    ...SEED_ENCOUNTER.combatants[0]!,
    id,
    name: 'Goblin',
    kind: 'monster' as const,
    cr: '1/4',
  });
  return { ...SEED_ENCOUNTER, combatants: [...SEED_ENCOUNTER.combatants, mob('mob-1'), mob('mob-2')] };
}

describe('DM Studio tools', () => {
  it('Loot & Shops labels the party stash and the active character purse (audit D1)', async () => {
    await openDmTab('Loot & Shops');
    expect(await screen.findByText(/Party stash:/)).toBeTruthy();
    const purse = await screen.findByTestId('shop-purse');
    expect(purse.textContent).toMatch(/purse: \d[\d,]* GP/);
    expect(purse.textContent).toContain("'s purse");
  });

  it('Party XP tab pre-fills the award from the encounter total and says what it awards (audit D2)', async () => {
    await saveEncounter(twoGoblins());
    await openDmTab('Party XP');
    const field = (await screen.findByLabelText(/XP to award/)) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('100')); // 2 x 50 XP
    const award = screen.getByRole('button', { name: /Award 100 XP to the party/ });
    expect(award).toBeTruthy();
    fireEvent.change(field, { target: { value: '250' } });
    expect(screen.getByRole('button', { name: /Award 250 XP to the party/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use encounter total \(100\)/ }));
    expect(field.value).toBe('100');
  });
});
