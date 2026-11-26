/**
 * Browser-side image upload helper: downscales and recompresses a picked image before it is stored as
 * a data URL, so IndexedDB, backups and live-table messages stay small. Uses canvas, so it lives here
 * and not in the engine. SVG and GIF are stored as they are (re-encoding would flatten them).
 */

export const MAX_EDGE_MAP = 1600;
export const MAX_EDGE_SMALL = 512; // avatars and token portraits
export const TARGET_BYTES = 300 * 1024;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];

export type UploadKind = 'map' | 'avatar';

export const maxEdgeFor = (kind: UploadKind): number => (kind === 'avatar' ? MAX_EDGE_SMALL : MAX_EDGE_MAP);

/** Size after fitting inside maxEdge on the longer side; never enlarges. */
export function planDownscale(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > maxEdge)) return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Bytes a data URL decodes to (base64 part only). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export interface EncodableCanvas {
  toDataURL(type?: string, quality?: number): string;
}

/**
 * Encodes as WebP, lowering quality until the result fits `targetBytes`. When the browser cannot
 * encode WebP (it answers with PNG) JPEG is used instead. Returns the smallest attempt if none fits.
 */
export function encodeWithinBudget(canvas: EncodableCanvas, targetBytes = TARGET_BYTES): string {
  let type = 'image/webp';
  let best = '';
  for (const q of QUALITIES) {
    let out = canvas.toDataURL(type, q);
    if (type === 'image/webp' && !out.startsWith('data:image/webp')) {
      type = 'image/jpeg';
      out = canvas.toDataURL(type, q);
    }
    if (!best || dataUrlBytes(out) < dataUrlBytes(best)) best = out;
    if (dataUrlBytes(out) <= targetBytes) return out;
  }
  return best;
}

/** True for formats that must not be re-encoded. */
export const isPassThroughImage = (mime: string): boolean => mime === 'image/svg+xml' || mime === 'image/gif';

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable file')));
    reader.onerror = () => reject(reader.error ?? new Error('unreadable file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not an image'));
    img.src = src;
  });
}

/**
 * Picked file -> compressed data URL. If anything about the canvas path fails, the original file is
 * stored as it was (an upload never gets lost because compression failed).
 */
export async function fileToImageDataUrl(file: File, kind: UploadKind): Promise<string> {
  const original = await readAsDataUrl(file);
  if (isPassThroughImage(file.type)) return original;
  try {
    const img = await loadImage(original);
    const { width, height } = planDownscale(img.naturalWidth, img.naturalHeight, maxEdgeFor(kind));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, width, height);
    const out = encodeWithinBudget(canvas);
    // Keep the original when recompression did not help (small, already-optimised files).
    return dataUrlBytes(out) < dataUrlBytes(original) ? out : original;
  } catch {
    return original;
  }
}

/** Calls `onDone` with the compressed data URL; `onFail` (optional) when the file cannot be read at all. */
export function pickImage(file: File | undefined, kind: UploadKind, onDone: (dataUrl: string) => void, onFail?: () => void): void {
  if (!file) return;
  fileToImageDataUrl(file, kind).then(onDone, () => onFail?.());
}
