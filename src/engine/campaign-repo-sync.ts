import { CampaignEntry, CampaignRecord, ExternalRepoConfig } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CompendiumEntity, ItemCategory } from '../types/compendium';
import {
  buildImportReport,
  mergePipelineResults,
  runImportPipeline,
  runImportPipelineOnEntities,
  type ImportReport,
  type PipelineResult,
} from './import-pipeline';
import { PACK_FORMAT_V1, type InstalledPack, type PackManifest } from '../types/pack';
import {
  FREE5E_PACK_ID,
  assignPackIdentity,
  convertLegacyManifest,
  expandGlobs,
  free5eTargetsFromTree,
  guessCategoryFromPath,
  isFree5eRepo,
  isGlob,
  parsePackManifest,
  slugifyPackText,
  type LegacyConversion,
  type PackIdentity,
} from './pack-manifest';

const PAT_STORAGE_KEY = 'sidereroll-github-pat';
const NO_PACK_PREFIX = 'sidereroll-no-pack:';
const NO_PACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The requested file does not exist in the repo (HTTP 404): "no pack", not a failure. */
class RepoFileNotFoundError extends Error {}

function noPackKey(config: ExternalRepoConfig, packPath: string): string {
  return `${NO_PACK_PREFIX}${config.owner}/${config.repo}@${config.branch?.trim() || 'main'}:${packPath}`;
}

function isKnownNoPack(key: string): boolean {
  try {
    const at = Number(localStorage.getItem(key));
    return Number.isFinite(at) && at > 0 && Date.now() - at < NO_PACK_TTL_MS;
  } catch {
    return false;
  }
}

function rememberNoPack(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // best effort: without storage we just ask again next time
  }
}

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
    if (res.status === 404) throw new RepoFileNotFoundError(`Not found: ${cleanPath}`);
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} for ${cleanPath}`);
    }
    return res.text();
  }

  const rawUrl = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${branch}/${cleanPath}`;
  const res = await fetch(rawUrl);
  if (res.status === 404) throw new RepoFileNotFoundError(`Not found: ${cleanPath}`);
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

export interface FetchedPack extends SyncedCampaignPackResult {
  manifest: PackManifest;
  /** Which kind of repo this was: a v1 `pack.json`, a v0 `campaign-pack.json`, or the built-in tree adapter. */
  format: 'v1' | 'v0' | 'tree-adapter';
  /** Commit the files were read from (when GitHub could tell us). */
  sha?: string;
  warnings: string[];
  /** What the import pipeline did with the files: counts, repairs (with notes), rejections (with reasons). */
  report: ImportReport;
  /** Pack files that could not be read this time (kept as they were on an update, never "removed"). */
  unreadable: string[];
}

export interface FetchPackOptions {
  /** Ignore the "this repo has no pack file" memory (an explicit install / update always looks again). */
  fresh?: boolean;
}

function authHeaders(token: string | undefined, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

/** Resolves a branch / tag / sha to a full commit sha. Undefined when GitHub can't say (offline, rate limit, private). */
export async function resolveCommitSha(config: ExternalRepoConfig, token?: string): Promise<string | undefined> {
  const ref = config.branch?.trim() || 'main';
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/commits/${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: authHeaders(token, 'application/vnd.github.sha') }).catch(() => null);
  if (!res?.ok) return undefined;
  const text = (await res.text().catch(() => '')).trim();
  return /^[0-9a-f]{40}$/i.test(text) ? text.toLowerCase() : undefined;
}

/** Every file path in the repo at `config.branch`, or null when the tree can't be listed. */
async function fetchRepoTreePaths(config: ExternalRepoConfig, token?: string): Promise<string[] | null> {
  const branch = config.branch?.trim() || 'main';
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await fetch(treeUrl, { headers: authHeaders(token, 'application/vnd.github+json') }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { tree?: Array<{ path?: string; type?: string }> } | null;
  if (!data) return null;
  return (data.tree ?? []).filter((n) => n.type === 'blob' && typeof n.path === 'string').map((n) => n.path as string);
}

function packIdForRepo(config: ExternalRepoConfig): string {
  return isFree5eRepo(config.owner, config.repo) ? FREE5E_PACK_ID : slugifyPackText(config.repo) || 'pack';
}

/**
 * Built-in adapter for Free5e-shaped repos (no pack.json needed). Installs as pack `free5e` for
 * Solopass/free5e and as `<repo>` for any other repo that happens to follow the same folder layout.
 */
async function fetchFree5eTreeFromGitHub(
  config: ExternalRepoConfig,
  token: string | undefined,
  sha: string | undefined
): Promise<FetchedPack | null> {
  let targets: Array<{ path: string; category: ItemCategory }> = [];
  const files = await fetchRepoTreePaths(config, token);
  if (files) {
    targets = free5eTargetsFromTree(files);
  } else {
    targets = await discoverFree5ePathsViaRaw(config, token);
  }
  if (targets.length === 0) return null;

  const isFree5e = isFree5eRepo(config.owner, config.repo);
  const sourceLabel = `Free5e (${config.owner}/${config.repo})`;
  const results: PipelineResult[] = [];
  const unreadable: string[] = [];
  const BATCH = 24;
  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const batches = await Promise.all(
      slice.map(async (t): Promise<PipelineResult | null> => {
        try {
          const md = await fetchRepoText(config, t.path, token);
          return runImportPipeline(md, { name: t.path, categoryHint: t.category, sourceLabel, stableIds: true, packFile: t.path });
        } catch {
          unreadable.push(t.path);
          return null;
        }
      })
    );
    for (const r of batches) if (r) results.push(r);
  }
  // a tree where nothing could be fetched is "no pack", not an empty one
  if (results.length === 0) return null;
  const merged = mergePipelineResults(results, 'free5e-markdown');

  const ref = sha ?? (config.branch?.trim() || 'main');
  const manifest: PackManifest = {
    format: PACK_FORMAT_V1,
    id: packIdForRepo(config),
    name: isFree5e ? 'Free5e' : config.repo,
    version: sha ? sha.slice(0, 7) : ref,
    ...(isFree5e ? { license: 'CC-BY-4.0' } : {}),
    requires: [],
    content: [],
    characters: [],
  };
  // the parser's own ids (free5e-spl-alarm ...) are stable, so they are kept; only provenance is added
  const entities = assignPackIdentity(
    merged.items.map((i) => ({ entity: i.entity, hadId: true })),
    { packId: manifest.id, packVersion: manifest.version, packRef: ref }
  );
  return {
    manifest,
    format: 'tree-adapter',
    ...(sha ? { sha } : {}),
    manifestName: isFree5e ? 'Free5e (CC-BY-4.0)' : manifest.name,
    entities,
    characters: [],
    entries: [],
    warnings: unreadable.map((p) => `${p}: could not be read.`),
    report: buildImportReport(merged, { files: results.length, unreadable, format: 'pack' }),
    unreadable,
    syncedAt: new Date().toISOString(),
  };
}

interface MaterializeInput {
  manifest: PackManifest;
  /** Repo config pinned to the commit sha when known: every file is read from the same commit. */
  pinned: ExternalRepoConfig;
  token?: string;
  sha?: string;
  legacy?: LegacyConversion;
}

const DEFAULT_SOURCE_LABELS = new Set(['Custom', 'Homebrew', 'Custom Repo']);

/** Fetches and parses every file a (v1 or converted v0) manifest lists into entities / characters / entries. */
async function materializePack(input: MaterializeInput): Promise<FetchedPack> {
  const { manifest, pinned, token, sha, legacy } = input;
  const warnings: string[] = [];
  const ref = sha ?? (pinned.branch?.trim() || 'main');
  const sourceLabel = legacy?.sourceLabel || manifest.name;
  const identity: PackIdentity = { packId: manifest.id, packVersion: manifest.version, packRef: ref };
  const defaultRuleset = !legacy && (manifest.ruleset === '2014' || manifest.ruleset === '2024') ? manifest.ruleset : undefined;

  let repoFiles: string[] = [];
  const needsTree = [...manifest.content, ...manifest.characters].some(isGlob);
  if (needsTree) {
    const tree = await fetchRepoTreePaths(pinned, token);
    if (!tree) {
      throw new Error(
        `Could not list the files of ${pinned.owner}/${pinned.repo} (GitHub API unreachable or rate-limited), so the patterns in the pack manifest cannot be expanded. Try again later or add a GitHub token in Settings.`
      );
    }
    repoFiles = tree;
  }
  const expand = (patterns: string[], field: string): string[] => {
    const out: string[] = [];
    for (const pattern of patterns) {
      const hits = expandGlobs([pattern], repoFiles).filter((f) => f !== 'pack.json' && f !== 'campaign-pack.json');
      if (isGlob(pattern) && hits.length === 0) warnings.push(`"${field}" pattern "${pattern}" matched no files.`);
      for (const h of hits) if (!out.includes(h)) out.push(h);
    }
    return out;
  };

  const results: PipelineResult[] = [];
  const unreadable: string[] = [];
  let filesRead = 0;
  const mapEntity = (entity: CompendiumEntity): CompendiumEntity => {
    const imageUrl = entity.imageUrl ? resolveRepoAssetUrl(entity.imageUrl, pinned) : undefined;
    const source = !entity.source || DEFAULT_SOURCE_LABELS.has(entity.source) ? sourceLabel : entity.source;
    return { ...entity, source, ...(imageUrl ? { imageUrl } : {}) };
  };
  const stableIds = manifest.id === FREE5E_PACK_ID;
  const shared = { sourceLabel, ...(defaultRuleset ? { defaultRuleset } : {}), mapEntity };
  const prefixed = (path: string, r: PipelineResult): PipelineResult => ({
    ...r,
    rejected: r.rejected.map((x) => ({ source: `${path}: ${x.source}`, reason: x.reason })),
  });

  if (legacy && legacy.inlineEntities.length > 0) {
    results.push(runImportPipelineOnEntities(legacy.inlineEntities, { ...shared, categoryHint: 'gear', name: 'campaign-pack.json' }));
  }

  const SKIPPED_NAMES = /(^|\/)(readme|license|licence|changelog|contributing|code_of_conduct)(\.[a-z]+)?$/i;
  const NOT_CONTENT = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|woff2?|ttf|mp3|ogg|wav|mp4)$/i;
  for (const path of expand(manifest.content, 'content')) {
    if (NOT_CONTENT.test(path)) {
      warnings.push(`${path}: not a content file (image or binary), skipped.`);
      continue;
    }
    if (SKIPPED_NAMES.test(path)) continue;
    const hint = legacy?.categoryHints[path] ?? guessCategoryFromPath(path);
    let text: string;
    try {
      text = await fetchRepoText(pinned, path, token);
    } catch (err) {
      unreadable.push(path);
      warnings.push(`${path}: could not be read (${err instanceof Error ? err.message : String(err)}).`);
      continue;
    }
    filesRead++;
    const result = prefixed(path, runImportPipeline(text, { ...shared, name: path, categoryHint: hint, stableIds, packFile: path }));
    if (result.format === 'invalid-json' || result.format === 'binary' || result.format === 'unknown') {
      unreadable.push(path);
      warnings.push(result.format === 'invalid-json' ? `${path}: not valid JSON, skipped.` : `${path}: ${result.rejected[0]?.reason ?? 'could not be read'}; skipped.`);
      continue;
    }
    if (result.accepted.length === 0 && result.rejected.length === 0 && result.warnings.length === 0) warnings.push(`${path}: no entries found.`);
    results.push(result);
  }
  // when every listed file failed there is nothing to install: say so instead of installing an empty pack
  if (unreadable.length > 0 && filesRead === 0 && results.length === 0) {
    throw new Error(`None of the pack files could be read (${unreadable.slice(0, 3).join(', ')}${unreadable.length > 3 ? ', ...' : ''}). Try again later.`);
  }

  const characters: RawCharacterState[] = [];
  const charResults: PipelineResult[] = [];
  const takeCharacters = (r: PipelineResult) => {
    for (const ch of r.characters) {
      characters.push(ch.avatarUrl ? { ...ch, avatarUrl: resolveRepoAssetUrl(ch.avatarUrl, pinned) ?? ch.avatarUrl } : ch);
    }
    charResults.push(r);
  };
  if (legacy && legacy.inlineCharacters.length > 0) takeCharacters(runImportPipeline(JSON.stringify(legacy.inlineCharacters), { name: 'campaign-pack.json (characters)' }));
  for (const path of expand(manifest.characters, 'characters')) {
    let text: string;
    try {
      text = await fetchRepoText(pinned, path, token);
    } catch (err) {
      unreadable.push(path);
      warnings.push(`${path}: could not be read (${err instanceof Error ? err.message : String(err)}).`);
      continue;
    }
    const r = prefixed(path, runImportPipeline(text, { name: path }));
    if (r.format === 'invalid-json' || r.format === 'binary' || r.format === 'unknown') {
      unreadable.push(path);
      warnings.push(`${path}: ${r.rejected[0]?.reason ?? 'could not be read'}; skipped.`);
      continue;
    }
    takeCharacters(r);
  }

  let entries: CampaignEntry[] = legacy ? (legacy.entries as CampaignEntry[]) : [];
  if (manifest.campaign) {
    try {
      const payload = JSON.parse(await fetchRepoText(pinned, manifest.campaign, token)) as unknown;
      const list = Array.isArray(payload) ? payload : (payload as { entries?: unknown })?.entries;
      if (Array.isArray(list)) entries = list as CampaignEntry[];
    } catch (err) {
      if (err instanceof RepoFileNotFoundError || err instanceof SyntaxError) {
        warnings.push(`${manifest.campaign}: could not be read, skipped.`);
      } else {
        throw err;
      }
    }
  }

  const merged = mergePipelineResults([...results, ...charResults.map((r) => ({ ...r, items: [] }))]);
  const entities = assignPackIdentity(
    merged.items.map((i) => ({ entity: i.entity, hadId: i.explicitId })),
    identity
  );
  return {
    manifest,
    format: legacy ? 'v0' : 'v1',
    ...(sha ? { sha } : {}),
    manifestName: manifest.name,
    entities,
    characters,
    entries,
    warnings: [...warnings, ...merged.warnings],
    report: buildImportReport(merged, { files: filesRead + characters.length, unreadable, format: 'pack' }),
    unreadable,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Reads a GitHub repo as a pack: `pack.json` (v1), else the old `campaign-pack.json` (v0), else the
 * built-in Free5e tree adapter. Every file is read from one commit (the sha the ref points to).
 */
export async function fetchPackFromGitHub(
  config: ExternalRepoConfig,
  token?: string,
  opts: FetchPackOptions = {}
): Promise<FetchedPack> {
  const sha = await resolveCommitSha(config, token);
  const pinned: ExternalRepoConfig = sha ? { ...config, branch: sha } : config;
  const skipCache = opts.fresh === true;

  const v1Key = noPackKey(config, 'pack.json');
  if (skipCache || !isKnownNoPack(v1Key)) {
    let v1Raw: unknown;
    let found = false;
    try {
      v1Raw = await fetchRepoJson(pinned, 'pack.json', token);
      found = true;
    } catch (err) {
      if (err instanceof RepoFileNotFoundError) rememberNoPack(v1Key);
      else if (err instanceof SyntaxError) throw new Error(`pack.json in ${config.owner}/${config.repo} is not valid JSON.`);
      // any other failure (network, 5xx): try the older formats / adapter below
    }
    if (found) {
      const parsed = parsePackManifest(v1Raw);
      if (!parsed.ok) {
        throw new Error(`pack.json in ${config.owner}/${config.repo} is not a valid pack:\n- ${parsed.errors.join('\n- ')}`);
      }
      return materializePack({ manifest: parsed.manifest, pinned, token, sha });
    }
  }

  const packPath = config.packPath?.trim() || 'campaign-pack.json';
  const missingKey = noPackKey(config, packPath);
  if (!skipCache && isKnownNoPack(missingKey)) {
    // this repo had no pack file the last time we looked: skip the request that would 404 again
    const known = await fetchFree5eTreeFromGitHub(pinned, token, sha);
    if (known) return known;
  }
  let rawManifest: unknown;
  try {
    rawManifest = await fetchRepoJson(pinned, packPath, token);
  } catch (err) {
    if (err instanceof RepoFileNotFoundError) rememberNoPack(missingKey);
    const treeFallback = await fetchFree5eTreeFromGitHub(pinned, token, sha);
    if (treeFallback) return treeFallback;
    throw err;
  }
  const legacy = convertLegacyManifest(rawManifest, { owner: config.owner, repo: config.repo });
  return materializePack({ manifest: legacy.manifest, pinned, token, sha, legacy });
}

/** The record kept in the `packs` table for a fetched pack. */
export function toInstalledPack(fetched: FetchedPack, config: ExternalRepoConfig): InstalledPack {
  const m = fetched.manifest;
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    repo: `${config.owner}/${config.repo}`,
    ref: config.branch?.trim() ?? '',
    ...(fetched.sha ? { sha: fetched.sha } : {}),
    ...(m.license ? { license: m.license } : {}),
    ...(m.requires.length > 0 ? { requires: m.requires } : {}),
    entityCount: fetched.entities.length,
    installedAt: new Date().toISOString(),
  };
}

/** The original entry point (startup Free5e auto-sync, tests): same as `fetchPackFromGitHub`. */
export async function fetchCampaignPackFromGitHub(
  config: ExternalRepoConfig,
  token?: string
): Promise<FetchedPack> {
  return fetchPackFromGitHub(config, token);
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
