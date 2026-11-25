import { lazy, Suspense } from 'react';
import './styles/tokens.css';
import './styles/layout.css';
import { useSheetStore } from './state/useSheetStore';
import { CommandPalette, StatusConsole } from './components/SummonCombatDrawer';
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
  SwordsIcon,
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
const CharacterManagerModal = lazy(() =>
  import('./components/CharacterManagerModal').then((m) => ({ default: m.CharacterManagerModal }))
);
import { computeCharacterSheet } from './engine/rules-math';
import { detectRulesetPreset } from './engine/ruleset-config';
import type { DmHubTab } from './components/DmHubModal';
import { SEED_CHARACTER, SEED_ENCOUNTER } from './state/seed';
import { useAppUiState } from './components/app/useAppUiState';
import { buildAppPanels } from './components/app/panels';
import { TopBar } from './components/app/TopBar';
import { AppBanners } from './components/app/AppBanners';


export function App() {
  const store = useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER);
  const ui = useAppUiState(store);
  const {
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
    isEditingLayout,
    setIsEditingLayout,
    customThemes,
    activeTheme,
    activeLayout,
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
    dmHubOpen,
    setDmHubOpen,
    encounterBuilderOpen,
    setEncounterBuilderOpen,
    selectedTargetIds,
    centerStage,
    setCenterStage,
    playerView,
    inspectedCombatantId,
    setInspectedCombatantId,
    uiMode,
    setUiMode,
    unifiedView,
    setUnifiedView,
    showClassicCombat,
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
    isInDmStudio,
  } = ui;

  const {
    vitalsNode,
    actionBoardNode,
    combatDrawerNode,
    rightSlotNode,
    sharedBattlemapProps,
    sharedDmHubProps,
  } = buildAppPanels(store, ui);

  return (
    <div className={shellClass}>
      <TopBar store={store} ui={ui} />

      <AppBanners store={store} ui={ui} />

      {!isPlayerRole ? (
        <div className="dm-workspace-grid">
          <nav className="dm-left-rail" aria-label="DM Studio navigation">
            {(
              [
                ['party', 'Party & Sync'],
                ['binder', 'Campaign Binder'],
                ['clock', 'World Clock'],
                ['loot', 'Loot & Shops'],
                ['dmscreen', 'DM Screen'],
                ['xp', 'Party XP & Milestones'],
                ['improv', 'Improv'],
                ['worldmap', 'World Map'],
                ['soundboard', 'Soundboard'],
                ['battlemap', 'Tactical Battlemap'],
              ] as Array<[DmHubTab | 'battlemap', string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`unified-rail-btn ${dmSection === key ? 'active' : ''}`}
                onClick={() => setDmSection(key)}
              >
                <span>{label}</span>
              </button>
            ))}

            <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border-subtle)', margin: '6px 0' }} />
            <div className="forge-section-label" style={{ paddingLeft: 4, marginBottom: 2 }}>
              PARTY ({store.characterList.length})
            </div>
            {store.characterList.map((pc) => {
              const resolved = computeCharacterSheet(pc);
              return (
                <div key={pc.id} className="dm-party-mini-card">
                  <div className="forge-row-between" style={{ gap: 4 }}>
                    <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pc.name}
                    </strong>
                    <span className="badge tabular">AC {resolved.ac.final}</span>
                  </div>
                  <div className="forge-row-between tabular forge-muted" style={{ fontSize: 11 }}>
                    <span>HP {resolved.hp.current}/{resolved.hp.max}</span>
                    <span>PP {resolved.passivePerception}</span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    style={{ width: '100%', fontSize: 11, padding: '3px 6px' }}
                    onClick={() => void openPcSheetFromDm(pc.id)}
                  >
                    Open Sheet
                  </button>
                </div>
              );
            })}
          </nav>

          <main className="dm-center-stage">
            {dmSection === 'battlemap' ? (
              <Suspense fallback={null}>
                <BattlemapModal
                  isOpen
                  embeddedFull
                  onClose={() => setDmSection('party')}
                  {...sharedBattlemapProps}
                  playerView={effectivePlayerView}
                />
              </Suspense>
            ) : (
              <Suspense fallback={null}>
                <DmHubModal
                  isOpen
                  embedded
                  activeTab={dmSection}
                  onTabChange={(t) => setDmSection(t)}
                  onOpenCharacterSheet={(id) => void openPcSheetFromDm(id)}
                  onClose={() => {}}
                  {...sharedDmHubProps}
                />
              </Suspense>
            )}
          </main>

          {combatDrawerNode}
        </div>
      ) : modularMode ? (
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
              setPaletteInitialRuleset('all');
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
              {showCenterBattlemap ? (
                <div className="center-battlemap-slot" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
              ) : (
                actionBoardNode
              )}
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
            {!isInDmStudio && (
              <>
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
              </>
            )}
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
        onSyncFree5ePack={store.syncFree5ePack}
        free5eSyncing={store.free5eSyncing}
        free5eCount={store.compendium.filter((e) => e.id.startsWith('free5e-')).length}
        onImportDdbPdf={store.importDdbPdfFile}
        onImportHomebrew={store.importMarkdownHomebrew}
        onImportJsonText={store.importJsonFilePayload}
      />

      <ModalDialog
        wide
        isOpen={inspectedPcId !== null}
        onClose={() => setInspectedPcId(null)}
        title={`${store.rawChar.name} — Character Sheet (DM Inspector)`}
      >
        <div className="pc-sheet-modal-grid">
          {vitalsNode}
          {actionBoardNode}
        </div>
      </ModalDialog>

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
          onLaunchAndStart={(monsters) => {
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
            store.startEncounterAlert();
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
          onImportBackup={async (file) => {
            await store.importJsonFilePayload(await file.text());
          }}
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
