// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PacksPanel, parsePackSpec, type PackApi } from '../PacksPanel';
import type { InstalledPack } from '../../types/pack';

afterEach(cleanup);

const PACK: InstalledPack = {
  id: 'synthetic',
  name: 'Synthetic Pack',
  version: '1.2.0',
  repo: 'Someone/synthetic',
  ref: '',
  sha: 'abcdef1234567890abcdef1234567890abcdef12',
  license: 'CC-BY-4.0',
  entityCount: 7,
  installedAt: 'then',
};

function makeApi(over: Partial<PackApi> = {}): PackApi {
  return {
    packs: [PACK],
    install: vi.fn(async () => ({ ok: true as const })),
    update: vi.fn(async () => ({ ok: true as const })),
    uninstall: vi.fn(async () => ({ ok: true as const })),
    checkUpdate: vi.fn(async () => 'available' as const),
    ...over,
  };
}

describe('parsePackSpec', () => {
  it('reads owner/repo, owner/repo@ref and GitHub URLs', () => {
    expect(parsePackSpec('Someone/synthetic')).toEqual({ owner: 'Someone', repo: 'synthetic' });
    expect(parsePackSpec('Someone/synthetic@v1.2')).toEqual({ owner: 'Someone', repo: 'synthetic', ref: 'v1.2' });
    expect(parsePackSpec('https://github.com/Someone/synthetic.git')).toEqual({ owner: 'Someone', repo: 'synthetic' });
    expect(parsePackSpec('https://github.com/Someone/synthetic/tree/dev')).toEqual({ owner: 'Someone', repo: 'synthetic', ref: 'dev' });
    expect(parsePackSpec('nonsense')).toBeNull();
    expect(parsePackSpec('a/b/c')).toBeNull();
    expect(parsePackSpec('  ')).toBeNull();
  });
});

describe('PacksPanel', () => {
  it('lists the installed pack with version, short sha, repo and license', () => {
    render(<PacksPanel api={makeApi()} />);
    expect(screen.getByText('Synthetic Pack')).toBeTruthy();
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(screen.getByText('abcdef1')).toBeTruthy();
    expect(screen.getByText(/Someone\/synthetic/)).toBeTruthy();
    expect(screen.getByText(/CC-BY-4\.0/)).toBeTruthy();
  });

  it('check for update shows the result and offers Update only when one is available', async () => {
    const api = makeApi();
    render(<PacksPanel api={api} />);
    expect(screen.queryByText('Update')).toBeNull();
    fireEvent.click(screen.getByText('Check for update'));
    await waitFor(() => expect(screen.getByText('Update available')).toBeTruthy());
    fireEvent.click(screen.getByText('Update'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('synthetic'));
  });

  it('uninstall needs a second click and then calls the store', async () => {
    const api = makeApi();
    render(<PacksPanel api={api} />);
    fireEvent.click(screen.getByText('Uninstall'));
    expect(api.uninstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Remove its 7 entries/));
    await waitFor(() => expect(api.uninstall).toHaveBeenCalledWith('synthetic'));
  });

  it('Keep cancels an uninstall', () => {
    const api = makeApi();
    render(<PacksPanel api={api} />);
    fireEvent.click(screen.getByText('Uninstall'));
    fireEvent.click(screen.getByText('Keep'));
    expect(api.uninstall).not.toHaveBeenCalled();
    expect(screen.getByText('Uninstall')).toBeTruthy();
  });

  it('adds a pack from owner/repo@ref and shows a store error', async () => {
    const api = makeApi({ install: vi.fn(async () => ({ ok: false as const, error: 'pack.json is not a valid pack' })) });
    render(<PacksPanel api={api} />);
    fireEvent.change(screen.getByPlaceholderText('owner/repo or owner/repo@ref'), { target: { value: 'Other/thing@dev' } });
    fireEvent.click(screen.getByText('Add pack'));
    await waitFor(() => expect(api.install).toHaveBeenCalledWith({ owner: 'Other', repo: 'thing', ref: 'dev' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('not a valid pack'));
  });

  it('rejects text that is not a repo without calling the store', () => {
    const api = makeApi({ packs: [] });
    render(<PacksPanel api={api} />);
    expect(screen.getByText(/No packs installed yet/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('owner/repo or owner/repo@ref'), { target: { value: 'justaword' } });
    fireEvent.click(screen.getByText('Add pack'));
    expect(api.install).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('owner/repo');
  });
});
