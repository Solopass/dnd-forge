/**
 * Which image references the app accepts. Pure: no DOM, no storage.
 *
 * Allowed: https URLs, http://localhost / 127.0.0.1 (development), data:image/(png|jpeg|webp|gif|svg+xml);base64,
 * and repo-relative "./x.png" (resolved against a pack's owner/repo/sha when the repo is known).
 * Everything else is dropped: javascript:, file:, protocol-relative "//host", root paths such as "/api/images/..."
 * (nothing serves them), plain words.
 */

export interface ImageRefRepo {
  owner: string;
  repo: string;
  /** Commit sha (or branch) the file is read from. */
  ref?: string;
}

export interface ImageRefContext {
  /** Resolves "./x.png" to raw.githubusercontent.com/<owner>/<repo>/<ref>/x.png. */
  repo?: ImageRefRepo;
  /** Keeps "./x.png" untouched when no repo is known yet (the importer resolves it later). */
  keepRelative?: boolean;
}

export const MAX_IMAGE_REF_LENGTH = 2_000_000; // data URLs from uploads are large
const MAX_URL_LENGTH = 2000;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z0-9+/=\s]+$/i;
const LOCAL_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#]|$)/i;

export function sanitizeImageRef(value: unknown, ctx: ImageRefContext = {}): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v || v.length > MAX_IMAGE_REF_LENGTH) return undefined;
  if (/^data:/i.test(v)) return DATA_IMAGE.test(v) ? v : undefined;
  if (v.length > MAX_URL_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\s]/.test(v)) return undefined;
  if (/^https:\/\/[^/]+/i.test(v) || LOCAL_HTTP.test(v)) return v;
  if (v.startsWith('./')) {
    const path = v.slice(2);
    if (!path || path.split('/').includes('..')) return undefined;
    if (ctx.repo) {
      const ref = ctx.repo.ref?.trim() || 'main';
      return `https://raw.githubusercontent.com/${ctx.repo.owner}/${ctx.repo.repo}/${ref}/${path}`;
    }
    return ctx.keepRelative ? v : undefined;
  }
  return undefined;
}

/** First usable image among the field names importers accept (imageUrl, image, img, portraitUrl, tokenUrl). */
export function pickImageRef(raw: Record<string, unknown>, ctx: ImageRefContext = {}): string | undefined {
  for (const key of ['imageUrl', 'image', 'img', 'portraitUrl', 'tokenUrl']) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) {
      const ok = sanitizeImageRef(v, ctx);
      if (ok) return ok;
    }
  }
  return undefined;
}

/** Short credit line ("Art by X, CC BY 4.0"), single line, bounded. */
export function sanitizeArtCredit(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(/\s+/g, ' ').trim().slice(0, 200);
  return t || undefined;
}
