import { CampaignEntry, ExternalRepoConfig } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CompendiumEntity, ItemCategory } from '../types/compendium';
import { normalizeCustomCharacter, normalizeCustomEntity } from './custom-content-loader';

const PAT_STORAGE_KEY = 'sidereroll-github-pat';

export interface CampaignPackManifest {
  name?: string;
  ruleset?: '2014' | '2024';
  source?: string;
  characters?: string[];
  entities?: Array<string | { path: string; category?: ItemCategory }>;
  entries?: CampaignEntry[];
}

export interface SyncedCampaignPackResult {
  manifestName?: string;
  entities: CompendiumEntity[];
  characters: RawCharacterState[];
  entries: CampaignEntry[];
  syncedAt: string;
}

export function getStoredGithubPat(): string {
  try {
    return localStorage.getItem(PAT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredGithubPat(token: string): void {
  try {
    const clean = token.trim();
    if (clean) {
      localStorage.setItem(PAT_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(PAT_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function parseRepoSlug(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!trimmed) return null;
  const ghMatch = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
  if (ghMatch?.[1] && ghMatch[2]) {
    return { owner: ghMatch[1], repo: ghMatch[2] };
  }
  const parts = trimmed.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

export function resolveRepoAssetUrl(rawUrl: string | undefined, config: ExternalRepoConfig): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('./')) return trimmed;
  const branch = config.branch?.trim() || 'main';
  return `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${branch}/${trimmed.slice(2)}`;
}

async function fetchRepoJson(
  config: ExternalRepoConfig,
  filePath: string,
  token?: string
): Promise<unknown> {
  const cleanPath = filePath.replace(/^\.?\//, '');
  const branch = config.branch?.trim() || 'main';

  if (token?.trim()) {
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${cleanPath}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: 'application/vnd.github.raw+json',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for ${cleanPath}`);
    }
    return res.json();
  }

  const rawUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${branch}/${cleanPath}`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${cleanPath}`);
  }
  return res.json();
}

export async function fetchCampaignPackFromGitHub(
  config: ExternalRepoConfig,
  token?: string
): Promise<SyncedCampaignPackResult> {
  const rawManifest = (await fetchRepoJson(config, 'campaign-pack.json', token)) as CampaignPackManifest;
  const entities: CompendiumEntity[] = [];
  const characters: RawCharacterState[] = [];

  for (const entrySpec of rawManifest.entities ?? []) {
    const specPath = typeof entrySpec === 'string' ? entrySpec : entrySpec.path;
    const fallbackCat: ItemCategory =
      (typeof entrySpec === 'object' && entrySpec.category) ||
      (specPath.includes('spell')
        ? 'spell'
        : specPath.includes('monster')
          ? 'monster'
          : specPath.includes('feat')
            ? 'feat'
            : 'gear');
    const payload = await fetchRepoJson(config, specPath, token);
    const arr = Array.isArray(payload) ? payload : [payload];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const norm = normalizeCustomEntity(item as Record<string, unknown>, fallbackCat);
      if (norm) {
        if (norm.imageUrl) norm.imageUrl = resolveRepoAssetUrl(norm.imageUrl, config);
        entities.push(norm);
      }
    }
  }

  for (const charPath of rawManifest.characters ?? []) {
    const payload = await fetchRepoJson(config, charPath, token);
    const arr = Array.isArray(payload) ? payload : [payload];
    for (const rawChar of arr) {
      if (!rawChar || typeof rawChar !== 'object') continue;
      const norm = normalizeCustomCharacter(rawChar as Record<string, unknown>);
      if (norm) {
        if (norm.avatarUrl) norm.avatarUrl = resolveRepoAssetUrl(norm.avatarUrl, config);
        characters.push(norm);
      }
    }
  }

  return {
    manifestName: rawManifest.name,
    entities,
    characters,
    entries: Array.isArray(rawManifest.entries) ? rawManifest.entries : [],
    syncedAt: new Date().toISOString(),
  };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function pushFileToGitHubRepo(
  config: ExternalRepoConfig,
  filePath: string,
  contentText: string,
  commitMessage: string,
  token: string
): Promise<{ htmlUrl?: string }> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('GitHub Sync Token is required to push files from the browser.');
  }
  const cleanPath = filePath.replace(/^\.?\//, '');
  const branch = config.branch?.trim() || 'main';
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${cleanPath}`;

  let existingSha: string | undefined;
  const checkRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (checkRes.ok) {
    const info = (await checkRes.json()) as { sha?: string };
    existingSha = info.sha;
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: utf8ToBase64(contentText),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub push failed (${putRes.status}): ${errText.slice(0, 180)}`);
  }

  const out = (await putRes.json()) as { content?: { html_url?: string } };
  return { htmlUrl: out.content?.html_url };
}

export function buildCampaignPackTemplate(campaignName: string): string {
  return JSON.stringify(
    {
      name: campaignName,
      ruleset: '2024',
      source: campaignName,
      characters: ['characters/hero.json'],
      entities: [
        { path: 'spells/campaign-spells.json', category: 'spell' },
        { path: 'monsters/campaign-monsters.json', category: 'monster' },
        { path: 'items/campaign-items.json', category: 'gear' },
      ],
      entries: [],
    },
    null,
    2
  );
}
