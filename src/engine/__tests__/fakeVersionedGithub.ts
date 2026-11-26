import { vi } from 'vitest';

/** A repo with history: files per commit sha, a moving head, optional privacy (needs a token). */
export interface VersionedRepo {
  head: string;
  versions: Record<string, Record<string, string>>;
  private?: boolean;
}
export interface VersionedHub {
  repos: Record<string, VersionedRepo>;
  /** Make every request fail like a dead connection. */
  down: boolean;
  urls: string[];
}

export function stubVersionedGitHub(repos: Record<string, VersionedRepo>): VersionedHub {
  const hub: VersionedHub = { repos, down: false, urls: [] };
  vi.stubGlobal('fetch', async (input: string, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    hub.urls.push(url);
    if (hub.down) throw new TypeError('Failed to fetch');
    const api = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/(commits|git\/trees)\/([^/?]+)/);
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    const contents = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/contents\/([^?]+)\?ref=(.+)$/);
    if (contents) {
      const crepo = repos[`${contents[1]}/${contents[2]}`];
      const cfiles = crepo?.versions[decodeURIComponent(contents[4]!)];
      const ctext = cfiles?.[contents[3]!];
      return !init?.headers?.Authorization && crepo?.private ? new Response('Not Found', { status: 404 }) : ctext === undefined ? new Response('Not Found', { status: 404 }) : new Response(ctext, { status: 200 });
    }
    const m = api ?? raw;
    if (!m) return new Response('?', { status: 500 });
    const repo = repos[`${m[1]}/${m[2]}`];
    const hasToken = !!init?.headers?.Authorization;
    if (!repo || (repo.private && !hasToken)) return new Response('Not Found', { status: 404 });
    const ref = decodeURIComponent(api ? m[4]! : m[3]!);
    const sha = repo.versions[ref] ? ref : ['main', 'master'].includes(ref) ? repo.head : undefined;
    if (!sha) return new Response('Not Found', { status: 404 });
    const files = repo.versions[sha]!;
    if (api) {
      if (m[3] === 'commits') return new Response(sha, { status: 200 });
      return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    }
    const text = files[m[4]!];
    return text === undefined ? new Response('Not Found', { status: 404 }) : new Response(text, { status: 200 });
  });
  return hub;
}
