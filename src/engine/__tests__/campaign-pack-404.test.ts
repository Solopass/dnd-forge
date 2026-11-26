// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCampaignPackFromGitHub } from '../campaign-repo-sync';

const CONFIG = { owner: 'Someone', repo: 'no-pack-repo', branch: 'main' };

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    if (url.includes('api.github.com')) {
      const tree = [{ path: 'en-US/Characters_Codex/03_Creating_a_Character/Feats/Feats/Alert.md', type: 'blob' }];
      return new Response(JSON.stringify({ tree }), { status: 200 });
    }
    if (url.endsWith('campaign-pack.json')) return new Response('Not Found', { status: 404 });
    return new Response('#### Alert\n\nYou are always on the lookout for danger.', { status: 200 });
  });
  return urls;
}

describe('missing campaign-pack.json (audit C6)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('a 404 means "no pack": falls back to the repo tree and is not asked again', async () => {
    const urls = stubFetch();
    const first = await fetchCampaignPackFromGitHub(CONFIG);
    expect(first.entities.length).toBeGreaterThan(0);
    expect(urls.filter((u) => u.endsWith('campaign-pack.json'))).toHaveLength(1);

    urls.length = 0;
    const second = await fetchCampaignPackFromGitHub(CONFIG);
    expect(second.entities.length).toBeGreaterThan(0);
    expect(urls.filter((u) => u.endsWith('campaign-pack.json'))).toHaveLength(0);
  });

  it('other failures are not remembered as "no pack"', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (url.endsWith('campaign-pack.json')) return new Response('boom', { status: 500 });
      return new Response('', { status: 500 });
    });
    await fetchCampaignPackFromGitHub(CONFIG).catch(() => null);
    await fetchCampaignPackFromGitHub(CONFIG).catch(() => null);
    expect(urls.filter((u) => u.endsWith('campaign-pack.json'))).toHaveLength(2);
  });
});
