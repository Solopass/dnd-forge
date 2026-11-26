import { useState } from 'react';
import type { CampaignPack } from '../types/campaign';
import type { InstalledPack } from '../types/pack';
import { packKey, shortSha } from '../engine/campaign-packs';
import { parsePackSpec } from './PacksPanel';

type Outcome = { ok: true; note?: string } | { ok: false; error: string };

/** What the DM tab needs from the store. */
export interface CampaignPacksApi {
  campaignPacks: readonly CampaignPack[];
  installedPacks: readonly InstalledPack[];
  link: (spec: { owner: string; repo: string; ref?: string }) => Promise<Outcome>;
  linkInstalled: (packId: string) => Promise<Outcome>;
  update: (key: string) => Promise<Outcome>;
  setEnabled: (key: string, enabled: boolean) => void;
  remove: (key: string) => void;
}

/** DM: the packs this campaign uses. Pinned to a commit; the Live Table installs exactly that commit on players' laptops. */
export function CampaignPacksPanel({ api }: { api: CampaignPacksApi }) {
  const [spec, setSpec] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const run = async (key: string, job: () => Promise<Outcome>, okMessage: string) => {
    setBusy(key);
    setMessage('');
    try {
      const res = await job();
      setMessage(res.ok ? res.note ?? okMessage : res.error);
    } finally {
      setBusy(null);
    }
  };

  const linkedKeys = new Set(api.campaignPacks.map(packKey));
  const available = api.installedPacks.filter((p) => !linkedKeys.has(p.repo.toLowerCase()));

  return (
    <section className="packs-panel card" aria-label="Campaign packs">
      <h4 className="packs-panel__title">Campaign packs</h4>
      <p className="packs-panel__empty">
        Packs players get automatically when they join your Live Table, pinned to the commit shown. Removing one here does not uninstall it.
      </p>
      {api.campaignPacks.length === 0 ? (
        <p className="packs-panel__empty">No packs linked to this campaign yet.</p>
      ) : (
        <ul className="packs-panel__list">
          {api.campaignPacks.map((p) => {
            const key = packKey(p);
            const installed = api.installedPacks.find((i) => i.repo.toLowerCase() === key);
            return (
              <li key={key} className="card packs-panel__item">
                <div className="packs-panel__head">
                  <strong>{installed?.name ?? `${p.owner}/${p.repo}`}</strong>
                  {installed && <span className="badge tabular">v{installed.version}</span>}
                  {p.sha ? (
                    <span className="badge tabular" title={p.sha}>
                      {shortSha(p.sha)}
                    </span>
                  ) : (
                    <span className="badge packs-panel__state--unknown">Not pinned: use Update to latest</span>
                  )}
                  {!p.enabled && <span className="badge packs-panel__state--unknown">Disabled</span>}
                </div>
                <div className="packs-panel__meta">
                  {p.owner}/{p.repo}@{p.ref || 'main'}
                </div>
                <div className="forge-row gap-2 wrap">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => run(`up:${key}`, () => api.update(key), 'Pinned to the latest commit.')}
                  >
                    {busy === `up:${key}` ? 'Checking...' : 'Update to latest'}
                  </button>
                  <button type="button" className="btn" onClick={() => api.setEnabled(key, !p.enabled)}>
                    {p.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="btn packs-panel__danger" onClick={() => api.remove(key)}>
                    Remove from campaign
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 && (
        <div className="packs-panel__add">
          <label className="fix-field packs-panel__field">
            <span>Add an installed pack</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy !== null}>
              <option value="">Choose a pack...</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} v{p.version}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || !pick}
            onClick={async () => {
              await run('pick', () => api.linkInstalled(pick), 'Linked.');
              setPick('');
            }}
          >
            Add to campaign
          </button>
        </div>
      )}

      <form
        className="packs-panel__add"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parsePackSpec(spec);
          if (!parsed) {
            setMessage('Enter a repo as owner/repo (optionally owner/repo@ref).');
            return;
          }
          void run('add', () => api.link(parsed), 'Linked.').then(() => setSpec(''));
        }}
      >
        <label className="fix-field packs-panel__field">
          <span>Link a GitHub pack</span>
          <input type="text" value={spec} placeholder="owner/repo or owner/repo@ref" onChange={(e) => setSpec(e.target.value)} disabled={busy !== null} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy !== null || !spec.trim()}>
          {busy === 'add' ? 'Reading repo...' : 'Link pack'}
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
