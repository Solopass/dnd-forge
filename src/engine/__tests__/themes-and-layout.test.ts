import { describe, expect, it } from 'vitest';
import {
  autoFixContrastHex,
  BUILTIN_THEMES,
  computeContrastRatio,
} from '../themes';
import {
  BUILTIN_LAYOUT_PRESETS,
  moveWidgetById,
  normalizeLayoutConfig,
  reorderWidget,
  resizeWidget,
  toggleWidgetVisibility,
} from '../layout-engine';
import {
  decodeSetupShareCode,
  encodeSetupShareCode,
  sanitizeThemeDefinition,
} from '../setup-sharing';

describe('Theme Engine & WCAG Contrast', () => {
  it('ensures all 8 built-in themes meet >= 4.5:1 primary text contrast', () => {
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(8);
    for (const theme of BUILTIN_THEMES) {
      const ratio = computeContrastRatio(theme.tokens.textPrimary, theme.tokens.bgSurface);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('computes contrast ratios and auto-fixes low-contrast text', () => {
    expect(computeContrastRatio('#000000', '#ffffff')).toBe(21);
    expect(computeContrastRatio('#777777', '#888888')).toBeLessThan(2);
    expect(autoFixContrastHex('#0d1117')).toBe('#f8fafc');
    expect(autoFixContrastHex('#fbf8f3')).toBe('#111827');
  });
});

describe('Modular Layout Engine', () => {
  it('reorders, resizes, and toggles widget visibility deterministically', () => {
    const base = structuredClone(BUILTIN_LAYOUT_PRESETS[0]!);
    const firstId = base.widgets[0]!.id;
    const secondId = base.widgets[1]!.id;

    const reordered = reorderWidget(base, 0, 1);
    expect(reordered.widgets[0]?.id).toBe(secondId);
    expect(reordered.widgets[1]?.id).toBe(firstId);

    const movedBack = moveWidgetById(reordered, firstId, -1);
    expect(movedBack.widgets[0]?.id).toBe(firstId);

    const resized = resizeWidget(base, firstId, 8, 'tall');
    expect(resized.widgets[0]?.colSpan).toBe(8);
    expect(resized.widgets[0]?.heightPreset).toBe('tall');

    const toggled = toggleWidgetVisibility(base, firstId);
    expect(toggled.widgets[0]?.visible).toBe(false);
  });

  it('normalizes partial/invalid layout configs safely', () => {
    const norm = normalizeLayoutConfig({
      id: 'test-layout',
      name: 'My Custom',
      widgets: [{ id: 'vitals', label: 'Vitals', colSpan: 99 as unknown as 4, heightPreset: 'auto', visible: true }],
    });
    expect(norm.widgets.find((w) => w.id === 'vitals')?.colSpan).toBe(4);
    expect(norm.widgets.length).toBe(BUILTIN_LAYOUT_PRESETS[0]!.widgets.length);
  });
});

describe('Setup Sharing Codecs & Sanitization', () => {
  it('round-trips FORGE-UI share codes and rejects CSS injection in theme colors', () => {
    const theme = BUILTIN_THEMES[2]!; // Parchment Grimoire
    const layout = BUILTIN_LAYOUT_PRESETS[1]!;
    const code = encodeSetupShareCode({
      schema: 'dnd-forge-setup-v1',
      name: 'Parchment Combat',
      author: 'Coop',
      exportedAt: '2026-11-24T00:00:00Z',
      theme,
      layout,
    });

    expect(code.startsWith('FORGE-UI:')).toBe(true);
    const decoded = decodeSetupShareCode(code);
    expect(decoded.name).toBe('Parchment Combat');
    expect(decoded.theme.id).toBe('parchment-grimoire');
    expect(decoded.layout.id).toBe('layout-combat-vtt');

    const sanitized = sanitizeThemeDefinition({
      name: 'Unsafe',
      tokens: {
        ...theme.tokens,
        bgBase: 'red; background-image: url(evil)' as string,
      },
    });
    expect(sanitized.tokens.bgBase).toBe(BUILTIN_THEMES[0]!.tokens.bgBase);
  });
});
