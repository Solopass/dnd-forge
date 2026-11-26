import { useCallback } from 'react';
import { getStoredGithubPat, resolveCommitSha } from '../../engine/campaign-repo-sync';
import { packKey, removeCampaignPack, setCampaignPackEnabled, upsertCampaignPack } from '../../engine/campaign-packs';
import type { StoreCore } from './core';
import type { useContentImportActions } from './content-import';

export type CampaignPackResult = { ok: true; note?: string } | { ok: false; error: string };

export type CampaignPackDeps = Pick<ReturnType<typeof useContentImportActions>, 'updatePack'>;

/** DM side of campaign packs: link, pin, update to latest, enable/disable, remove. None of this installs or uninstalls anything for the DM. */
export function useCampaignPackActions(core: StoreCore, deps: CampaignPackDeps) {
  const { campaign, packs, persistCampaign, appendLog, pushToast } = core;
  const { updatePack } = deps;

  const pinNote = 'GitHub did not answer for that repo/ref. It may be private (add a GitHub token in Settings) or misspelled.';

  /** Adds `owner/repo[@ref]` to the campaign, pinned to the commit the ref points at right now. */
  const linkCampaignPack = useCallback(
    async (spec: { owner: string; repo: string; ref?: string }): Promise<CampaignPackResult> => {
      const owner = spec.owner.trim();
      const repo = spec.repo.trim();
      if (!owner || !repo) return { ok: false, error: 'Enter a repo as owner/repo (optionally owner/repo@ref).' };
      const ref = spec.ref?.trim() || 'main';
      const sha = await resolveCommitSha({ owner, repo, branch: ref }, getStoredGithubPat() || undefined);
      if (!sha) return { ok: false, error: pinNote };
      persistCampaign((prev) => ({ ...prev, packs: upsertCampaignPack(prev.packs ?? [], { owner, repo, ref, sha, enabled: true }) }));
      appendLog(`Campaign "${campaign.name}": linked pack ${owner}/${repo}@${ref} pinned to ${sha.slice(0, 7)}.`, 'info');
      return { ok: true };
    },
    [campaign.name, persistCampaign, appendLog]
  );

  /** Adds a pack the DM already installed, pinned to the commit it was installed from. */
  const linkInstalledPack = useCallback(
    async (packId: string): Promise<CampaignPackResult> => {
      const pack = packs.find((p) => p.id === packId);
      if (!pack) return { ok: false, error: 'That pack is not installed.' };
      const [owner, repo] = pack.repo.split('/');
      if (!owner || !repo) return { ok: false, error: `Bad repo name "${pack.repo}".` };
      const ref = pack.ref || 'main';
      const sha = pack.sha || (await resolveCommitSha({ owner, repo, branch: ref }, getStoredGithubPat() || undefined));
      if (!sha) return { ok: false, error: pinNote };
      persistCampaign((prev) => ({ ...prev, packs: upsertCampaignPack(prev.packs ?? [], { owner, repo, ref, sha, enabled: true }) }));
      appendLog(`Campaign "${campaign.name}": linked installed pack ${pack.name} (${sha.slice(0, 7)}).`, 'info');
      return { ok: true };
    },
    [packs, campaign.name, persistCampaign, appendLog]
  );

  /** Re-resolves the ref to its newest commit and re-pins. A locally installed copy is updated through the usual preview. */
  const updateCampaignPack = useCallback(
    async (key: string): Promise<CampaignPackResult> => {
      const entry = (campaign.packs ?? []).find((p) => packKey(p) === key.toLowerCase());
      if (!entry) return { ok: false, error: 'That pack is not linked to this campaign.' };
      const sha = await resolveCommitSha({ owner: entry.owner, repo: entry.repo, branch: entry.ref || 'main' }, getStoredGithubPat() || undefined);
      if (!sha) return { ok: false, error: pinNote };
      if (sha === entry.sha) return { ok: true, note: 'Already at the latest commit.' };
      let note = `Pinned to ${sha.slice(0, 7)}; players get it the next time they join (or right now at a live table).`;
      const installed = packs.find((p) => p.repo.toLowerCase() === key.toLowerCase());
      if (installed && installed.sha !== sha) {
        const res = await updatePack(installed.id);
        if (!res.ok) return { ok: false, error: res.error };
        note += ' Review the import preview to update your own copy too.';
      }
      persistCampaign((prev) => ({ ...prev, packs: upsertCampaignPack(prev.packs ?? [], { ...entry, sha }) }));
      appendLog(`Campaign "${campaign.name}": ${entry.owner}/${entry.repo} re-pinned ${entry.sha ? entry.sha.slice(0, 7) : '(unpinned)'} -> ${sha.slice(0, 7)}.`, 'info');
      return { ok: true, note };
    },
    [campaign.packs, campaign.name, packs, updatePack, persistCampaign, appendLog]
  );

  const setCampaignPackOn = useCallback(
    (key: string, enabled: boolean) => persistCampaign((prev) => ({ ...prev, packs: setCampaignPackEnabled(prev.packs ?? [], key, enabled) })),
    [persistCampaign]
  );

  /** Removes the link only: the pack stays installed here, and players keep what they already synced. */
  const removeCampaignPackLink = useCallback(
    (key: string) => {
      persistCampaign((prev) => ({ ...prev, packs: removeCampaignPack(prev.packs ?? [], key) }));
      pushToast('Pack removed from this campaign (still installed).', 'info');
    },
    [persistCampaign, pushToast]
  );

  return { linkCampaignPack, linkInstalledPack, updateCampaignPack, setCampaignPackOn, removeCampaignPackLink };
}
