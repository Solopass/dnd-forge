import { useEffect, useRef, useState } from 'react';
import './styles/tokens.css';
import './styles/layout.css';
import { useSheetStore } from './state/useSheetStore';
import { VitalsColumn } from './components/VitalsColumn';
import { ActionEconomyBoard } from './components/ActionEconomyBoard';
import {
  CommandPalette,
  StatusConsole,
  SummonCombatDrawer,
} from './components/SummonCombatDrawer';
import { CharacterBuilderDrawer } from './components/CharacterBuilderDrawer';
import { EquipmentSpellDrawer } from './components/EquipmentSpellDrawer';
import { NewCharacterModal } from './components/NewCharacterModal';
import { BattlemapModal } from './components/BattlemapModal';
import { SettingsModal } from './components/SettingsModal';
import { LevelUpModal } from './components/LevelUpModal';
import { LiveTableModal } from './components/LiveTableModal';
import { DmHubModal } from './components/DmHubModal';
import { MonsterStatblockModal } from './components/MonsterStatblockModal';
import { EncounterBuilderModal } from './components/EncounterBuilderModal';
import { ToastStack } from './components/ToastStack';
import { BUILTIN_CONTENT_PACKS } from './engine/srd-packs';
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
  const [levelUpOpen, setLevelUpOpen] = useState(false);
  const [liveTableOpen, setLiveTableOpen] = useState(false);
  const [dmHubOpen, setDmHubOpen] = useState(false);
  const [encounterBuilderOpen, setEncounterBuilderOpen] = useState(false);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [playerView, setPlayerView] = useState(false);
  const [inspectedCombatantId, setInspectedCombatantId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'vitals' | 'actions' | 'combat'>('vitals');
  const inspectedCombatant =
    inspectedCombatantId ? (store.encounter.combatants.find((c) => c.id === inspectedCombatantId) ?? null) : null;
  const [consoleSize, setConsoleSize] = useState<'normal' | 'expanded' | 'collapsed'>('normal');
  const mobileTablistRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className={shellClass}>
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong>D&amp;D FORGE // LOCAL VTT</strong>
          <select
            aria-label="Active character"
            value={store.rawChar.id}
            onChange={(e) => void store.switchCharacter(e.target.value)}
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '3px 8px' }}
          >
            {store.characterList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (Lvl {c.classes.reduce((s, x) => s + x.level, 0)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setNewCharOpen(true)}
          >
            + New Char
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            className="btn"
            disabled={!store.canUndo}
            onClick={store.undo}
            title="Undo last sheet or combat change (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="btn"
            disabled={!store.canRedo}
            onClick={store.redo}
            title="Redo change (Ctrl+Y)"
          >
            Redo
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setLevelUpOpen(true)}>
            Level Up
          </button>
          <button type="button" className="btn" onClick={() => setBuilderOpen(true)}>
            Build / Stats
          </button>
          <button type="button" className="btn" onClick={() => setGearOpen(true)}>
            Gear &amp; Spells ({store.resolvedSheet.attunementCount}/3 Attuned)
          </button>
          <button type="button" className="btn" onClick={() => setPaletteOpen(true)}>
            Packs / PDF / Import (Ctrl+K)
          </button>
          <button type="button" className="btn" onClick={() => setDmHubOpen(true)}>
            DM Hub
          </button>
          <button type="button" className="btn" onClick={() => setBattlemapOpen(true)}>
            Battlemap
          </button>
          <button
            type="button"
            className={`btn ${store.liveStatus.role !== 'idle' ? 'btn-primary' : ''}`}
            onClick={() => setLiveTableOpen(true)}
          >
            Live Table{store.liveStatus.role !== 'idle' ? ` (${store.liveStatus.peers.length + 1})` : ''}
          </button>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
            Theme / Print
          </button>
        </div>
      </header>

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

      <div className="workspace-grid" data-active-tab={mobileTab}>
        <VitalsColumn
          sheet={store.resolvedSheet}
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
          onSpendHitDie={store.spendHitDie}
          onRollCheck={(label, mod) => {
            const sign = mod >= 0 ? '+' : '';
            const res = evaluateDiceExpression(`1d20${sign}${mod}`, store.rollMode);
            store.appendLog(`${label} (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
          }}
        />

        <ActionEconomyBoard
          sheet={store.resolvedSheet}
          rollMode={store.rollMode}
          onChangeRollMode={store.setRollMode}
          onTriggerActivity={store.triggerActivity}
          onRollInlineExpression={store.rollInlineExpression}
        />

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
          onOpenBattlemap={() => setBattlemapOpen(true)}
          onNextTurn={store.stepCombatTurn}
          onResetEncounter={store.resetEncounter}
          onAdjustCombatantHp={store.adjustCombatantHp}
          onSetCombatantInitiative={store.setCombatantInitiative}
          onToggleCombatantCondition={store.toggleCombatantCondition}
          onToggleCombatantEconomy={store.toggleCombatantEconomy}
          onRemoveCombatant={store.removeCombatant}
          playerView={playerView}
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
          onAddMonster={store.addMonsterToEncounter}
        />
      </div>

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
        onClose={() => setPaletteOpen(false)}
        searchCompendium={store.searchCompendium}
        onAddCompendiumItem={store.addCompendiumItemToSheet}
        onInstallContentPack={store.installContentPack}
        onImportDdbPdf={store.importDdbPdfFile}
        onImportHomebrew={store.importMarkdownHomebrew}
        onImportJsonText={store.importJsonFilePayload}
      />

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

      <NewCharacterModal
        isOpen={newCharOpen}
        onClose={() => setNewCharOpen(false)}
        onCreate={store.createCharacterFromPreset}
      />

      <LevelUpModal
        isOpen={levelUpOpen}
        character={store.rawChar}
        onClose={() => setLevelUpOpen(false)}
        onApplyLevelUp={store.applyLevelUpPlan}
      />

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
        onLog={store.appendLog}
      />

      <EquipmentSpellDrawer
        isOpen={gearOpen}
        items={store.rawChar.items}
        attunementCount={store.resolvedSheet.attunementCount}
        strScore={store.resolvedSheet.abilities.str.score.final}
        preparedCount={store.resolvedSheet.spellcasting.preparedCount}
        maxPrepared={store.resolvedSheet.spellcasting.maxPrepared}
        currency={store.rawChar.currency}
        notes={store.rawChar.notes}
        onClose={() => setGearOpen(false)}
        onToggleEquipped={store.toggleItemEquipped}
        onTogglePrepared={store.toggleItemPrepared}
        onToggleAttuned={store.toggleItemAttuned}
        onUpdateQuantity={store.updateItemQuantity}
        onRemoveItem={store.removeSheetItem}
        onUpdateCurrency={store.updateCurrency}
        onUpdateNotes={store.updateCharacterNotes}
        onCreateHomebrew={store.createHomebrewEntity}
      />

      <BattlemapModal
        isOpen={battlemapOpen}
        encounter={store.encounter}
        playerView={playerView}
        onTogglePlayerView={() => setPlayerView((v) => !v)}
        onClose={() => setBattlemapOpen(false)}
        onMoveToken={store.moveCombatantToken}
        onSetMapImage={store.setEncounterMapImage}
        onAddTemplate={store.addMapTemplate}
        onClearTemplates={store.clearMapTemplates}
        onToggleFogCells={store.toggleFogCells}
        onFillAllFog={store.fillAllFog}
        onClearAllFog={store.clearAllFog}
        onSetTerrainCell={store.setTerrainCell}
        onClearTerrain={store.clearTerrain}
        onUpdateMapSettings={store.updateEncounterMapSettings}
        onNextTurn={store.stepCombatTurn}
        scenes={store.scenes}
        onSaveScene={store.saveCurrentMapAsScene}
        onLoadScene={store.loadSceneToEncounter}
        onDeleteScene={store.deleteScene}
        onAddSketchStroke={store.addMapSketchStroke}
        onClearSketches={store.clearMapSketches}
        activePings={store.activePings}
        onPing={store.broadcastMapPing}
        selectedTargetIds={selectedTargetIds}
        onToggleTarget={(id) =>
          setSelectedTargetIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
          )
        }
        onSetTokenPortrait={store.setCombatantPortrait}
        onSetTokenVision={store.setCombatantVision}
        onOpenPopOutPlayer={() => {
          window.open('?player=1', 'dnd-forge-player-display', 'width=1280,height=800');
        }}
      />

      <DmHubModal
        isOpen={dmHubOpen}
        onClose={() => setDmHubOpen(false)}
        campaign={store.campaign}
        campaignList={store.campaignList}
        characterList={store.characterList}
        activeCharacterName={store.rawChar.name}
        activeCharacterGp={store.rawChar.currency?.gp ?? 0}
        encounter={store.encounter}
        onSwitchCampaign={store.switchCampaign}
        onCreateCampaign={store.createCampaign}
        onDeleteCampaign={store.deleteCampaign}
        onUpsertEntry={store.upsertCampaignEntry}
        onDeleteEntry={store.deleteCampaignEntry}
        onAdvanceClock={store.advanceCampaignClock}
        onAddTimer={store.addClockTimer}
        onSetWeather={store.setCampaignWeather}
        onAddPartyLoot={store.addPartyLoot}
        onDistributeGold={store.distributeGoldToParty}
        onBuyShopItem={store.buyShopItemForActiveCharacter}
        onAwardXp={store.awardPartyXp}
        onMilestoneLevelUp={store.triggerPartyMilestoneLevelUp}
        onRollExpression={store.rollInlineExpression}
        activeSharedHandout={store.activeSharedHandout}
        onShareHandout={store.shareHandoutToPlayers}
        onHideHandout={store.hideSharedHandout}
        onSetWorldMapImage={store.setWorldMapImage}
        onUpsertWorldMapPin={store.upsertWorldMapPin}
        onDeleteWorldMapPin={store.deleteWorldMapPin}
        onSpawnImprovEncounter={(enc) => {
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
        }}
        onPrintPacket={() => {
          document.body.classList.add('print-session-mode');
          window.print();
          setTimeout(() => document.body.classList.remove('print-session-mode'), 300);
        }}
      />

      <EncounterBuilderModal
        isOpen={encounterBuilderOpen}
        onClose={() => setEncounterBuilderOpen(false)}
        partyLevels={store.characterList.map((c) => c.classes.reduce((s, cl) => s + cl.level, 0))}
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
              m.entries.join(' ')
            );
          }
        }}
        onCreateCustomMonster={(entity) => {
          void store.createHomebrewEntity(entity, false);
        }}
      />

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
        onExportBackup={handleExport}
        onExportActiveCharacter={handleExportActiveCharacter}
      />

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
