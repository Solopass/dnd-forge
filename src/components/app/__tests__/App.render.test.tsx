// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../../App';
import { db } from '../../../storage/db';

// Render snapshots of every layout/role combination App can reach.
// These guard the App.tsx split: moving code must not change the rendered DOM.

const FIXED_NOW = new Date('2026-01-15T12:00:00Z');

function normalize(html: string): string {
  // console-log timestamps like "[5:44:25 PM]" depend on the machine's locale/zone
  const noTimes = html.replace(/\[\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?\]/g, '[TIME]');
  // React useId() values ("_r_1o_") come from a counter shared by every render in the
  // process, so renumber them by order of first appearance (keeps which elements share an id)
  const seen = new Map<string, string>();
  return noTimes.replace(/_r_[0-9a-z]+_/g, (id) => {
    if (!seen.has(id)) seen.set(id, `_id${seen.size}_`);
    return seen.get(id)!;
  });
}

type Setup = { role: 'dm' | 'player'; uiMode?: 'classic' | 'unified'; modular?: boolean };

async function renderApp(opts: Setup, ready: () => Promise<unknown>) {
  localStorage.setItem('dnd-forge-table-role', opts.role);
  localStorage.setItem('dnd-forge-ui-mode', opts.uiMode ?? 'classic');
  localStorage.setItem('dnd-forge-modular-mode', opts.modular ? '1' : '0');
  const view = render(<App />);
  // startup Dexie hydration ends by refreshing the compendium from the db
  await waitFor(async () => {
    expect(await db.compendium.count()).toBeGreaterThan(0);
  }, { timeout: 10000 });
  await ready();
  // let lazy chunks and trailing state updates settle
  await new Promise((r) => setTimeout(r, 300));
  await ready();
  return view;
}

beforeEach(async () => {
  // jsdom has no matchMedia: stub it as "nothing matches" (light scheme, motion allowed)
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  localStorage.setItem('sidereroll-free5e-autosynced', '1');
  await db.delete();
  await db.open();
});

afterEach(async () => {
  // unmount so nothing keeps saving, then wait for queued Dexie writes
  cleanup();
  await db.transaction('rw', db.tables, () => undefined);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('App layouts render', () => {
  it('DM view', async () => {
    const { container } = await renderApp({ role: 'dm' }, async () => {
      await screen.findByLabelText('DM Studio navigation');
      await screen.findByText('Party & Sync');
    });
    expect(screen.getByRole('button', { name: 'DM' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Campaign Binder')).toBeTruthy();
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Beyond Classic, combat rail on', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'classic' }, async () => {
      await screen.findByText('Combat Rail ON');
    });
    expect(screen.getByLabelText('Ability scores and combat vitals')).toBeTruthy();
    expect(screen.getByText('Actions & Sheet')).toBeTruthy();
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Beyond Classic, combat rail off', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'classic' }, async () => {
      await screen.findByText('Combat Rail ON');
    });
    fireEvent.click(screen.getByText('Combat Rail ON'));
    await screen.findByText('Combat Rail OFF');
    expect(screen.queryByRole('tablist', { name: 'Right panel tabs' })).toBeNull();
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Unified Command, sheet view', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'unified' }, async () => {
      await screen.findByLabelText('Unified workspace navigation');
    });
    expect(screen.getByText('Play Sheet')).toBeTruthy();
    expect(screen.getByText('Compendium / PDF')).toBeTruthy();
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Unified Command, VTT view', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'unified' }, async () => {
      await screen.findByLabelText('Unified workspace navigation');
    });
    fireEvent.click(screen.getByText('Tactical VTT'));
    await screen.findByText('← Play Sheet');
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Modular Grid', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'classic', modular: true }, async () => {
      await screen.findByText('Edit Blocks');
    });
    expect(screen.getByRole('button', { name: 'Modular Grid' }).getAttribute('aria-pressed')).toBe('true');
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('DM view, Tactical Battlemap section', async () => {
    const { container } = await renderApp({ role: 'dm' }, async () => {
      await screen.findByLabelText('DM Studio navigation');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tactical Battlemap', pressed: false }));
    await waitFor(() => expect(container.querySelector('.battlemap-scroll')).not.toBeNull());
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Beyond Classic, battlemap in the center stage', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'classic' }, async () => {
      await screen.findByText('Combat Rail ON');
    });
    fireEvent.click(screen.getByText(/Active Battlemap/));
    await waitFor(() => expect(container.querySelector('.center-battlemap-slot .battlemap-scroll')).not.toBeNull());
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });
});
