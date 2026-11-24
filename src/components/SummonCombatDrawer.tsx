import { FormEvent, useState } from 'react';
import { CombatEncounterState } from '../types/combat';
import { Activity, CompendiumEntity } from '../types/compendium';
import { ActionEconomy, STANDARD_CONDITIONS } from '../types/core';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { evaluateEncounterDifficulty } from '../engine/encounter-math';
import { ConsoleLine } from '../state/useSheetStore';
import { ModalDialog } from './ModalDialog';

interface SummonDrawerProps {
  encounter: CombatEncounterState;
  encounterList: CombatEncounterState[];
  partyLevels: number[];
  pendingConcDc: number | null;
  onSwitchEncounter: (id: string) => void;
  onCreateEncounter: (name: string) => Promise<void>;
  onDuplicateEncounter: () => Promise<void>;
  onDeleteEncounter: (id: string) => Promise<void>;
  onAddPartyToEncounter: () => void;
  onOpenBattlemap: () => void;
  onNextTurn: () => void;
  onResetEncounter: () => void;
  onAdjustCombatantHp: (id: string, delta: number) => void;
  onSetCombatantInitiative: (id: string, initiative: number) => void;
  onToggleCombatantCondition: (id: string, condition: string) => void;
  onToggleCombatantEconomy: (id: string, economy: ActionEconomy) => void;
  onRemoveCombatant: (id: string) => void;
  onTriggerCombatantActivity: (combatantName: string, act: Activity) => void;
  onDropConcentration: (sourceId: string) => void;
  onRollConcentrationSave: (dc?: number) => void;
  onAddMonster: (name: string, ac: number, hp: number, dexMod: number, actions?: Activity[], cr?: string) => void;
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
  onSwitchEncounter,
  onCreateEncounter,
  onDuplicateEncounter,
  onDeleteEncounter,
  onAddPartyToEncounter,
  onOpenBattlemap,
  onNextTurn,
  onResetEncounter,
  onAdjustCombatantHp,
  onSetCombatantInitiative,
  onToggleCombatantCondition,
  onToggleCombatantEconomy,
  onRemoveCombatant,
  onTriggerCombatantActivity,
  onDropConcentration,
  onRollConcentrationSave,
  onAddMonster,
}: SummonDrawerProps) {
  const [mobName, setMobName] = useState('');
  const [mobAc, setMobAc] = useState('14');
  const [mobHp, setMobHp] = useState('32');
  const [mobCr, setMobCr] = useState('1');
  const [mobCond, setMobCond] = useState<string>(STANDARD_CONDITIONS[10]);
  const [hpDeltas, setHpDeltas] = useState<Record<string, string>>({});

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
          <div className="forge-row">
            <button type="button" className="btn" onClick={onAddPartyToEncounter} title="Drop all saved PCs into encounter">
              + Party
            </button>
            <button type="button" className="btn" onClick={onOpenBattlemap}>
              Battlemap
            </button>
            <button type="button" className="btn" onClick={onResetEncounter} title="Clear monsters/summons and reset to Round 1">
              Reset
            </button>
            <button type="button" className="btn btn-primary" onClick={onNextTurn}>
              Next Turn
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="forge-section-label">QUICK ADD ENEMY / NPC</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 44px 48px 46px auto', gap: 4 }}>
          <input
            aria-label="Enemy or NPC name"
            type="text"
            placeholder="Goblin Boss"
            value={mobName}
            onChange={(e) => setMobName(e.target.value)}
            className="forge-input"
            style={{ padding: '3px 6px' }}
          />
          <input
            aria-label="Enemy AC"
            type="number"
            title="AC"
            value={mobAc}
            onChange={(e) => setMobAc(e.target.value)}
            className="forge-input tabular"
            style={{ padding: '3px 4px' }}
          />
          <input
            aria-label="Enemy HP"
            type="number"
            title="HP"
            value={mobHp}
            onChange={(e) => setMobHp(e.target.value)}
            className="forge-input tabular"
            style={{ padding: '3px 4px' }}
          />
          <input
            aria-label="Enemy CR"
            type="text"
            title="CR (e.g. 1/4, 3)"
            value={mobCr}
            onChange={(e) => setMobCr(e.target.value)}
            className="forge-input tabular"
            style={{ padding: '3px 4px' }}
          />
          <button
            type="button"
            className="btn"
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

      {encounter.activeEffects.length > 0 && (
        <div className="card">
          <div className="forge-section-label" style={{ color: 'var(--accent-amber)' }}>
            ACTIVE CONCENTRATION &amp; EFFECTS
          </div>
          {encounter.activeEffects.map((eff) => (
            <div
              key={eff.id}
              className="forge-row-between"
              style={{ fontSize: 12, marginTop: 4, flexWrap: 'wrap' }}
            >
              <span>• {eff.name}</span>
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
        </div>
      )}

      {encounter.combatants.map((node, idx) => {
        const isActive = idx === encounter.activeTurnIndex;
        const hpPct = node.hp.max > 0 ? Math.max(0, Math.min(100, (node.hp.current / node.hp.max) * 100)) : 0;
        return (
          <div
            key={node.id}
            className={`card ${isActive ? 'combatant-active' : ''}`}
            style={{ marginLeft: node.ownerId ? 14 : 0 }}
          >
            <div className="forge-row-between">
              <span>
                {node.ownerId ? '↳ ' : ''}
                <strong>{node.name}</strong>
                {isActive && <span className="turn-badge">ACTIVE TURN</span>}
              </span>
              <div className="forge-row">
                <span className="forge-muted" style={{ fontSize: 11 }}>Init</span>
                <input
                  aria-label={`${node.name} initiative`}
                  type="number"
                  value={node.initiative}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) onSetCombatantInitiative(node.id, val);
                  }}
                  className="forge-input tabular"
                  style={{ width: 42, padding: '1px 4px', fontSize: 11 }}
                />
                <span className="tabular forge-muted">
                  • AC {node.ac}
                </span>
                {node.kind !== 'pc' && (
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
              <span className="tabular" style={{ fontSize: 12 }}>
                HP <strong>{node.hp.current}</strong> / {node.hp.max}
                {node.hp.temp > 0 ? ` (+${node.hp.temp})` : ''}
              </span>
              <div className="forge-row">
                <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, -5)}>-5</button>
                <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, -1)}>-1</button>
                <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, 5)}>+5</button>
              </div>
            </div>

            <div className="hp-bar-track" aria-hidden="true">
              <div
                className={`hp-bar-fill ${getCombatHpClass(node.hp.current, node.hp.max)}`}
                style={{ width: `${hpPct}%` }}
              />
            </div>

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

            {node.conditions.length > 0 && (
              <div className="pill-row" style={{ marginTop: 4 }}>
                {node.conditions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="pill active"
                    onClick={() => onToggleCombatantCondition(node.id, c)}
                  >
                    {c} ×
                  </button>
                ))}
              </div>
            )}

            {node.actions && node.actions.length > 0 && (
              <div className="pill-row" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                {node.actions.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    className="btn btn-primary tabular"
                    onClick={() => onTriggerCombatantActivity(node.name, act)}
                  >
                    {act.name} {act.attackBonusFormula ? `(${act.attackBonusFormula})` : ''}
                  </button>
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
  searchCompendium,
  onAddCompendiumItem,
  onInstallContentPack,
  onImportDdbPdf,
  onImportHomebrew,
  onImportJsonText,
}: CommandPaletteProps) {
  const [tab, setTab] = useState<'search' | 'packs' | 'pdf' | 'markdown' | 'json'>('search');
  const [categoryFilter, setCategoryFilter] = useState<'all' | CompendiumEntity['category']>('all');
  const [query, setQuery] = useState('');
  const [pasteText, setPasteText] = useState('');

  const matches = searchCompendium(query).filter(
    (item) => categoryFilter === 'all' || item.category === categoryFilter
  );

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
            <div className="pill-row" style={{ marginBottom: 8 }}>
              {(['all', 'spell', 'weapon', 'armor', 'feat', 'monster'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`pill ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>
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
                  <div>
                    <strong>{item.name}</strong>{' '}
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      [{item.category.toUpperCase()} • {item.source} • {item.ruleset}]
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      onAddCompendiumItem(item);
                      onClose();
                    }}
                  >
                    {item.category === 'monster' ? '+ Encounter' : '+ Sheet'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'packs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              1-click install built-in SRD 5.1 / 2024 SRD 5.2 spells, weapons, and monster packs into your local IndexedDB compendium:
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
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    await onInstallContentPack(pack.id);
                    setTab('search');
                  }}
                >
                  Install Pack
                </button>
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
              Supports both D&amp;D Forge full backup bundles and 5e.tools JSON datasets (<code>spell</code>, <code>item</code>, <code>feat</code>, <code>monster</code>) for importing expansion books and DLC content.
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
          <label htmlFor="dice-console-input" className="forge-label">
            DICE CONSOLE:
          </label>
          <input
            id="dice-console-input"
            type="text"
            value={diceInput}
            onChange={(e) => setDiceInput(e.target.value)}
            placeholder="2d6+4, 4d6kh3, 1d20+9..."
            className="forge-input tabular"
            style={{ width: 200, padding: '2px 8px' }}
          />
          <button type="submit" className="btn btn-primary">
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
