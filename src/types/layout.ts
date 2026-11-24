export type WidgetId =
  | 'vitals'
  | 'abilities'
  | 'skills'
  | 'conditions'
  | 'buffs_actions'
  | 'pinned_favorites'
  | 'spells'
  | 'inventory'
  | 'party_inventory'
  | 'features_notes'
  | 'combat_tracker'
  | 'mini_vtt'
  | 'dice_console'
  | 'dm_notes'
  | 'dm_loot';

export type WidgetColSpan = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12;
export type WidgetHeightPreset = 'auto' | 'compact' | 'tall';
export type WidgetAccent = 'default' | 'brand' | 'gold';

export interface WidgetLayoutItem {
  id: WidgetId;
  label: string;
  colSpan: WidgetColSpan;
  heightPreset: WidgetHeightPreset;
  heightPx?: number;
  accent?: WidgetAccent;
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
