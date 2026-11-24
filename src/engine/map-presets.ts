export interface BattlemapPreset {
  id: string;
  name: string;
  dataUrl: string;
}

function encodeSvgDataUrl(svgBody: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">${svgBody}</svg>`
  )}`;
}

export const BUILTIN_MAP_PRESETS: BattlemapPreset[] = [
  {
    id: 'preset-stone-dungeon',
    name: 'Stone Dungeon',
    dataUrl: encodeSvgDataUrl(`
      <rect width="1000" height="600" fill="#181c24"/>
      <rect x="40" y="40" width="920" height="520" rx="8" fill="#222834" stroke="#4b5563" stroke-width="8"/>
      <rect x="280" y="140" width="90" height="90" fill="#141820" stroke="#4b5563" stroke-width="4"/>
      <rect x="630" y="140" width="90" height="90" fill="#141820" stroke="#4b5563" stroke-width="4"/>
      <rect x="280" y="370" width="90" height="90" fill="#141820" stroke="#4b5563" stroke-width="4"/>
      <rect x="630" y="370" width="90" height="90" fill="#141820" stroke="#4b5563" stroke-width="4"/>
      <circle cx="500" cy="300" r="65" fill="#1a2230" stroke="#60a5fa" stroke-width="3" stroke-dasharray="8 6"/>
    `),
  },
  {
    id: 'preset-tavern-taproom',
    name: 'Tavern Taproom',
    dataUrl: encodeSvgDataUrl(`
      <rect width="1000" height="600" fill="#241912"/>
      <rect x="30" y="30" width="940" height="540" fill="#3a281c" stroke="#785136" stroke-width="8"/>
      <rect x="90" y="90" width="260" height="65" rx="6" fill="#5c3d28" stroke="#a16b47" stroke-width="3"/>
      <circle cx="240" cy="320" r="46" fill="#6b472f" stroke="#a16b47" stroke-width="3"/>
      <circle cx="500" cy="240" r="46" fill="#6b472f" stroke="#a16b47" stroke-width="3"/>
      <circle cx="500" cy="420" r="46" fill="#6b472f" stroke="#a16b47" stroke-width="3"/>
      <rect x="740" y="160" width="140" height="240" rx="6" fill="#5c3d28" stroke="#a16b47" stroke-width="3"/>
      <rect x="860" y="45" width="90" height="40" fill="#ea580c" opacity="0.65"/>
    `),
  },
  {
    id: 'preset-forest-clearing',
    name: 'Forest Clearing',
    dataUrl: encodeSvgDataUrl(`
      <rect width="1000" height="600" fill="#132217"/>
      <ellipse cx="500" cy="300" rx="340" ry="200" fill="#1e3523"/>
      <path d="M0 490 Q 320 420 580 490 T 1000 450" fill="none" stroke="#5b4936" stroke-width="48" opacity="0.7"/>
      <circle cx="130" cy="110" r="65" fill="#0e2915" stroke="#1f4d2a" stroke-width="4"/>
      <circle cx="860" cy="120" r="75" fill="#0e2915" stroke="#1f4d2a" stroke-width="4"/>
      <circle cx="150" cy="500" r="60" fill="#0e2915" stroke="#1f4d2a" stroke-width="4"/>
      <circle cx="830" cy="490" r="70" fill="#0e2915" stroke="#1f4d2a" stroke-width="4"/>
      <circle cx="500" cy="130" r="38" fill="#374151" stroke="#6b7280" stroke-width="3"/>
    `),
  },
];
