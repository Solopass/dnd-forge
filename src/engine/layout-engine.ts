import {
  WidgetAccent,
  WidgetColSpan,
  WidgetHeightPreset,
  WidgetId,
  WidgetLayoutItem,
  WorkspaceLayoutConfig,
} from '../types/layout';

export const ACTIVE_LAYOUT_STORAGE_KEY = 'dnd-forge-active-layout';
export const SAVED_LAYOUTS_STORAGE_KEY = 'dnd-forge-saved-layouts';

export const WIDGET_LABELS: Record<WidgetId, string> = {
  vitals: 'HP, AC, Init & Speed',
  abilities: 'Abilities & Saves',
  skills: 'Skills & Passives',
  conditions: 'Conditions & Defenses',
  buffs_actions: 'Actions & Combat Buffs',
  pinned_favorites: '★ Pinned Favorites',
  spells: 'Spell Slots & Spells',
  inventory: 'Equipment & Currency',
  features_notes: 'Features & Notes',
  combat_tracker: 'Encounter & Turn Tracker',
  mini_vtt: 'Tactical Mini VTT',
  dice_console: 'Dice & Combat Log',
  dm_notes: 'DM Campaign & Clock',
  dm_loot: 'DM Party Stash & Gold',
};

function makeWidgets(
  specs: Array<[WidgetId, WidgetColSpan, WidgetHeightPreset?, boolean?]>
): WidgetLayoutItem[] {
  return specs.map(([id, colSpan, heightPreset = 'auto', visible = true]) => ({
    id,
    label: WIDGET_LABELS[id],
    colSpan,
    heightPreset,
    visible,
  }));
}

export const BUILTIN_LAYOUT_PRESETS: WorkspaceLayoutConfig[] = [
  {
    id: 'layout-balanced-commander',
    name: 'Balanced Commander',
    description: '3-column tactical sheet with Vitals, Actions, Spells, and Combat Tracker.',
    builtIn: true,
    gap: 'normal',
    widgets: makeWidgets([
      ['vitals', 4],
      ['buffs_actions', 4],
      ['combat_tracker', 4],
      ['abilities', 4],
      ['pinned_favorites', 4],
      ['spells', 4],
      ['skills', 4, 'compact'],
      ['conditions', 4],
      ['inventory', 4, 'compact'],
      ['features_notes', 6, 'compact'],
      ['mini_vtt', 6, 'compact', false],
      ['dice_console', 12, 'compact', false],
    ]),
  },
  {
    id: 'layout-combat-vtt',
    name: 'Combat & Mini VTT',
    description: 'Front-loads Actions, Pinned Favorites, Combat Tracker, and Live Mini VTT.',
    builtIn: true,
    gap: 'normal',
    widgets: makeWidgets([
      ['vitals', 4],
      ['buffs_actions', 4],
      ['combat_tracker', 4],
      ['mini_vtt', 8],
      ['pinned_favorites', 4],
      ['abilities', 6],
      ['conditions', 6],
      ['spells', 6, 'compact'],
      ['skills', 6, 'compact'],
      ['inventory', 6, 'compact', false],
      ['features_notes', 6, 'compact', false],
      ['dice_console', 12, 'compact', false],
    ]),
  },
  {
    id: 'layout-spellcaster',
    name: 'Spellcaster Grimoire',
    description: 'Wide Spells & Spell Slots block paired with Concentration, Vitals, and Skills.',
    builtIn: true,
    gap: 'normal',
    widgets: makeWidgets([
      ['vitals', 4],
      ['spells', 8],
      ['abilities', 4],
      ['buffs_actions', 4],
      ['combat_tracker', 4],
      ['conditions', 4],
      ['skills', 4, 'compact'],
      ['pinned_favorites', 4],
      ['features_notes', 6, 'compact'],
      ['inventory', 6, 'compact'],
      ['mini_vtt', 6, 'compact', false],
      ['dice_console', 12, 'compact', false],
    ]),
  },
  {
    id: 'layout-dm-screen',
    name: 'DM Master Screen',
    description: 'Tactical VTT, Encounter Tracker, Campaign Clock, Party Stash, and Conditions side by side.',
    builtIn: true,
    gap: 'tight',
    widgets: makeWidgets([
      ['combat_tracker', 4],
      ['mini_vtt', 8, 'tall'],
      ['dm_notes', 6, 'compact'],
      ['dm_loot', 6, 'compact'],
      ['vitals', 4],
      ['conditions', 4],
      ['features_notes', 4, 'compact'],
      ['buffs_actions', 6, 'compact'],
      ['spells', 6, 'compact'],
      ['abilities', 6, 'compact', false],
      ['skills', 6, 'compact', false],
      ['pinned_favorites', 4, 'compact', false],
      ['inventory', 6, 'compact', false],
      ['dice_console', 12, 'compact', false],
    ]),
  },
];

export function reorderWidget(
  layout: WorkspaceLayoutConfig,
  fromIndex: number,
  toIndex: number
): WorkspaceLayoutConfig {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= layout.widgets.length ||
    toIndex >= layout.widgets.length
  ) {
    return layout;
  }
  const next = [...layout.widgets];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return layout;
  next.splice(toIndex, 0, moved);
  return { ...layout, widgets: next };
}

export function moveWidgetById(
  layout: WorkspaceLayoutConfig,
  widgetId: WidgetId,
  delta: -1 | 1
): WorkspaceLayoutConfig {
  const idx = layout.widgets.findIndex((w) => w.id === widgetId);
  if (idx < 0) return layout;
  return reorderWidget(layout, idx, idx + delta);
}

export function resizeWidget(
  layout: WorkspaceLayoutConfig,
  widgetId: WidgetId,
  colSpan: WidgetColSpan,
  heightPreset?: WidgetHeightPreset,
  heightPx?: number | null
): WorkspaceLayoutConfig {
  return {
    ...layout,
    widgets: layout.widgets.map((w) =>
      w.id === widgetId
        ? {
            ...w,
            colSpan,
            heightPreset: heightPreset ?? w.heightPreset,
            heightPx:
              heightPx === null
                ? undefined
                : typeof heightPx === 'number'
                  ? Math.max(180, Math.min(820, Math.round(heightPx)))
                  : w.heightPx,
          }
        : w
    ),
  };
}

export function setWidgetAccent(
  layout: WorkspaceLayoutConfig,
  widgetId: WidgetId,
  accent: WidgetAccent
): WorkspaceLayoutConfig {
  return {
    ...layout,
    widgets: layout.widgets.map((w) => (w.id === widgetId ? { ...w, accent } : w)),
  };
}

export function toggleWidgetVisibility(
  layout: WorkspaceLayoutConfig,
  widgetId: WidgetId
): WorkspaceLayoutConfig {
  return {
    ...layout,
    widgets: layout.widgets.map((w) =>
      w.id === widgetId ? { ...w, visible: !w.visible } : w
    ),
  };
}

export function normalizeLayoutConfig(raw: Partial<WorkspaceLayoutConfig>): WorkspaceLayoutConfig {
  const fallback = BUILTIN_LAYOUT_PRESETS[0]!;
  const incomingWidgets = Array.isArray(raw.widgets) ? raw.widgets : [];
  const seen = new Set<WidgetId>();
  const validSpans = new Set<WidgetColSpan>([3, 4, 5, 6, 7, 8, 9, 10, 12]);
  const normalized: WidgetLayoutItem[] = [];

  for (const w of incomingWidgets) {
    if (!w || typeof w.id !== 'string' || !(w.id in WIDGET_LABELS) || seen.has(w.id as WidgetId)) {
      continue;
    }
    const id = w.id as WidgetId;
    seen.add(id);
    const span: WidgetColSpan = validSpans.has(w.colSpan as WidgetColSpan)
      ? (w.colSpan as WidgetColSpan)
      : 4;
    const heightPreset: WidgetHeightPreset =
      w.heightPreset === 'compact' || w.heightPreset === 'tall' ? w.heightPreset : 'auto';
    const heightPx =
      typeof w.heightPx === 'number' && Number.isFinite(w.heightPx)
        ? Math.max(180, Math.min(820, Math.round(w.heightPx)))
        : undefined;
    const accent: WidgetAccent =
      w.accent === 'brand' || w.accent === 'gold' ? w.accent : 'default';
    normalized.push({
      id,
      label: WIDGET_LABELS[id],
      colSpan: span,
      heightPreset,
      heightPx,
      accent,
      visible: typeof w.visible === 'boolean' ? w.visible : true,
    });
  }

  for (const def of fallback.widgets) {
    if (!seen.has(def.id)) {
      normalized.push({ ...def, visible: false });
    }
  }

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : 'layout-custom',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Custom Layout',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    gap: raw.gap === 'tight' || raw.gap === 'wide' ? raw.gap : 'normal',
    widgets: normalized,
  };
}

export function readStoredLayout(): WorkspaceLayoutConfig {
  try {
    const raw = localStorage.getItem(ACTIVE_LAYOUT_STORAGE_KEY);
    if (!raw) return structuredClone(BUILTIN_LAYOUT_PRESETS[0]!);
    return normalizeLayoutConfig(JSON.parse(raw) as Partial<WorkspaceLayoutConfig>);
  } catch {
    return structuredClone(BUILTIN_LAYOUT_PRESETS[0]!);
  }
}

export function saveStoredLayout(layout: WorkspaceLayoutConfig): void {
  try {
    localStorage.setItem(ACTIVE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage errors
  }
}

export function readStoredSavedLayouts(): WorkspaceLayoutConfig[] {
  try {
    const raw = localStorage.getItem(SAVED_LAYOUTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeLayoutConfig(item as Partial<WorkspaceLayoutConfig>))
      : [];
  } catch {
    return [];
  }
}

export function saveCustomLayoutPreset(
  layout: WorkspaceLayoutConfig,
  name: string
): WorkspaceLayoutConfig[] {
  const cleanName = name.trim() || 'Custom Layout';
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
  const entry: WorkspaceLayoutConfig = {
    ...structuredClone(layout),
    id: `layout-user-${slug}-${Date.now().toString(36)}`,
    name: cleanName,
    builtIn: false,
  };
  const existing = readStoredSavedLayouts().filter((p) => p.name !== cleanName);
  const next = [entry, ...existing].slice(0, 12);
  try {
    localStorage.setItem(SAVED_LAYOUTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
  return next;
}
