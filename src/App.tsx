import React, { useEffect, useState } from 'react';
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
        { id: 'cloak-ac', target: 'ac.bonus', value: 1 },
        { id: 'cloak-save', target: 'save.all', value: 1 },
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong>D&amp;D FORGE // LOCAL VTT</strong>
          <select
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
            className="btn"
            onClick={() => void store.createNewCharacter(`Hero ${store.characterList.length + 1}`)}
          >
            + New Char
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => setBuilderOpen(true)}>
            Build / Level Up
          </button>
          <button type="button" className="btn" onClick={() => setGearOpen(true)}>
            Gear &amp; Spells ({store.resolvedSheet.attunementCount}/3 Attuned)
          </button>
          <button type="button" className="btn" onClick={() => setPaletteOpen(true)}>
            Packs / PDF / Import (Ctrl+K)
          </button>
          <button type="button" className="btn" onClick={handleExport}>
            Export JSON
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <VitalsColumn
          sheet={store.resolvedSheet}
          onAdjustHp={store.adjustHp}
          onSetTempHp={store.setTempHp}
          onUpdateDeathSaves={store.updateDeathSaves}
          onAdjustResource={store.adjustResourcePool}
          onAddResource={store.addCustomResourcePool}
          onSetAcOverride={(val) => store.setStatOverride('ac', val)}
          onRollInitiative={store.rollCharacterInitiative}
          onToggleCondition={store.toggleCondition}
          onTakeRest={store.takeRest}
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
          onNextTurn={store.stepCombatTurn}
          onResetEncounter={store.resetEncounter}
          onAdjustCombatantHp={store.adjustCombatantHp}
          onSetCombatantInitiative={store.setCombatantInitiative}
          onToggleCombatantCondition={store.toggleCombatantCondition}
          onRemoveCombatant={store.removeCombatant}
          onTriggerCombatantActivity={store.triggerCombatantActivity}
          onDropConcentration={store.dropConcentration}
          onAddMonster={store.addMonsterToEncounter}
        />
      </div>

      <StatusConsole
        lines={store.consoleLines}
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
        onClose={() => setBuilderOpen(false)}
        onUpdateCharacter={store.persistCharacter}
        onLog={store.appendLog}
      />

      <EquipmentSpellDrawer
        isOpen={gearOpen}
        items={store.rawChar.items}
        attunementCount={store.resolvedSheet.attunementCount}
        onClose={() => setGearOpen(false)}
        onToggleEquipped={store.toggleItemEquipped}
        onTogglePrepared={store.toggleItemPrepared}
        onToggleAttuned={store.toggleItemAttuned}
        onRemoveItem={store.removeSheetItem}
      />
    </div>
  );
}
