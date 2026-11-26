import { describe, expect, it } from 'vitest';
import { pickImageRef, sanitizeArtCredit, sanitizeImageRef } from '../image-ref';
import { sanitizeEntity } from '../import-normalize';
import { resolveRepoAssetUrl } from '../campaign-repo-sync';
import { loadCustomRepoEntities } from '../custom-content-loader';

describe('sanitizeImageRef', () => {
  it('allows https, local http and image data URLs', () => {
    expect(sanitizeImageRef('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(sanitizeImageRef('http://localhost:5198/a.png')).toBe('http://localhost:5198/a.png');
    expect(sanitizeImageRef('http://127.0.0.1/a.png')).toBe('http://127.0.0.1/a.png');
    expect(sanitizeImageRef('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
  });

  it('drops scripts, remote http, unserved root paths and other data types', () => {
    for (const bad of [
      'javascript:alert(1)', 'http://example.com/a.png', 'file:///c:/a.png', '//cdn.example.com/a.png',
      '/api/images/monsters/aboleth.png', '/api +2/images/x.png', '/api/2014/x.png', 'aboleth.png',
      'data:text/html;base64,AAAA', 'data:image/png,notbase64', 'https://', 'https://a.com/a b.png', '', '   ', 42, null,
    ]) {
      expect(sanitizeImageRef(bad), String(bad)).toBeUndefined();
    }
  });

  it('resolves ./ paths against the pack repo and sha, and rejects traversal', () => {
    const repo = { owner: 'Solopass', repo: 'pack', ref: 'abc123' };
    expect(sanitizeImageRef('./images/x.png', { repo })).toBe('https://raw.githubusercontent.com/Solopass/pack/abc123/images/x.png');
    expect(sanitizeImageRef('./../secret.png', { repo })).toBeUndefined();
    expect(sanitizeImageRef('./images/x.png')).toBeUndefined();
    expect(sanitizeImageRef('./images/x.png', { keepRelative: true })).toBe('./images/x.png');
  });

  it('pickImageRef takes the first valid field; artCredit is one bounded line', () => {
    expect(pickImageRef({ imageUrl: '/api/x.png', img: 'https://a.com/i.png' })).toBe('https://a.com/i.png');
    expect(pickImageRef({ imageUrl: 'javascript:1' })).toBeUndefined();
    expect(sanitizeArtCredit('  Art by  Z\n CC BY ')).toBe('Art by Z CC BY');
    expect(sanitizeArtCredit('x'.repeat(500))?.length).toBe(200);
    expect(sanitizeArtCredit(7)).toBeUndefined();
  });

  it('resolveRepoAssetUrl uses the pinned sha stored in branch', () => {
    expect(resolveRepoAssetUrl('./a/b.png', { owner: 'o', repo: 'r', branch: 'deadbeef' })).toBe('https://raw.githubusercontent.com/o/r/deadbeef/a/b.png');
    expect(resolveRepoAssetUrl('javascript:1', { owner: 'o', repo: 'r' })).toBeUndefined();
  });
});

describe('importers apply the image rules', () => {
  it('normalizeEntity keeps a good image and artCredit, drops a bad one', () => {
    const ent = (raw: unknown) => {
      const r = sanitizeEntity(raw);
      if (r.ok === false) throw new Error(r.reason);
      return r.entity;
    };
    const good = ent({ name: 'Orb', category: 'gear', image: 'https://a.com/o.png', artCredit: 'By Me' });
    expect(good.imageUrl).toBe('https://a.com/o.png');
    expect(good.artCredit).toBe('By Me');
    expect(ent({ name: 'Orb2', category: 'gear', imageUrl: 'javascript:alert(1)' }).imageUrl).toBeUndefined();
  });

  it('bundled SRD content has no unserved /api image paths', async () => {
    const all = await loadCustomRepoEntities();
    const withImage = all.filter((e) => e.imageUrl);
    expect(all.length).toBeGreaterThan(500);
    expect(withImage.every((e) => /^(https:|http:\/\/(localhost|127\.0\.0\.1)|data:image|\.\/)/.test(e.imageUrl ?? ''))).toBe(true);
  });
});
