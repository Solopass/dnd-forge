function flattenEntryNode(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) flattenEntryNode(child, out);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const heading = typeof obj.name === 'string' && obj.name.trim() ? `${obj.name.trim()}: ` : '';
    if (Array.isArray(obj.entries)) {
      const sub: string[] = [];
      for (const child of obj.entries) flattenEntryNode(child, sub);
      if (sub.length > 0) {
        if (heading) sub[0] = `${heading}${sub[0]}`;
        out.push(...sub);
      }
      return;
    }
    if (Array.isArray(obj.items)) {
      if (heading) out.push(heading.replace(/:\s*$/, ''));
      for (const item of obj.items) {
        const sub: string[] = [];
        flattenEntryNode(item, sub);
        for (const line of sub) out.push(`• ${line}`);
      }
      return;
    }
    if (typeof obj.entry === 'string' && obj.entry.trim()) {
      out.push(`${heading}${obj.entry.trim()}`);
      return;
    }
    if (typeof obj.text === 'string' && obj.text.trim()) {
      out.push(`${heading}${obj.text.trim()}`);
    }
  }
}

export function normalizeEntries(rawEntries: unknown, rawDescription?: unknown): string[] {
  const out: string[] = [];
  if (rawEntries !== undefined) {
    flattenEntryNode(rawEntries, out);
  }
  if (out.length === 0 && typeof rawDescription === 'string' && rawDescription.trim()) {
    for (const para of rawDescription.split(/\n{2,}/)) {
      const t = para.trim();
      if (t) out.push(t);
    }
  }
  return out;
}
