import { useState } from 'react';
import type { InstalledPack } from '../types/pack';
import { failureMessage, type TablePackSyncState } from '../engine/campaign-packs';

export type PackOutcome = { ok: true } | { ok: false; error: string };
export type PackUpdateState = 'current' | 'available' | 'unknown';

/** What the Packs tab needs from the store. */
export interface PackApi {
  packs: readonly InstalledPack[];
  install: (spec: { owner: string; repo: string; ref?: string }) => Promise<PackOutcome>;
  update: (packId: string) => Promise<PackOutcome>;
  uninstall: (packId: string) => Promise<PackOutcome>;
  checkUpdate: (packId: string) => Promise<PackUpdateState>;
  /** Outcome of the last campaign pack sync from a Live Table host (players). */
  tableSync?: TablePackSyncState | null;
  retryTableSync?: () => Promise<void>;
}

/** "owner/repo", "owner/repo@ref" or a github.com URL (optionally with /tree/<ref>). */
export function parsePackSpec(input: string): { owner: string; repo: string; ref?: string } | null {
  let text = input.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!text) return null;
  let ref: string | undefined;
  const url = text.match(/github\.com\/([^/\s]+)\/([^/\s@]+)(?:\/tree\/([^\s]+))?/i);
  if (url?.[1] && url[2]) {
    return { owner: url[1], repo: url[2].replace(/\.git$/i, ''), ...(url[3] ? { ref: url[3] } : {}) };
  }
  const at = text.indexOf('@');
  if (at > 0) {
    ref = text.slice(at + 1).trim() || undefined;
    text = text.slice(0, at);
  }
  const parts = text.split('/').map((p) => p.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1], ...(ref ? { ref } : {}) };
}

const UPDATE_LABEL: Record<PackUpdateState, string> = {
  current: 'Up to date',
  available: 'Update available',
  unknown: 'Could not check',
};

export function PacksPanel({ api }: { api: PackApi }) {
  const [spec, setSpec] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [updates, setUpdates] = useState<Record<string, PackUpdateState>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const failedTable = (api.tableSync?.results ?? []).filter((r) => r.status === 'needs-access' || r.status === 'network' || r.status === 'error');

  const run = async (key: string, job: () => Promise<PackOutcome>, okMessage: string) => {
    setBusy(key);
    setMessage('');
    try {
      const res = await job();
      setMessage(res.ok ? okMessage : res.error);
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const parsed = parsePackSpec(spec);
    if (!parsed) {
      setMessage('Enter a repo as owner/repo (optionally owner/repo@ref).');
      return;
    }
    await run('add', () => api.install(parsed), 'Review the import preview to finish installing.');
    setSpec('');
  };

  return (
    <section className="packs-panel" aria-label="Installed packs">
      <h4 className="packs-panel__title">Installed packs</h4>
      {api.packs.length === 0 ? (
        <p className="packs-panel__empty">No packs installed yet. Add one from GitHub below.</p>
      ) : (
        <ul className="packs-panel__list">
          {api.packs.map((p) => {
            const state = updates[p.id];
            return (
              <li key={p.id} className="card packs-panel__item">
                <div className="packs-panel__head">
                  <strong>{p.name}</strong>
                  <span className="badge tabular">v{p.version}</span>
                  {p.sha && <span className="badge tabular" title={p.sha}>{p.sha.slice(0, 7)}</span>}
                  {p.managedByCampaign && <span className="badge" title="Installed by your DM's table; synced to their commit">Campaign</span>}
                  {typeof p.entityCount === 'number' && <span className="badge tabular">{p.entityCount} items</span>}
                  {state && (
                    <span className={`badge packs-panel__state packs-panel__state--${state}`}>{UPDATE_LABEL[state]}</span>
                  )}
                </div>
                <div className="packs-panel__meta">
                  {p.repo}
                  {p.ref ? `@${p.ref}` : ''} · {p.license || 'no license listed'}
                </div>
                <div className="forge-row gap-2 wrap">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(`check:${p.id}`);
                      try {
                        const r = await api.checkUpdate(p.id);
                        setUpdates((prev) => ({ ...prev, [p.id]: r }));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === `check:${p.id}` ? 'Checking...' : 'Check for update'}
                  </button>
                  {state === 'available' && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => run(`update:${p.id}`, () => api.update(p.id), 'Review the import preview to finish updating.')}
                    >
                      Update
                    </button>
                  )}
                  {confirming === p.id ? (
                    <>
                      <button
                        type="button"
                        className="btn packs-panel__danger"
                        disabled={busy !== null}
                        onClick={async () => {
                          setConfirming(null);
                          await run(`rm:${p.id}`, () => api.uninstall(p.id), `Uninstalled ${p.name}.`);
                          setUpdates((prev) => {
                            const { [p.id]: _gone, ...rest } = prev;
                            return rest;
                          });
                        }}
                      >
                        Remove its {p.entityCount ?? ''} entries
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => setConfirming(p.id)}>
                      Uninstall
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {failedTable.length > 0 && (
        <div className="packs-panel__item card" role="alert">
          <strong>Campaign packs that did not sync</strong>
          <ul className="packs-panel__list">
            {failedTable.map((r) => (
              <li key={`${r.owner}/${r.repo}`} className="packs-panel__meta">
                {failureMessage(r)}
              </li>
            ))}
          </ul>
          {api.retryTableSync && (
            <div className="forge-row gap-2 wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy('retry');
                  try {
                    await api.retryTableSync?.();
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === 'retry' ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          )}
        </div>
      )}

      <form
        className="packs-panel__add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="fix-field packs-panel__field">
          <span>Add pack from GitHub</span>
          <input
            type="text"
            value={spec}
            placeholder="owner/repo or owner/repo@ref"
            onChange={(e) => setSpec(e.target.value)}
            disabled={busy !== null}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy !== null || !spec.trim()}>
          {busy === 'add' ? 'Reading repo...' : 'Add pack'}
        </button>
      </form>
      {message && (
        <p className="packs-panel__message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
