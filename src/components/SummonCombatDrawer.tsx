import { FormEvent, useEffect, useState } from 'react';
import { CombatEncounterState } from '../types/combat';
import { Activity, CompendiumEntity, CreatureSize, MonsterStatMeta } from '../types/compendium';
import { ActionEconomy, STANDARD_CONDITIONS } from '../types/core';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { extractSrdSpellcasterClasses, spellOnClassList } from '../engine/classes';
import { DuplicatesReview } from './DuplicatesReview';
import { ContentFixEditor } from './ContentFixEditor';
import { ContentFixesReview, type ContentFixApi } from './ContentFixesReview';
import { PacksPanel, type PackApi } from './PacksPanel';
import {
  dedupeCompendium,
  DEFAULT_SOURCE_PRIORITY,
  type DuplicateAction,
  type DuplicateDecision,
  type NearDuplicateGroup,
  type SourceTier,
} from '../engine/compendium-dedupe';
import { readStoredSourcePriority } from '../storage/source-priority';
import { CONDITION_RULES } from '../engine/conditions';
import { getQualitativeHealthLabel } from '../engine/dm-tools';
import { evaluateEncounterDifficulty } from '../engine/encounter-math';
import { ConsoleLine } from '../state/useSheetStore';
import { DiceIcon } from './Icons';
import { ModalDialog } from './ModalDialog';

interface SummonDrawerProps {
  encounter: CombatEncounterState;
  encounterList: CombatEncounterState[];
  partyLevels: number[];
  pendingConcDc: number | null;
  playerView: boolean;
  onTogglePlayerView: () => void;
  onSwitchEncounter: (id: string) => void;
  onCreateEncounter: (name: string) => Promise<void>;
  onDuplicateEncounter: () => Promise<void>;
  onDeleteEncounter: (id: string) => Promise<void>;
  onAddPartyToEncounter: () => void;
  onRollAllInitiative: () => void;
  onOpenBattlemap: () => void;
  onNextTurn: () => void;
  onResetEncounter: () => void;
  onInspectCombatant: (id: string) => void;
  onToggleCombatantHidden: (id: string) => void;
  onSetCombatantSize: (id: string, size: CreatureSize) => void;
  onAdjustLegendary: (id: string, delta: number) => void;
  onToggleOrRollRecharge: (id: string, abilityName: string) => void;
  onAddTimedEffect: (name: string, rounds: number) => void;
  onAdjustCombatantHp: (id: string, delta: number) => void;
  onSetCombatantInitiative: (id: string, initiative: number) => void;
  onMoveCombatantOrder?: (id: string, delta: -1 | 1) => void;
  onToggleCombatantCondition: (id: string, condition: string) => void;
  onToggleCombatantEconomy: (id: string, economy: ActionEconomy) => void;
  onRemoveCombatant: (id: string) => void;
  onTriggerCombatantActivity: (combatantName: string, act: Activity) => void;
  onDropConcentration: (sourceId: string) => void;
  onRollConcentrationSave: (dc?: number) => void;
  selectedTargetIds: string[];
  onToggleTarget: (id: string) => void;
  onClearTargets: () => void;
  onTargetAttack: (attackerName: string, targetIds: string[], act: Activity) => void;
  onTargetSave: (attackerName: string, targetIds: string[], act: Activity) => void;
  onOpenEncounterBuilder: () => void;
  onStartEncounterAlert?: () => void;
  compendiumMonsters?: CompendiumEntity[];
  hideBattlemapButton?: boolean;
  isPlayerRole?: boolean;
  onAddMonster: (
    name: string,
    ac: number,
    hp: number,
    dexMod: number,
    actions?: Activity[],
    cr?: string,
    extraMeta?: MonsterStatMeta,
    notes?: string
  ) => void;
}

function getCombatHpClass(current: number, max: number): string {
  if (max <= 0) return 'hp-low';
  const ratio = current / max;
  if (ratio > 0.5) return 'hp-high';
  if (ratio > 0.25) return 'hp-mid';
  return 'hp-low';
}

export function SummonCombatDrawer({
  encounter,
  encounterList,
  partyLevels,
  pendingConcDc,
  playerView,
  onTogglePlayerView,
  onSwitchEncounter,
  onCreateEncounter,
  onDuplicateEncounter,
  onDeleteEncounter,
  onAddPartyToEncounter,
  onRollAllInitiative,
  onOpenBattlemap,
  onNextTurn,
  onResetEncounter,
  onInspectCombatant,
  onToggleCombatantHidden,
  onSetCombatantSize,
  onAdjustLegendary,
  onToggleOrRollRecharge,
  onAddTimedEffect,
  onAdjustCombatantHp,
  onSetCombatantInitiative,
  onMoveCombatantOrder,
  onToggleCombatantCondition,
  onToggleCombatantEconomy,
  onRemoveCombatant,
  onTriggerCombatantActivity,
  onDropConcentration,
  onRollConcentrationSave,
  selectedTargetIds,
  onToggleTarget,
  onClearTargets,
  onTargetAttack,
  onTargetSave,
  onOpenEncounterBuilder,
  onStartEncounterAlert,
  compendiumMonsters,
  hideBattlemapButton = false,
  isPlayerRole = false,
  onAddMonster,
}: SummonDrawerProps) {
  const [showAddCreature, setShowAddCreature] = useState(false);
  const [showEffectForm, setShowEffectForm] = useState(false);
  const [mobName, setMobName] = useState('');
  const [mobAc, setMobAc] = useState('14');
  const [mobHp, setMobHp] = useState('32');
  const [mobCr, setMobCr] = useState('1');
  const [mobSearch, setMobSearch] = useState('');
  const [srdMobId, setSrdMobId] = useState('');
  const [effectNameInput, setEffectNameInput] = useState('');
  const [effectRoundsInput, setEffectRoundsInput] = useState('10');
  const [mobCond, setMobCond] = useState<string>('');
  const [hpDeltas, setHpDeltas] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const srdMonsters = dedupeCompendium(
    compendiumMonsters && compendiumMonsters.length > 0
      ? compendiumMonsters
      : BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).filter(
          (e) => e.category === 'monster' && e.monsterMeta
        ),
    readStoredSourcePriority()
  );
  const filteredSrdMonsters = srdMonsters
    .filter((m) => {
      const q = mobSearch.trim().toLowerCase();
      if (!q) return true;
      return `${m.name} ${m.monsterMeta?.cr ?? ''} ${m.ruleset}`.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 80);
  const visibleCombatants = playerView
    ? encounter.combatants.filter((c) => !c.hidden || c.kind === 'pc')
    : encounter.combatants;

  const monsterCrs = encounter.combatants
    .filter((c) => c.kind === 'monster')
    .map((c) => c.cr ?? '1');
  const difficulty =
    monsterCrs.length > 0 ? evaluateEncounterDifficulty(partyLevels, monsterCrs) : null;

  const applyCombatantDelta = (id: string, sign: 1 | -1) => {
    const raw = hpDeltas[id] ?? '';
    const amount = Math.abs(Number.parseInt(raw, 10));
    if (!Number.isNaN(amount) && amount > 0) {
      onAdjustCombatantHp(id, sign * amount);
      setHpDeltas((prev) => ({ ...prev, [id]: '' }));
    }
  };

  return (
    <aside className="pane" aria-label="Encounter and Linked Summons">
      <div className="card forge-stack">
        {/* encounter management is hidden for the player role; a DM previewing Player View keeps it */}
        {isPlayerRole ? (
          <div className="forge-section-label">{encounter.name}</div>
        ) : (
        <div className="forge-row-between">
          <select
            aria-label="Active encounter"
            className="forge-input combat-drawer__input"
            value={encounter.id}
            onChange={(e) => onSwitchEncounter(e.target.value)}
          >
            {encounterList.map((enc) => (
              <option key={enc.id} value={enc.id}>
                {enc.name}
              </option>
            ))}
          </select>
          <div className="forge-row">
            <button
              type="button"
              className="btn"
              onClick={() => void onCreateEncounter(`Encounter ${encounterList.length + 1}`)}
              title="Create new encounter"
            >
              + New
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void onDuplicateEncounter()}
              title="Duplicate current encounter"
            >
              Dup
            </button>
            {encounterList.length > 1 && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onDeleteEncounter(encounter.id)}
                title="Delete current encounter"
              >
                Del
              </button>
            )}
          </div>
        </div>
        )}

        <div className="forge-row-between wrap">
          <div className="tabular forge-muted text-sm">
            Round {encounter.round} • {encounter.combatants.length} Combatants
            {difficulty && (
              <span
                className="cost-badge combat-drawer__cost-badge"
                style={{ color:
                    difficulty.rating === 'Deadly'
                      ? 'var(--accent-red)'
                      : difficulty.rating === 'Hard'
                      ? 'var(--accent-amber)'
                      : 'var(--accent-green)' }}
              >
                {difficulty.rating.toUpperCase()} • {difficulty.adjustedXp.toLocaleString()} adj XP
              </span>
            )}
          </div>
          <div className="forge-row wrap">
            {!isPlayerRole && (
              <>
                {onStartEncounterAlert && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={onStartEncounterAlert}
                    title="Flash Roll Initiative alert and play sound on all connected players' browsers"
                  >
                    Start! (Roll Init)
                  </button>
                )}
                <button type="button" className="btn" onClick={onAddPartyToEncounter} title="Drop all saved PCs into encounter">
                  + Party
                </button>
                <button type="button" className="btn" onClick={onRollAllInitiative} title="Roll 1d20 + DEX for all combatants">
                  Roll All Init
                </button>
              </>
            )}
            {!isPlayerRole && (
              <>
                <button
                  type="button"
                  className={`pill ${playerView ? 'active' : ''}`}
                  aria-pressed={playerView}
                  onClick={onTogglePlayerView}
                  title="Toggle Player View (hides monster HP and ambushers)"
                >
                  {playerView ? 'Player View' : 'DM View'}
                </button>
              </>
            )}
            {!hideBattlemapButton && (
              <button type="button" className="btn" onClick={onOpenBattlemap}>
                Battlemap
              </button>
            )}
            {!isPlayerRole && (
              <>
                <button type="button" className="btn" onClick={onResetEncounter} title="Clear monsters/summons and reset to Round 1">
                  Reset
                </button>
                <button type="button" className="btn btn-primary" onClick={onNextTurn}>
                  Next Turn
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {!playerView && (
        <div className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">ENCOUNTER CONTROLS</div>
            <div className="forge-row">
              <button
                type="button"
                className={`pill ${showAddCreature ? 'active' : ''}`}
                onClick={() => setShowAddCreature((v) => !v)}
              >
                {showAddCreature ? 'Hide Add' : '+ Add Creature'}
              </button>
              <button type="button" className="btn btn-primary" onClick={onOpenEncounterBuilder}>
                Builder / Forge
              </button>
            </div>
          </div>
          {selectedTargetIds.length > 0 && (
            <div className="subpanel forge-row-between combat-drawer__subpanel">
              <div className="pill-row">
                <span className="muted-label">Targets ({selectedTargetIds.length}):</span>
                {encounter.combatants
                  .filter((c) => selectedTargetIds.includes(c.id))
                  .map((c) => (
                    <span key={c.id} className="badge tabular">
                      {c.kind === 'pc' || !playerView
                        ? `${c.name} (AC ${c.ac} • ${c.hp.current}/${c.hp.max})`
                        : c.name}
                    </span>
                  ))}
              </div>
              <button type="button" className="btn" onClick={onClearTargets}>
                Clear Targets
              </button>
            </div>
          )}
          {showAddCreature && (
            <>
              <input
                aria-label="Search compendium monsters"
                type="text"
                className="forge-input combat-drawer__input-2"
                placeholder={`Search ${srdMonsters.length} monsters (name, CR, 2024)...`}
                value={mobSearch}
                onChange={(e) => setMobSearch(e.target.value)}
              />
              <div className="forge-row">
            <select
              aria-label="Quick add SRD monster"
              className="forge-input combat-drawer__input-3"
              value={srdMobId}
              onChange={(e) => setSrdMobId(e.target.value)}
            >
              <option value="">
                Pick Monster ({filteredSrdMonsters.length} shown of {srdMonsters.length})...
              </option>
              {filteredSrdMonsters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} [{m.ruleset}] (CR {m.monsterMeta?.cr ?? '?'} • HP {m.monsterMeta?.hp})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!srdMobId}
              onClick={() => {
                const chosen = srdMonsters.find((m) => m.id === srdMobId);
                if (!chosen?.monsterMeta) return;
                onAddMonster(
                  chosen.name,
                  chosen.monsterMeta.ac,
                  chosen.monsterMeta.hp,
                  chosen.monsterMeta.dexModifier,
                  chosen.activities,
                  chosen.monsterMeta.cr,
                  chosen.monsterMeta,
                  chosen.entries.join(' ')
                );
                setSrdMobId('');
              }}
            >
              +Spawn
            </button>
          </div>
          <div className="forge-stack gap-2">
            <input
              aria-label="Enemy or NPC name"
              type="text"
              placeholder="Custom NPC/Monster name..."
              value={mobName}
              onChange={(e) => setMobName(e.target.value)}
              className="forge-input combat-drawer__input-4"
            />
            <div className="combat-drawer__div">
              <input
                aria-label="Enemy AC"
                type="number"
                title="AC"
                placeholder="AC"
                value={mobAc}
                onChange={(e) => setMobAc(e.target.value)}
                className="forge-input tabular combat-drawer__input-5"
              />
              <input
                aria-label="Enemy HP"
                type="number"
                title="HP"
                placeholder="HP"
                value={mobHp}
                onChange={(e) => setMobHp(e.target.value)}
                className="forge-input tabular combat-drawer__input-5"
              />
              <input
                aria-label="Enemy CR"
                type="text"
                title="CR (e.g. 1/4, 3)"
                placeholder="CR"
                value={mobCr}
                onChange={(e) => setMobCr(e.target.value)}
                className="forge-input tabular combat-drawer__input-5"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!mobName.trim()) return;
                  onAddMonster(
                    mobName.trim(),
                    Number.parseInt(mobAc, 10) || 12,
                    Number.parseInt(mobHp, 10) || 20,
                    1,
                    undefined,
                    mobCr.trim() || '1'
                  );
                  setMobName('');
                }}
              >
                +Add
              </button>
            </div>
          </div>
            </>
          )}
          {encounter.combatants.length <= 1 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const goblin = srdMonsters.find((m) => m.name === 'Goblin');
                if (!goblin?.monsterMeta) return;
                for (let i = 0; i < 2; i++) {
                  onAddMonster(
                    goblin.name,
                    goblin.monsterMeta.ac,
                    goblin.monsterMeta.hp,
                    goblin.monsterMeta.dexModifier,
                    goblin.activities,
                    goblin.monsterMeta.cr,
                    goblin.monsterMeta,
                    goblin.entries.join(' ')
                  );
                }
              }}
            >
              Quick Demo: Spawn 2× Goblin
            </button>
          )}
        </div>
      )}

      <div className="card forge-stack">
        <div className="forge-row-between">
          <div className="forge-section-label combat-drawer__section-label">
            ACTIVE EFFECTS &amp; TIMERS ({encounter.activeEffects.length})
          </div>
          {!playerView && (
            <button
              type="button"
              className={`pill ${showEffectForm ? 'active' : ''}`}
              onClick={() => setShowEffectForm((v) => !v)}
            >
              {showEffectForm ? 'Hide' : '+ Timer'}
            </button>
          )}
        </div>
        {encounter.activeEffects.map((eff) => (
          <div
            key={eff.id}
            className="forge-row-between text-md wrap"
          >
            <span>
              • {eff.name}
              {eff.roundsRemaining !== undefined && (
                <span className="cost-badge tabular">{eff.roundsRemaining} rnd</span>
              )}
            </span>
            {eff.isConcentration && (
              <div className="forge-row">
                <button
                  type="button"
                  className={`btn tabular ${pendingConcDc !== null ? 'btn-primary' : ''}`}
                  onClick={() => onRollConcentrationSave(pendingConcDc ?? 10)}
                >
                  CON Save (DC {pendingConcDc ?? 10})
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => onDropConcentration(eff.sourceCombatantId)}
                >
                  Drop Conc
                </button>
              </div>
            )}
          </div>
        ))}
        {!playerView && showEffectForm && (
          <div className="forge-row">
            <input
              aria-label="Timed effect name"
              type="text"
              className="forge-input combat-drawer__input-6"
              placeholder="Effect timer (e.g. Bless)"
              value={effectNameInput}
              onChange={(e) => setEffectNameInput(e.target.value)}
            />
            <input
              aria-label="Effect duration rounds"
              type="number"
              min={1}
              className="forge-input tabular combat-drawer__input-7"
              value={effectRoundsInput}
              onChange={(e) => setEffectRoundsInput(e.target.value)}
              title="Duration in rounds"
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!effectNameInput.trim()) return;
                onAddTimedEffect(effectNameInput, Number.parseInt(effectRoundsInput, 10) || 10);
                setEffectNameInput('');
              }}
            >
              +Timer
            </button>
          </div>
        )}
      </div>

      {!playerView && selectedTargetIds.length > 0 && (
        <div
          className="subpanel forge-row-between combat-drawer__subpanel-2"
        >
          <span className="text-sm">
            <strong>Targets ({selectedTargetIds.length}):</strong>{' '}
            {encounter.combatants
              .filter((c) => selectedTargetIds.includes(c.id))
              .map((c) => c.name)
              .join(', ')}
          </span>
          <button type="button" className="pill" onClick={onClearTargets}>
            Clear
          </button>
        </div>
      )}

      {visibleCombatants.map((node) => {
        const isActive = encounter.combatants[encounter.activeTurnIndex]?.id === node.id;
        const isDown = node.hp.current <= 0;
        const isExpanded = expandedIds[node.id] ?? isActive;
        const hpPct = node.hp.max > 0 ? Math.max(0, Math.min(100, (node.hp.current / node.hp.max) * 100)) : 0;
        const hideHp = playerView && node.kind !== 'pc';
        return (
          <div
            key={node.id}
            className={`card ${isActive ? 'combatant-active' : ''}`}
            style={{
              marginLeft: node.ownerId ? 14 : 0,
              opacity: isDown ? 0.56 : node.hidden ? 0.72 : 1,
            }}
          >
            <div className="forge-row-between wrap gap-1">
              <span className="combat-drawer__span">
                <input
                  aria-label={`${node.name} initiative`}
                  type="number"
                  value={node.initiative}
                  disabled={playerView && node.kind !== 'pc'}
                  title="Initiative"
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) onSetCombatantInitiative(node.id, val);
                  }}
                  className="forge-input tabular combat-drawer__input-8"
                />
                {node.ownerId ? '↳ ' : ''}
                <strong>{node.name}</strong>
                {isActive && <span className="turn-badge">TURN</span>}
                {isDown && <span className="conc-badge combat-drawer__conc-badge">0 HP</span>}
                {node.hidden && <span className="conc-badge">HIDDEN</span>}
                <span className="tabular forge-muted text-sm">
                  AC {hideHp ? '?' : node.ac}
                </span>
              </span>
              <div className="forge-row wrap gap-1">
                {!playerView && (
                  <button
                    type="button"
                    className={`pill ${selectedTargetIds.includes(node.id) ? 'active' : ''}`}
                    onClick={() => onToggleTarget(node.id)}
                    title="Select as attack/spell target"
                  >
                    {selectedTargetIds.includes(node.id) ? 'Targeted' : 'Target'}
                  </button>
                )}
                {node.kind !== 'pc' && !isPlayerRole && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onInspectCombatant(node.id)}
                    title="Inspect full statblock & traits"
                  >
                    Stats
                  </button>
                )}
                <button
                  type="button"
                  className={`pill ${isExpanded ? 'active' : ''}`}
                  onClick={() => toggleExpanded(node.id)}
                  title={isExpanded ? 'Collapse combatant controls' : 'Expand combatant controls'}
                >
                  {isExpanded ? 'Less' : 'More'}
                </button>
              </div>
            </div>

            <div className="forge-row-between mt-2 gap-2 wrap">
              {hideHp ? (
                <span className="text-md">
                  Status: <strong>{getQualitativeHealthLabel(node.hp.current, node.hp.max)}</strong>
                </span>
              ) : (
                <>
                  <span className="tabular text-md">
                    HP <strong>{node.hp.current}</strong> / {node.hp.max}
                    {node.hp.temp > 0 ? ` (+${node.hp.temp})` : ''}
                  </span>
                  <div className="forge-row gap-1">
                    <div className="econ-pill-row" role="group" aria-label={`${node.name} turn economy`}>
                      {([
                        { key: 'action', label: 'A', title: 'Action' },
                        { key: 'bonus_action', label: 'BA', title: 'Bonus Action' },
                        { key: 'reaction', label: 'R', title: 'Reaction' },
                      ] as const).map((item) => {
                        const used = node.turnEconomyUsed[item.key];
                        return (
                          <button
                            key={item.key}
                            type="button"
                            className={`econ-pill ${used ? 'used' : ''}`}
                            aria-pressed={used}
                            title={`${item.title}: ${used ? 'Used' : 'Available'} (click to toggle)`}
                            onClick={() => onToggleCombatantEconomy(node.id, item.key)}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, -5)}>-5</button>
                    <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, -1)}>-1</button>
                    <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, 5)}>+5</button>
                  </div>
                </>
              )}
            </div>

            {!hideHp && (
              <div className="hp-bar-track" aria-hidden="true">
                <div
                  className={`hp-bar-fill ${getCombatHpClass(node.hp.current, node.hp.max)}`}
                  style={{ width: `${hpPct}%` }}
                />
              </div>
            )}

            {node.conditions.length > 0 && (
              <div className="pill-row combat-drawer__pill-row">
                {node.conditions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="pill active"
                    title={CONDITION_RULES[c] ?? 'Click to toggle condition'}
                    onClick={() => !hideHp && onToggleCombatantCondition(node.id, c)}
                  >
                    {c} {!hideHp ? '×' : ''}
                  </button>
                ))}
              </div>
            )}

            {isExpanded && (
              <div className="forge-stack combat-drawer__stack">
                {!playerView && (
                  <div className="forge-row wrap gap-1">
                    {!isPlayerRole && onMoveCombatantOrder && (
                      <>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Move ${node.name} up in initiative`}
                          title="Move up in turn order"
                          onClick={() => onMoveCombatantOrder(node.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`Move ${node.name} down in initiative`}
                          title="Move down in turn order"
                          onClick={() => onMoveCombatantOrder(node.id, 1)}
                        >
                          ↓
                        </button>
                      </>
                    )}
                    {node.kind !== 'pc' && (
                      <>
                        <button
                          type="button"
                          className={`pill ${node.hidden ? 'active' : ''}`}
                          onClick={() => onToggleCombatantHidden(node.id)}
                          title="Hide or reveal in Player View & Battlemap"
                        >
                          {node.hidden ? 'Reveal' : 'Hide'}
                        </button>
                        <select
                          aria-label={`${node.name} creature size`}
                          className="forge-input combat-drawer__input-9"
                          value={node.size ?? 'medium'}
                          onChange={(e) => onSetCombatantSize(node.id, e.target.value as CreatureSize)}
                        >
                          <option value="tiny">T (1x1)</option>
                          <option value="small">S (1x1)</option>
                          <option value="medium">M (1x1)</option>
                          <option value="large">L (2x2)</option>
                          <option value="huge">H (3x3)</option>
                          <option value="gargantuan">G (4x4)</option>
                        </select>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger combat-drawer__btn"
                      title="Remove from encounter"
                      aria-label={`Remove ${node.name}`}
                      onClick={() => onRemoveCombatant(node.id)}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {!playerView && (node.legendaryActions || (node.rechargeStates && node.rechargeStates.length > 0)) && (
                  <div className="forge-row wrap gap-2">
                    {node.legendaryActions && (
                      <div className="forge-row text-sm">
                        <span className="forge-muted tabular">
                          LA: {node.legendaryActions.current}/{node.legendaryActions.max}
                        </span>
                        <button
                          type="button"
                          className="btn"
                          disabled={node.legendaryActions.current <= 0}
                          onClick={() => onAdjustLegendary(node.id, -1)}
                        >
                          -1 LA
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={node.legendaryActions.current >= node.legendaryActions.max}
                          onClick={() => onAdjustLegendary(node.id, 1)}
                        >
                          +1
                        </button>
                      </div>
                    )}
                    {node.rechargeStates?.map((rec) => (
                      <button
                        key={rec.name}
                        type="button"
                        className={`pill ${rec.available ? 'active' : ''}`}
                        onClick={() => onToggleOrRollRecharge(node.id, rec.name)}
                        title={rec.available ? 'Click to mark spent' : `Click to roll 1d6 Recharge (${rec.minRoll}+)`}
                      >
                        {rec.name.replace(/\s*\(Recharge[^)]*\)/i, '')}: {rec.available ? 'Ready' : `Roll ${rec.minRoll}+`}
                      </button>
                    ))}
                  </div>
                )}

                {!hideHp && (
                  <div className="forge-row gap-1">
                    <input
                      aria-label={`${node.name} HP delta`}
                      type="number"
                      min={1}
                      placeholder="Amt (Enter=Dmg)"
                      value={hpDeltas[node.id] ?? ''}
                      onChange={(e) => setHpDeltas((prev) => ({ ...prev, [node.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyCombatantDelta(node.id, -1);
                        }
                      }}
                      className="forge-input tabular combat-drawer__input-10"
                    />
                    <button type="button" className="btn btn-danger" onClick={() => applyCombatantDelta(node.id, -1)}>
                      Dmg
                    </button>
                    <button type="button" className="btn btn-primary" onClick={() => applyCombatantDelta(node.id, 1)}>
                      Heal
                    </button>
                    <select
                      aria-label={`${node.name} condition`}
                      className="forge-input combat-drawer__input-11"
                      value={mobCond}
                      onChange={(e) => setMobCond(e.target.value)}
                    >
                      <option value="">Add condition…</option>
                      {STANDARD_CONDITIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={mobCond === ''}
                      onClick={() => onToggleCombatantCondition(node.id, mobCond)}
                    >
                      +Cond
                    </button>
                  </div>
                )}

                {!hideHp && node.actions && node.actions.length > 0 && (
                  <div className="pill-row">
                    {node.actions.map((act) => (
                      <span key={act.id} className="forge-row gap-1">
                        <button
                          type="button"
                          className="btn btn-primary tabular"
                          onClick={() => onTriggerCombatantActivity(node.name, act)}
                        >
                          {act.name} {act.attackBonusFormula ? `(${act.attackBonusFormula})` : ''}
                        </button>
                        {selectedTargetIds.length > 0 && (act.type === 'attack' || act.type === 'save') && (
                          <button
                            type="button"
                            className="btn btn-danger tabular"
                            title="Roll against selected target(s) & apply damage"
                            onClick={() =>
                              act.type === 'attack'
                                ? onTargetAttack(node.name, selectedTargetIds, act)
                                : onTargetSave(node.name, selectedTargetIds, act)
                            }
                          >
                            {act.type === 'attack' ? 'Hit' : 'Save'} ({selectedTargetIds.length})
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {!hideHp && node.kind !== 'pc' && (node.notes || node.monsterMeta?.senses || node.monsterMeta?.resistances?.length || node.monsterMeta?.immunities?.length) && (
                  <div className="subpanel forge-muted combat-drawer__subpanel-3">
                    {node.monsterMeta?.senses && <div><strong>Senses:</strong> {node.monsterMeta.senses}</div>}
                    {node.monsterMeta?.resistances && node.monsterMeta.resistances.length > 0 && (
                      <div><strong>Resistances:</strong> {node.monsterMeta.resistances.join(', ')}</div>
                    )}
                    {node.monsterMeta?.immunities && node.monsterMeta.immunities.length > 0 && (
                      <div><strong>Immunities:</strong> {node.monsterMeta.immunities.join(', ')}</div>
                    )}
                    {node.notes && <div>{node.notes.slice(0, 220)}{node.notes.length > 220 ? '…' : ''}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  isPlayerRole?: boolean;
  initialCategory?: 'all' | CompendiumEntity['category'];
  initialRuleset?: 'all' | '2014' | '2024';
  ownedItemNames?: string[];
  characterClasses?: string[];
  maxCastableSpellLevel?: number;
  searchCompendium: (query: string) => CompendiumEntity[];
  onAddCompendiumItem: (item: CompendiumEntity) => void;
  onInstallContentPack: (packId: string) => Promise<void>;
  onSyncFree5ePack?: () => Promise<void>;
  free5eSyncing?: boolean;
  free5eCount?: number;
  onImportDdbPdf: (file: File) => Promise<void>;
  /** Raw compendium + the duplicate-review state for the Duplicates tab. */
  allEntities?: readonly CompendiumEntity[];
  sourcePriority?: readonly SourceTier[];
  dupDecisions?: readonly DuplicateDecision[];
  onResolveDuplicate?: (group: NearDuplicateGroup, action: DuplicateAction, keepId?: string) => void | Promise<void>;
  onUndoDuplicate?: (groupId: string) => void | Promise<void>;
  /** Flag it, fix it, review it: the Fixes tab and the Report / fix button on entries. */
  fixApi?: ContentFixApi;
  /** Installed packs: list, add from GitHub, update, uninstall. */
  packApi?: PackApi;
  /** Opens the dialog straight on the fix editor for this entry (from the item inspector). */
  initialFixEntityId?: string | null;
  onImportHomebrew: (rawMarkdown: string) => Promise<void>;
  onImportJsonText: (rawJson: string) => Promise<void>;
}

export function CommandPalette({
  isOpen,
  onClose,
  isPlayerRole = false,
  initialCategory = 'all',
  initialRuleset = 'all',
  ownedItemNames = [],
  characterClasses = [],
  maxCastableSpellLevel = 9,
  searchCompendium,
  onAddCompendiumItem,
  onInstallContentPack,
  onSyncFree5ePack,
  free5eSyncing = false,
  free5eCount = 0,
  onImportDdbPdf,
  allEntities,
  sourcePriority,
  dupDecisions,
  onResolveDuplicate,
  onUndoDuplicate,
  fixApi,
  packApi,
  initialFixEntityId = null,
  onImportHomebrew,
  onImportJsonText,
}: CommandPaletteProps) {
  const [tab, setTab] = useState<'search' | 'packs' | 'pdf' | 'markdown' | 'json' | 'dupes' | 'fixes'>('search');
  const [fixTargetId, setFixTargetId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | CompendiumEntity['category']>(initialCategory);
  const [rulesetFilter, setRulesetFilter] = useState<'all' | '2014' | '2024'>(initialRuleset);
  const [customOnly, setCustomOnly] = useState(false);
  const [spellLevelFilter, setSpellLevelFilter] = useState<'all' | number>('all');
  const [spellTagFilter, setSpellTagFilter] = useState<'all' | 'conc' | 'ritual'>('all');
  const [classCastableOnly, setClassCastableOnly] = useState(false);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [query, setQuery] = useState('');
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTab('search');
      setCategoryFilter(initialCategory);
      setRulesetFilter(initialRuleset);
      setSpellLevelFilter('all');
      setSpellTagFilter('all');
      setShowAllMatches(false);
      setQuery('');
      setClassCastableOnly(initialCategory === 'spell' && maxCastableSpellLevel > 0);
      setFixTargetId(initialFixEntityId);
    }
  }, [isOpen, initialCategory, initialRuleset, maxCastableSpellLevel, initialFixEntityId]);

  const charClassSet = extractSrdSpellcasterClasses(characterClasses);
  const allMatches = searchCompendium(query)
    .filter(
      (item) =>
        (categoryFilter === 'all' || item.category === categoryFilter) &&
        (rulesetFilter === 'all' || item.ruleset === rulesetFilter) &&
        (!customOnly ||
          item.ruleset === 'homebrew' ||
          (!item.source.startsWith('SRD') && !item.source.startsWith('5e'))) &&
        (categoryFilter !== 'spell' || spellLevelFilter === 'all' || (item.spellLevel ?? 0) === spellLevelFilter) &&
        (categoryFilter !== 'spell' ||
          !classCastableOnly ||
          ((item.spellLevel ?? 0) <= maxCastableSpellLevel && spellOnClassList(item, charClassSet))) &&
        (categoryFilter !== 'spell' ||
          spellTagFilter === 'all' ||
          (spellTagFilter === 'conc' && Boolean(item.concentration)) ||
          (spellTagFilter === 'ritual' && Boolean(item.ritual)))
    )
    .sort((a, b) => {
      if (categoryFilter === 'spell') {
        const lvlDiff = (a.spellLevel ?? 0) - (b.spellLevel ?? 0);
        if (lvlDiff !== 0) return lvlDiff;
      }
      return a.name.localeCompare(b.name);
    });
  const matches =
    categoryFilter === 'spell' || showAllMatches ? allMatches : allMatches.slice(0, 120);
  const ownedSet = new Set(ownedItemNames.map((n) => n.toLowerCase()));
  const fixTarget = fixApi && fixTargetId ? fixApi.getEffective(fixTargetId) : undefined;
  const pendingFixCount = fixApi ? fixApi.fixes.filter((f) => f.status === 'proposed').length : 0;

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Compendium, SRD Packs & Importers">
      <div className="pill-row combat-drawer__pill-row-2">
            <button
              type="button"
              className={`pill ${tab === 'search' ? 'active' : ''}`}
              onClick={() => setTab('search')}
            >
              Compendium
            </button>
            <button
              type="button"
              className={`pill ${tab === 'packs' ? 'active' : ''}`}
              onClick={() => setTab('packs')}
            >
              SRD &amp; DLC Packs
            </button>
            <button
              type="button"
              className={`pill ${tab === 'pdf' ? 'active' : ''}`}
              onClick={() => setTab('pdf')}
            >
              D&amp;D Beyond PDF
            </button>
            <button
              type="button"
              className={`pill ${tab === 'markdown' ? 'active' : ''}`}
              onClick={() => setTab('markdown')}
            >
              Paste Markdown
            </button>
            <button
              type="button"
              className={`pill ${tab === 'json' ? 'active' : ''}`}
              onClick={() => setTab('json')}
            >
              5e.tools / Backup JSON
            </button>
            {allEntities && onResolveDuplicate && onUndoDuplicate && (
              <button
                type="button"
                className={`pill ${tab === 'dupes' ? 'active' : ''}`}
                onClick={() => setTab('dupes')}
              >
                Duplicates
              </button>
            )}
            {fixApi && (
              <button
                type="button"
                className={`pill ${tab === 'fixes' ? 'active' : ''}`}
                onClick={() => {
                  setTab('fixes');
                  setFixTargetId(null);
                }}
              >
                Fixes
                {pendingFixCount > 0 ? ` (${pendingFixCount})` : ''}
              </button>
            )}
        </div>

        {fixApi && fixTarget && (
          <ContentFixEditor
            entity={fixTarget}
            onSubmit={async (edited, note) => {
              const r = await fixApi.propose(fixTarget.id, edited, note);
              if (!r.ok) return r.error;
              setFixTargetId(null);
              setTab('fixes');
              return null;
            }}
            onCancel={() => setFixTargetId(null)}
          />
        )}

        {tab === 'search' && !fixTarget && (
          <div>
            <input
              autoFocus
              aria-label="Search compendium"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search local spells, weapons, armor, feats, monsters..."
              className="combat-drawer__input-12"
            />
            <div className="pill-row combat-drawer__pill-row-3">
              {(['all', 'spell', 'monster', 'weapon', 'armor', 'gear', 'feat', 'feature', 'background', 'species'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`pill ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
              <span className="combat-drawer__span-2">|</span>
              {(['all', '2014', '2024'] as const).map((rs) => (
                <button
                  key={rs}
                  type="button"
                  className={`pill ${rulesetFilter === rs ? 'active' : ''}`}
                  onClick={() => setRulesetFilter(rs)}
                >
                  {rs === 'all' ? 'ALL RULES' : rs === '2024' ? '2024 (Modern)' : '2014'}
                </button>
              ))}
              <button
                type="button"
                className={`pill ${customOnly ? 'active' : ''}`}
                onClick={() => setCustomOnly((v) => !v)}
                title="Show only Homebrew, DLC, and Repo-synced content"
              >
                DLC / REPO
              </button>
              <span className="badge tabular combat-drawer__btn">
                {matches.length}/{allMatches.length}
              </span>
              {allMatches.length > matches.length && (
                <button
                  type="button"
                  className="pill"
                  onClick={() => setShowAllMatches(true)}
                >
                  Show all {allMatches.length}
                </button>
              )}
            </div>
            {categoryFilter === 'spell' && (
              <div className="pill-row combat-drawer__pill-row-3">
                <button
                  type="button"
                  className={`pill ${spellLevelFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setSpellLevelFilter('all')}
                >
                  All Lvls
                </button>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`pill tabular ${spellLevelFilter === lvl ? 'active' : ''}`}
                    onClick={() => setSpellLevelFilter(lvl)}
                  >
                    {lvl === 0 ? 'Cantrip' : `L${lvl}`}
                  </button>
                ))}
                <span className="combat-drawer__span-2">|</span>
                <button
                  type="button"
                  className={`pill ${spellTagFilter === 'conc' ? 'active' : ''}`}
                  onClick={() => setSpellTagFilter((t) => (t === 'conc' ? 'all' : 'conc'))}
                >
                  CONC
                </button>
                <button
                  type="button"
                  className={`pill ${spellTagFilter === 'ritual' ? 'active' : ''}`}
                  onClick={() => setSpellTagFilter((t) => (t === 'ritual' ? 'all' : 'ritual'))}
                >
                  RITUAL
                </button>
                {characterClasses.length > 0 && (
                  <button
                    type="button"
                    className={`pill ${classCastableOnly ? 'active' : ''}`}
                    title={`Filter to spells usable by ${characterClasses.join('/')} up to Spell Level ${maxCastableSpellLevel}`}
                    onClick={() => setClassCastableOnly((v) => !v)}
                  >
                    {characterClasses.join('/')} (≤ L{maxCastableSpellLevel})
                  </button>
                )}
              </div>
            )}
            <div className="combat-drawer__div-2">
              {matches.map((item) => (
                <div
                  key={item.id}
                  className="combat-drawer__div-3"
                >
                  <div className="combat-drawer__div-4">
                    <strong>{item.name}</strong>{' '}
                    {item.fixedBy && item.fixedBy.length > 0 && (
                      <span className="badge badge-fixed" title="An approved fix is applied to this entry">fixed</span>
                    )}{' '}
                    <span className="combat-drawer__span-3">
                      [
                      {item.category === 'spell'
                        ? `${(item.spellLevel ?? 0) === 0 ? 'Cantrip' : `Lvl ${item.spellLevel}`}`
                        : item.category.toUpperCase()}
                      {' • '}
                      {item.source} • {item.ruleset}]
                    </span>
                    {item.alsoIn && item.alsoIn.length > 0 && (
                      <span className="forge-muted text-sm"> also in: {item.alsoIn.join(', ')}</span>
                    )}
                    {item.category === 'spell' && (
                      <div className="combat-drawer__div-5">
                        {[item.castingTime, item.range, item.concentration ? 'CONC' : '', item.ritual ? 'RITUAL' : '']
                          .filter(Boolean)
                          .join(' • ')}
                      </div>
                    )}
                  </div>
                  {fixApi && (
                    <button type="button" className="btn text-sm fix-report-btn" title="Report a mistake or propose a fix" onClick={() => setFixTargetId(item.id)}>
                      Report / fix
                    </button>
                  )}
                  {item.category === 'monster' && isPlayerRole ? (
                    <span className="badge" title="Switch to DM role to spawn monsters">DM Only</span>
                  ) : (
                    <button
                      type="button"
                      className={`btn ${ownedSet.has(item.name.toLowerCase()) ? '' : 'btn-primary'}`}
                      onClick={() => {
                        onAddCompendiumItem(item);
                        if (categoryFilter !== 'spell') {
                          onClose();
                        }
                      }}
                    >
                      {item.category === 'monster'
                        ? '+ Encounter'
                        : ownedSet.has(item.name.toLowerCase())
                          ? 'On Sheet ✓ (+1)'
                          : '+ Sheet'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'packs' && (
          <div className="combat-drawer__div-6">
            {packApi && <PacksPanel api={packApi} />}
            <div className="forge-row-between combat-drawer__row-between">
              <span>All built-in SRD 5.1 / 2024 SRD 5.2 &amp; Repo content packs are automatically pre-installed.</span>
              <div className="forge-row gap-2 wrap">
                {free5eCount > 0 && (
                  <span className="badge tabular">Free5e: {free5eCount} items ✓</span>
                )}
                {onSyncFree5ePack && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={free5eSyncing}
                    onClick={async () => {
                      await onSyncFree5ePack();
                      setTab('search');
                    }}
                    title="Pull native Markdown spells, feats, and gear directly from github.com/Solopass/free5e (CC-BY-4.0)"
                  >
                    {free5eSyncing
                      ? 'Syncing Solopass/free5e...'
                      : free5eCount > 0
                        ? 'Re-sync Free5e'
                        : 'Sync Free5e (Solopass/free5e)'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    for (const p of BUILTIN_CONTENT_PACKS) {
                      await onInstallContentPack(p.id);
                    }
                    setTab('search');
                  }}
                >
                  Re-sync All
                </button>
              </div>
            </div>
            {BUILTIN_CONTENT_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="card combat-drawer__card"
              >
                <div>
                  <strong>{pack.name}</strong>{' '}
                  <span className="combat-drawer__span-4">
                    [{pack.ruleset.toUpperCase()} • {pack.entities.length} items]
                  </span>
                  <div className="combat-drawer__div-7">{pack.description}</div>
                </div>
                <span className="badge combat-drawer__badge">
                  Installed ✓
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'dupes' && allEntities && onResolveDuplicate && onUndoDuplicate && (
          <DuplicatesReview
            entities={allEntities}
            priority={sourcePriority ?? DEFAULT_SOURCE_PRIORITY}
            decisions={dupDecisions ?? []}
            onResolve={onResolveDuplicate}
            onUndo={onUndoDuplicate}
          />
        )}

        {tab === 'fixes' && fixApi && !fixTarget && <ContentFixesReview api={fixApi} />}

        {tab === 'pdf' && (
          <div className="combat-drawer__div-6">
            <div className="combat-drawer__div-7">
              Upload a character sheet PDF exported from <strong>D&amp;D Beyond</strong> (<em>Export to PDF</em>). Extracts character name, species, classes/levels, ability scores, HP, AC, saves, skills, weapons, and spells locally in your browser:
            </div>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                await onImportDdbPdf(file);
                onClose();
              }}
              className="combat-drawer__input-13"
            />
          </div>
        )}

        {tab === 'markdown' && (
          <div>
            <textarea
              autoFocus
              rows={7}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`### Owlbear
Armor Class: 13
Hit Points: 59
16 (+3) 12 (+1) 17 (+3) 3 (-4) 12 (+1) 7 (-2)
Claws. +7 to hit, 2d8 + 5 slashing damage`}
              className="combat-drawer__textarea"
            />
            <div className="combat-drawer__div-8">
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  if (!pasteText.trim()) return;
                  await onImportHomebrew(pasteText);
                  setPasteText('');
                  onClose();
                }}
              >
                Parse &amp; Add
              </button>
            </div>
          </div>
        )}

        {tab === 'json' && (
          <div>
            <input
              type="file"
              accept=".json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                await onImportJsonText(text);
                onClose();
              }}
              className="combat-drawer__input-13"
            />
            <div className="combat-drawer__div-9">
              Supports both Sidereroll full backup bundles and 5e.tools JSON datasets (<code>spell</code>, <code>item</code>, <code>feat</code>, <code>monster</code>) for importing expansion books and DLC content.
            </div>
          </div>
        )}
    </ModalDialog>
  );
}

interface StatusConsoleProps {
  lines: ConsoleLine[];
  consoleSize: 'normal' | 'expanded' | 'collapsed';
  onCycleConsoleSize: () => void;
  onClearLog: () => void;
  onRollExpression: (label: string, expr: string) => void;
}

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const;

export function StatusConsole({
  lines,
  consoleSize,
  onCycleConsoleSize,
  onClearLog,
  onRollExpression,
}: StatusConsoleProps) {
  const [diceInput, setDiceInput] = useState('');

  const handleRollSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!diceInput.trim()) return;
    onRollExpression('Custom Roll', diceInput.trim());
    setDiceInput('');
  };

  return (
    <footer className="status-console-shell">
      <div className="status-console-bar">
        <form className="forge-row" onSubmit={handleRollSubmit}>
          <label htmlFor="dice-console-input" className="forge-label combat-drawer__label">
            <DiceIcon size={14} /> DICE TRAY
          </label>
          <input
            id="dice-console-input"
            type="text"
            value={diceInput}
            onChange={(e) => setDiceInput(e.target.value)}
            placeholder="2d6+4, 4d6kh3, 1d20+9..."
            className="forge-input tabular combat-drawer__input-14"
          />
          <button type="submit" className="btn btn-brand">
            Roll
          </button>
        </form>

        <div className="dice-tray" aria-label="Quick dice tray">
          {QUICK_DICE.map((die) => (
            <button
              key={die}
              type="button"
              className="btn tabular"
              onClick={() => onRollExpression(`Quick ${die}`, `1${die}`)}
            >
              {die}
            </button>
          ))}
          <button
            type="button"
            className="btn tabular"
            title="Roll d20 with Advantage"
            onClick={() => onRollExpression('Quick d20 (Adv)', '2d20kh1')}
          >
            d20 Adv
          </button>
          <button
            type="button"
            className="btn tabular"
            title="Roll d20 with Disadvantage"
            onClick={() => onRollExpression('Quick d20 (Dis)', '2d20kl1')}
          >
            d20 Dis
          </button>
        </div>

        <div className="forge-row">
          <button type="button" className="btn" onClick={onClearLog}>
            Clear
          </button>
          <button
            type="button"
            className="btn"
            onClick={onCycleConsoleSize}
            title="Cycle console height (normal / expanded / collapsed)"
          >
            {consoleSize === 'normal' ? 'Expand' : consoleSize === 'expanded' ? 'Collapse' : 'Restore'}
          </button>
        </div>
      </div>
      <div className="status-console-log" aria-live="polite">
        {lines.map((line) => (
          <div
            key={line.id}
            style={{
              color:
                line.tone === 'crit'
                  ? 'var(--accent-green)'
                  : line.tone === 'warn'
                  ? 'var(--accent-amber)'
                  : line.tone === 'roll'
                  ? 'var(--accent-blue)'
                  : 'var(--text-secondary)',
            }}
          >
            [{line.timestamp}] {line.text}
          </div>
        ))}
      </div>
    </footer>
  );
}
