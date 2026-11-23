import { useState } from 'react';
import { ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { ActionEconomy, RollMode } from '../types/core';
import { parse5eToolsEntries } from '../engine/tags';

interface ActionEconomyBoardProps {
  sheet: ResolvedCharacterSheet;
  rollMode: RollMode;
  onChangeRollMode: (mode: RollMode) => void;
  onTriggerActivity: (activity: ResolvedActivity) => void;
  onRollInlineExpression: (label: string, expression: string) => void;
}

const ECONOMY_SECTIONS: Array<{ key: ActionEconomy; label: string }> = [
  { key: 'action', label: 'Actions' },
  { key: 'bonus_action', label: 'Bonus Actions' },
  { key: 'reaction', label: 'Reactions' },
  { key: 'free', label: 'Free & Special' },
];

export function ActionEconomyBoard({
  sheet,
  rollMode,
  onChangeRollMode,
  onTriggerActivity,
  onRollInlineExpression,
}: ActionEconomyBoardProps) {
  const [filter, setFilter] = useState<'all' | 'attack' | 'summon' | 'concentration'>('all');

  const matchesFilter = (act: ResolvedActivity): boolean => {
    if (filter === 'attack') return act.type === 'attack';
    if (filter === 'summon') return act.type === 'summon';
    if (filter === 'concentration') return act.concentration;
    return true;
  };

  const renderTaggedDescription = (actName: string, text: string) => {
    const segments = parse5eToolsEntries(text);
    return segments.map((seg, i) => {
      if (seg.kind === 'roll') {
        return (
          <button
            key={i}
            type="button"
            className="inline-tag-btn"
            onClick={() => onRollInlineExpression(`${actName} (${seg.tag})`, seg.expression)}
          >
            {seg.display}
          </button>
        );
      }
      if (seg.kind === 'save') {
        return (
          <span key={i} style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>
            {seg.display}
          </span>
        );
      }
      if (seg.kind === 'ref') {
        return (
          <span key={i} style={{ textDecoration: 'underline dotted', color: 'var(--text-primary)' }}>
            {seg.display}
          </span>
        );
      }
      return <span key={i}>{seg.value}</span>;
    });
  };

  return (
    <main className="pane" aria-label="Action Economy Dashboard">
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="pill-row">
          {(['all', 'attack', 'summon', 'concentration'] as const).map((pill) => (
            <button
              key={pill}
              type="button"
              className={`pill ${filter === pill ? 'active' : ''}`}
              onClick={() => setFilter(pill)}
            >
              {pill.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="pill-row">
          {(['disadvantage', 'normal', 'advantage'] as RollMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`pill ${rollMode === mode ? 'active' : ''}`}
              onClick={() => onChangeRollMode(mode)}
            >
              {mode === 'disadvantage' ? 'DIS' : mode === 'advantage' ? 'ADV' : 'FLAT'}
            </button>
          ))}
        </div>
      </div>

      {ECONOMY_SECTIONS.map(({ key, label }) => {
        const items = sheet.actionsByEconomy[key].filter(matchesFilter);
        return (
          <section key={key} className="card">
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {label.toUpperCase()} ({items.length})
            </div>
            {items.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No matching actions.</div>
            ) : (
              items.map((act) => {
                const desc = act.resolvedDescription ?? act.description;
                return (
                  <div
                    key={act.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div>
                      <strong>{act.name}</strong>{' '}
                      <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                        ({act.parentItemName})
                      </span>
                      {act.concentration && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: 'var(--accent-amber)',
                            border: '1px solid var(--accent-amber)',
                            borderRadius: 3,
                            padding: '0 4px',
                          }}
                        >
                          CONC
                        </span>
                      )}
                      {desc && (
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                          {renderTaggedDescription(act.name, desc)}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary tabular"
                      onClick={() => onTriggerActivity(act)}
                    >
                      {act.computedAttackBonus !== null
                        ? `+${act.computedAttackBonus} / ${act.computedDamage ?? 'Roll'}`
                        : act.type === 'summon'
                        ? 'Summon'
                        : 'Use'}
                    </button>
                  </div>
                );
              })
            )}
          </section>
        );
      })}
    </main>
  );
}
