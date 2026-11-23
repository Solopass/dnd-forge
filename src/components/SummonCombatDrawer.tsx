import React, { useEffect, useRef, useState } from 'react';
import { CombatEncounterState } from '../types/combat';
import { Activity, CompendiumEntity } from '../types/compendium';
import { STANDARD_CONDITIONS } from '../types/core';
import { BUILTIN_CONTENT_PACKS } from '../engine/srd-packs';
import { ConsoleLine } from '../state/useSheetStore';

interface SummonDrawerProps {
  encounter: CombatEncounterState;
  onNextTurn: () => void;
  onResetEncounter: () => void;
  onAdjustCombatantHp: (id: string, delta: number) => void;
  onSetCombatantInitiative: (id: string, initiative: number) => void;
  onToggleCombatantCondition: (id: string, condition: string) => void;
  onRemoveCombatant: (id: string) => void;
  onTriggerCombatantActivity: (combatantName: string, act: Activity) => void;
  onDropConcentration: (sourceId: string) => void;
  onAddMonster: (name: string, ac: number, hp: number, dexMod: number) => void;
}

export function SummonCombatDrawer({
  encounter,
  onNextTurn,
  onResetEncounter,
  onAdjustCombatantHp,
  onSetCombatantInitiative,
  onToggleCombatantCondition,
  onRemoveCombatant,
  onTriggerCombatantActivity,
  onDropConcentration,
  onAddMonster,
}: SummonDrawerProps) {
  const [mobName, setMobName] = useState('');
  const [mobAc, setMobAc] = useState('14');
  const [mobHp, setMobHp] = useState('32');
  const [mobCond, setMobCond] = useState<string>(STANDARD_CONDITIONS[10]);

  return (
    <aside className="pane" aria-label="Encounter and Linked Summons">
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{encounter.name}</strong>
          <div className="tabular" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Round {encounter.round} • {encounter.combatants.length} Combatants
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" onClick={onResetEncounter} title="Clear monsters/summons and reset to Round 1">
            Reset
          </button>
          <button type="button" className="btn btn-primary" onClick={onNextTurn}>
            Next Turn
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
          QUICK ADD ENEMY / NPC
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px 54px auto', gap: 4 }}>
          <input
            type="text"
            placeholder="Goblin Boss"
            value={mobName}
            onChange={(e) => setMobName(e.target.value)}
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '3px 6px' }}
          />
          <input
            type="number"
            title="AC"
            value={mobAc}
            onChange={(e) => setMobAc(e.target.value)}
            className="tabular"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '3px 4px' }}
          />
          <input
            type="number"
            title="HP"
            value={mobHp}
            onChange={(e) => setMobHp(e.target.value)}
            className="tabular"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '3px 4px' }}
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
                1
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
          <div style={{ fontSize: 11, color: 'var(--accent-amber)', marginBottom: 4 }}>
            ACTIVE CONCENTRATION &amp; EFFECTS
          </div>
          {encounter.activeEffects.map((eff) => (
            <div
              key={eff.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginTop: 4 }}
            >
              <span>• {eff.name}</span>
              {eff.isConcentration && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => onDropConcentration(eff.sourceCombatantId)}
                >
                  Drop Conc
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {encounter.combatants.map((node, idx) => {
        const isActive = idx === encounter.activeTurnIndex;
        return (
          <div
            key={node.id}
            className="card"
            style={{
              borderColor: isActive ? 'var(--accent-blue)' : 'var(--border-subtle)',
              marginLeft: node.ownerId ? 14 : 0,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {node.ownerId ? '↳ ' : ''}
                <strong>{node.name}</strong>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Init</span>
                <input
                  type="number"
                  value={node.initiative}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value, 10);
                    if (!Number.isNaN(val)) onSetCombatantInitiative(node.id, val);
                  }}
                  className="tabular"
                  style={{ width: 42, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '1px 4px', fontSize: 11 }}
                />
                <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
                  • AC {node.ac}
                </span>
                {node.kind !== 'pc' && (
                  <button
                    type="button"
                    className="btn"
                    title="Remove from encounter"
                    onClick={() => onRemoveCombatant(node.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span className="tabular" style={{ fontSize: 12 }}>
                HP <strong>{node.hp.current}</strong> / {node.hp.max}
                {node.hp.temp > 0 ? ` (+${node.hp.temp})` : ''}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, -5)}>-5</button>
                <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, -1)}>-1</button>
                <button type="button" className="btn" onClick={() => onAdjustCombatantHp(node.id, 5)}>+5</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <select
                value={mobCond}
                onChange={(e) => setMobCond(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '2px 4px', fontSize: 11 }}
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
  const [query, setQuery] = useState('');
  const [pasteText, setPasteText] = useState('');
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const matches = searchCompendium(query);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="pill-row">
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
          <button type="button" className="btn" onClick={onClose}>
            Esc
          </button>
        </div>

        {tab === 'search' && (
          <div>
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search local spells, weapons, monsters, homebrew..."
              style={{
                width: '100%',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '7px 10px',
                marginBottom: 8,
              }}
            />
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
              placeholder={'### Owlbear
Armor Class: 13
Hit Points: 59
16 (+3) 12 (+1) 17 (+3) 3 (-4) 12 (+1) 7 (-2)
Claws. +7 to hit, 2d8 + 5 slashing damage'}
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
      </div>
    </div>
  );
}

interface StatusConsoleProps {
  lines: ConsoleLine[];
  onRollExpression: (label: string, expr: string) => void;
}

export function StatusConsole({ lines, onRollExpression }: StatusConsoleProps) {
  const [diceInput, setDiceInput] = useState('');

  const handleRollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!diceInput.trim()) return;
    onRollExpression('Custom Roll', diceInput.trim());
    setDiceInput('');
  };

  return (
    <footer className="status-console-shell" aria-live="polite">
      <form className="status-console-bar" onSubmit={handleRollSubmit}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>DICE CONSOLE:</span>
        <input
          type="text"
          value={diceInput}
          onChange={(e) => setDiceInput(e.target.value)}
          placeholder="2d6+4, 4d6kh3, 1d20+9..."
          className="tabular"
          style={{
            width: 220,
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            padding: '2px 8px',
            fontSize: 12,
          }}
        />
        <button type="submit" className="btn btn-primary">
          Roll
        </button>
      </form>
      <div className="status-console-log">
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
