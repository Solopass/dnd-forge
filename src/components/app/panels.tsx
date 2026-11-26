import { Suspense } from 'react';
import { VitalsColumn } from '../VitalsColumn';
import { ActionEconomyBoard } from '../ActionEconomyBoard';
import { SummonCombatDrawer } from '../SummonCombatDrawer';
import { BUILTIN_CONTENT_PACKS } from '../../engine/srd-packs';
import { evaluateDiceExpression } from '../../engine/dice';
import { ItemInspectorPanel } from './lazy';
import type { AppUi } from './useAppUiState';
import type { SheetStore } from './types';

/**
 * The pieces every layout shares (vitals, action board, combat drawer, right slot, battlemap and
 * DM hub props). Plain function, no hooks: fix a shared panel here once for all three layouts.
 */
export function buildAppPanels(store: SheetStore, ui: AppUi) {
  const {
    setPaletteOpen,
    setBuilderOpen,
    setGearOpen,
    setBattlemapOpen,
    setShortRestOpen,
    setPaletteInitialCat,
    setPaletteInitialRuleset,
    setEncounterBuilderOpen,
    selectedTargetIds,
    setSelectedTargetIds,
    setPlayerView,
    setInspectedCombatantId,
    rightTab,
    setRightTab,
    setInspectedItemId,
    uiMode,
    unifiedView,
    setUnifiedView,
    setShowClassicCombat,
    isPlayerRole,
    effectivePlayerView,
    inspectedItem,
    isInDmStudio,
  } = ui;

  const rollCheck = (label: string, mod: number) => {
    const sign = mod >= 0 ? '+' : '';
    const res = evaluateDiceExpression(`1d20${sign}${mod}`, store.rollMode);
    store.appendLog(`${label} (${res.mode}): ${res.total}`, res.isCrit ? 'crit' : 'roll');
  };

  type TriggerArgs = Parameters<SheetStore['triggerActivity']>;
  const triggerActivity = (act: TriggerArgs[0], slot: TriggerArgs[1], ritual: TriggerArgs[2]) =>
    store.triggerActivity(act, slot, ritual, selectedTargetIds);

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
      onRollCheck={rollCheck}
    />
  );

  const actionBoardNode = (
    <ActionEconomyBoard
      sheet={store.resolvedSheet}
      rawChar={store.rawChar}
      layoutVariant={uiMode}
      rollMode={store.rollMode}
      onChangeRollMode={store.setRollMode}
      onTriggerActivity={triggerActivity}
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
      onRollCheck={rollCheck}
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
        setPaletteInitialRuleset('all');
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
      onStartEncounterAlert={store.startEncounterAlert}
      compendiumMonsters={store.effectiveCompendium.filter((e) => e.category === 'monster' && Boolean(e.monsterMeta))}
      hideBattlemapButton={uiMode === 'unified' && unifiedView === 'vtt'}
      onAddMonster={store.addMonsterToEncounter}
    />
  );


  const rightSlotNode = isInDmStudio ? (
    combatDrawerNode
  ) : (
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
              onTriggerActivity={triggerActivity}
              onRollInlineExpression={store.rollInlineExpression}
              onToggleEquipped={store.toggleItemEquipped}
              onTogglePrepared={store.toggleItemPrepared}
              onToggleAttuned={store.toggleItemAttuned}
              onUpdateQuantity={store.updateItemQuantity}
              onUpdateContainer={store.updateItemContainer}
              onDepositToPartyStash={store.depositItemToPartyStash}
              onUpdateMagic={store.updateItemMagic}
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
    playerView: effectivePlayerView,
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
    onPromptPartyRoll: store.sendRollRequestToPeers,
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
    },
    onPrintPacket: () => {
      document.body.classList.add('print-session-mode');
      const cleanup = () => document.body.classList.remove('print-session-mode');
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      setTimeout(cleanup, 1500);
    },
  };

  return {
    triggerActivity,
    rollCheck,
    vitalsNode,
    actionBoardNode,
    combatDrawerNode,
    rightSlotNode,
    sharedBattlemapProps,
    sharedDmHubProps,
  };
}

export type AppPanels = ReturnType<typeof buildAppPanels>;
