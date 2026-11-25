import { Suspense } from 'react';
import { BattlemapModal, ModularCanvas } from '../lazy';
import type { AppLayoutProps } from '../types';

export function ModularLayout({ store, ui, panels }: AppLayoutProps) {
  const {
    setPaletteOpen,
    setBuilderOpen,
    setGearOpen,
    setThemeStudioOpen,
    isEditingLayout,
    setIsEditingLayout,
    activeLayout,
    setPaletteInitialCat,
    setPaletteInitialRuleset,
    isPlayerRole,
    handleChangeLayout,
  } = ui;
  const {
    combatDrawerNode,
    sharedBattlemapProps,
    triggerActivity,
  } = panels;
  return (
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
        onTriggerActivity={triggerActivity}
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
  );
}
