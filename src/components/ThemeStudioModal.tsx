import { useState } from 'react';
import {
  autoFixContrastHex,
  BUILTIN_THEMES,
  computeContrastRatio,
} from '../engine/themes';
import { BUILTIN_LAYOUT_PRESETS } from '../engine/layout-engine';
import { CUSTOM_REPO_LAYOUTS, CUSTOM_REPO_THEMES } from '../engine/custom-content-loader';
import {
  decodeSetupShareCode,
  DndForgeSetupBundle,
  downloadSetupJson,
  encodeSetupShareCode,
} from '../engine/setup-sharing';
import { HouseRulesConfig } from '../engine/ruleset-config';
import {
  ThemeBodyFont,
  ThemeDefinition,
  ThemeDensity,
  ThemeDisplayFont,
  ThemeElevation,
  ThemeMonoFont,
  ThemeRadiusScale,
  ThemeTexture,
  ThemeTokens,
} from '../types/theme';
import { WorkspaceLayoutConfig } from '../types/layout';
import { ModalDialog } from './ModalDialog';

interface ThemeStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTheme: ThemeDefinition;
  customThemes: ThemeDefinition[];
  onApplyTheme: (theme: ThemeDefinition) => void;
  onSaveCustomTheme: (theme: ThemeDefinition) => void;
  onDeleteCustomTheme: (themeId: string) => void;
  activeLayout: WorkspaceLayoutConfig;
  onApplyLayout: (layout: WorkspaceLayoutConfig) => void;
  onEnterLayoutEditor: () => void;
  houseRules: HouseRulesConfig;
  onUpdateHouseRules: (next: HouseRulesConfig) => void;
  onLog: (msg: string, tone?: 'info' | 'warn') => void;
}

const COLOR_FIELDS: Array<{ key: keyof ThemeTokens; label: string }> = [
  { key: 'bgBase', label: 'Canvas Base' },
  { key: 'bgSurface', label: 'Card Surface' },
  { key: 'bgElevated', label: 'Elevated Surface' },
  { key: 'bgCardHeader', label: 'Card Header' },
  { key: 'borderSubtle', label: 'Borders' },
  { key: 'textPrimary', label: 'Primary Text' },
  { key: 'textSecondary', label: 'Secondary Text' },
  { key: 'textMuted', label: 'Muted Text' },
  { key: 'accentBrand', label: 'Primary Accent' },
  { key: 'accentSecondary', label: 'Gold / Secondary' },
  { key: 'accentSuccess', label: 'Success' },
  { key: 'accentDanger', label: 'Danger' },
  { key: 'accentWarning', label: 'Warning' },
];

export function ThemeStudioModal({
  isOpen,
  onClose,
  activeTheme,
  customThemes,
  onApplyTheme,
  onSaveCustomTheme,
  onDeleteCustomTheme,
  activeLayout,
  onApplyLayout,
  onEnterLayoutEditor,
  houseRules,
  onUpdateHouseRules,
  onLog,
}: ThemeStudioModalProps) {
  const [tab, setTab] = useState<'gallery' | 'editor' | 'share'>('gallery');
  const [draft, setDraft] = useState<ThemeDefinition>(() => structuredClone(activeTheme));
  const [customName, setCustomName] = useState(() => `${activeTheme.name} Custom`);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [decodedPreview, setDecodedPreview] = useState<DndForgeSetupBundle | null>(null);
  const [notice, setNotice] = useState('');

  const allGalleryThemes = [...BUILTIN_THEMES, ...CUSTOM_REPO_THEMES, ...customThemes];
  const allLayoutPresets = [...BUILTIN_LAYOUT_PRESETS, ...CUSTOM_REPO_LAYOUTS];

  const contrastRatio = computeContrastRatio(draft.tokens.textPrimary, draft.tokens.bgSurface);
  const contrastLevel = contrastRatio >= 7 ? 'AAA' : contrastRatio >= 4.5 ? 'AA' : 'LOW';

  const updateDraft = (updater: (prev: ThemeDefinition) => ThemeDefinition) => {
    setDraft((prev) => {
      const next = updater(prev);
      onApplyTheme(next);
      return next;
    });
  };

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2600);
  };

  const buildCurrentBundle = (): DndForgeSetupBundle => ({
    schema: 'dnd-forge-setup-v1',
    name: `${activeTheme.name} + ${activeLayout.name}`,
    exportedAt: new Date().toISOString(),
    theme: activeTheme,
    layout: activeLayout,
    houseRules,
  });

  const handleCopyShareCode = async () => {
    const code = encodeSetupShareCode(buildCurrentBundle());
    try {
      await navigator.clipboard.writeText(code);
      flashNotice('Copied FORGE-UI share code to clipboard!');
    } catch {
      setShareCodeInput(code);
      flashNotice('Generated share code in the box below.');
    }
  };

  const handlePreviewShareInput = () => {
    try {
      const parsed = decodeSetupShareCode(shareCodeInput);
      setDecodedPreview(parsed);
      flashNotice(`Decoded "${parsed.name}"!`);
    } catch (err) {
      onLog(`Setup import failed: ${String(err)}`, 'warn');
      flashNotice('Invalid share code or JSON.');
    }
  };

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Theme Studio, Layouts & Setup Sharing" wide>
      <div className="forge-stack">
        <div className="forge-row-between wrap gap-3">
          <div className="pill-row">
            <button
              type="button"
              className={`pill ${tab === 'gallery' ? 'active' : ''}`}
              onClick={() => setTab('gallery')}
            >
              Theme Gallery ({allGalleryThemes.length})
            </button>
            <button
              type="button"
              className={`pill ${tab === 'editor' ? 'active' : ''}`}
              onClick={() => {
                setDraft(structuredClone(activeTheme));
                setCustomName(`${activeTheme.name} Custom`);
                setTab('editor');
              }}
            >
              Visual Theme Editor
            </button>
            <button
              type="button"
              className={`pill ${tab === 'share' ? 'active' : ''}`}
              onClick={() => setTab('share')}
            >
              Layouts &amp; Share Setup
            </button>
          </div>
          {notice && (
            <span className="badge" style={{ color: 'var(--accent-green)' }}>
              {notice}
            </span>
          )}
        </div>

        {tab === 'gallery' && (
          <div className="forge-stack">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                gap: 10,
              }}
            >
              {allGalleryThemes.map((t) => {
                const isActive = activeTheme.id === t.id;
                const isCustomLocal = !t.builtIn && customThemes.some((c) => c.id === t.id);
                return (
                  <div
                    key={t.id}
                    className="card forge-stack"
                    style={{
                      borderColor: isActive ? 'var(--accent-brand)' : 'var(--border-subtle)',
                      background: t.tokens.bgSurface,
                      color: t.tokens.textPrimary,
                    }}
                  >
                    <div className="forge-row-between">
                      <strong style={{ fontSize: 13 }}>{t.name}</strong>
                      <span className="badge" style={{ color: t.tokens.textSecondary, borderColor: t.tokens.borderSubtle }}>
                        {t.colorScheme.toUpperCase()}
                      </span>
                    </div>
                    {t.description && (
                      <div style={{ fontSize: 11, color: t.tokens.textSecondary }}>{t.description}</div>
                    )}
                    <div className="forge-row" style={{ gap: 5 }}>
                      {[
                        t.tokens.bgBase,
                        t.tokens.bgElevated,
                        t.tokens.accentBrand,
                        t.tokens.accentSecondary,
                        t.tokens.accentSuccess,
                      ].map((hex, i) => (
                        <span
                          key={i}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            background: hex,
                            border: `1px solid ${t.tokens.borderSubtle}`,
                            forcedColorAdjust: 'none',
                          }}
                        />
                      ))}
                    </div>
                    <div className="forge-row wrap gap-2">
                      <button
                        type="button"
                        className={`btn ${isActive ? 'btn-primary' : ''}`}
                        onClick={() => {
                          onApplyTheme(t);
                          setDraft(structuredClone(t));
                          flashNotice(`Applied "${t.name}"`);
                        }}
                      >
                        {isActive ? 'Active' : 'Apply'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const clone: ThemeDefinition = {
                            ...structuredClone(t),
                            id: `custom-${Date.now().toString(36)}`,
                            name: `${t.name} Remix`,
                            builtIn: false,
                          };
                          setDraft(clone);
                          setCustomName(clone.name);
                          onApplyTheme(clone);
                          setTab('editor');
                        }}
                      >
                        Customize
                      </button>
                      {isCustomLocal && (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => onDeleteCustomTheme(t.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'editor' && (
          <div className="forge-stack">
            <div className="subpanel forge-row-between" style={{ padding: '8px 12px', flexWrap: 'wrap', gap: 8 }}>
              <div className="forge-row gap-3 wrap">
                <span className="forge-section-label">LIVE CONTRAST CHECK</span>
                <span
                  className="badge tabular"
                  style={{
                    color: contrastLevel === 'LOW' ? 'var(--accent-red)' : 'var(--accent-green)',
                    borderColor: contrastLevel === 'LOW' ? 'var(--accent-red)' : 'var(--accent-green)',
                  }}
                >
                  {contrastRatio}:1 ({contrastLevel})
                </span>
                {contrastLevel === 'LOW' && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      updateDraft((prev) => ({
                        ...prev,
                        tokens: {
                          ...prev.tokens,
                          textPrimary: autoFixContrastHex(prev.tokens.bgSurface),
                        },
                      }))
                    }
                  >
                    Auto-Fix Text Contrast
                  </button>
                )}
              </div>

              <div className="pill-row">
                <button
                  type="button"
                  className={`pill ${draft.colorScheme === 'dark' ? 'active' : ''}`}
                  onClick={() => updateDraft((prev) => ({ ...prev, colorScheme: 'dark' }))}
                >
                  Dark Base
                </button>
                <button
                  type="button"
                  className={`pill ${draft.colorScheme === 'light' ? 'active' : ''}`}
                  onClick={() => updateDraft((prev) => ({ ...prev, colorScheme: 'light' }))}
                >
                  Light Base
                </button>
              </div>
            </div>

            <div className="card forge-stack">
              <div className="forge-section-label">COLORS</div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                  gap: 8,
                }}
              >
                {COLOR_FIELDS.map(({ key, label }) => (
                  <label key={key} className="forge-row-between subpanel" style={{ padding: '5px 8px' }}>
                    <span className="text-md">{label}</span>
                    <input
                      type="color"
                      aria-label={label}
                      className="theme-swatch-input"
                      value={draft.tokens[key]}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateDraft((prev) => ({
                          ...prev,
                          tokens: { ...prev.tokens, [key]: val },
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="forge-grid-2" style={{ alignItems: 'start' }}>
              <div className="card forge-stack">
                <div className="forge-section-label">TYPOGRAPHY</div>
                <label className="forge-field">
                  <span className="forge-label">HEADING FONT</span>
                  <select
                    className="forge-input"
                    value={draft.typography.displayFont}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        typography: { ...prev.typography, displayFont: e.target.value as ThemeDisplayFont },
                      }))
                    }
                  >
                    <option value="Inter">Inter (Clean Modern)</option>
                    <option value="Cinzel">Cinzel (Classic Fantasy Serif)</option>
                    <option value="Fraunces">Fraunces (Editorial Grimoire)</option>
                    <option value="Space Grotesk">Space Grotesk (Sci-Fi / Tactical)</option>
                    <option value="System">System UI</option>
                  </select>
                </label>
                <label className="forge-field">
                  <span className="forge-label">BODY FONT</span>
                  <select
                    className="forge-input"
                    value={draft.typography.bodyFont}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        typography: { ...prev.typography, bodyFont: e.target.value as ThemeBodyFont },
                      }))
                    }
                  >
                    <option value="Inter">Inter</option>
                    <option value="Fraunces">Fraunces</option>
                    <option value="System">System UI</option>
                  </select>
                </label>
                <label className="forge-field">
                  <span className="forge-label">DICE / MONOSPACE FONT</span>
                  <select
                    className="forge-input"
                    value={draft.typography.monoFont}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        typography: { ...prev.typography, monoFont: e.target.value as ThemeMonoFont },
                      }))
                    }
                  >
                    <option value="JetBrains Mono">JetBrains Mono</option>
                    <option value="Fira Code">Fira Code</option>
                    <option value="System Monospace">System Monospace</option>
                  </select>
                </label>
                <label className="forge-field">
                  <span className="forge-label">
                    FONT SCALE ({Math.round(draft.typography.fontScale * 100)}%)
                  </span>
                  <input
                    type="range"
                    min={0.9}
                    max={1.2}
                    step={0.05}
                    value={draft.typography.fontScale}
                    onChange={(e) =>
                      updateDraft((prev) => ({
                        ...prev,
                        typography: {
                          ...prev.typography,
                          fontScale: Number.parseFloat(e.target.value) || 1,
                        },
                      }))
                    }
                  />
                </label>
              </div>

              <div className="card forge-stack">
                <div className="forge-section-label">SURFACE, DENSITY &amp; TEXTURE</div>
                <div>
                  <div className="forge-label" style={{ marginBottom: 4 }}>DENSITY</div>
                  <div className="pill-row">
                    {(['compact', 'comfortable', 'spacious'] as ThemeDensity[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`pill ${draft.surface.density === d ? 'active' : ''}`}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            surface: { ...prev.surface, density: d },
                          }))
                        }
                      >
                        {d.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="forge-label" style={{ marginBottom: 4 }}>CORNER RADIUS</div>
                  <div className="pill-row">
                    {(['sharp', 'balanced', 'rounded', 'pill'] as ThemeRadiusScale[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`pill ${draft.surface.radiusScale === r ? 'active' : ''}`}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            surface: { ...prev.surface, radiusScale: r },
                          }))
                        }
                      >
                        {r.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="forge-label" style={{ marginBottom: 4 }}>ELEVATION</div>
                  <div className="pill-row">
                    {(['flat', 'subtle', 'elevated', 'glass'] as ThemeElevation[]).map((el) => (
                      <button
                        key={el}
                        type="button"
                        className={`pill ${draft.surface.elevation === el ? 'active' : ''}`}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            surface: { ...prev.surface, elevation: el },
                          }))
                        }
                      >
                        {el.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="forge-label" style={{ marginBottom: 4 }}>BACKGROUND TEXTURE</div>
                  <div className="pill-row">
                    {(['none', 'parchment', 'grid', 'noise'] as ThemeTexture[]).map((tx) => (
                      <button
                        key={tx}
                        type="button"
                        className={`pill ${draft.surface.texture === tx ? 'active' : ''}`}
                        onClick={() =>
                          updateDraft((prev) => ({
                            ...prev,
                            surface: { ...prev.surface, texture: tx },
                          }))
                        }
                      >
                        {tx.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="card forge-row wrap">
              <input
                aria-label="Custom theme name"
                type="text"
                className="forge-input"
                style={{ flex: 1, minWidth: 180 }}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My Custom Theme"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const saved: ThemeDefinition = {
                    ...structuredClone(draft),
                    id:
                      draft.builtIn || !draft.id.startsWith('custom-')
                        ? `custom-${Date.now().toString(36)}`
                        : draft.id,
                    name: customName.trim() || 'My Custom Theme',
                    builtIn: false,
                  };
                  onSaveCustomTheme(saved);
                  onApplyTheme(saved);
                  setDraft(structuredClone(saved));
                  flashNotice(`Saved "${saved.name}"!`);
                }}
              >
                Save Custom Theme
              </button>
            </div>
          </div>
        )}

        {tab === 'share' && (
          <div className="forge-stack">
            <div className="card forge-stack">
              <div className="forge-row-between wrap gap-3">
                <div>
                  <div className="forge-section-label">MODULAR BLOCK LAYOUT PRESETS</div>
                  <div className="forge-muted text-md">
                    Active Layout: <strong>{activeLayout.name}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onClose();
                    onEnterLayoutEditor();
                  }}
                >
                  Customize &amp; Resize Blocks...
                </button>
              </div>
              <div className="pill-row">
                {allLayoutPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`pill ${activeLayout.id === preset.id ? 'active' : ''}`}
                    onClick={() => {
                      onApplyLayout(structuredClone(preset));
                      flashNotice(`Applied layout "${preset.name}"`);
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="card forge-stack">
              <div className="forge-section-label">SHARE OR IMPORT SETUP (THEME + LAYOUT)</div>
              <div className="forge-row wrap">
                <button type="button" className="btn btn-primary" onClick={() => void handleCopyShareCode()}>
                  Copy Share Code (FORGE-UI:...)
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => downloadSetupJson(buildCurrentBundle())}
                >
                  Download Setup .json
                </button>
              </div>
              <textarea
                aria-label="Paste FORGE-UI share code or setup JSON"
                rows={4}
                className="forge-input tabular"
                placeholder="Paste a FORGE-UI:... share code or .dndforge-setup.json here..."
                value={shareCodeInput}
                onChange={(e) => setShareCodeInput(e.target.value)}
              />
              <div className="forge-row wrap">
                <button type="button" className="btn" onClick={handlePreviewShareInput}>
                  Preview Shared Setup
                </button>
                <label className="btn clickable">
                  Load Setup .json File
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="is-hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const txt = await file.text();
                      setShareCodeInput(txt);
                      try {
                        const parsed = decodeSetupShareCode(txt);
                        setDecodedPreview(parsed);
                        flashNotice(`Loaded "${parsed.name}" from file!`);
                      } catch (err) {
                        onLog(`Setup file error: ${String(err)}`, 'warn');
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {decodedPreview && (
                <div className="subpanel forge-stack" style={{ padding: 10 }}>
                  <div>
                    <strong>{decodedPreview.name}</strong>{' '}
                    <span className="badge">Theme: {decodedPreview.theme.name}</span>{' '}
                    <span className="badge">Layout: {decodedPreview.layout.name}</span>
                  </div>
                  <div className="forge-row wrap">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        onSaveCustomTheme(decodedPreview.theme);
                        onApplyTheme(decodedPreview.theme);
                        onApplyLayout(decodedPreview.layout);
                        if (decodedPreview.houseRules) {
                          onUpdateHouseRules(decodedPreview.houseRules);
                        }
                        flashNotice(`Applied full setup "${decodedPreview.name}"!`);
                      }}
                    >
                      Apply Theme + Layout
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        onSaveCustomTheme(decodedPreview.theme);
                        onApplyTheme(decodedPreview.theme);
                        flashNotice(`Applied theme "${decodedPreview.theme.name}"!`);
                      }}
                    >
                      Apply Theme Only
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        onApplyLayout(decodedPreview.layout);
                        flashNotice(`Applied layout "${decodedPreview.layout.name}"!`);
                      }}
                    >
                      Apply Layout Only
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
