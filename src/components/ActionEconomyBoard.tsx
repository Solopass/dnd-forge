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

const ECONOMY_SECTIONS: Array<{ key: Exclude<ActionEconomy, 'special'>; label: string }> = [
  { key: 'action', label: 'Actions' },
  { key: 'bonus_action', label: 'Bonus Actions' },
  { key: 'reaction', label: 'Reactions' },
  { key: 'free', label: 'Free & Special' },
];

function formatResourceBadge(poolId: string): string {
  const slotMatch = poolId.match(/^spell_slot_(\d+)$/);
  if (slotMatch && slotMatch[1]) {
    const lvl = Number.parseInt(slotMatch[1], 10);
    const ord = lvl === 1 ? '1st' : lvl === 2 ? '2nd' : lvl === 3 ? '3rd' : `${lvl}th`;
    return `${ord} Slot`;
  }
  return poolId
    .replace(/^auto_class_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatActivityActionLabel(act: ResolvedActivity): string {
  if (act.computedAttackBonus !== null) {
    const sign = act.computedAttackBonus >= 0 ? '+' : '';
    return `${sign}${act.computedAttackBonus} / ${act.computedDamage ?? 'Roll'}`;
  }
  if (act.type === 'save' && act.computedSaveDc !== null && act.saveAbility) {
    const dmg = act.computedDamage ? ` • ${act.computedDamage}` : '';
    return `DC ${act.computedSaveDc} ${act.saveAbility.toUpperCase()}${dmg}`;
  }
  if (act.type === 'heal' && act.computedDamage) {
    return `Heal ${act.computedDamage}`;
  }
  if (act.type === 'summon') {
    return 'Summon';
  }
  if (act.computedDamage) {
    return `Roll ${act.computedDamage}`;
  }
  return 'Use';
}

export function ActionEconomyBoard({
  sheet,
  rollMode,
  onChangeRollMode,
  onTriggerActivity,
  onRollInlineExpression,
}: ActionEconomyBoardProps) {
  const [filter, setFilter] = useState<'all' | 'attack' | 'save' | 'heal' | 'summon' | 'concentration'>('all');
  const [search, setSearch] = useState('');

  const matchesFilter = (act: ResolvedActivity): boolean => {
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${act.name} ${act.parentItemName} ${act.resolvedDescription ?? act.description ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter === 'attack') return act.type === 'attack';
    if (filter === 'save') return act.type === 'save';
    if (filter === 'heal') return act.type === 'heal';
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
      <div className="card forge-stack">
        <div className="forge-row-between" style={{ flexWrap: 'wrap' }}>
          <div className="pill-row">
            {(['all', 'attack', 'save', 'heal', 'summon', 'concentration'] as const).map((pill) => (
              <button
                key={pill}
                type="button"
                className={`pill ${filter === pill ? 'active' : ''}`}
                onClick={() => setFilter(pill)}
              >
                {pill === 'concentration' ? 'CONC' : pill.toUpperCase()}
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

        <input
          aria-label="Filter actions and spells"
          type="text"
          className="forge-input"
          placeholder="Filter actions, spells, features..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {ECONOMY_SECTIONS.map(({ key, label }) => {
        const pool =
          key === 'free'
            ? [...sheet.actionsByEconomy.free, ...sheet.actionsByEconomy.special]
            : sheet.actionsByEconomy[key];
        const items = pool.filter(matchesFilter);
        return (
          <section key={key} className="card">
            <div className="forge-section-label">
              {label.toUpperCase()} ({items.length})
            </div>
            {items.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No matching actions.</div>
            ) : (
              items.map((act) => {
                const desc = act.resolvedDescription ?? act.description;
                return (
                  <div key={act.id} className="forge-list-row">
                    <div>
                      <strong>{act.name}</strong>{' '}
                      <span className="forge-muted" style={{ fontSize: 11 }}>
                        ({act.parentItemName})
                      </span>
                      {act.concentration && <span className="conc-badge">CONC</span>}
                      {act.resourceCost && (
                        <span className="cost-badge">
                          {formatResourceBadge(act.resourceCost.poolId)}
                        </span>
                      )}
                      {desc && (
                        <div className="forge-muted">
                          {renderTaggedDescription(act.name, desc)}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary tabular forge-nowrap"
                      onClick={() => onTriggerActivity(act)}
                    >
                      {formatActivityActionLabel(act)}
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
