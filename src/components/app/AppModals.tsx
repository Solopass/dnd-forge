import { Suspense } from 'react';
import { StatusConsole, CommandPalette } from '../SummonCombatDrawer';
import { ModalDialog } from '../ModalDialog';
import { ToastStack } from '../ToastStack';
import { detectRulesetPreset } from '../../engine/ruleset-config';
import {
  BattlemapModal,
  CharacterBuilderDrawer,
  CharacterManagerModal,
  DmHubModal,
  EncounterBuilderModal,
  EquipmentSpellDrawer,
  LevelUpModal,
  LiveTableModal,
  MonsterStatblockModal,
  NewCharacterModal,
  RulesetModal,
  SettingsModal,
  ShortRestModal,
  ThemeStudioModal,
} from './lazy';
import type { AppLayoutProps } from './types';

export function AppModals({ store, ui, panels }: AppLayoutProps) {
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
    effectivePlayerView,
    inspectedCombatantId,
    setInspectedCombatantId,
    uiMode,
    setUiMode,
    shortcutsOpen,
    setShortcutsOpen,
    consoleSize,
    setConsoleSize,
    inspectedPcId,
    setInspectedPcId,
    inspectedCombatant,
    isPlayerRole,
    handleApplyTheme,
    handleSaveCustomTheme,
    handleDeleteCustomTheme,
    handleChangeLayout,
    setModularEnabled,
    handleExportActiveCharacter,
    handleExport,
  } = ui;
  const {
    vitalsNode,
    actionBoardNode,
    sharedBattlemapProps,
    sharedDmHubProps,
  } = panels;
  return (
    <>
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
          playerView={effectivePlayerView}
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
    </>
  );
}
