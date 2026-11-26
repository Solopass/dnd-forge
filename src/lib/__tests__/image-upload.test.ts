import { describe, expect, it } from 'vitest';
import { dataUrlBytes, encodeWithinBudget, isPassThroughImage, maxEdgeFor, planDownscale } from '../image-upload';

/** Fake canvas: the "file" gets smaller as quality drops. */
function fakeCanvas(bytesAtQuality: (q: number) => number, supportsWebp = true) {
  const calls: Array<[string, number | undefined]> = [];
  return {
    calls,
    toDataURL(type = 'image/png', quality?: number) {
      calls.push([type, quality]);
      const actual = type === 'image/webp' && !supportsWebp ? 'image/png' : type;
      const raw = bytesAtQuality(quality ?? 1);
      return `data:${actual};base64,${'A'.repeat(Math.ceil((raw * 4) / 3))}`;
    },
  };
}

describe('image upload sizing', () => {
  it('fits the longer side into the limit and never enlarges', () => {
    expect(planDownscale(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
    expect(planDownscale(1000, 3000, 512)).toEqual({ width: 171, height: 512 });
    expect(planDownscale(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(maxEdgeFor('avatar')).toBe(512);
    expect(maxEdgeFor('map')).toBe(1600);
  });

  it('measures data URL bytes', () => {
    expect(dataUrlBytes('data:image/png;base64,QUJD')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,QUI=')).toBe(2);
  });

  it('lowers WebP quality until under the target', () => {
    const canvas = fakeCanvas((q) => Math.round(q * 600_000));
    const out = encodeWithinBudget(canvas, 300 * 1024);
    expect(out.startsWith('data:image/webp')).toBe(true);
    expect(dataUrlBytes(out)).toBeLessThanOrEqual(300 * 1024);
    expect(canvas.calls.length).toBeGreaterThan(1);
  });

  it('uses JPEG when the browser cannot encode WebP, and returns the smallest if nothing fits', () => {
    const canvas = fakeCanvas(() => 900_000, false);
    const out = encodeWithinBudget(canvas, 300 * 1024);
    expect(out.startsWith('data:image/jpeg')).toBe(true);
    expect(canvas.calls.some(([t]) => t === 'image/jpeg')).toBe(true);
  });

  it('leaves SVG and GIF alone', () => {
    expect(isPassThroughImage('image/svg+xml')).toBe(true);
    expect(isPassThroughImage('image/gif')).toBe(true);
    expect(isPassThroughImage('image/png')).toBe(false);
  });
});
