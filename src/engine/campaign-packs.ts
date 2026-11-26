import type { CampaignPack, CampaignRecord } from '../types/campaign';
import type { InstalledPack } from '../types/pack';

/** What the host sends to players: just enough to fetch the same commit. */
export interface TablePack {
  owner: string;
  repo: string;
  sha: string;
}

export type TablePackStatus = 'synced' | 'current' | 'needs-access' | 'network' | 'error';

/** The outcome for one pack of the last table sync (failures are always listed, never silent). */
export interface TablePackResult {
  owner: string;
  repo: string;
  sha: string;
  status: TablePackStatus;
  name?: string;
  version?: string;
  message?: string;
}

export interface TablePackSyncState {
  campaignId: string;
  at: string;
  results: TablePackResult[];
}

const SHA = /^[0-9a-f]{40}$/i;
const SLUG = /^[A-Za-z0-9._-]+$/;

export const packKey = (p: { owner: string; repo: string }): string => `${p.owner}/${p.repo}`.toLowerCase();
export const shortSha = (sha: string): string => sha.slice(0, 7);

/**
 * Brings an older campaign (one `externalRepo`, no `packs`) up to date: the repo becomes `packs[0]`, unpinned
 * (its sha is filled in the next time the DM updates it). The old field stays for its sync/push buttons.
 * Returns the same object when nothing needs to change.
 */
export function migrateCampaignPacks(campaign: CampaignRecord): CampaignRecord {
  if (Array.isArray(campaign.packs)) return campaign;
  const repo = campaign.externalRepo;
  const packs: CampaignPack[] =
    repo?.owner && repo.repo ? [{ owner: repo.owner, repo: repo.repo, ref: repo.branch?.trim() || 'main', sha: '', enabled: true }] : [];
  return { ...campaign, packs };
}

export function upsertCampaignPack(packs: readonly CampaignPack[], entry: CampaignPack): CampaignPack[] {
  const key = packKey(entry);
  return packs.some((p) => packKey(p) === key) ? packs.map((p) => (packKey(p) === key ? { ...p, ...entry } : p)) : [...packs, entry];
}

export const removeCampaignPack = (packs: readonly CampaignPack[], key: string): CampaignPack[] => packs.filter((p) => packKey(p) !== key.toLowerCase());

export const setCampaignPackEnabled = (packs: readonly CampaignPack[], key: string, enabled: boolean): CampaignPack[] =>
  packs.map((p) => (packKey(p) === key.toLowerCase() ? { ...p, enabled } : p));

/** The list the host sends: enabled and pinned packs only. */
export function toTablePacks(packs: readonly CampaignPack[] | undefined): TablePack[] {
  return (packs ?? []).filter((p) => p.enabled && SHA.test(p.sha)).map((p) => ({ owner: p.owner, repo: p.repo, sha: p.sha.toLowerCase() }));
}

/** Checks a received list: anything that is not a plain owner/repo at a full commit sha is dropped. */
export function parseTablePacks(value: unknown): TablePack[] {
  if (!Array.isArray(value)) return [];
  const out: TablePack[] = [];
  for (const v of value) {
    if (typeof v !== 'object' || v === null) continue;
    const { owner, repo, sha } = v as Record<string, unknown>;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof sha !== 'string') continue;
    if (!SLUG.test(owner) || !SLUG.test(repo) || !SHA.test(sha)) continue;
    if (out.some((o) => packKey(o) === packKey({ owner, repo }))) continue;
    out.push({ owner, repo, sha: sha.toLowerCase() });
  }
  return out;
}

/** True when the player already has this repo at this commit. */
export const isCurrentAt = (installed: InstalledPack | undefined, sha: string): boolean => !!installed?.sha && installed.sha.toLowerCase() === sha.toLowerCase();

export const labelOf = (r: Pick<TablePackResult, 'owner' | 'repo' | 'name'>): string => r.name || `${r.owner}/${r.repo}`;

export function failureMessage(r: TablePackResult): string {
  const label = labelOf(r);
  if (r.status === 'needs-access') return `Pack ${label} needs access — ask the DM or add a GitHub token in Settings`;
  if (r.status === 'network') return `Could not reach GitHub for pack ${label}. Check your connection and retry.`;
  return `Pack ${label} could not be installed${r.message ? `: ${r.message}` : '.'}`;
}

/** "Synced 2 packs: X v1.2, Y v1.0" (null when nothing was installed or changed). */
export function syncSummary(results: readonly TablePackResult[]): string | null {
  const done = results.filter((r) => r.status === 'synced');
  if (done.length === 0) return null;
  return `Synced ${done.length} pack${done.length === 1 ? '' : 's'}: ${done.map((r) => `${labelOf(r)}${r.version ? ` v${r.version}` : ''}`).join(', ')}`;
}
