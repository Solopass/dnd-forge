import { vi } from 'vitest';

// Synthetic repos behind a mocked fetch: no live network.
export interface FakeRepo {
  sha?: string;
  files: Record<string, string>;
}

export function stubGitHub(repos: Record<string, FakeRepo>) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (input: string) => {
    const url = String(input);
    urls.push(url);
    const api = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/(commits|git\/trees)\/([^?]+)/);
    if (api) {
      const repo = repos[`${api[1]}/${api[2]}`];
      if (!repo) return new Response('Not Found', { status: 404 });
      if (api[3] === 'commits') {
        return repo.sha ? new Response(repo.sha, { status: 200 }) : new Response('nope', { status: 403 });
      }
      const tree = Object.keys(repo.files).map((path) => ({ path, type: 'blob' }));
      return new Response(JSON.stringify({ tree }), { status: 200 });
    }
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (raw) {
      const repo = repos[`${raw[1]}/${raw[2]}`];
      const text = repo?.files[raw[4]!];
      return text === undefined ? new Response('Not Found', { status: 404 }) : new Response(text, { status: 200 });
    }
    return new Response('?', { status: 500 });
  });
  return urls;
}
