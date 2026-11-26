import { useEffect, useRef, useState } from 'react';
import type { DmHubTab } from '../DmHubModal';
import { CUSTOM_REPO_THEMES } from '../../engine/custom-content-loader';
import { readStoredLayout, saveStoredLayout } from '../../engine/layout-engine';
import {
  applyThemeToDocument,
  BUILTIN_THEMES,
  readStoredActiveThemeId,
  readStoredCustomThemes,
  saveCustomThemes,
} from '../../engine/themes';
import { applyUiMode, readStoredUiMode, UiMode } from '../../engine/ui-mode';
import { exportFullBundle } from '../../storage/db';
import type { ThemeDefinition } from '../../types/theme';
import type { WorkspaceLayoutConfig } from '../../types/layout';
import type { ItemCategory } from '../../types/compendium';
import type { SheetStore } from './types';

/** All of App's UI state (modal flags, layout mode, role, selections), its effects and derived flags. */
export function useAppUiState(store: SheetStore) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [newCharOpen, setNewCharOpen] = useState(false);
  const [battlemapOpen, setBattlemapOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesetOpen, setRulesetOpen] = useState(false);
  const [themeStudioOpen, setThemeStudioOpen] = useState(false);
  const [modularMode, setModularMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dnd-forge-modular-mode') === '1';
    } catch {
      return false;
    }
  });
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const [customThemes, setCustomThemes] = useState<ThemeDefinition[]>(() => readStoredCustomThemes());
  const [activeTheme, setActiveTheme] = useState<ThemeDefinition>(() => {
    const storedId = readStoredActiveThemeId();
    const pool = [...BUILTIN_THEMES, ...CUSTOM_REPO_THEMES, ...readStoredCustomThemes()];
    return pool.find((t) => t.id === storedId) ?? BUILTIN_THEMES[0]!;
  });
  const [activeLayout, setActiveLayout] = useState<WorkspaceLayoutConfig>(() => readStoredLayout());
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [shortRestOpen, setShortRestOpen] = useState(false);
  const [charManagerOpen, setCharManagerOpen] = useState(false);
  const [paletteInitialCat, setPaletteInitialCat] = useState<'all' | ItemCategory>('all');
  const [paletteInitialRuleset, setPaletteInitialRuleset] = useState<'all' | '2014' | '2024'>('all');
  const [liveTableOpen, setLiveTableOpen] = useState(false);
  const [encounterBuilderOpen, setEncounterBuilderOpen] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [tableRole, setTableRole] = useState<'dm' | 'player'>(() => {
    try {
      return localStorage.getItem('dnd-forge-table-role') === 'player' ? 'player' : 'dm';
    } catch {
      return 'dm';
    }
  });
  const [centerStage, setCenterStage] = useState<'auto' | 'sheet' | 'battlemap'>('sheet');
  const [playerView, setPlayerView] = useState(false);
  const [inspectedCombatantId, setInspectedCombatantId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'combat' | 'inspector'>('combat');
  const [inspectedItemId, setInspectedItemId] = useState<string | null>(null);
  const [uiMode, setUiMode] = useState<UiMode>(readStoredUiMode);
  const [unifiedView, setUnifiedView] = useState<'sheet' | 'dm' | 'vtt'>('sheet');
  const [showClassicCombat, setShowClassicCombat] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'vitals' | 'actions' | 'combat'>('vitals');
  const inspectedCombatant =
    inspectedCombatantId ? (store.encounter.combatants.find((c) => c.id === inspectedCombatantId) ?? null) : null;
  const [consoleSize, setConsoleSize] = useState<'normal' | 'expanded' | 'collapsed'>('normal');
  const mobileTablistRef = useRef<HTMLDivElement | null>(null);

  const isPlayerRole = tableRole === 'player' || store.liveStatus.role === 'player';
  const [dmSection, setDmSection] = useState<DmHubTab | 'battlemap'>('party');
  const [inspectedPcId, setInspectedPcId] = useState<string | null>(null);
  const openPcSheetFromDm = async (characterId: string) => {
    await store.switchCharacter(characterId);
    setInspectedPcId(characterId);
  };
  const effectivePlayerView = isPlayerRole ? true : playerView;
  const isCombatActive = store.encounter.combatants.length > 1 || store.encounter.round > 1;
  const showCenterBattlemap =
    centerStage === 'battlemap' || (centerStage === 'auto' && isCombatActive);

  const setTableRolePersisted = (next: 'dm' | 'player') => {
    setTableRole(next);
    try {
      localStorage.setItem('dnd-forge-table-role', next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    applyUiMode(uiMode);
  }, [uiMode]);

  useEffect(() => {
    applyThemeToDocument(activeTheme);
  }, [activeTheme]);

  const handleApplyTheme = (theme: ThemeDefinition) => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (!reduced && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => setActiveTheme(theme));
    } else {
      setActiveTheme(theme);
    }
  };

  const handleSaveCustomTheme = (theme: ThemeDefinition) => {
    setCustomThemes((prev) => {
      const next = prev.some((t) => t.id === theme.id)
        ? prev.map((t) => (t.id === theme.id ? theme : t))
        : [theme, ...prev];
      saveCustomThemes(next);
      return next;
    });
  };

  const handleDeleteCustomTheme = (themeId: string) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== themeId);
      saveCustomThemes(next);
      return next;
    });
    if (activeTheme.id === themeId) {
      setActiveTheme(BUILTIN_THEMES[0]!);
    }
  };

  const handleChangeLayout = (next: WorkspaceLayoutConfig) => {
    setActiveLayout(next);
    saveStoredLayout(next);
  };

  const setModularEnabled = (enabled: boolean) => {
    setModularMode(enabled);
    try {
      localStorage.setItem('dnd-forge-modular-mode', enabled ? '1' : '0');
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);
      if (isEditable) return;

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        store.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const handleExportActiveCharacter = () => {
    const blob = new Blob([JSON.stringify(store.rawChar, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${store.rawChar.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'character'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    store.appendLog(`Exported single character "${store.rawChar.name}" (.json).`, 'info');
  };

  const handleExport = async () => {
    const bundle = await exportFullBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dnd-forge-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    store.appendLog('Exported full local IndexedDB bundle (.json).', 'info');
  };

  const shellClass =
    consoleSize === 'collapsed'
      ? 'app-shell console-collapsed'
      : consoleSize === 'expanded'
      ? 'app-shell console-expanded'
      : 'app-shell';

  const charLevel = store.rawChar.classes.reduce((s, x) => s + x.level, 0);
  const classSummary = store.rawChar.classes.map((c) => `${c.className} ${c.level}`).join(' / ') || 'Adventurer';

  const inspectedItem =
    inspectedItemId !== null
      ? store.rawChar.items.find((it) => it.id === inspectedItemId) ?? null
      : null;

  const isInDmStudio = !modularMode && uiMode === 'unified' && unifiedView === 'dm' && !isPlayerRole;

  return {
    paletteOpen,
    setPaletteOpen,
    builderOpen,
    setBuilderOpen,
    gearOpen,
    setGearOpen,
    newCharOpen,
    setNewCharOpen,
    battlemapOpen,
    setBattlemapOpen,
    settingsOpen,
    setSettingsOpen,
    rulesetOpen,
    setRulesetOpen,
    themeStudioOpen,
    setThemeStudioOpen,
    modularMode,
    setModularMode,
    isEditingLayout,
    setIsEditingLayout,
    customThemes,
    setCustomThemes,
    activeTheme,
    setActiveTheme,
    activeLayout,
    setActiveLayout,
    levelUpOpen,
    setLevelUpOpen,
    shortRestOpen,
    setShortRestOpen,
    charManagerOpen,
    setCharManagerOpen,
    paletteInitialCat,
    setPaletteInitialCat,
    paletteInitialRuleset,
    setPaletteInitialRuleset,
    liveTableOpen,
    setLiveTableOpen,
    encounterBuilderOpen,
    setEncounterBuilderOpen,
    selectedTargetIds,
    setSelectedTargetIds,
    tableRole,
    setTableRole,
    centerStage,
    setCenterStage,
    playerView,
    setPlayerView,
    inspectedCombatantId,
    setInspectedCombatantId,
    rightTab,
    setRightTab,
    inspectedItemId,
    setInspectedItemId,
    uiMode,
    setUiMode,
    unifiedView,
    setUnifiedView,
    showClassicCombat,
    setShowClassicCombat,
    shortcutsOpen,
    setShortcutsOpen,
    mobileTab,
    setMobileTab,
    consoleSize,
    setConsoleSize,
    dmSection,
    setDmSection,
    inspectedPcId,
    setInspectedPcId,
    inspectedCombatant,
    mobileTablistRef,
    isPlayerRole,
    openPcSheetFromDm,
    effectivePlayerView,
    isCombatActive,
    showCenterBattlemap,
    setTableRolePersisted,
    handleApplyTheme,
    handleSaveCustomTheme,
    handleDeleteCustomTheme,
    handleChangeLayout,
    setModularEnabled,
    handleExportActiveCharacter,
    handleExport,
    shellClass,
    charLevel,
    classSummary,
    inspectedItem,
    isInDmStudio,
  };
}

export type AppUi = ReturnType<typeof useAppUiState>;
