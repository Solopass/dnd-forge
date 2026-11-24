import {
  ThemeBodyFont,
  ThemeDefinition,
  ThemeDisplayFont,
  ThemeMonoFont,
  ThemeRadiusScale,
} from '../types/theme';

export const ACTIVE_THEME_STORAGE_KEY = 'dnd-forge-active-theme';
export const CUSTOM_THEMES_STORAGE_KEY = 'dnd-forge-custom-themes';

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'obsidian-forge',
    name: 'Obsidian Forge',
    author: 'Sidereroll',
    description: 'Deep slate obsidian with arcane sapphire and warm amber accents.',
    colorScheme: 'dark',
    builtIn: true,
    tokens: {
      bgBase: '#0d1117',
      bgSurface: '#161b22',
      bgElevated: '#21262d',
      bgCardHeader: '#1b222c',
      borderSubtle: '#30363d',
      textPrimary: '#f0f6fc',
      textSecondary: '#9ba3b0',
      textMuted: '#7d8590',
      accentBrand: '#3b82f6',
      accentSecondary: '#f59e0b',
      accentSuccess: '#3fb950',
      accentDanger: '#f85149',
      accentWarning: '#d29922',
    },
    typography: {
      displayFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'balanced',
      elevation: 'subtle',
      texture: 'none',
      density: 'comfortable',
    },
  },
  {
    id: 'crimson-keep',
    name: 'Crimson Keep',
    author: 'Sidereroll',
    description: 'Classic tabletop charcoal with crimson steel and antique brass.',
    colorScheme: 'dark',
    builtIn: true,
    tokens: {
      bgBase: '#12161c',
      bgSurface: '#1a2028',
      bgElevated: '#232b36',
      bgCardHeader: '#252126',
      borderSubtle: '#333d4b',
      textPrimary: '#f5f2eb',
      textSecondary: '#b8b2a6',
      textMuted: '#8a857b',
      accentBrand: '#ff4d5e',
      accentSecondary: '#c5a059',
      accentSuccess: '#3fb950',
      accentDanger: '#ff5c5c',
      accentWarning: '#d4a72c',
    },
    typography: {
      displayFont: 'Cinzel',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'balanced',
      elevation: 'elevated',
      texture: 'none',
      density: 'comfortable',
    },
  },
  {
    id: 'parchment-grimoire',
    name: 'Parchment Grimoire',
    author: 'Sidereroll',
    description: 'Warm aged vellum with deep sepia ink and burgundy wax seals.',
    colorScheme: 'light',
    builtIn: true,
    tokens: {
      bgBase: '#f4efe6',
      bgSurface: '#fbf8f3',
      bgElevated: '#ebe2d3',
      bgCardHeader: '#efe6d7',
      borderSubtle: '#c9bba5',
      textPrimary: '#241c14',
      textSecondary: '#544638',
      textMuted: '#736454',
      accentBrand: '#dc2626',
      accentSecondary: '#8c621c',
      accentSuccess: '#1e6f38',
      accentDanger: '#b42318',
      accentWarning: '#9a6700',
    },
    typography: {
      displayFont: 'Fraunces',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'balanced',
      elevation: 'subtle',
      texture: 'parchment',
      density: 'comfortable',
    },
  },
  {
    id: 'astral-spelljammer',
    name: 'Astral Spelljammer',
    author: 'Sidereroll',
    description: 'Deep cosmic indigo with violet nebula glass and cyan starlight.',
    colorScheme: 'dark',
    builtIn: true,
    tokens: {
      bgBase: '#090b1a',
      bgSurface: '#11152c',
      bgElevated: '#1a2040',
      bgCardHeader: '#171b38',
      borderSubtle: '#2c3566',
      textPrimary: '#eef2ff',
      textSecondary: '#a5b4fc',
      textMuted: '#7c88c4',
      accentBrand: '#8b5cf6',
      accentSecondary: '#22d3ee',
      accentSuccess: '#34d399',
      accentDanger: '#fb7185',
      accentWarning: '#fbbf24',
    },
    typography: {
      displayFont: 'Space Grotesk',
      bodyFont: 'Inter',
      monoFont: 'Fira Code',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'rounded',
      elevation: 'glass',
      texture: 'grid',
      density: 'comfortable',
    },
  },
  {
    id: 'feywild-emerald',
    name: 'Feywild Emerald',
    author: 'Sidereroll',
    description: 'Deep enchanted forest moss with emerald canopies and sunlit gold.',
    colorScheme: 'dark',
    builtIn: true,
    tokens: {
      bgBase: '#091510',
      bgSurface: '#102119',
      bgElevated: '#183024',
      bgCardHeader: '#14291f',
      borderSubtle: '#274938',
      textPrimary: '#ecfdf5',
      textSecondary: '#a7f3d0',
      textMuted: '#6ee7b7',
      accentBrand: '#10b981',
      accentSecondary: '#f59e0b',
      accentSuccess: '#34d399',
      accentDanger: '#f87171',
      accentWarning: '#fbbf24',
    },
    typography: {
      displayFont: 'Fraunces',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'rounded',
      elevation: 'subtle',
      texture: 'noise',
      density: 'comfortable',
    },
  },
  {
    id: 'underdark-neon',
    name: 'Underdark Neon',
    author: 'Sidereroll',
    description: 'Pitch obsidian cavern with electric magenta and bioluminescent teal.',
    colorScheme: 'dark',
    builtIn: true,
    tokens: {
      bgBase: '#07070c',
      bgSurface: '#10101a',
      bgElevated: '#19192a',
      bgCardHeader: '#161426',
      borderSubtle: '#2d294a',
      textPrimary: '#f8f7ff',
      textSecondary: '#c4b5fd',
      textMuted: '#8b83b8',
      accentBrand: '#ec4899',
      accentSecondary: '#14b8a6',
      accentSuccess: '#2dd4bf',
      accentDanger: '#fb7185',
      accentWarning: '#facc15',
    },
    typography: {
      displayFont: 'Space Grotesk',
      bodyFont: 'Inter',
      monoFont: 'Fira Code',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'sharp',
      elevation: 'elevated',
      texture: 'grid',
      density: 'compact',
    },
  },
  {
    id: 'icewind-frost',
    name: 'Icewind Frost',
    author: 'Sidereroll',
    description: 'Crisp glacial light slate with cobalt ice and silver trim.',
    colorScheme: 'light',
    builtIn: true,
    tokens: {
      bgBase: '#eef4fb',
      bgSurface: '#ffffff',
      bgElevated: '#e2ebf6',
      bgCardHeader: '#e8f0fa',
      borderSubtle: '#b8cae0',
      textPrimary: '#0f172a',
      textSecondary: '#334155',
      textMuted: '#64748b',
      accentBrand: '#1d4ed8',
      accentSecondary: '#0284c7',
      accentSuccess: '#15803d',
      accentDanger: '#dc2626',
      accentWarning: '#b45309',
    },
    typography: {
      displayFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      fontScale: 1,
    },
    surface: {
      radiusScale: 'balanced',
      elevation: 'subtle',
      texture: 'none',
      density: 'comfortable',
    },
  },
  {
    id: 'high-contrast-tactical',
    name: 'High-Contrast Tactical',
    author: 'Sidereroll',
    description: 'WCAG AAA 7:1+ contrast dark mode with crisp borders and zero clutter.',
    colorScheme: 'dark',
    builtIn: true,
    tokens: {
      bgBase: '#000000',
      bgSurface: '#0c0c0f',
      bgElevated: '#18181f',
      bgCardHeader: '#14141a',
      borderSubtle: '#525266',
      textPrimary: '#ffffff',
      textSecondary: '#e4e4e7',
      textMuted: '#b4b4c4',
      accentBrand: '#60a5fa',
      accentSecondary: '#fbbf24',
      accentSuccess: '#4ade80',
      accentDanger: '#f87171',
      accentWarning: '#facc15',
    },
    typography: {
      displayFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      fontScale: 1.05,
    },
    surface: {
      radiusScale: 'sharp',
      elevation: 'flat',
      texture: 'none',
      density: 'comfortable',
    },
  },
];

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const linear = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function computeContrastRatio(fgHex: string, bgHex: string): number {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return 1;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function autoFixContrastHex(bgHex: string): string {
  const whiteRatio = computeContrastRatio('#ffffff', bgHex);
  const darkRatio = computeContrastRatio('#111827', bgHex);
  return whiteRatio >= darkRatio ? '#f8fafc' : '#111827';
}

function mapDisplayFont(font: ThemeDisplayFont): string {
  switch (font) {
    case 'Cinzel':
      return "'Cinzel', Georgia, serif";
    case 'Fraunces':
      return "'Fraunces', Georgia, serif";
    case 'Space Grotesk':
      return "'Space Grotesk', system-ui, sans-serif";
    case 'System':
      return 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    default:
      return "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  }
}

function mapBodyFont(font: ThemeBodyFont): string {
  switch (font) {
    case 'Fraunces':
      return "'Fraunces', Georgia, serif";
    case 'System':
      return 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    default:
      return "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  }
}

function mapMonoFont(font: ThemeMonoFont): string {
  switch (font) {
    case 'Fira Code':
      return "'Fira Code', ui-monospace, monospace";
    case 'System Monospace':
      return 'ui-monospace, SFMono-Regular, Menlo, monospace';
    default:
      return "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
  }
}

function mapRadiusPx(scale: ThemeRadiusScale): { sm: string; md: string; lg: string } {
  switch (scale) {
    case 'sharp':
      return { sm: '2px', md: '3px', lg: '4px' };
    case 'rounded':
      return { sm: '6px', md: '11px', lg: '16px' };
    case 'pill':
      return { sm: '8px', md: '14px', lg: '20px' };
    default:
      return { sm: '4px', md: '7px', lg: '10px' };
  }
}

export function applyThemeToDocument(theme: ThemeDefinition): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { tokens, typography, surface } = theme;
  const radii = mapRadiusPx(surface.radiusScale);

  const vars: Record<string, string> = {
    '--bg-base': tokens.bgBase,
    '--bg-surface': tokens.bgSurface,
    '--bg-elevated': tokens.bgElevated,
    '--bg-hover': tokens.bgElevated,
    '--bg-card-header': tokens.bgCardHeader,
    '--bg-rail': tokens.bgBase,
    '--border-subtle': tokens.borderSubtle,
    '--border-accent': tokens.accentBrand,
    '--text-primary': tokens.textPrimary,
    '--text-secondary': tokens.textSecondary,
    '--text-muted': tokens.textMuted,
    '--accent-brand': tokens.accentBrand,
    '--accent-blue': tokens.accentBrand,
    '--accent-gold': tokens.accentSecondary,
    '--accent-amber': tokens.accentWarning,
    '--accent-green': tokens.accentSuccess,
    '--accent-red': tokens.accentDanger,
    '--accent-purple': tokens.accentSecondary,
    '--scrollbar-track': tokens.bgBase,
    '--scrollbar-thumb': tokens.borderSubtle,
    '--font-display': mapDisplayFont(typography.displayFont),
    '--font-sans': mapBodyFont(typography.bodyFont),
    '--font-mono': mapMonoFont(typography.monoFont),
    '--font-scale': String(Math.max(0.85, Math.min(1.25, typography.fontScale || 1))),
    '--radius-sm': radii.sm,
    '--radius-md': radii.md,
    '--radius-lg': radii.lg,
    '--density': surface.density,
  };

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }

  root.dataset.themeId = theme.id;
  root.dataset.density = surface.density;
  root.dataset.elevation = surface.elevation;
  root.dataset.texture = surface.texture;
  root.dataset.radius = surface.radiusScale;

  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = theme.colorScheme;
  }

  try {
    localStorage.setItem(ACTIVE_THEME_STORAGE_KEY, theme.id);
  } catch {
    // Ignore storage errors
  }
}

export function readStoredActiveThemeId(): string {
  try {
    return localStorage.getItem(ACTIVE_THEME_STORAGE_KEY) || BUILTIN_THEMES[0]!.id;
  } catch {
    return BUILTIN_THEMES[0]!.id;
  }
}

export function readStoredCustomThemes(): ThemeDefinition[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ThemeDefinition[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomThemes(themes: ThemeDefinition[]): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // Ignore storage errors
  }
}
