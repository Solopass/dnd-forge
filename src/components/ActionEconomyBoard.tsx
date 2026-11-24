import { useState } from 'react';
import { ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { ActionEconomy, RollMode } from '../types/core';
import { parse5eToolsEntries } from '../engine/tags';
import { scaleDiceForUpcast } from '../engine/dice';

interface ActionEconomyBoardProps {
  sheet: ResolvedCharacterSheet;
  rollMode: RollMode;
  onChangeRollMode: (mode: RollMode) => void;
  onTriggerActivity: (activity: ResolvedActivity, slotLevelOverride?: number, asRitual?: boolean) => void;
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

function formatActivityActionLabel(act: ResolvedActivity, overrideDamage?: string | null): string {
  const dmgText = overrideDamage ?? act.computedDamage;
  if (act.computedAttackBonus !== null) {
    const sign = act.computedAttackBonus >= 0 ? '+' : '';
    return `${sign}${act.computedAttackBonus} / ${dmgText ?? 'Roll'}`;
  }
  if (act.type === 'save' && act.computedSaveDc !== null && act.saveAbility) {
    const dmg = dmgText ? ` • ${dmgText}` : '';
    return `DC ${act.computedSaveDc} ${act.saveAbility.toUpperCase()}${dmg}`;
  }
  if (act.type === 'heal' && dmgText) {
    return `Heal ${dmgText}`;
  }
  if (act.type === 'summon') {
    return 'Summon';
  }
  if (dmgText) {
    return `Roll ${dmgText}`;
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
  const [upcastOverrides, setUpcastOverrides] = useState<Record<string, number>>({});

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
                const slotMatch = act.resourceCost?.poolId.match(/^spell_slot_(\d+)$/);
                const baseSlotLvl = slotMatch?.[1] ? Number.parseInt(slotMatch[1], 10) : 0;
                const higherSlots =
                  baseSlotLvl > 0 && act.upcastDicePerLevel
                    ? sheet.resources
                        .map((r) => {
                          const m = r.id.match(/^spell_slot_(\d+)$/);
                          const lvl = m?.[1] ? Number.parseInt(m[1], 10) : 0;
                          return { lvl, pool: r };
                        })
                        .filter((x) => x.lvl >= baseSlotLvl && x.pool.max > 0)
                    : [];
                const chosenSlot = upcastOverrides[act.id] ?? baseSlotLvl;
                const extraLevels = baseSlotLvl > 0 ? Math.max(0, chosenSlot - baseSlotLvl) : 0;
                const previewDamage =
                  act.computedDamage && act.upcastDicePerLevel && extraLevels > 0
                    ? scaleDiceForUpcast(act.computedDamage, act.upcastDicePerLevel, extraLevels)
                    : act.computedDamage;
                return (
                  <div key={act.id} className="forge-list-row">
                    <div>
                      <strong>{act.name}</strong>{' '}
                      <span className="forge-muted" style={{ fontSize: 11 }}>
                        ({act.parentItemName})
                      </span>
                      {act.concentration && <span className="conc-badge">CONC</span>}
                      {act.ritual && <span className="ritual-badge">RITUAL</span>}
                      {act.resourceCost && (
                        <span className="cost-badge">
                          {formatResourceBadge(act.resourceCost.poolId)}
                        </span>
                      )}
                      {act.spellMeta && (
                        <div className="forge-muted" style={{ fontSize: 10 }}>
                          {[act.spellMeta.castingTime, act.spellMeta.range, act.spellMeta.duration, act.spellMeta.components]
                            .filter(Boolean)
                            .join(' • ')}
                        </div>
                      )}
                      {desc && (
                        <div className="forge-muted">
                          {renderTaggedDescription(act.name, desc)}
                        </div>
                      )}
                    </div>

                    <div className="forge-row">
                      {act.ritual && (
                        <button
                          type="button"
                          className="btn forge-nowrap"
                          title="Cast as Ritual (10 min, spends no spell slot)"
                          onClick={() => onTriggerActivity(act, undefined, true)}
                        >
                          Ritual
                        </button>
                      )}
                      {higherSlots.length > 1 && (
                        <select
                          aria-label={`Cast level for ${act.name}`}
                          className="forge-input tabular"
                          style={{ padding: '3px 4px', fontSize: 11 }}
                          value={chosenSlot}
                          onChange={(e) => {
                            const lvl = Number.parseInt(e.target.value, 10);
                            setUpcastOverrides((prev) => ({ ...prev, [act.id]: lvl }));
                          }}
                        >
                          {higherSlots.map(({ lvl, pool }) => (
                            <option key={lvl} value={lvl}>
                              L{lvl} ({pool.current}/{pool.max})
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary tabular forge-nowrap"
                        onClick={() =>
                          onTriggerActivity(act, chosenSlot > baseSlotLvl ? chosenSlot : undefined)
                        }
                      >
                        {formatActivityActionLabel(act, previewDamage)}
                      </button>
                    </div>
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
