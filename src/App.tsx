import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { APP_VERSION } from './version';
import './styles/tokens.css';
import './styles/layout.css';
import { useSheetStore } from './state/useSheetStore';
import { VitalsColumn } from './components/VitalsColumn';
import { ActionEconomyBoard } from './components/ActionEconomyBoard';
import { SummonCombatDrawer, CommandPalette, StatusConsole } from './components/SummonCombatDrawer';
import { ModalDialog } from './components/ModalDialog';
import { ToastStack } from './components/ToastStack';

const NewCharacterModal = lazy(() =>
  import('./components/NewCharacterModal').then((m) => ({ default: m.NewCharacterModal }))
);

const BattlemapModal = lazy(() =>
  import('./components/BattlemapModal').then((m) => ({ default: m.BattlemapModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const RulesetModal = lazy(() =>
  import('./components/RulesetModal').then((m) => ({ default: m.RulesetModal }))
);
const ThemeStudioModal = lazy(() =>
  import('./components/ThemeStudioModal').then((m) => ({ default: m.ThemeStudioModal }))
);
const ModularCanvas = lazy(() =>
  import('./components/ModularCanvas').then((m) => ({ default: m.ModularCanvas }))
);
const LevelUpModal = lazy(() =>
  import('./components/LevelUpModal').then((m) => ({ default: m.LevelUpModal }))
);
const DmHubModal = lazy(() =>
  import('./components/DmHubModal').then((m) => ({ default: m.DmHubModal }))
);
const MonsterStatblockModal = lazy(() =>
  import('./components/MonsterStatblockModal').then((m) => ({ default: m.MonsterStatblockModal }))
);

const CharacterBuilderDrawer = lazy(() =>
  import('./components/CharacterBuilderDrawer').then((m) => ({ default: m.CharacterBuilderDrawer }))
);
const EquipmentSpellDrawer = lazy(() =>
  import('./components/EquipmentSpellDrawer').then((m) => ({ default: m.EquipmentSpellDrawer }))
);
import {
  BackpackIcon,
  BookIcon,
  MapIcon,
  RedoIcon,
  SettingsIcon,
  ShieldIcon,
  SwordsIcon,
  UndoIcon,
} from './components/Icons';

const LiveTableModal = lazy(() =>
  import('./components/LiveTableModal').then((m) => ({ default: m.LiveTableModal }))
);
const EncounterBuilderModal = lazy(() =>
  import('./components/EncounterBuilderModal').then((m) => ({ default: m.EncounterBuilderModal }))
);
const ShortRestModal = lazy(() =>
  import('./components/ShortRestModal').then((m) => ({ default: m.ShortRestModal }))
);
const ItemInspectorPanel = lazy(() =>
  import('./components/ItemInspectorPanel').then((m) => ({ default: m.ItemInspectorPanel }))
);
const CharacterManagerModal = lazy(() =>
  import('./components/CharacterManagerModal').then((m) => ({ default: m.CharacterManagerModal }))
);
import { BUILTIN_CONTENT_PACKS } from './engine/srd-packs';
import { detectRulesetPreset } from './engine/ruleset-config';
import {
  applyThemeToDocument,
  BUILTIN_THEMES,
  readStoredActiveThemeId,
  readStoredCustomThemes,
  saveCustomThemes,
} from './engine/themes';
import { CUSTOM_REPO_THEMES } from './engine/custom-content-loader';
import { readStoredLayout, saveStoredLayout } from './engine/layout-engine';
import { ThemeDefinition } from './types/theme';
import { WorkspaceLayoutConfig } from './types/layout';
import { applyUiMode, readStoredUiMode, UiMode } from './engine/ui-mode';
import { evaluateDiceExpression } from './engine/dice';
import { exportFullBundle } from './storage/db';
import { RawCharacterState } from './types/character';
import { CombatEncounterState } from './types/combat';

const SEED_CHARACTER: RawCharacterState = {
  id: 'char-armorer-01',
  name: 'Armorer Artificer',
  ruleset: '2014',
  species: 'Human',
  background: 'Clan Crafter',
  classes: [{ className: 'Artificer', subclassName: 'Armorer', level: 9, hitDie: 8, casterProgression: 'half_up' }],
  baseAbilities: { str: 10, dex: 14, con: 16, int: 18, wis: 12, cha: 8 },
  bonusAbilities: { str: 0, dex: 0, con: 0, int: 2, wis: 0, cha: 0 },
  saveProficiencies: ['con', 'int'],
  skillProficiencies: {
    acrobatics: 0, animal_handling: 0, arcana: 2, athletics: 0, deception: 0,
    history: 1, insight: 0, intimidation: 0, investigation: 2, medicine: 0,
    nature: 0, perception: 1, performance: 0, persuasion: 0, religion: 0,
    sleight_of_hand: 0, stealth: 0, survival: 0,
  },
  hp: { current: 76, max: 76, temp: 9 },
  deathSaves: { successes: 0, failures: 0 },
  exhaustion: 0,
  conditions: [],
  resources: [
    { id: 'spell_slot_1', name: '1st-Level Slots', current: 4, max: 4, recovery: 'long_rest', isAutoSpellSlot: true },
    { id: 'spell_slot_2', name: '2nd-Level Slots', current: 3, max: 3, recovery: 'long_rest', isAutoSpellSlot: true },
    { id: 'spell_slot_3', name: '3rd-Level Slots', current: 2, max: 2, recovery: 'long_rest', isAutoSpellSlot: true },
    { id: 'defensive_field', name: 'Defensive Field', current: 4, max: 4, recovery: 'long_rest' },
  ],
  items: [
    {
      id: 'item-plate',
      name: 'Arcane Plate Armor',
      source: 'PHB',
      ruleset: '2014',
      category: 'armor',
      equipped: true,
      acFormula: { base: 18, dexCap: 0 },
      activities: [],
      entries: ['Heavy plate integrated as Arcane Armor.'],
    },
    {
      id: 'item-shield',
      name: 'Enhanced Defense Shield (+1)',
      source: 'TCE',
      ruleset: '2014',
      category: 'shield',
      equipped: true,
      acFlatBonus: 3,
      activities: [],
      entries: ['+2 base shield plus +1 Artificer Infusion.'],
    },
    {
      id: 'item-cloak',
      name: 'Cloak of Protection',
      source: 'DMG',
      ruleset: '2014',
      category: 'gear',
      equipped: true,
      requiresAttunement: true,
      attuned: false,
      modifiers: [
        { target: 'ac.bonus', value: 1 },
        { target: 'save.all', value: 1 },
      ],
      activities: [],
      entries: ['Grants +1 AC and +1 to all saving throws while attuned.'],
    },
    {
      id: 'item-gauntlets',
      name: 'Guardian Thunder Gauntlets',
      source: 'TCE',
      ruleset: '2014',
      category: 'weapon',
      equipped: true,
      activities: [
        {
          id: 'act-gauntlet-hit',
          name: 'Thunder Gauntlets',
          type: 'attack',
          actionEconomy: 'action',
          attackAbility: 'int',
          attackBonusFormula: '@int + @prof',
          damageFormula: '1d8 + @int',
          damageType: 'thunder',
          description: 'Deals {@damage 1d8+@int} thunder damage; target has disadvantage against others.',
        },
        {
          id: 'act-defensive-field',
          name: 'Defensive Field',
          type: 'heal',
          actionEconomy: 'bonus_action',
          resourceCost: { poolId: 'defensive_field', amount: 1 },
          description: 'Gain temporary HP equal to your Artificer level.',
        },
      ],
      entries: ['Integrated melee weapons in Guardian Armor model.'],
    },
    {
      id: 'spell-summon-construct',
      name: 'Summon Construct',
      source: 'TCE',
      ruleset: '2014',
      category: 'spell',
      equipped: true,
      prepared: true,
      concentration: true,
      spellLevel: 4,
      activities: [
        {
          id: 'act-summon-construct',
          name: 'Cast Summon Construct',
          type: 'summon',
          actionEconomy: 'action',
          resourceCost: { poolId: 'spell_slot_3', amount: 1 },
          description: 'Spawns a linked Construct companion immediately after your initiative.',
        },
      ],
      entries: ['You call forth the spirit of a construct.'],
    },
    {
      id: 'feat-arcane-armor',
      name: 'Arcane Armor (Guardian)',
      source: 'TCE',
      ruleset: '2014',
      category: 'feature',
      activities: [],
      entries: ['Your armor removes STR requirements, serves as a spellcasting focus, and deploys Thunder Gauntlets.'],
    },
    {
      id: 'feat-extra-attack',
      name: 'Extra Attack',
      source: 'PHB',
      ruleset: '2014',
      category: 'feature',
      activities: [],
      entries: ['You can attack twice, rather than once, whenever you take the Attack action on your turn.'],
    },
    {
      id: 'feat-flash-of-genius',
      name: 'Flash of Genius',
      source: 'TCE',
      ruleset: '2014',
      category: 'feature',
      activities: [],
      entries: ['Reaction: Add your INT modifier (+5) to an ability check or saving throw within 30 ft.'],
    },
  ],
  overrides: {},
};

const SEED_ENCOUNTER: CombatEncounterState = {
  id: 'enc-01',
  name: 'Active Combat',
  round: 1,
  activeTurnIndex: 0,
  combatants: [
    {
      id: 'char-armorer-01',
      name: 'Armorer Artificer',
      kind: 'pc',
      initiative: 16,
      dexModifier: 2,
      ac: 21,
      hp: { current: 76, max: 76, temp: 9 },
      conditions: [],
      turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
    },
  ],
  activeEffects: [],
  log: [],
};

export function App() {
  const store = useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER);
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
  const [paletteInitialCat, setPaletteInitialCat] = useState<'all' | 'weapon' | 'armor' | 'shield' | 'gear' | 'spell' | 'feature' | 'feat' | 'infusion' | 'monster'>('all');
  const [paletteInitialRuleset, setPaletteInitialRuleset] = useState<'all' | '2014' | '2024'>('all');
  const [liveTableOpen, setLiveTableOpen] = useState(false);
  const [dmHubOpen, setDmHubOpen] = useState(false);
  const [encounterBuilderOpen, setEncounterBuilderOpen] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [tableRole, setTableRole] = useState<'dm' | 'player'>(() => {
    try {
      return localStorage.getItem('dnd-forge-table-role') === 'player' ? 'player' : 'dm';
    } catch {
      return 'dm';
    }
  });
  const [centerStage, setCenterStage] = useState<'auto' | 'sheet' | 'battlemap'>('auto');
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

  const vitalsNode = (
    <VitalsColumn
      sheet={store.resolvedSheet}
      layoutVariant={uiMode}
      isDruid={store.rawChar.classes.some((c) => c.className.toLowerCase() === 'druid')}
      onAdjustHp={store.adjustHp}
      onSetTempHp={store.setTempHp}
      onSetExhaustion={store.setExhaustion}
      onUpdateDeathSaves={store.updateDeathSaves}
      onRollDeathSave={store.rollDeathSave}
      onToggleInspiration={store.toggleInspiration}
      onToggleDefense={store.toggleDefense}
      onEnterWildShape={store.enterWildShape}
      onRevertWildShape={store.revertWildShape}
      onAdjustResource={store.adjustResourcePool}
      onAddResource={store.addCustomResourcePool}
      onSetAcOverride={(val) => store.setStatOverride('ac', val)}
      onRollInitiative={store.rollCharacterInitiative}
      onToggleCondition={store.toggleCondition}
      onTakeRest={store.takeRest}
      onOpenShortRest={() => setShortRestOpen(true)}
      onSpendHitDie={store.spendHitDie}
      onUpdateSenses={store.updateSenses}
      onUpdateSpeeds={store.updateSpeeds}
      onRollCheck={(label, mod) => {
        const sign = mod >= 0 ? '+' : '';
        const res = evaluateDiceExpression(`1d20${sign}${mod}`, store.rollMode);
        store.appendLog(`${label} (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
      }}
    />
  );

  const actionBoardNode = (
    <ActionEconomyBoard
      sheet={store.resolvedSheet}
      rawChar={store.rawChar}
      layoutVariant={uiMode}
      rollMode={store.rollMode}
      onChangeRollMode={store.setRollMode}
      onTriggerActivity={(act, slot, ritual) =>
        store.triggerActivity(act, slot, ritual, selectedTargetIds)
      }
      onRollInlineExpression={store.rollInlineExpression}
      onToggleEquipped={store.toggleItemEquipped}
      onTogglePrepared={store.toggleItemPrepared}
      onToggleAttuned={store.toggleItemAttuned}
      onAdjustResource={store.adjustResourcePool}
      onOpenGearDrawer={() => setGearOpen(true)}
      onOpenBuilderDrawer={() => setBuilderOpen(true)}
      activeBuffs={store.activeBuffs}
      flankingRule={store.houseRules.flankingRule}
      onToggleBuff={store.toggleBuff}
      onDivineSmite={store.divineSmite}
      onRollCheck={(label, mod) => {
        const sign = mod >= 0 ? '+' : '';
        const res = evaluateDiceExpression(`1d20${sign}${mod}`, store.rollMode);
        store.appendLog(`${label} (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
      }}
      campaign={store.campaign}
      onUpdateQuantity={store.updateItemQuantity}
      onUpdateContainer={store.updateItemContainer}
      onUpdateCurrency={store.updateCurrency}
      onSimplifyCurrency={store.simplifyCurrency}
      onDepositToPartyStash={store.depositItemToPartyStash}
      onClaimPartyStashItem={store.claimPartyStashItem}
      onAddPartyStashItem={store.addPartyStashItem}
      onInspectItem={(itemId) => {
        setInspectedItemId(itemId);
        setRightTab('inspector');
        if (uiMode === 'classic') setShowClassicCombat(true);
      }}
      onOpenCompendium={(cat) => {
        setPaletteInitialCat(cat);
        setPaletteInitialRuleset(store.rawChar.ruleset === '2024' ? '2024' : '2014');
        setPaletteOpen(true);
      }}
    />
  );

  const combatDrawerNode = (
    <SummonCombatDrawer
      encounter={store.encounter}
      encounterList={store.encounterList}
      partyLevels={store.characterList.map((c) => c.classes.reduce((s, x) => s + x.level, 0))}
      pendingConcDc={store.pendingConcDc}
      onSwitchEncounter={store.switchEncounter}
      onCreateEncounter={store.createEncounter}
      onDuplicateEncounter={store.duplicateEncounter}
      onDeleteEncounter={store.deleteEncounter}
      onAddPartyToEncounter={store.addPartyToEncounter}
      onOpenBattlemap={() => (uiMode === 'unified' ? setUnifiedView('vtt') : setBattlemapOpen(true))}
      onNextTurn={store.stepCombatTurn}
      onResetEncounter={store.resetEncounter}
      onAdjustCombatantHp={store.adjustCombatantHp}
      onSetCombatantInitiative={store.setCombatantInitiative}
      onMoveCombatantOrder={store.moveCombatantOrder}
      onToggleCombatantCondition={store.toggleCombatantCondition}
      onToggleCombatantEconomy={store.toggleCombatantEconomy}
      onRemoveCombatant={store.removeCombatant}
      playerView={effectivePlayerView}
      isPlayerRole={isPlayerRole}
      onTogglePlayerView={() => setPlayerView((v) => !v)}
      onRollAllInitiative={store.rollAllInitiative}
      onInspectCombatant={setInspectedCombatantId}
      onToggleCombatantHidden={store.toggleCombatantHidden}
      onSetCombatantSize={store.setCombatantSize}
      onAdjustLegendary={store.adjustLegendaryActions}
      onToggleOrRollRecharge={store.toggleOrRollRecharge}
      onAddTimedEffect={store.addTimedCombatEffect}
      onTriggerCombatantActivity={store.triggerCombatantActivity}
      onDropConcentration={store.dropConcentration}
      onRollConcentrationSave={store.rollConcentrationSave}
      selectedTargetIds={selectedTargetIds}
      onToggleTarget={(id) =>
        setSelectedTargetIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        )
      }
      onClearTargets={() => setSelectedTargetIds([])}
      onTargetAttack={store.targetAttackCombatants}
      onTargetSave={store.targetSaveCombatants}
      onOpenEncounterBuilder={() => setEncounterBuilderOpen(true)}
      hideBattlemapButton={uiMode === 'unified' && unifiedView === 'vtt'}
      onAddMonster={store.addMonsterToEncounter}
    />
  );

  const inspectedItem =
    inspectedItemId !== null
      ? store.rawChar.items.find((it) => it.id === inspectedItemId) ?? null
      : null;

  const rightSlotNode = (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      <div
        className="subpanel forge-row"
        role="tablist"
        aria-label="Right panel tabs"
        style={{ padding: '4px 8px', gap: 6, margin: '8px 10px 0', flexShrink: 0 }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={rightTab === 'combat'}
          className={`pill ${rightTab === 'combat' ? 'active' : ''}`}
          onClick={() => setRightTab('combat')}
        >
          Combat ({store.encounter.combatants.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rightTab === 'inspector'}
          className={`pill ${rightTab === 'inspector' ? 'active' : ''}`}
          onClick={() => setRightTab('inspector')}
        >
          {inspectedItem ? `Inspector: ${inspectedItem.name}` : 'Inspector'}
        </button>
      </div>
      {rightTab === 'combat' ? (
        combatDrawerNode
      ) : (
        <div className="pane" style={{ padding: '10px 12px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <Suspense fallback={null}>
            <ItemInspectorPanel
              item={inspectedItem}
              sheet={store.resolvedSheet}
              onTriggerActivity={(act, slot, ritual) =>
        store.triggerActivity(act, slot, ritual, selectedTargetIds)
      }
              onRollInlineExpression={store.rollInlineExpression}
              onToggleEquipped={store.toggleItemEquipped}
              onTogglePrepared={store.toggleItemPrepared}
              onToggleAttuned={store.toggleItemAttuned}
              onUpdateQuantity={store.updateItemQuantity}
              onUpdateContainer={store.updateItemContainer}
              onDepositToPartyStash={store.depositItemToPartyStash}
              onRemoveItem={(id) => {
                store.removeSheetItem(id);
                setInspectedItemId(null);
              }}
              onBackToCombat={() => setRightTab('combat')}
            />
          </Suspense>
        </div>
      )}
    </div>
  );

  const sharedBattlemapProps = {
    encounter: store.encounter,
    playerView,
    onTogglePlayerView: () => setPlayerView((v) => !v),
    onMoveToken: store.moveCombatantToken,
    onSetMapImage: store.setEncounterMapImage,
    onAddTemplate: store.addMapTemplate,
    onClearTemplates: store.clearMapTemplates,
    onToggleFogCells: store.toggleFogCells,
    onFillAllFog: store.fillAllFog,
    onClearAllFog: store.clearAllFog,
    onSetTerrainCell: store.setTerrainCell,
    onClearTerrain: store.clearTerrain,
    onUpdateMapSettings: store.updateEncounterMapSettings,
    onNextTurn: store.stepCombatTurn,
    scenes: store.scenes,
    onSaveScene: store.saveCurrentMapAsScene,
    onLoadScene: store.loadSceneToEncounter,
    onDeleteScene: store.deleteScene,
    onAddSketchStroke: store.addMapSketchStroke,
    onClearSketches: store.clearMapSketches,
    activePings: store.activePings,
    onPing: store.broadcastMapPing,
    selectedTargetIds,
    onToggleTarget: (id: string) =>
      setSelectedTargetIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      ),
    onSetTokenPortrait: store.setCombatantPortrait,
    onSetTokenVision: store.setCombatantVision,
    onAdjustTokenHp: store.adjustCombatantHp,
    onToggleTokenCondition: store.toggleCombatantCondition,
    onInspectToken: setInspectedCombatantId,
    ownedCharacterId: isPlayerRole ? (store.claimedTokenId ?? store.rawChar.id) : undefined,
    onOpenPopOutPlayer: () => {
      window.open('?player=1', 'dnd-forge-player-display', 'width=1280,height=800');
    },
  };

  const sharedDmHubProps = {
    campaign: store.campaign,
    campaignList: store.campaignList,
    characterList: store.characterList,
    activeCharacterName: store.rawChar.name,
    activeCharacterGp: store.rawChar.currency?.gp ?? 0,
    encounter: store.encounter,
    onSwitchCampaign: store.switchCampaign,
    onCreateCampaign: store.createCampaign,
    onDeleteCampaign: store.deleteCampaign,
    onUpsertEntry: store.upsertCampaignEntry,
    onDeleteEntry: store.deleteCampaignEntry,
    onAdvanceClock: store.advanceCampaignClock,
    onAddTimer: store.addClockTimer,
    onSetWeather: store.setCampaignWeather,
    onAddPartyLoot: store.addPartyLoot,
    onDistributeGold: store.distributeGoldToParty,
    onBuyShopItem: store.buyShopItemForActiveCharacter,
    onAwardXp: store.awardPartyXp,
    onMilestoneLevelUp: store.triggerPartyMilestoneLevelUp,
    onRollExpression: store.rollInlineExpression,
    activeSharedHandout: store.activeSharedHandout,
    onShareHandout: store.shareHandoutToPlayers,
    onHideHandout: store.hideSharedHandout,
    onSetWorldMapImage: store.setWorldMapImage,
    onUpsertWorldMapPin: store.upsertWorldMapPin,
    onDeleteWorldMapPin: store.deleteWorldMapPin,
    onAssignLootToCharacter: store.assignLootItemToCharacter,
    onUpsertDowntime: store.upsertDowntimeProject,
    onAdvanceDowntime: store.advanceDowntimeDays,
    onDeleteDowntime: store.deleteDowntimeProject,
    onSyncCampaignRepo: store.syncCampaignExternalRepo,
    onPushCampaignRepo: store.pushCampaignToRepo,
    onSpawnImprovEncounter: (enc: { monsters: Array<{ name: string; count: number }> }) => {
      const allMobs = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).filter(
        (e) => e.category === 'monster'
      );
      for (const entry of enc.monsters) {
        const match = allMobs.find((m) => m.name === entry.name);
        if (match?.monsterMeta) {
          for (let i = 0; i < entry.count; i++) {
            store.addMonsterToEncounter(
              match.name,
              match.monsterMeta.ac,
              match.monsterMeta.hp,
              match.monsterMeta.dexModifier,
              match.activities,
              match.monsterMeta.cr,
              match.monsterMeta,
              match.entries.join(' ')
            );
          }
        }
      }
      setDmHubOpen(false);
    },
    onPrintPacket: () => {
      document.body.classList.add('print-session-mode');
      const cleanup = () => document.body.classList.remove('print-session-mode');
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      setTimeout(cleanup, 1500);
    },
  };

  return (
    <div className={shellClass}>
      <header className="topbar">
        <div className="topbar-brand">
          <span
            className="topbar-brand-badge"
            style={{
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              lineHeight: 1.05,
              gap: 1,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="topbar-brand-dot" aria-hidden="true" />
              SIDEREROLL
            </span>
            <span
              className="tabular"
              style={{ fontSize: 9, opacity: 0.72, letterSpacing: '0.06em', paddingLeft: 14 }}
            >
              {APP_VERSION}
            </span>
          </span>
          <select
            aria-label="Active character"
            value={store.rawChar.id}
            onChange={(e) => void store.switchCharacter(e.target.value)}
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
          >
            {store.characterList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (Lvl {c.classes.reduce((s, x) => s + x.level, 0)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => setCharManagerOpen(true)}
            title="Open Character Manager (switch, import, export, duplicate, delete)"
          >
            Roster ({store.characterList.length})
          </button>
          <button
            type="button"
            className="btn btn-brand"
            onClick={() => setNewCharOpen(true)}
          >
            + New
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setLevelUpOpen(true)}>
            Level Up
          </button>
        </div>

        <div className="topbar-center">
          <div className="mode-switcher" role="group" aria-label="Interface layout mode">
            <button
              type="button"
              className={`mode-switcher-btn ${!modularMode && uiMode === 'classic' ? 'active' : ''}`}
              aria-pressed={!modularMode && uiMode === 'classic'}
              onClick={() => {
                setModularEnabled(false);
                setUiMode('classic');
              }}
            >
              Beyond Classic
            </button>
            <button
              type="button"
              className={`mode-switcher-btn ${!modularMode && uiMode === 'unified' ? 'active' : ''}`}
              aria-pressed={!modularMode && uiMode === 'unified'}
              onClick={() => {
                setModularEnabled(false);
                setUiMode('unified');
              }}
            >
              Unified Command
            </button>
            <button
              type="button"
              className={`mode-switcher-btn ${modularMode ? 'active' : ''}`}
              aria-pressed={modularMode}
              onClick={() => setModularEnabled(true)}
            >
              Modular Grid
            </button>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="mode-switcher" role="group" aria-label="Table role">
            <button
              type="button"
              className={`mode-switcher-btn ${!isPlayerRole ? 'active' : ''}`}
              aria-pressed={!isPlayerRole}
              disabled={store.liveStatus.role === 'player'}
              onClick={() => setTableRolePersisted('dm')}
              title="DM View: full encounter, monster, and campaign controls"
            >
              DM
            </button>
            <button
              type="button"
              className={`mode-switcher-btn ${isPlayerRole ? 'active' : ''}`}
              aria-pressed={isPlayerRole}
              onClick={() => setTableRolePersisted('player')}
              title="Player View: sheet, dice, and your own token only (hides monster tools)"
            >
              Player
            </button>
          </div>
          {modularMode && (
            <button
              type="button"
              className={`btn ${isEditingLayout ? 'btn-primary' : ''}`}
              onClick={() => setIsEditingLayout((v) => !v)}
              title="Reorder, resize, hide, or restore workspace blocks"
            >
              {isEditingLayout ? 'Done Editing' : 'Edit Blocks'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => setThemeStudioOpen(true)}
            title="Open Theme Studio, Custom Theme Editor & Setup Sharing"
          >
            Themes
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setRulesetOpen(true)}
            title="View 2014 vs 2024 rule differences & customize house rules"
          >
            Rules:{' '}
            {(() => {
              const p = detectRulesetPreset(store.houseRules);
              return p === '2014' ? '2014' : p === '2024' ? '2024' : 'Custom';
            })()}
          </button>
          <button type="button" className="btn" onClick={() => setPaletteOpen(true)} title="Compendium, Packs & PDF Import (Ctrl+K)">
            Packs (Ctrl+K)
          </button>
          {!isPlayerRole && (modularMode || uiMode === 'classic') && (
            <>
              <button type="button" className="btn" onClick={() => setDmHubOpen(true)}>
                DM Hub
              </button>
              <button type="button" className="btn" onClick={() => setBattlemapOpen(true)}>
                Battlemap
              </button>
            </>
          )}
          <button
            type="button"
            className={`btn ${store.liveStatus.role !== 'idle' ? 'btn-primary' : ''}`}
            onClick={() => setLiveTableOpen(true)}
          >
            Live Table{store.liveStatus.role !== 'idle' ? ` (${store.liveStatus.peers.length + 1})` : ''}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!store.canUndo}
            onClick={store.undo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="btn"
            disabled={!store.canRedo}
            onClick={store.redo}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <RedoIcon />
          </button>
          <button type="button" className="btn" onClick={() => setShortcutsOpen(true)} title="Keyboard Shortcuts & Tips">
            ?
          </button>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)} title="Settings & Theme">
            <SettingsIcon />
          </button>
        </div>
      </header>

      {!modularMode && uiMode === 'classic' && (
        <div className="beyond-hero-banner">
          <div className="beyond-hero-identity">
            <label
              className="beyond-crest"
              style={{ cursor: 'pointer', overflow: 'hidden' }}
              title="Click to upload character avatar"
            >
              {store.rawChar.avatarUrl ? (
                <img
                  src={store.rawChar.avatarUrl}
                  alt={store.rawChar.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                store.rawChar.name.slice(0, 2).toUpperCase()
              )}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') store.setCharacterAvatar(reader.result);
                  };
                  reader.readAsDataURL(file);
                  e.target.value = '';
                }}
              />
            </label>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.15 }}>
                {store.rawChar.name}
              </div>
              <div className="forge-muted" style={{ fontSize: 11 }}>
                {store.rawChar.species} • {classSummary} • Level {charLevel}
              </div>
            </div>
          </div>
          <div className="forge-row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => setShortRestOpen(true)}>
              Short Rest
            </button>
            <button type="button" className="btn" onClick={() => store.takeRest('long_rest')}>
              Long Rest
            </button>
            <button type="button" className="btn" onClick={() => setBuilderOpen(true)}>
              Build / Stats
            </button>
            <button type="button" className="btn" onClick={() => setGearOpen(true)}>
              Gear &amp; Spells ({store.resolvedSheet.attunementCount}/3)
            </button>
            <button
              type="button"
              className={`pill ${showClassicCombat ? 'active' : ''}`}
              aria-pressed={showClassicCombat}
              onClick={() => setShowClassicCombat((v) => !v)}
            >
              Combat Rail {showClassicCombat ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}

      {!modularMode && uiMode === 'classic' && (
        <div className="beyond-ability-bar" aria-label="Ability scores and combat vitals">
          <div className="beyond-ability-strip">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((key) => {
              const ab = store.resolvedSheet.abilities[key];
              const modSign = ab.modifier >= 0 ? '+' : '';
              const saveSign = ab.save.final >= 0 ? '+' : '';
              const isSaveProf = ab.save.modifiers.some((m) => m.id.startsWith('save-prof-'));
              return (
                <div
                  key={key}
                  className="ability-tile"
                  style={{ borderColor: isSaveProf ? 'var(--accent-gold)' : 'var(--border-subtle)' }}
                >
                  <div className="ability-tile-head">
                    <strong>{key}</strong>
                    <span className="badge tabular" style={{ padding: '0 4px' }}>{ab.score.final}</span>
                  </div>
                  <button
                    type="button"
                    className="ability-tile-mod tabular"
                    style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', width: '100%' }}
                    onClick={() => {
                      const s = ab.modifier >= 0 ? '+' : '';
                      const res = evaluateDiceExpression(`1d20${s}${ab.modifier}`, store.rollMode);
                      store.appendLog(`${key.toUpperCase()} Check (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
                    }}
                  >
                    {modSign}{ab.modifier}
                  </button>
                  <button
                    type="button"
                    className={`btn tabular ${isSaveProf ? 'btn-primary' : ''}`}
                    style={{ width: '100%', padding: '1px 4px', fontSize: 10 }}
                    onClick={() => {
                      const s = ab.save.final >= 0 ? '+' : '';
                      const res = evaluateDiceExpression(`1d20${s}${ab.save.final}`, store.rollMode);
                      store.appendLog(`${key.toUpperCase()} Save (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
                    }}
                  >
                    {isSaveProf ? '★ ' : 'Sv '}
                    {saveSign}{ab.save.final}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="beyond-combat-strip">
            <div className="beyond-stat-box beyond-stat-shield">
              <span className="stat-tile-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <ShieldIcon size={11} /> AC
              </span>
              <span className="stat-tile-val tabular">{store.resolvedSheet.ac.final}</span>
            </div>
            <button type="button" className="beyond-stat-box" onClick={store.rollCharacterInitiative} style={{ cursor: 'pointer' }}>
              <span className="stat-tile-label">INIT</span>
              <span className="stat-tile-val tabular">
                {store.resolvedSheet.initiative.final >= 0 ? `+${store.resolvedSheet.initiative.final}` : store.resolvedSheet.initiative.final}
              </span>
            </button>
            <div className="beyond-stat-box">
              <span className="stat-tile-label">SPEED</span>
              <span className="stat-tile-val tabular">{store.resolvedSheet.speed.final}ft</span>
            </div>
            <div className="beyond-stat-box">
              <span className="stat-tile-label">
                {store.resolvedSheet.spellcasting.primaryAbility ? 'SPELL DC' : 'PROF'}
              </span>
              <span className="stat-tile-val tabular">
                {store.resolvedSheet.spellcasting.primaryAbility
                  ? store.resolvedSheet.spellcasting.saveDc.final
                  : `+${store.resolvedSheet.proficiencyBonus.final}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {!isPlayerRole && store.encounter.combatants.some((c) => c.kind === 'pc') && (
        <div
          className="subpanel forge-row"
          style={{
            padding: '5px 14px',
            margin: '6px 14px 0',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
          aria-label="DM Party Live Status Strip"
        >
          <span className="muted-label">PARTY VITALS</span>
          {store.encounter.combatants
            .filter((c) => c.kind === 'pc')
            .map((pc) => (
              <span key={pc.id} className="badge tabular">
                <strong>{pc.name}</strong> • HP {pc.hp.current}/{pc.hp.max} • AC {pc.ac}
                {pc.conditions.length > 0 ? ` • ${pc.conditions.join(', ')}` : ''}
              </span>
            ))}
        </div>
      )}

      {store.pendingConcDc !== null && (
        <div
          className="subpanel forge-row-between"
          role="alert"
          style={{
            padding: '8px 14px',
            margin: '6px 14px 0',
            borderColor: 'color-mix(in oklab, var(--accent-danger) 65%, var(--border-subtle))',
            background: 'color-mix(in oklab, var(--accent-danger) 12%, var(--bg-surface))',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div className="forge-row" style={{ gap: 8 }}>
            <span className="badge" style={{ color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }}>
              CONCENTRATION CHECK
            </span>
            <span>
              Roll Constitution saving throw vs <strong className="tabular">DC {store.pendingConcDc}</strong>
            </span>
          </div>
          <div className="forge-row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => store.rollConcentrationSave(store.pendingConcDc ?? 10)}
            >
              Roll CON Save (DC {store.pendingConcDc})
            </button>
            <button type="button" className="btn btn-danger" onClick={() => store.dropConcentration('Dropped manually')}>
              Drop Concentration
            </button>
          </div>
        </div>
      )}

      {store.pendingRollRequest && (
        <div
          className="subpanel forge-row-between"
          role="alert"
          style={{
            padding: '10px 16px',
            margin: '8px 16px 0',
            borderColor: 'rgba(245, 158, 11, 0.55)',
            background: 'rgba(245, 158, 11, 0.08)',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div className="forge-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="badge" style={{ color: 'var(--accent-amber)', borderColor: 'rgba(245, 158, 11, 0.5)' }}>
              DM ROLL REQUEST
            </span>
            <strong>{store.pendingRollRequest.senderName}</strong> requests{' '}
            <strong>{store.pendingRollRequest.label}</strong>
            {store.pendingRollRequest.dc !== undefined && (
              <span className="badge tabular">DC {store.pendingRollRequest.dc}</span>
            )}
          </div>
          <div className="forge-row" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const req = store.pendingRollRequest;
                if (!req) return;
                let mod = 0;
                if (req.kind === 'save') {
                  const ab = store.resolvedSheet.abilities[req.abilityOrSkill as keyof typeof store.resolvedSheet.abilities];
                  mod = ab?.save.final ?? 0;
                } else {
                  const sk = store.resolvedSheet.skills[req.abilityOrSkill as keyof typeof store.resolvedSheet.skills];
                  mod = sk?.final ?? 0;
                }
                const sign = mod >= 0 ? '+' : '';
                store.rollInlineExpression(
                  `${req.label}${req.dc ? ` (DC ${req.dc})` : ''}`,
                  `1d20${sign}${mod}`
                );
                store.dismissRollRequest();
              }}
            >
              Roll Now
            </button>
            <button type="button" className="btn" onClick={store.dismissRollRequest}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {modularMode ? (
        <Suspense fallback={null}>
          <ModularCanvas
            layout={activeLayout}
            onChangeLayout={handleChangeLayout}
            isEditing={isEditingLayout}
            onToggleEditing={setIsEditingLayout}
            onOpenThemeStudio={() => setThemeStudioOpen(true)}
            sheet={store.resolvedSheet}
            rawChar={store.rawChar}
            rollMode={store.rollMode}
            onChangeRollMode={store.setRollMode}
            activeBuffs={store.activeBuffs}
            flankingRule={store.houseRules.flankingRule}
            onToggleBuff={store.toggleBuff}
            onDivineSmite={store.divineSmite}
            onTriggerActivity={(act, slot, ritual) =>
        store.triggerActivity(act, slot, ritual, selectedTargetIds)
      }
            onRollInlineExpression={store.rollInlineExpression}
            onAdjustHp={store.adjustHp}
            onSetTempHp={store.setTempHp}
            onSetExhaustion={store.setExhaustion}
            onRollAbilityCheck={(ab) => {
              const mod = store.resolvedSheet.abilities[ab].modifier;
              store.rollInlineExpression(`${ab.toUpperCase()} Check`, `1d20${mod >= 0 ? '+' : ''}${mod}`);
            }}
            onRollSavingThrow={(ab) => {
              const mod = store.resolvedSheet.abilities[ab].save.final;
              store.rollInlineExpression(`${ab.toUpperCase()} Save`, `1d20${mod >= 0 ? '+' : ''}${mod}`);
            }}
            onRollSkillCheck={(sk) => {
              const mod = store.resolvedSheet.skills[sk].final;
              store.rollInlineExpression(`${sk} Check`, `1d20${mod >= 0 ? '+' : ''}${mod}`);
            }}
            onToggleCondition={store.toggleCondition}
            onAdjustResource={store.adjustResourcePool}
            onToggleEquipped={store.toggleItemEquipped}
            onToggleAttuned={store.toggleItemAttuned}
            onOpenBuilderDrawer={() => setBuilderOpen(true)}
            onOpenGearDrawer={() => setGearOpen(true)}
            encounter={store.encounter}
            combatDrawerNode={combatDrawerNode}
            miniVttNode={
              <Suspense fallback={null}>
                <BattlemapModal isOpen embedded onClose={() => {}} {...sharedBattlemapProps} />
              </Suspense>
            }
            consoleLines={store.consoleLines}
            isPlayerRole={isPlayerRole}
            campaign={store.campaign}
            characterList={store.characterList}
            onAdvanceClock={store.advanceCampaignClock}
            onAssignLootToCharacter={store.assignLootItemToCharacter}
            onDistributeGold={store.distributeGoldToParty}
            onUpdateQuantity={store.updateItemQuantity}
            onUpdateContainer={store.updateItemContainer}
            onUpdateCurrency={store.updateCurrency}
            onSimplifyCurrency={store.simplifyCurrency}
            onDepositToPartyStash={store.depositItemToPartyStash}
            onClaimPartyStashItem={store.claimPartyStashItem}
            onAddPartyStashItem={store.addPartyStashItem}
            onOpenCompendium={(cat) => {
              setPaletteInitialCat(cat);
              setPaletteInitialRuleset(store.rawChar.ruleset === '2024' ? '2024' : '2014');
              setPaletteOpen(true);
            }}
          />
        </Suspense>
      ) : uiMode === 'classic' ? (
        <>
          <div className="mobile-tab-bar" role="tablist" aria-label="Workspace panels" ref={mobileTablistRef}>
            {(
              [
                { key: 'vitals', label: 'Vitals & Skills' },
                { key: 'actions', label: 'Actions & Spells' },
                { key: 'combat', label: 'Combat & Encounter' },
              ] as const
            ).map((tab, idx, arr) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`tab-${tab.key}`}
                className="mobile-tab"
                aria-selected={mobileTab === tab.key}
                tabIndex={mobileTab === tab.key ? 0 : -1}
                onClick={() => setMobileTab(tab.key)}
                onKeyDown={(e) => {
                  let nextIdx: number | null = null;
                  if (e.key === 'ArrowRight') nextIdx = (idx + 1) % arr.length;
                  else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + arr.length) % arr.length;
                  else if (e.key === 'Home') nextIdx = 0;
                  else if (e.key === 'End') nextIdx = arr.length - 1;
                  if (nextIdx !== null && arr[nextIdx]) {
                    e.preventDefault();
                    setMobileTab(arr[nextIdx]!.key);
                    const buttons = mobileTablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                    buttons?.[nextIdx]?.focus();
                  }
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            className={`workspace-grid ${!showClassicCombat ? 'classic-no-combat' : ''}`}
            data-active-tab={mobileTab}
          >
            {vitalsNode}
            <div className="pane center-stage-pane" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, gap: 10, padding: '10px 12px' }}>
              <div className="subpanel forge-row-between" style={{ padding: '5px 10px', flexWrap: 'wrap', gap: 6, flexShrink: 0 }}>
                <div className="pill-row">
                  <button
                    type="button"
                    className={`pill ${!showCenterBattlemap ? 'active' : ''}`}
                    onClick={() => setCenterStage('sheet')}
                  >
                    Actions &amp; Sheet
                  </button>
                  <button
                    type="button"
                    className={`pill ${showCenterBattlemap ? 'active' : ''}`}
                    onClick={() => setCenterStage('battlemap')}
                  >
                    Active Battlemap {isCombatActive ? '• Combat Live' : ''}
                  </button>
                  <button
                    type="button"
                    className={`pill ${centerStage === 'auto' ? 'active' : ''}`}
                    onClick={() => setCenterStage('auto')}
                    title="Automatically show Battlemap above Actions & Sheet when combat is active"
                  >
                    Auto
                  </button>
                </div>
              </div>
              {showCenterBattlemap && (
                <div className="center-battlemap-slot" style={{ flexShrink: 0 }}>
                  <Suspense fallback={null}>
                    <BattlemapModal
                      isOpen
                      embeddedFull
                      onClose={() => setCenterStage('sheet')}
                      {...sharedBattlemapProps}
                      playerView={effectivePlayerView}
                    />
                  </Suspense>
                </div>
              )}
              {actionBoardNode}
            </div>
            {showClassicCombat && rightSlotNode}
          </div>
        </>
      ) : (
        <div className="unified-shell">
          <nav className="unified-rail" aria-label="Unified workspace navigation">
            <button
              type="button"
              className={`unified-rail-btn ${unifiedView === 'sheet' ? 'active' : ''}`}
              onClick={() => setUnifiedView('sheet')}
            >
              <span className="forge-row" style={{ gap: 6 }}><SwordsIcon size={14} /> Play Sheet</span>
              <span className="badge">Lvl {charLevel}</span>
            </button>
            {!isPlayerRole && (
              <button
                type="button"
                className={`unified-rail-btn ${unifiedView === 'dm' ? 'active' : ''}`}
                onClick={() => setUnifiedView('dm')}
              >
                <span className="forge-row" style={{ gap: 6 }}><BookIcon size={14} /> DM Studio</span>
                <span className="badge">{store.campaign.entries.length}</span>
              </button>
            )}
            <button
              type="button"
              className={`unified-rail-btn ${unifiedView === 'vtt' ? 'active' : ''}`}
              onClick={() => setUnifiedView('vtt')}
            >
              <span className="forge-row" style={{ gap: 6 }}><MapIcon size={14} /> Tactical VTT</span>
              <span className="badge">{isCombatActive ? `Live R${store.encounter.round}` : `Rnd ${store.encounter.round}`}</span>
            </button>
            <div className="subpanel forge-stack" style={{ padding: '8px', gap: 6, marginTop: 4 }}>
              <div className="forge-row-between tabular" style={{ fontSize: 11 }}>
                <strong>HP {store.resolvedSheet.hp.current}/{store.resolvedSheet.hp.max}</strong>
                <span>AC {store.resolvedSheet.ac.final}</span>
              </div>
              <div className="forge-row" style={{ gap: 4 }}>
                <button type="button" className="btn" style={{ flex: 1, fontSize: 11 }} onClick={() => setShortRestOpen(true)}>
                  Short Rest
                </button>
                <button type="button" className="btn" style={{ flex: 1, fontSize: 11 }} onClick={() => store.takeRest('long_rest')}>
                  Long Rest
                </button>
              </div>
            </div>
            <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border-subtle)', margin: '4px 0' }} />
            <button type="button" className="unified-rail-btn" onClick={() => setBuilderOpen(true)}>
              <span>Build &amp; Stats</span>
            </button>
            <button type="button" className="unified-rail-btn" onClick={() => setGearOpen(true)}>
              <span className="forge-row" style={{ gap: 6 }}><BackpackIcon size={14} /> Gear &amp; Spells</span>
              <span className="badge">{store.resolvedSheet.attunementCount}/3</span>
            </button>
            {!isPlayerRole && (
              <button type="button" className="unified-rail-btn" onClick={() => setEncounterBuilderOpen(true)}>
                <span>Encounter Forge</span>
              </button>
            )}
            <button type="button" className="unified-rail-btn" onClick={() => setPaletteOpen(true)}>
              <span>Compendium / PDF</span>
            </button>
          </nav>

          <div className="unified-main-with-combat">
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}>
              {unifiedView !== 'sheet' && (
                <div
                  className="subpanel forge-row-between"
                  style={{
                    margin: '10px 14px 0',
                    padding: '6px 10px',
                    flexWrap: 'wrap',
                    gap: 8,
                    flexShrink: 0,
                  }}
                >
                  <div className="forge-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="badge tabular">
                      Round {store.encounter.round} • Turn:{' '}
                      {store.encounter.combatants[store.encounter.activeTurnIndex]?.name ?? 'None'}
                    </span>
                    {store.consoleLines.length > 0 && (
                      <span className="forge-muted" style={{ fontSize: 11, maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Latest: {store.consoleLines[store.consoleLines.length - 1]?.text}
                      </span>
                    )}
                  </div>
                  <button type="button" className="btn" onClick={() => setUnifiedView('sheet')}>
                    ← Play Sheet
                  </button>
                </div>
              )}
              {unifiedView === 'sheet' && (
                <div className="unified-sheet-split" style={{ flex: 1, minHeight: 0 }}>
                  {vitalsNode}
                  {actionBoardNode}
                </div>
              )}
              {unifiedView === 'dm' && !isPlayerRole && (
                <div className="pane" style={{ padding: 14, flex: 1, minHeight: 0 }}>
                  <Suspense fallback={null}>
                    <DmHubModal isOpen embedded onClose={() => setUnifiedView('sheet')} {...sharedDmHubProps} />
                  </Suspense>
                </div>
              )}
              {(unifiedView === 'vtt' || (unifiedView === 'dm' && isPlayerRole)) && (
                <div className="pane center-stage-pane" style={{ padding: '10px 14px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="subpanel forge-row-between" style={{ padding: '6px 10px', flexWrap: 'wrap', gap: 8, flexShrink: 0 }}>
                    <div className="pill-row tabular">
                      <span className="badge">
                        HP {store.resolvedSheet.hp.current}/{store.resolvedSheet.hp.max}
                        {store.resolvedSheet.hp.temp > 0 ? ` (+${store.resolvedSheet.hp.temp})` : ''}
                      </span>
                      <span className="badge">AC {store.resolvedSheet.ac.final}</span>
                      <button type="button" className="btn" onClick={store.rollCharacterInitiative}>
                        Init {store.resolvedSheet.initiative.final >= 0 ? `+${store.resolvedSheet.initiative.final}` : store.resolvedSheet.initiative.final}
                      </button>
                      <span className="badge">Speed {store.resolvedSheet.speed.final}ft</span>
                    </div>
                    <div className="forge-row" style={{ gap: 4 }}>
                      <button type="button" className="btn btn-danger" onClick={() => store.adjustHp(-5)}>
                        -5 HP
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => store.adjustHp(5)}>
                        +5 HP
                      </button>
                    </div>
                  </div>
                  <div className="center-battlemap-slot" style={{ flexShrink: 0 }}>
                    <Suspense fallback={null}>
                      <BattlemapModal
                        isOpen
                        embeddedFull
                        onClose={() => setUnifiedView('sheet')}
                        {...sharedBattlemapProps}
                        playerView={effectivePlayerView}
                      />
                    </Suspense>
                  </div>
                  {actionBoardNode}
                </div>
              )}
            </div>
            {rightSlotNode}
          </div>
        </div>
      )}

      <StatusConsole
        lines={store.consoleLines}
        consoleSize={consoleSize}
        onCycleConsoleSize={() =>
          setConsoleSize((s) => (s === 'normal' ? 'expanded' : s === 'expanded' ? 'collapsed' : 'normal'))
        }
        onClearLog={store.clearConsoleLog}
        onRollExpression={store.rollInlineExpression}
      />

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
          setPaletteInitialCat('all');
          setPaletteInitialRuleset('all');
        }}
        isPlayerRole={isPlayerRole}
        initialCategory={paletteInitialCat}
        initialRuleset={paletteInitialRuleset}
        ownedItemNames={store.rawChar.items.map((i) => i.name)}
        characterClasses={store.rawChar.classes.map((c) => c.className)}
        maxCastableSpellLevel={Math.max(
          0,
          ...store.resolvedSheet.resources
            .filter((r) => r.max > 0 && /^spell_slot_(\d+)$/.test(r.id))
            .map((r) => Number.parseInt(r.id.replace('spell_slot_', ''), 10)),
          ...(store.resolvedSheet.resources.some((r) => r.max > 0 && (r.id === 'pact_magic' || r.id === 'auto_class_pact_magic'))
            ? [
                Math.min(
                  5,
                  Math.ceil(
                    store.rawChar.classes
                      .filter((c) => c.casterProgression === 'pact')
                      .reduce((s, c) => s + c.level, 0) / 2
                  )
                ),
              ]
            : [])
        )}
        searchCompendium={store.searchCompendium}
        onAddCompendiumItem={store.addCompendiumItemToSheet}
        onInstallContentPack={store.installContentPack}
        onImportDdbPdf={store.importDdbPdfFile}
        onImportHomebrew={store.importMarkdownHomebrew}
        onImportJsonText={store.importJsonFilePayload}
      />

      <Suspense fallback={null}>
        <CharacterBuilderDrawer
          isOpen={builderOpen}
          character={store.rawChar}
          canDelete={store.characterList.length > 1}
          onClose={() => setBuilderOpen(false)}
          onUpdateCharacter={store.persistCharacter}
          onApplySubclassGrants={store.applySubclassGrants}
          onOpenLevelUp={() => setLevelUpOpen(true)}
          onDuplicateCharacter={store.duplicateCharacter}
          onDeleteCharacter={() => store.deleteCharacter(store.rawChar.id)}
          onLog={store.appendLog}
        />
      </Suspense>

      <Suspense fallback={null}>
        <NewCharacterModal
          isOpen={newCharOpen}
          onClose={() => setNewCharOpen(false)}
          compendiumEntities={store.compendium}
          onCreate={store.createCharacterFromPreset}
        />
      </Suspense>

      <Suspense fallback={null}>
        <CharacterManagerModal
          isOpen={charManagerOpen}
          onClose={() => setCharManagerOpen(false)}
          characters={store.characterList}
          activeCharacterId={store.rawChar.id}
          onSelectCharacter={(id) => store.switchCharacter(id)}
          onOpenNewCharacter={() => setNewCharOpen(true)}
          onOpenBuilderForActive={() => setBuilderOpen(true)}
          onDuplicateCharacter={store.duplicateCharacter}
          onDeleteCharacter={store.deleteCharacter}
          onImportDdbPdf={store.importDdbPdfFile}
          onImportCharacterJson={store.importSingleCharacter}
          onExportMarkdown={(c) => {
            const lines = [
              `# ${c.name}`,
              `*${c.species} • ${c.classes.map((cl) => `${cl.className}${cl.subclassName ? ` (${cl.subclassName})` : ''} ${cl.level}`).join(' / ')} • ${c.background} (${c.ruleset})*`,
              '',
              `**HP:** ${c.hp.current}/${c.hp.max}${c.hp.temp ? ` (+${c.hp.temp} temp)` : ''}`,
              c.speeds ? `**Speeds:** Walk ${c.speeds.walk ?? 30}ft${c.speeds.fly ? `, Fly ${c.speeds.fly}ft` : ''}${c.speeds.swim ? `, Swim ${c.speeds.swim}ft` : ''}${c.speeds.climb ? `, Climb ${c.speeds.climb}ft` : ''}${c.speeds.burrow ? `, Burrow ${c.speeds.burrow}ft` : ''}` : '',
              c.senses ? `**Senses:** ${Object.entries(c.senses).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${k} ${v}ft`).join(', ') || 'Normal'}` : '',
              '',
              '## Ability Scores',
              ...(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((ab) => {
                const score = c.baseAbilities[ab] + c.bonusAbilities[ab];
                const mod = Math.floor((score - 10) / 2);
                return `- **${ab.toUpperCase()}:** ${score} (${mod >= 0 ? `+${mod}` : mod})`;
              }),
              '',
              c.structuredProficiencies
                ? `## Proficiencies & Languages\n- **Armor:** ${c.structuredProficiencies.armor.join(', ') || '—'}\n- **Weapons:** ${c.structuredProficiencies.weapons.join(', ') || '—'}\n- **Tools:** ${c.structuredProficiencies.tools.join(', ') || '—'}\n- **Languages:** ${c.structuredProficiencies.languages.join(', ') || 'Common'}\n`
                : '',
              '## Spells, Gear & Features',
              ...c.items.map((it) => `- **${it.name}** (${it.category})${it.entries[0] ? `: ${it.entries[0]}` : ''}`),
            ].filter(Boolean);
            const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'character'}.md`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          onPushToCampaignRepo={store.pushCharacterToCampaignRepo}
          campaignRepoLabel={
            store.campaign.externalRepo
              ? `${store.campaign.externalRepo.owner}/${store.campaign.externalRepo.repo}`
              : undefined
          }
        />
      </Suspense>

      <Suspense fallback={null}>
        <LevelUpModal
          isOpen={levelUpOpen}
          character={store.rawChar}
          compendiumEntities={store.compendium}
          onClose={() => setLevelUpOpen(false)}
          onApplyLevelUp={store.applyLevelUpPlan}
        />
      </Suspense>

      <Suspense fallback={null}>
        <LiveTableModal
          isOpen={liveTableOpen}
          onClose={() => setLiveTableOpen(false)}
          activeCharacter={store.rawChar}
          liveStatus={store.liveStatus}
          onHostLocalRoom={store.hostLocalTable}
          onJoinLocalRoom={store.joinLocalTable}
          onCreateWebRtcInvite={store.createWebRtcInvite}
          onAcceptWebRtcInvite={store.acceptWebRtcInvite}
          onCompleteWebRtcLink={store.completeWebRtcLink}
          onDisconnect={store.disconnectLiveTable}
          onPushEncounter={store.pushEncounterToPeers}
          onShareCharacterToPeers={store.shareActiveCharacterToPeers}
          onImportCharacter={store.importSingleCharacter}
          onSendRollRequest={store.sendRollRequestToPeers}
          pcTokens={store.encounter.combatants
            .filter((c) => c.kind === 'pc')
            .map((c) => ({ id: c.id, name: c.name }))}
          claimedTokenId={store.claimedTokenId}
          onClaimToken={store.claimCombatantToken}
          onLog={store.appendLog}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EquipmentSpellDrawer
          isOpen={gearOpen}
          items={store.rawChar.items}
          attunementCount={store.resolvedSheet.attunementCount}
          strScore={store.resolvedSheet.abilities.str.score.final}
          preparedCount={store.resolvedSheet.spellcasting.preparedCount}
          maxPrepared={store.resolvedSheet.spellcasting.maxPrepared}
          currency={store.rawChar.currency}
          notes={store.rawChar.notes}
          structuredProficiencies={store.rawChar.structuredProficiencies}
          details={store.rawChar.details}
          onClose={() => setGearOpen(false)}
          onToggleEquipped={store.toggleItemEquipped}
          onTogglePrepared={store.toggleItemPrepared}
          onToggleAttuned={store.toggleItemAttuned}
          onUpdateQuantity={store.updateItemQuantity}
          onUpdateContainer={store.updateItemContainer}
          onDepositToPartyStash={store.depositItemToPartyStash}
          onRemoveItem={store.removeSheetItem}
          onUpdateCurrency={store.updateCurrency}
          onSimplifyCurrency={store.simplifyCurrency}
          onUpdateNotes={store.updateCharacterNotes}
          onUpdateStructuredProficiencies={store.updateStructuredProficiencies}
          onUpdateDetails={store.updateDetails}
          onCreateHomebrew={store.createHomebrewEntity}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ShortRestModal
          isOpen={shortRestOpen}
          onClose={() => setShortRestOpen(false)}
          sheet={store.resolvedSheet}
          classes={store.rawChar.classes}
          onSpendHitDice={store.spendHitDiceBulk}
          onCompleteShortRest={() => store.takeRest('short_rest')}
        />
      </Suspense>

      <Suspense fallback={null}>
        <BattlemapModal
          isOpen={battlemapOpen}
          onClose={() => setBattlemapOpen(false)}
          {...sharedBattlemapProps}
        />

        <DmHubModal
          isOpen={dmHubOpen}
          onClose={() => setDmHubOpen(false)}
          {...sharedDmHubProps}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EncounterBuilderModal
          isOpen={encounterBuilderOpen}
          onClose={() => setEncounterBuilderOpen(false)}
          partyLevels={store.characterList.map((c) => c.classes.reduce((s, cl) => s + cl.level, 0))}
          compendiumMonsters={store.compendium.filter((e) => e.category === 'monster')}
          onSpawnMonsters={(monsters) => {
            for (const m of monsters) {
              if (!m.monsterMeta) continue;
              store.addMonsterToEncounter(
                m.name,
                m.monsterMeta.ac,
                m.monsterMeta.hp,
                m.monsterMeta.dexModifier,
                m.activities,
                m.monsterMeta.cr,
                m.monsterMeta,
                m.entries.join(' '),
                m.imageUrl
              );
            }
          }}
          onCreateCustomMonster={(entity) => {
            void store.createHomebrewEntity(entity, false);
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <MonsterStatblockModal
          combatant={inspectedCombatant}
          playerView={playerView}
          onClose={() => setInspectedCombatantId(null)}
          onTriggerActivity={store.triggerCombatantActivity}
          onAdjustLegendary={store.adjustLegendaryActions}
          onToggleOrRollRecharge={store.toggleOrRollRecharge}
        />

        <SettingsModal
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          uiMode={uiMode}
          onChangeUiMode={setUiMode}
          rulesetPresetLabel={(() => {
            const p = detectRulesetPreset(store.houseRules);
            return p === '2014' ? '2014 Classic' : p === '2024' ? '2024 Revised' : 'Custom Mix';
          })()}
          onOpenRulesetModal={() => setRulesetOpen(true)}
          activeThemeName={activeTheme.name}
          onOpenThemeStudio={() => setThemeStudioOpen(true)}
          onExportBackup={handleExport}
          onExportActiveCharacter={handleExportActiveCharacter}
        />

        <RulesetModal
          isOpen={rulesetOpen}
          onClose={() => setRulesetOpen(false)}
          houseRules={store.houseRules}
          onUpdateHouseRules={store.updateHouseRules}
        />

        <ThemeStudioModal
          isOpen={themeStudioOpen}
          onClose={() => setThemeStudioOpen(false)}
          activeTheme={activeTheme}
          customThemes={customThemes}
          onApplyTheme={handleApplyTheme}
          onSaveCustomTheme={handleSaveCustomTheme}
          onDeleteCustomTheme={handleDeleteCustomTheme}
          activeLayout={activeLayout}
          onApplyLayout={handleChangeLayout}
          onEnterLayoutEditor={() => {
            setModularEnabled(true);
            setIsEditingLayout(true);
          }}
          houseRules={store.houseRules}
          onUpdateHouseRules={store.updateHouseRules}
          onLog={store.appendLog}
        />
      </Suspense>

      <ModalDialog
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard Shortcuts & Quick Tips"
      >
        <div className="forge-stack">
          <div className="card forge-stack">
            <div className="card-header">
              <div className="forge-section-label">KEYBOARD SHORTCUTS</div>
            </div>
            <div className="forge-list-row">
              <span>Open Compendium, Packs &amp; PDF Importer</span>
              <span className="badge tabular">Ctrl + K</span>
            </div>
            <div className="forge-list-row">
              <span>Undo / Redo last sheet or combat edit</span>
              <span className="badge tabular">Ctrl + Z / Ctrl + Y</span>
            </div>
            <div className="forge-list-row">
              <span>Nudge selected Battlemap token 1 cell</span>
              <span className="badge tabular">Arrow Keys</span>
            </div>
            <div className="forge-list-row">
              <span>Close active modal or dialog</span>
              <span className="badge tabular">Esc</span>
            </div>
          </div>
          <div className="card forge-stack">
            <div className="card-header">
              <div className="forge-section-label">QUICK WORKFLOW TIPS</div>
            </div>
            <div className="forge-muted">
              • Switch anytime between <strong>Beyond Classic</strong> and <strong>Unified Command</strong> in the topbar.<br />
              • Click the character crest in Classic mode to upload a custom portrait (auto-syncs to Battlemap tokens).<br />
              • Use <strong>Target</strong> in the Combat Drawer or Battlemap to roll attacks/saves directly against enemies.
            </div>
          </div>
        </div>
      </ModalDialog>

      <ToastStack
        toasts={store.toasts}
        suppressToasts={
          paletteOpen ||
          builderOpen ||
          gearOpen ||
          newCharOpen ||
          battlemapOpen ||
          settingsOpen ||
          levelUpOpen ||
          liveTableOpen ||
          dmHubOpen ||
          encounterBuilderOpen ||
          shortcutsOpen ||
          Boolean(inspectedCombatantId)
        }
        onDismiss={store.dismissToast}
      />

      <section className="print-session-packet" aria-hidden="true">
        <h1>{store.campaign.name} — Session Prep Packet</h1>
        <p>
          Setting: {store.campaign.setting} • Day {store.campaign.clock.day},{' '}
          {String(store.campaign.clock.hour).padStart(2, '0')}:
          {String(store.campaign.clock.minute).padStart(2, '0')} ({store.campaign.clock.weather})
        </p>
        <h2>Active Character: {store.rawChar.name}</h2>
        <p>
          {store.rawChar.species} • {classSummary} • Lvl {charLevel} • AC {store.resolvedSheet.ac.final} • HP {store.resolvedSheet.hp.current}/{store.resolvedSheet.hp.max} • Walk {store.resolvedSheet.speeds.walk}ft
          {store.resolvedSheet.speeds.fly > 0 ? `, Fly ${store.resolvedSheet.speeds.fly}ft` : ''}
          {store.resolvedSheet.speeds.swim > 0 ? `, Swim ${store.resolvedSheet.speeds.swim}ft` : ''}
          {store.resolvedSheet.senses.darkvision > 0 ? ` • Darkvision ${store.resolvedSheet.senses.darkvision}ft` : ''}
        </p>
        {store.rawChar.structuredProficiencies && (
          <p style={{ fontSize: 12 }}>
            <strong>Proficiencies:</strong>{' '}
            {[
              store.rawChar.structuredProficiencies.armor.length ? `Armor (${store.rawChar.structuredProficiencies.armor.join(', ')})` : '',
              store.rawChar.structuredProficiencies.weapons.length ? `Weapons (${store.rawChar.structuredProficiencies.weapons.join(', ')})` : '',
              store.rawChar.structuredProficiencies.tools.length ? `Tools (${store.rawChar.structuredProficiencies.tools.join(', ')})` : '',
              store.rawChar.structuredProficiencies.languages.length ? `Languages (${store.rawChar.structuredProficiencies.languages.join(', ')})` : '',
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>
        )}
        {store.rawChar.details && (
          <p style={{ fontSize: 12 }}>
            {[
              store.rawChar.details.alignment,
              store.rawChar.details.traits ? `Traits: ${store.rawChar.details.traits}` : '',
              store.rawChar.details.ideals ? `Ideals: ${store.rawChar.details.ideals}` : '',
              store.rawChar.details.bonds ? `Bonds: ${store.rawChar.details.bonds}` : '',
              store.rawChar.details.flaws ? `Flaws: ${store.rawChar.details.flaws}` : '',
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>
        )}
        <h2>Campaign Binder ({store.campaign.entries.length} Entries)</h2>
        {store.campaign.entries.map((entry) => (
          <div key={entry.id} style={{ marginBottom: 10, borderBottom: '1px solid #ccc', paddingBottom: 6 }}>
            <strong>
              [{entry.category.toUpperCase()}] {entry.title}
            </strong>{' '}
            — {entry.summary}
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{entry.body}</div>
          </div>
        ))}
        <h2>Active Encounter: {store.encounter.name} (Round {store.encounter.round})</h2>
        <ul>
          {store.encounter.combatants.map((c) => (
            <li key={c.id}>
              {c.name} — Init {c.initiative}, AC {c.ac}, HP {c.hp.current}/{c.hp.max}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
