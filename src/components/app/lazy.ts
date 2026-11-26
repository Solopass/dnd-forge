import { lazy } from 'react';

// Every modal, drawer and heavy panel is loaded on demand so it stays in its own chunk.
export const BattlemapModal = lazy(() =>
  import('../BattlemapModal').then((m) => ({ default: m.BattlemapModal }))
);

export const CharacterBuilderDrawer = lazy(() =>
  import('../CharacterBuilderDrawer').then((m) => ({ default: m.CharacterBuilderDrawer }))
);

export const CharacterManagerModal = lazy(() =>
  import('../CharacterManagerModal').then((m) => ({ default: m.CharacterManagerModal }))
);

export const DmHubModal = lazy(() =>
  import('../DmHubModal').then((m) => ({ default: m.DmHubModal }))
);

export const EncounterBuilderModal = lazy(() =>
  import('../EncounterBuilderModal').then((m) => ({ default: m.EncounterBuilderModal }))
);

export const EquipmentSpellDrawer = lazy(() =>
  import('../EquipmentSpellDrawer').then((m) => ({ default: m.EquipmentSpellDrawer }))
);

export const ImportPreviewModal = lazy(() =>
  import('../ImportPreviewModal').then((m) => ({ default: m.ImportPreviewModal }))
);

export const ItemInspectorPanel = lazy(() =>
  import('../ItemInspectorPanel').then((m) => ({ default: m.ItemInspectorPanel }))
);

export const LevelUpModal = lazy(() =>
  import('../LevelUpModal').then((m) => ({ default: m.LevelUpModal }))
);

export const LiveTableModal = lazy(() =>
  import('../LiveTableModal').then((m) => ({ default: m.LiveTableModal }))
);

export const ModularCanvas = lazy(() =>
  import('../ModularCanvas').then((m) => ({ default: m.ModularCanvas }))
);

export const MonsterStatblockModal = lazy(() =>
  import('../MonsterStatblockModal').then((m) => ({ default: m.MonsterStatblockModal }))
);

export const NewCharacterModal = lazy(() =>
  import('../NewCharacterModal').then((m) => ({ default: m.NewCharacterModal }))
);

export const RulesetModal = lazy(() =>
  import('../RulesetModal').then((m) => ({ default: m.RulesetModal }))
);

export const SettingsModal = lazy(() =>
  import('../SettingsModal').then((m) => ({ default: m.SettingsModal }))
);

export const ShortRestModal = lazy(() =>
  import('../ShortRestModal').then((m) => ({ default: m.ShortRestModal }))
);

export const ThemeStudioModal = lazy(() =>
  import('../ThemeStudioModal').then((m) => ({ default: m.ThemeStudioModal }))
);
