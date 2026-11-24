import { ThemeDefinition } from '../types/theme';
import { WorkspaceLayoutConfig } from '../types/layout';
import { HouseRulesConfig } from './ruleset-config';
import { BUILTIN_THEMES } from './themes';
import { normalizeLayoutConfig } from './layout-engine';

export interface DndForgeSetupBundle {
  schema: 'dnd-forge-setup-v1';
  name: string;
  author?: string;
  exportedAt: string;
  theme: ThemeDefinition;
  layout: WorkspaceLayoutConfig;
  houseRules?: HouseRulesConfig;
}

const SETUP_PREFIX = 'FORGE-UI:';

function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

function fromBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function sanitizeColor(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
}

export function sanitizeThemeDefinition(raw: Partial<ThemeDefinition>): ThemeDefinition {
  const base = BUILTIN_THEMES[0]!;
  const t = raw.tokens ?? ({} as Partial<ThemeDefinition['tokens']>);
  const typo = raw.typography ?? ({} as Partial<ThemeDefinition['typography']>);
  const surf = raw.surface ?? ({} as Partial<ThemeDefinition['surface']>);

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
        : `custom-theme-${Date.now().toString(36)}`,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 64) : 'Custom Theme',
    author: typeof raw.author === 'string' ? raw.author.trim().slice(0, 64) : undefined,
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 200) : undefined,
    colorScheme: raw.colorScheme === 'light' ? 'light' : 'dark',
    tokens: {
      bgBase: sanitizeColor(t.bgBase, base.tokens.bgBase),
      bgSurface: sanitizeColor(t.bgSurface, base.tokens.bgSurface),
      bgElevated: sanitizeColor(t.bgElevated, base.tokens.bgElevated),
      bgCardHeader: sanitizeColor(t.bgCardHeader, base.tokens.bgCardHeader),
      borderSubtle: sanitizeColor(t.borderSubtle, base.tokens.borderSubtle),
      textPrimary: sanitizeColor(t.textPrimary, base.tokens.textPrimary),
      textSecondary: sanitizeColor(t.textSecondary, base.tokens.textSecondary),
      textMuted: sanitizeColor(t.textMuted, base.tokens.textMuted),
      accentBrand: sanitizeColor(t.accentBrand, base.tokens.accentBrand),
      accentSecondary: sanitizeColor(t.accentSecondary, base.tokens.accentSecondary),
      accentSuccess: sanitizeColor(t.accentSuccess, base.tokens.accentSuccess),
      accentDanger: sanitizeColor(t.accentDanger, base.tokens.accentDanger),
      accentWarning: sanitizeColor(t.accentWarning, base.tokens.accentWarning),
    },
    typography: {
      displayFont: typo.displayFont ?? 'Inter',
      bodyFont: typo.bodyFont ?? 'Inter',
      monoFont: typo.monoFont ?? 'JetBrains Mono',
      fontScale:
        typeof typo.fontScale === 'number' && Number.isFinite(typo.fontScale)
          ? Math.max(0.85, Math.min(1.25, typo.fontScale))
          : 1,
    },
    surface: {
      radiusScale: surf.radiusScale ?? 'balanced',
      elevation: surf.elevation ?? 'subtle',
      texture: surf.texture ?? 'none',
      density: surf.density ?? 'comfortable',
    },
  };
}

export function encodeSetupShareCode(bundle: DndForgeSetupBundle): string {
  return `${SETUP_PREFIX}${toBase64Utf8(JSON.stringify(bundle))}`;
}

export function decodeSetupShareCode(rawInput: string): DndForgeSetupBundle {
  const trimmed = rawInput.trim();
  const jsonText = trimmed.startsWith(SETUP_PREFIX)
    ? fromBase64Utf8(trimmed.slice(SETUP_PREFIX.length))
    : trimmed;

  const parsed = JSON.parse(jsonText) as Partial<DndForgeSetupBundle>;
  if (!parsed || typeof parsed !== 'object' || !parsed.theme || !parsed.layout) {
    throw new Error('Invalid D&D Forge setup payload: missing theme or layout.');
  }

  return {
    schema: 'dnd-forge-setup-v1',
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Shared Setup',
    author: typeof parsed.author === 'string' ? parsed.author.trim() : undefined,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    theme: sanitizeThemeDefinition(parsed.theme),
    layout: normalizeLayoutConfig(parsed.layout),
    houseRules: parsed.houseRules,
  };
}

export function downloadSetupJson(bundle: DndForgeSetupBundle): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = bundle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'setup';
  a.href = url;
  a.download = `${slug}.dndforge-setup.json`;
  a.click();
  URL.revokeObjectURL(url);
}
