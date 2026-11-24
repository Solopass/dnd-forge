import { FormEvent, useEffect, useState } from 'react';
import { CombatEncounterState } from '../types/combat';
import { Activity, CompendiumEntity, CreatureSize, MonsterStatMeta } from '../types/compendium';
import { ActionEconomy, STANDARD_CONDITIONS } from '../types/core';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
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
  const [srdMobId, setSrdMobId] = useState('');
  const [effectNameInput, setEffectNameInput] = useState('');
  const [effectRoundsInput, setEffectRoundsInput] = useState('10');
  const [mobCond, setMobCond] = useState<string>(STANDARD_CONDITIONS[10]);
  const [hpDeltas, setHpDeltas] = useState<Record<string, string>>({});

  const srdMonsters = BUILTIN_CONTENT_PACKS.flatMap((p) => p.entities).filter(
    (e) => e.category === 'monster' && e.monsterMeta
  );
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
        <div className="forge-row-between">
          <select
            aria-label="Active encounter"
            className="forge-input"
            value={encounter.id}
            onChange={(e) => onSwitchEncounter(e.target.value)}
            style={{ flex: 1, fontWeight: 700, padding: '3px 6px' }}
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

        <div className="forge-row-between" style={{ flexWrap: 'wrap' }}>
          <div className="tabular forge-muted" style={{ fontSize: 11 }}>
            Round {encounter.round} • {encounter.combatants.length} Combatants
            {difficulty && (
              <span
                className="cost-badge"
                style={{
                  color:
                    difficulty.rating === 'Deadly'
                      ? 'var(--accent-red)'
                      : difficulty.rating === 'Hard'
                      ? 'var(--accent-amber)'
                      : 'var(--accent-green)',
                  borderColor: 'currentColor',
                }}
              >
                {difficulty.rating.toUpperCase()} • {difficulty.adjustedXp.toLocaleString()} adj XP
              </span>
            )}
          </div>
          <div className="forge-row" style={{ flexWrap: 'wrap' }}>
            {!isPlayerRole && (
              <>
                <button type="button" className="btn" onClick={onAddPartyToEncounter} title="Drop all saved PCs into encounter">
                  + Party
                </button>
                <button type="button" className="btn" onClick={onRollAllInitiative} title="Roll 1d20 + DEX for all combatants">
                  Roll All Init
                </button>
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
            <div className="subpanel forge-row-between" style={{ padding: '4px 8px', flexWrap: 'wrap', gap: 6 }}>
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
              <div className="forge-row">
            <select
              aria-label="Quick add SRD monster"
              className="forge-input"
              value={srdMobId}
              onChange={(e) => setSrdMobId(e.target.value)}
              style={{ flex: 1, padding: '3px 6px' }}
            >
              <option value="">Pick SRD Monster (Goblin, Dragon, Lich...)</option>
              {srdMonsters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (CR {m.monsterMeta?.cr ?? '?'} • HP {m.monsterMeta?.hp})
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
          <div className="forge-stack" style={{ gap: 6 }}>
            <input
              aria-label="Enemy or NPC name"
              type="text"
              placeholder="Custom NPC/Monster name..."
              value={mobName}
              onChange={(e) => setMobName(e.target.value)}
              className="forge-input"
              style={{ padding: '4px 8px', width: '100%' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 4 }}>
              <input
                aria-label="Enemy AC"
                type="number"
                title="AC"
                placeholder="AC"
                value={mobAc}
                onChange={(e) => setMobAc(e.target.value)}
                className="forge-input tabular"
                style={{ padding: '3px 6px', minWidth: 0 }}
              />
              <input
                aria-label="Enemy HP"
                type="number"
                title="HP"
                placeholder="HP"
                value={mobHp}
                onChange={(e) => setMobHp(e.target.value)}
                className="forge-input tabular"
                style={{ padding: '3px 6px', minWidth: 0 }}
              />
              <input
                aria-label="Enemy CR"
                type="text"
                title="CR (e.g. 1/4, 3)"
                placeholder="CR"
                value={mobCr}
                onChange={(e) => setMobCr(e.target.value)}
                className="forge-input tabular"
                style={{ padding: '3px 6px', minWidth: 0 }}
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
          <div className="forge-section-label" style={{ color: 'var(--accent-amber)' }}>
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
            className="forge-row-between"
            style={{ fontSize: 12, flexWrap: 'wrap' }}
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
              className="forge-input"
              placeholder="Effect timer (e.g. Bless)"
              value={effectNameInput}
              onChange={(e) => setEffectNameInput(e.target.value)}
              style={{ flex: 1, padding: '2px 6px', fontSize: 11 }}
            />
            <input
              aria-label="Effect duration rounds"
              type="number"
              min={1}
              className="forge-input tabular"
              value={effectRoundsInput}
              onChange={(e) => setEffectRoundsInput(e.target.value)}
              style={{ width: 52, padding: '2px 4px', fontSize: 11 }}
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

      {visibleCombatants.map((node) => {
        const isActive = encounter.combatants[encounter.activeTurnIndex]?.id === node.id;
        const hpPct = node.hp.max > 0 ? Math.max(0, Math.min(100, (node.hp.current / node.hp.max) * 100)) : 0;
        const hideHp = playerView && node.kind !== 'pc';
        return (
          <div
            key={node.id}
            className={`card ${isActive ? 'combatant-active' : ''}`}
            style={{ marginLeft: node.ownerId ? 14 : 0, opacity: node.hidden ? 0.68 : 1 }}
          >
            <div className="forge-row-between" style={{ flexWrap: 'wrap', gap: 4 }}>
              <span>
                {node.ownerId ? '↳ ' : ''}
                <strong>{node.name}</strong>
                {isActive && <span className="turn-badge">ACTIVE TURN</span>}
                {node.hidden && <span className="conc-badge">HIDDEN</span>}
              </span>
              <div className="forge-row" style={{ flexWrap: 'wrap' }}>
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
                {node.kind !== 'pc' && !isPlayerRole && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onInspectCombatant(node.id)}
                    title="Inspect full statblock & traits"
                  >
                    Statblock
                  </button>
                )}
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
                {!playerView && node.kind !== 'pc' && (
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
                      className="forge-input"
                      value={node.size ?? 'medium'}
                      onChange={(e) => onSetCombatantSize(node.id, e.target.value as CreatureSize)}
                      style={{ padding: '1px 4px', fontSize: 11 }}
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
                <span className="forge-muted" style={{ fontSize: 11 }}>Init</span>
                <input
                  aria-label={`${node.name} initiative`}
                  type="number"
                  value={node.initiative}
                  disabled={playerView && node.kind !== 'pc'}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) onSetCombatantInitiative(node.id, val);
                  }}
                  className="forge-input tabular"
                  style={{ width: 42, padding: '1px 4px', fontSize: 11 }}
                />
                <span className="tabular forge-muted">
                  • AC {hideHp ? '?' : node.ac}
                </span>
                {!playerView && node.kind !== 'pc' && (
                  <button
                    type="button"
                    className="btn"
                    title="Remove from encounter"
                    aria-label={`Remove ${node.name}`}
                    onClick={() => onRemoveCombatant(node.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div className="forge-row-between" style={{ marginTop: 6 }}>
              {hideHp ? (
                <span style={{ fontSize: 12 }}>
                  Status: <strong>{getQualitativeHealthLabel(node.hp.current, node.hp.max)}</strong>
                </span>
              ) : (
                <>
                  <span className="tabular" style={{ fontSize: 12 }}>
                    HP <strong>{node.hp.current}</strong> / {node.hp.max}
                    {node.hp.temp > 0 ? ` (+${node.hp.temp})` : ''}
                  </span>
                  <div className="forge-row">
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

            {!playerView && (node.legendaryActions || (node.rechargeStates && node.rechargeStates.length > 0)) && (
              <div className="forge-row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 6 }}>
                {node.legendaryActions && (
                  <div className="forge-row" style={{ fontSize: 11 }}>
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

            <div className="forge-row-between" style={{ marginTop: 6 }}>
              <span className="forge-muted" style={{ fontSize: 11 }}>
                Turn Economy:
              </span>
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
            </div>

            {!hideHp && (
              <div className="forge-row" style={{ marginTop: 6 }}>
                <input
                  aria-label={`${node.name} HP delta`}
                  type="number"
                  min={1}
                  placeholder="Amt"
                  value={hpDeltas[node.id] ?? ''}
                  onChange={(e) => setHpDeltas((prev) => ({ ...prev, [node.id]: e.target.value }))}
                  className="forge-input tabular"
                  style={{ width: 56, padding: '2px 4px', fontSize: 11 }}
                />
                <button type="button" className="btn btn-danger" onClick={() => applyCombatantDelta(node.id, -1)}>
                  Dmg
                </button>
                <button type="button" className="btn btn-primary" onClick={() => applyCombatantDelta(node.id, 1)}>
                  Heal
                </button>
                <select
                  aria-label={`${node.name} condition`}
                  className="forge-input"
                  value={mobCond}
                  onChange={(e) => setMobCond(e.target.value)}
                  style={{ flex: 1, padding: '2px 4px', fontSize: 11 }}
                >
                  {STANDARD_CONDITIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  onClick={() => onToggleCombatantCondition(node.id, mobCond)}
                >
                  +Cond
                </button>
              </div>
            )}

            {node.conditions.length > 0 && (
              <div className="pill-row" style={{ marginTop: 4 }}>
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

            {!hideHp && node.actions && node.actions.length > 0 && (
              <div className="pill-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                {node.actions.map((act) => (
                  <span key={act.id} className="forge-row" style={{ gap: 4 }}>
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
  onImportDdbPdf: (file: File) => Promise<void>;
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
  onImportDdbPdf,
  onImportHomebrew,
  onImportJsonText,
}: CommandPaletteProps) {
  const [tab, setTab] = useState<'search' | 'packs' | 'pdf' | 'markdown' | 'json'>('search');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CompendiumEntity['category']>(initialCategory);
  const [rulesetFilter, setRulesetFilter] = useState<'all' | '2014' | '2024'>(initialRuleset);
  const [customOnly, setCustomOnly] = useState(false);
  const [spellLevelFilter, setSpellLevelFilter] = useState<'all' | number>('all');
  const [spellTagFilter, setSpellTagFilter] = useState<'all' | 'conc' | 'ritual'>('all');
  const [classCastableOnly, setClassCastableOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTab('search');
      setCategoryFilter(initialCategory);
      setRulesetFilter(initialRuleset);
      setSpellLevelFilter('all');
      setSpellTagFilter('all');
      setClassCastableOnly(initialCategory === 'spell' && maxCastableSpellLevel > 0);
    }
  }, [isOpen, initialCategory, initialRuleset, maxCastableSpellLevel]);

  const charClassSet = new Set(characterClasses.map((c) => c.toLowerCase()));
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
          ((item.spellLevel ?? 0) <= maxCastableSpellLevel &&
            (!item.classes?.length ||
              charClassSet.size === 0 ||
              item.classes.some((c) => charClassSet.has(c.toLowerCase()))))) &&
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
  const matches = allMatches.slice(0, 80);
  const ownedSet = new Set(ownedItemNames.map((n) => n.toLowerCase()));

  return (
    <ModalDialog isOpen={isOpen} onClose={onClose} title="Compendium, SRD Packs & Importers">
      <div className="pill-row" style={{ marginBottom: 10 }}>
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
        </div>

        {tab === 'search' && (
          <div>
            <input
              autoFocus
              aria-label="Search compendium"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search local spells, weapons, armor, feats, monsters..."
              style={{
                width: '100%',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '7px 10px',
                marginBottom: 8,
              }}
            />
            <div className="pill-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
              {(['all', 'spell', 'monster', 'weapon', 'armor', 'gear', 'feat', 'feature'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`pill ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
              <span style={{ opacity: 0.35 }}>|</span>
              {(['all', '2014', '2024'] as const).map((rs) => (
                <button
                  key={rs}
                  type="button"
                  className={`pill ${rulesetFilter === rs ? 'active' : ''}`}
                  onClick={() => setRulesetFilter(rs)}
                >
                  {rs === 'all' ? 'ALL RULES' : rs}
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
              <span className="badge tabular" style={{ marginLeft: 'auto' }}>
                {matches.length}/{allMatches.length}
              </span>
            </div>
            {categoryFilter === 'spell' && (
              <div className="pill-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
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
                <span style={{ opacity: 0.35 }}>|</span>
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
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {matches.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 4px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong>{item.name}</strong>{' '}
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      [
                      {item.category === 'spell'
                        ? `${(item.spellLevel ?? 0) === 0 ? 'Cantrip' : `Lvl ${item.spellLevel}`}`
                        : item.category.toUpperCase()}
                      {' • '}
                      {item.source} • {item.ruleset}]
                    </span>
                    {item.category === 'spell' && (
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                        {[item.castingTime, item.range, item.concentration ? 'CONC' : '', item.ritual ? 'RITUAL' : '']
                          .filter(Boolean)
                          .join(' • ')}
                      </div>
                    )}
                  </div>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="forge-row-between" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>All built-in SRD 5.1 / 2024 SRD 5.2 &amp; Repo content packs are automatically pre-installed.</span>
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
            {BUILTIN_CONTENT_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="card"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
              >
                <div>
                  <strong>{pack.name}</strong>{' '}
                  <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>
                    [{pack.ruleset.toUpperCase()} • {pack.entities.length} items]
                  </span>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{pack.description}</div>
                </div>
                <span className="badge" style={{ color: 'var(--accent-green)', borderColor: 'rgba(63,185,80,0.4)' }}>
                  Installed ✓
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'pdf' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
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
              style={{ color: 'var(--text-primary)' }}
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
              style={{
                width: '100%',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                fontFamily: 'var(--font-mono)',
                padding: 8,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
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
              style={{ color: 'var(--text-primary)' }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
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
          <label htmlFor="dice-console-input" className="forge-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <DiceIcon size={14} /> DICE TRAY
          </label>
          <input
            id="dice-console-input"
            type="text"
            value={diceInput}
            onChange={(e) => setDiceInput(e.target.value)}
            placeholder="2d6+4, 4d6kh3, 1d20+9..."
            className="forge-input tabular"
            style={{ width: 190, padding: '3px 8px' }}
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
