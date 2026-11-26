// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../../App';
import { db } from '../../../storage/db';
import { expectedCompendiumSize, waitForFullCompendiumInDb } from '../../../state/__tests__/compendiumReady';
import { APP_VERSION } from '../../../version';
import { SEED_ENCOUNTER } from '../../../state/seed';
import { ACTIVE_LAYOUT_STORAGE_KEY, BUILTIN_LAYOUT_PRESETS } from '../../../engine/layout-engine';

// Render snapshots of every layout/role combination App can reach.
// These guard the App.tsx split: moving code must not change the rendered DOM.

// Startup hydration + lazy chunks + settle() can take well over Vitest's default 5 s on a
// cold or busy machine; give each test room so a slow run fails as a mismatch, not a timeout.
vi.setConfig({ testTimeout: 30_000 });

const FIXED_NOW = new Date('2026-01-15T12:00:00Z');

function normalize(html: string): string {
  // console-log timestamps like "[5:44:25 PM]" depend on the machine's locale/zone
  const noTimes = html
    .replace(/\[\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?\]/g, '[TIME]')
    // the topbar shows APP_VERSION, which `bun run version:bump` changes before every push;
    // without this every bump would fail all snapshots (and tempt a blind `vitest -u`)
    .replace(new RegExp(`>${APP_VERSION.replace('.', '\\.')}<`, 'g'), '>[VERSION]<')
    // SVG coordinates from Math.sin/cos (SkillWheel) differ in the last digits between
    // Windows and the Linux CI runner (52.15051733833046 vs 52.150517338330474), so round them
    .replace(/(\d+\.\d{4})\d+/g, '$1');
  // React useId() values ("_r_1o_") come from a counter shared by every render in the
  // process, so renumber them by order of first appearance (keeps which elements share an id)
  const seen = new Map<string, string>();
  return noTimes.replace(/_r_[0-9a-z]+_/g, (id) => {
    if (!seen.has(id)) seen.set(id, `_id${seen.size}_`);
    return seen.get(id)!;
  });
}

// Lazy chunks load at their own pace (slower on a cold or busy machine), so wait until the
// DOM has stopped changing before snapshotting.
async function settle(container: HTMLElement) {
  let last = '';
  let stable = 0;
  for (let i = 0; i < 150 && stable < 6; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const now = container.innerHTML;
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  if (stable < 6) throw new Error('settle(): the DOM never stopped changing within 15 s');
}

type Setup = { role: 'dm' | 'player'; uiMode?: 'classic' | 'unified'; modular?: boolean };

async function renderApp(opts: Setup, ready: () => Promise<unknown>) {
  localStorage.setItem('dnd-forge-table-role', opts.role);
  localStorage.setItem('dnd-forge-ui-mode', opts.uiMode ?? 'classic');
  localStorage.setItem('dnd-forge-modular-mode', opts.modular ? '1' : '0');
  await expectedCompendiumSize(); // cached; computed before App starts its own load
  const view = render(<App />);
  // wait for the FULL load (about 4,000 entries): a slower machine would otherwise snapshot mid-load
  await waitForFullCompendiumInDb(waitFor);
  await ready();
  await settle(view.container);
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
    await settle(container);
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
    await settle(container);
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
    await settle(container);
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });

  it('Player x Beyond Classic, battlemap in the center stage', async () => {
    const { container } = await renderApp({ role: 'player', uiMode: 'classic' }, async () => {
      await screen.findByText('Combat Rail ON');
    });
    fireEvent.click(screen.getByText(/Active Battlemap/));
    await waitFor(() => expect(container.querySelector('.center-battlemap-slot .battlemap-scroll')).not.toBeNull());
    await settle(container);
    expect(normalize(container.innerHTML)).toMatchSnapshot();
  });
});

describe('Player view hides DM detail', () => {
  it('Player x Modular Grid mini battlemap hides monster HP bars', async () => {
    const preset = structuredClone(BUILTIN_LAYOUT_PRESETS[0]!);
    for (const w of preset.widgets) if (w.id === 'mini_vtt') w.visible = true;
    localStorage.setItem(ACTIVE_LAYOUT_STORAGE_KEY, JSON.stringify(preset));
    const pc = SEED_ENCOUNTER.combatants[0]!;
    await db.encounters.put({
      ...SEED_ENCOUNTER,
      combatants: [pc, { ...pc, id: 'mon-goblin-01', name: 'Goblin', kind: 'monster', hp: { current: 7, max: 7, temp: 0 }, ac: 15 }],
    });
    const { container } = await renderApp({ role: 'player', uiMode: 'classic', modular: true }, async () => {
      await screen.findByText('Edit Blocks');
      await waitFor(() => expect(document.querySelector('.battlemap-scroll')).not.toBeNull());
    });
    // the embedded map is just the SVG grid (no toolbar), so the HP bars are the visible DM detail
    // Only PC tokens get an HP bar in Player View; the encounter has a PC and a monster.
    const tokens = container.querySelectorAll('.battlemap-scroll svg g[opacity]');
    const hpBars = container.querySelectorAll('.battlemap-scroll svg rect[height="4"][fill="#0d1117"]');
    expect(tokens.length).toBeGreaterThan(1);
    expect(hpBars.length).toBeLessThan(tokens.length);
  });

  it('Player x Unified Command combat panel has no encounter management controls', async () => {
    await renderApp({ role: 'player', uiMode: 'unified' }, async () => {
      await screen.findByLabelText('Unified workspace navigation');
    });
    const panel = screen.getByLabelText('Encounter and Linked Summons');
    for (const name of ['+ New', 'Dup', 'Del', 'Reset', 'Start! (Roll Init)', 'Roll All Init', '+ Party', '+ Add Creature', 'Builder / Forge', '+ Timer', 'Next Turn']) {
      expect(within(panel).queryByRole('button', { name }), name).toBeNull();
    }
    expect(within(panel).queryByLabelText('Active encounter')).toBeNull();
    expect(within(panel).queryByText(/Quick Demo/)).toBeNull();
  });

  it('the sheet condition picker starts on a placeholder, not on a real condition', async () => {
    await renderApp({ role: 'player', uiMode: 'unified' }, async () => {
      await screen.findByLabelText('Unified workspace navigation');
    });
    const select = screen.getByLabelText('Condition to toggle') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0]?.textContent).toBe('Add condition…');
    expect(screen.getByRole('button', { name: 'Toggle Cond' }).hasAttribute('disabled')).toBe(true);
  });

  it('DM Studio side-nav buttons have names and mark the current section', async () => {
    await renderApp({ role: 'dm' }, async () => {
      await screen.findByLabelText('DM Studio navigation');
    });
    const nav = screen.getByLabelText('DM Studio navigation');
    const current = within(nav).getByRole('button', { name: 'Party & Sync' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('button', { name: 'Campaign Binder' }).hasAttribute('aria-current')).toBe(false);
  });

  it('DM header: one campaign picker, no duplicate buttons, More menu holds Settings', async () => {
    await renderApp({ role: 'dm' }, async () => {
      await screen.findByLabelText('DM Studio navigation');
    });
    const header = screen.getByRole('banner');
    expect(within(header).getAllByLabelText('Active campaign')).toHaveLength(1);
    expect(screen.getAllByLabelText('Active campaign')).toHaveLength(1);
    expect(within(header).queryByRole('button', { name: 'DM Hub' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Battlemap' })).toBeNull();
    const names = within(header).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    // the campaign bar lives only on the Campaign Binder tab, and has no picker of its own
    expect(screen.queryByRole('button', { name: 'Export .md' })).toBeNull();
    fireEvent.click(within(screen.getByLabelText('DM Studio navigation')).getByRole('button', { name: 'Campaign Binder' }));
    await screen.findByRole('button', { name: 'Export .md' });
    expect(screen.getAllByLabelText('Active campaign')).toHaveLength(1);

    const more = within(header).getByRole('button', { name: /More/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(within(header).getByRole('button', { name: 'Settings' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(within(header).queryByRole('button', { name: 'Settings' })).toBeNull();
    // outside click closes it too
    fireEvent.click(more);
    fireEvent.mouseDown(document.body);
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('Player header keeps Battlemap inside the More menu', async () => {
    await renderApp({ role: 'player', uiMode: 'classic' }, async () => {
      await screen.findByText('Combat Rail ON');
    });
    const header = screen.getByRole('banner');
    expect(within(header).queryByRole('button', { name: 'Battlemap' })).toBeNull();
    fireEvent.click(within(header).getByRole('button', { name: /More/ }));
    expect(within(header).getByRole('button', { name: 'Battlemap' })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Themes' })).toBeTruthy();
  });

  it('DM role: layout controls are locked or hidden, not silently inert', async () => {
    // jsdom has no <dialog>.showModal(); fake just enough for ModalDialog to open
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    await renderApp({ role: 'dm', modular: true }, async () => {
      await screen.findByLabelText('DM Studio navigation');
    });
    expect(screen.queryByRole('button', { name: 'Edit Blocks' })).toBeNull();
    const header = screen.getByRole('banner');
    fireEvent.click(within(header).getByRole('button', { name: /More/ }));
    fireEvent.click(within(header).getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Layouts apply to the Player view.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Unified Command Studio/ }).hasAttribute('disabled')).toBe(true);
  });
});
