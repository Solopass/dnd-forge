export type ParsedTagSegment =
  | { kind: 'text'; value: string }
  | { kind: 'roll'; tag: 'dice' | 'damage' | 'hit'; expression: string; display: string }
  | { kind: 'save'; ability: string; dc?: string; display: string }
  | { kind: 'ref'; category: string; name: string; display: string };

const TAG_REGEX = /\{@(\w+)\s+([^}]+)\}/g;

export function parse5eToolsEntries(entry: string): ParsedTagSegment[] {
  const segments: ParsedTagSegment[] = [];
  let lastIndex = 0;

  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(entry)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: entry.slice(lastIndex, match.index) });
    }

    const tagName = (match[1] ?? '').toLowerCase();
    const rawBody = match[2] ?? '';
    const parts = rawBody.split('|').map((p) => p.trim());
    const primary = parts[0] ?? '';
    const displayOverride = parts[2] || parts[1];

    if (tagName === 'dice' || tagName === 'damage' || tagName === 'hit') {
      const normalizedExpr =
        tagName === 'hit' && !primary.includes('d')
          ? `1d20${primary.startsWith('-') ? primary : `+${primary.replace(/^\+/, '')}`}`
          : primary;
      segments.push({
        kind: 'roll',
        tag: tagName,
        expression: normalizedExpr,
        display: displayOverride || (tagName === 'hit' ? `+${primary.replace(/^\+/, '')}` : primary),
      });
    } else if (tagName === 'save') {
      segments.push({
        kind: 'save',
        ability: primary.toUpperCase(),
        dc: parts[1],
        display: displayOverride || `${primary.toUpperCase()} Save`,
      });
    } else {
      segments.push({
        kind: 'ref',
        category: tagName,
        name: primary,
        display: displayOverride || primary,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < entry.length) {
    segments.push({ kind: 'text', value: entry.slice(lastIndex) });
  }

  return segments;
}
