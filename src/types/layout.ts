export type WidgetId =
  | 'vitals'
  | 'abilities'
  | 'skills'
  | 'conditions'
  | 'buffs_actions'
  | 'pinned_favorites'
  | 'spells'
  | 'inventory'
  | 'features_notes'
  | 'combat_tracker'
  | 'mini_vtt'
  | 'dice_console';

export type WidgetColSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetHeightPreset = 'auto' | 'compact' | 'tall';

export interface WidgetLayoutItem {
  id: WidgetId;
  label: string;
  colSpan: WidgetColSpan;
  heightPreset: WidgetHeightPreset;
  visible: boolean;
}

export interface WorkspaceLayoutConfig {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
  gap: 'tight' | 'normal' | 'wide';
  widgets: WidgetLayoutItem[];
}
