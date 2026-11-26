// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CampaignPacksPanel, type CampaignPacksApi } from '../CampaignPacksPanel';
import { PacksPanel, type PackApi } from '../PacksPanel';

afterEach(cleanup);

const SHA = 'c'.repeat(40);
const api = (over: Partial<CampaignPacksApi> = {}): CampaignPacksApi => ({
  campaignPacks: [{ owner: 'Someone', repo: 'alpha', ref: 'main', sha: SHA, enabled: true }],
  installedPacks: [{ id: 'beta', name: 'Pack beta', version: '2.0.0', repo: 'Someone/beta', ref: '', installedAt: '2026-01-01' }],
  link: vi.fn(async () => ({ ok: true as const })),
  linkInstalled: vi.fn(async () => ({ ok: true as const })),
  update: vi.fn(async () => ({ ok: true as const, note: 'Pinned to ddddddd.' })),
  setEnabled: vi.fn(),
  remove: vi.fn(),
  ...over,
});

describe('CampaignPacksPanel', () => {
  it('shows the pinned short sha and runs update, disable and remove', async () => {
    const a = api();
    render(<CampaignPacksPanel api={a} />);
    expect(screen.getByText('ccccccc')).toBeTruthy();
    fireEvent.click(screen.getByText('Update to latest'));
    await waitFor(() => expect(a.update).toHaveBeenCalledWith('someone/alpha'));
    await screen.findByText('Pinned to ddddddd.');
    fireEvent.click(screen.getByText('Disable'));
    expect(a.setEnabled).toHaveBeenCalledWith('someone/alpha', false);
    fireEvent.click(screen.getByText('Remove from campaign'));
    expect(a.remove).toHaveBeenCalledWith('someone/alpha');
  });

  it('adds from installed packs or by owner/repo@ref', async () => {
    const a = api();
    render(<CampaignPacksPanel api={a} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'beta' } });
    fireEvent.click(screen.getByText('Add to campaign'));
    await waitFor(() => expect(a.linkInstalled).toHaveBeenCalledWith('beta'));
    fireEvent.change(screen.getByPlaceholderText('owner/repo or owner/repo@ref'), { target: { value: 'Someone/gamma@v2' } });
    fireEvent.click(screen.getByText('Link pack'));
    await waitFor(() => expect(a.link).toHaveBeenCalledWith({ owner: 'Someone', repo: 'gamma', ref: 'v2' }));
  });
});

describe('PacksPanel table sync report', () => {
  it('lists failed packs with the needs-access wording and a Retry button', async () => {
    const retry = vi.fn(async () => undefined);
    const packApi: PackApi = {
      packs: [],
      install: vi.fn(),
      update: vi.fn(),
      uninstall: vi.fn(),
      checkUpdate: vi.fn(),
      tableSync: { campaignId: 'c', at: 'now', results: [{ owner: 'Someone', repo: 'secret', sha: SHA, status: 'needs-access' }] },
      retryTableSync: retry,
    };
    render(<PacksPanel api={packApi} />);
    expect(screen.getByText(/Pack Someone\/secret needs access/)).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(retry).toHaveBeenCalled());
  });
});
