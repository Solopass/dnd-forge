import { CampaignEntry, CampaignRecord, ExternalRepoConfig } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CompendiumEntity, ItemCategory } from '../types/compendium';
import { normalizeCustomCharacter, normalizeCustomEntity } from './custom-content-loader';
import { parseFree5eMarkdownBatch } from './free5e-parser';

const PAT_STORAGE_KEY = 'sidereroll-github-pat';

export interface CampaignPackManifest {
  name?: string;
  setting?: string;
  ruleset?: '2014' | '2024';
  source?: string;
  exportedAt?: string;
  characters?: Array<string | Record<string, unknown>>;
  entities?: Array<string | { path: string; category?: ItemCategory } | Record<string, unknown>>;
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

async function fetchRepoText(
  config: ExternalRepoConfig,
  filePath: string,
  token?: string
): Promise<string> {
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
    return res.text();
  }

  const rawUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${branch}/${cleanPath}`;
  const res = await fetch(rawUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${cleanPath}`);
  }
  return res.text();
}

async function fetchRepoJson(
  config: ExternalRepoConfig,
  filePath: string,
  token?: string
): Promise<unknown> {
  const text = await fetchRepoText(config, filePath, token);
  return JSON.parse(text) as unknown;
}

async function discoverFree5ePathsViaRaw(
  config: ExternalRepoConfig,
  token?: string
): Promise<Array<{ path: string; category: ItemCategory }>> {
  const targets: Array<{ path: string; category: ItemCategory }> = [
    { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Weapons_table.md', category: 'weapon' },
    { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Armor_table.md', category: 'armor' },
    { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Adventuring_Gear.md', category: 'gear' },
    { path: 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Tools.md', category: 'gear' },
  ];

  const extractLinks = (md: string): string[] => {
    const out: string[] = [];
    const re = /\]\(\.\/([^)\s]+\.md)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(md)) !== null) {
      if (m[1]) out.push(m[1]);
    }
    return out;
  };

  try {
    const featsIdx = await fetchRepoText(
      config,
      'en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats.md',
      token
    );
    for (const rel of extractLinks(featsIdx)) {
      targets.push({ path: `en-US/Characters_Codex/03_Creating_a_Character/Feats/${rel}`, category: 'feat' });
    }
  } catch {
    // ignore if missing
  }

  try {
    const spellsIdx = await fetchRepoText(
      config,
      'en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions.md',
      token
    );
    const letterFiles = extractLinks(spellsIdx);
    const letterContents = await Promise.all(
      letterFiles.map(async (rel) => {
        try {
          const full = `en-US/Characters_Codex/06_Spellcasting/${rel}`;
          const dir = full.slice(0, full.lastIndexOf('/'));
          const text = await fetchRepoText(config, full, token);
          return extractLinks(text).map((sp) => `${dir}/${sp}`);
        } catch {
          return [];
        }
      })
    );
    for (const group of letterContents) {
      for (const path of group) {
        targets.push({ path, category: 'spell' });
      }
    }
  } catch {
    // ignore if missing
  }

  return targets;
}

async function fetchFree5eTreeFromGitHub(
  config: ExternalRepoConfig,
  token?: string
): Promise<SyncedCampaignPackResult | null> {
  const branch = config.branch?.trim() || 'main';
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;

  let targets: Array<{ path: string; category: ItemCategory }> = [];
  const treeRes = await fetch(treeUrl, { headers }).catch(() => null);
  if (treeRes?.ok) {
    const treeData = (await treeRes.json()) as {
      tree?: Array<{ path?: string; type?: string }>;
    };
    const files = (treeData.tree ?? [])
      .filter((n) => n.type === 'blob' && typeof n.path === 'string' && n.path.endsWith('.md'))
      .map((n) => n.path as string);

    for (const p of files) {
      // `_A.md`-style files are alphabetical index pages, not content
      if ((p.split('/').pop() ?? '').startsWith('_')) continue;
      if (
        p.startsWith('en-US/Characters_Codex/06_Spellcasting/Spell_Descriptions/') &&
        !p.endsWith('/Spell_Descriptions.md')
      ) {
        targets.push({ path: p, category: 'spell' });
      } else if (p.startsWith('en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/')) {
        targets.push({ path: p, category: 'feat' });
      } else if (p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Weapons_table.md') {
        targets.push({ path: p, category: 'weapon' });
      } else if (p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Armor_table.md') {
        targets.push({ path: p, category: 'armor' });
      } else if (
        p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Adventuring_Gear.md' ||
        p === 'en-US/Characters_Codex/03_Creating_a_Character/Equipment/Tools.md'
      ) {
        targets.push({ path: p, category: 'gear' });
      } else if (p.startsWith('en-US/Monstrous_Manuscript/02_Monsters_A-Z/Monsters/')) {
        targets.push({ path: p, category: 'monster' });
      }
    }
  } else {
    targets = await discoverFree5ePathsViaRaw(config, token);
  }

  if (targets.length === 0) return null;

  const sourceLabel = `Free5e (${config.owner}/${config.repo})`;
  const entities: CompendiumEntity[] = [];
  const BATCH = 24;
  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (t) => {
        try {
          const md = await fetchRepoText(config, t.path, token);
          return parseFree5eMarkdownBatch(md, t.category, sourceLabel);
        } catch {
          return [];
        }
      })
    );
    for (const batch of results) {
      entities.push(...batch);
    }
  }

  return {
    manifestName: 'Free5e (CC-BY-4.0)',
    entities,
    characters: [],
    entries: [],
    syncedAt: new Date().toISOString(),
  };
}

export async function fetchCampaignPackFromGitHub(
  config: ExternalRepoConfig,
  token?: string
): Promise<SyncedCampaignPackResult> {
  const packPath = config.packPath?.trim() || 'campaign-pack.json';
  let rawManifest: CampaignPackManifest;
  try {
    rawManifest = (await fetchRepoJson(config, packPath, token)) as CampaignPackManifest;
  } catch (err) {
    const treeFallback = await fetchFree5eTreeFromGitHub(config, token);
    if (treeFallback) return treeFallback;
    throw err;
  }
  const entities: CompendiumEntity[] = [];
  const characters: RawCharacterState[] = [];
  const sourceLabel =
    rawManifest.source?.trim() || rawManifest.name?.trim() || `${config.owner}/${config.repo}`;

  const pushNormalizedEntity = (item: Record<string, unknown>, fallbackCat: ItemCategory) => {
    const norm = normalizeCustomEntity(item, fallbackCat);
    if (!norm) return;
    if (norm.imageUrl) norm.imageUrl = resolveRepoAssetUrl(norm.imageUrl, config);
    if (!norm.source || norm.source === 'Custom' || norm.source === 'Homebrew') {
      norm.source = sourceLabel;
    }
    entities.push(norm);
  };

  for (const entrySpec of rawManifest.entities ?? []) {
    const specObj =
      typeof entrySpec === 'object' && entrySpec !== null
        ? (entrySpec as { path?: unknown; category?: ItemCategory })
        : null;
    if (specObj && typeof specObj.path !== 'string') {
      const cat = typeof specObj.category === 'string' ? specObj.category : 'gear';
      pushNormalizedEntity(entrySpec as Record<string, unknown>, cat);
      continue;
    }
    const specPath = typeof entrySpec === 'string' ? entrySpec : typeof specObj?.path === 'string' ? specObj.path : '';
    if (!specPath) continue;
    const fallbackCat: ItemCategory =
      specObj?.category ||
      (specPath.includes('spell')
        ? 'spell'
        : specPath.includes('monster')
          ? 'monster'
          : specPath.includes('feat')
            ? 'feat'
            : 'gear');
    if (specPath.toLowerCase().endsWith('.md')) {
      const mdText = await fetchRepoText(config, specPath, token);
      for (const parsed of parseFree5eMarkdownBatch(mdText, fallbackCat, sourceLabel)) {
        if (parsed.imageUrl) parsed.imageUrl = resolveRepoAssetUrl(parsed.imageUrl, config);
        entities.push(parsed);
      }
      continue;
    }
    const payload = await fetchRepoJson(config, specPath, token);
    const arr = Array.isArray(payload) ? payload : [payload];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      pushNormalizedEntity(item as Record<string, unknown>, fallbackCat);
    }
  }

  for (const charSpec of rawManifest.characters ?? []) {
    if (typeof charSpec === 'object' && charSpec !== null) {
      const norm = normalizeCustomCharacter(charSpec);
      if (norm) {
        if (norm.avatarUrl) norm.avatarUrl = resolveRepoAssetUrl(norm.avatarUrl, config);
        characters.push(norm);
      }
      continue;
    }
    const payload = await fetchRepoJson(config, charSpec, token);
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

export async function tryFetchExistingManifest(
  config: ExternalRepoConfig,
  token?: string
): Promise<CampaignPackManifest | null> {
  const packPath = config.packPath?.trim() || 'campaign-pack.json';
  try {
    const data = await fetchRepoJson(config, packPath, token);
    return data && typeof data === 'object' ? (data as CampaignPackManifest) : null;
  } catch {
    return null;
  }
}

export function buildCampaignPackExport(
  campaign: CampaignRecord,
  customEntities: CompendiumEntity[],
  existingManifest?: CampaignPackManifest | null
): string {
  const preservedEntityRefs = (existingManifest?.entities ?? []).filter(
    (e) => typeof e === 'string' || (typeof e === 'object' && e !== null && 'path' in e)
  );
  const preservedCharRefs = (existingManifest?.characters ?? []).filter(
    (c) => typeof c === 'string'
  );

  const manifest: CampaignPackManifest = {
    ...(existingManifest ?? {}),
    name: campaign.name,
    setting: campaign.setting,
    source: existingManifest?.source ?? campaign.name,
    exportedAt: new Date().toISOString(),
    characters: preservedCharRefs,
    entities: [...preservedEntityRefs, ...customEntities.map((e) => e as unknown as Record<string, unknown>)],
    entries: campaign.entries,
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
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
