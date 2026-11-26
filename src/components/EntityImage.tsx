import { useEffect, useState, type ReactNode } from 'react';

const GLYPHS: Record<string, string> = {
  monster: '☠', spell: '✦', weapon: '⚔', armor: '⛨', shield: '⛨', feat: '★', feature: '★',
};

// SVG <image> supports referrerpolicy but React's SVG typings omit it.
const NO_REFERRER = { referrerPolicy: 'no-referrer' };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : (parts[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}

/** True once the browser could not load `src`; resets when `src` changes. */
function useImageFailed(src: string | undefined): [boolean, () => void] {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return [failed || !src, () => setFailed(true)];
}

interface EntityImageProps {
  src: string | undefined;
  /** Name for alt text and the initials fallback. */
  name: string;
  category?: string;
  /** Box size: "thumb" (22 px), "portrait" (52 px), "inspector" (wide, max 180 px tall). */
  size?: 'thumb' | 'portrait' | 'inspector';
  artCredit?: string;
  /** Renders nothing instead of the fallback when there is no src. */
  hideWhenEmpty?: boolean;
}

/**
 * One way to show entity art: lazy, fixed-size box, no referrer sent, and a fallback (initials plus a
 * category glyph) when the URL is missing or fails to load. Optional credit line underneath.
 */
export function EntityImage({ src, name, category, size = 'portrait', artCredit, hideWhenEmpty }: EntityImageProps) {
  const [failed, onError] = useImageFailed(src);
  if (!src && hideWhenEmpty) return null;
  return (
    <figure className={`entity-image entity-image--${size}`}>
      {failed ? (
        <span className="entity-image__fallback" role="img" aria-label={name} data-category={category}>
          {size === 'thumb' ? initialsOf(name).slice(0, 1) : initialsOf(name)}
          {size !== 'thumb' && GLYPHS[category ?? ''] ? <span className="entity-image__glyph">{GLYPHS[category ?? '']}</span> : null}
        </span>
      ) : (
        <img src={src} alt={size === 'thumb' ? '' : name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={onError} />
      )}
      {artCredit && size === 'inspector' ? <figcaption className="entity-image__credit">{artCredit}</figcaption> : null}
    </figure>
  );
}

interface TokenPortraitProps {
  href: string | undefined;
  x: number;
  y: number;
  size: number;
  clipPath: string;
  /** Shown instead of the picture when it cannot be loaded. */
  fallback: ReactNode;
}

/** Battlemap token picture (SVG <image>); falls back to `fallback` when the URL does not load. */
export function TokenPortrait({ href, x, y, size, clipPath, fallback }: TokenPortraitProps) {
  const [failed, onError] = useImageFailed(href);
  if (failed || !href) return <>{fallback}</>;
  return (
    <image
      href={href}
      x={x}
      y={y}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid slice"
      clipPath={clipPath}
      {...NO_REFERRER}
      onError={onError}
    />
  );
}
