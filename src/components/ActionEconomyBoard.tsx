import { useState } from 'react';
import { ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { ActionEconomy, RollMode } from '../types/core';
import { UiMode } from '../engine/ui-mode';
import { parse5eToolsEntries } from '../engine/tags';
import { scaleDiceForUpcast } from '../engine/dice';

interface ActionEconomyBoardProps {
  sheet: ResolvedCharacterSheet;
  layoutVariant?: UiMode;
  rollMode: RollMode;
  onChangeRollMode: (mode: RollMode) => void;
  onTriggerActivity: (activity: ResolvedActivity, slotLevelOverride?: number, asRitual?: boolean) => void;
  onRollInlineExpression: (label: string, expression: string) => void;
  onOpenGearDrawer?: () => void;
  onOpenBuilderDrawer?: () => void;
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
  layoutVariant = 'classic',
  rollMode,
  onChangeRollMode,
  onTriggerActivity,
  onRollInlineExpression,
  onOpenGearDrawer,
  onOpenBuilderDrawer,
}: ActionEconomyBoardProps) {
  const [beyondTab, setBeyondTab] = useState<'actions' | 'spells' | 'inventory' | 'features'>('actions');
  const [filter, setFilter] = useState<'all' | 'attack' | 'save' | 'heal' | 'summon' | 'concentration'>('all');
  const [search, setSearch] = useState('');
  const [upcastOverrides, setUpcastOverrides] = useState<Record<string, number>>({});

  const isSpellActivity = (act: ResolvedActivity): boolean =>
    Boolean(act.spellMeta || act.resourceCost?.poolId.startsWith('spell_slot_'));

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
      {layoutVariant === 'classic' && (
        <div className="beyond-tabs" role="tablist" aria-label="Character sheet sections">
          {(
            [
              ['actions', 'Actions'],
              ['spells', 'Spells'],
              ['inventory', 'Inventory'],
              ['features', 'Features & Notes'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={beyondTab === key}
              className={`beyond-tab ${beyondTab === key ? 'active' : ''}`}
              onClick={() => setBeyondTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(layoutVariant === 'unified' || beyondTab === 'actions' || beyondTab === 'spells') && (
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
      )}

      {layoutVariant === 'classic' && beyondTab === 'spells' && (
        <section className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">SPELLCASTING</div>
            <div className="pill-row tabular">
              <span className="badge">Save DC {sheet.spellcasting.saveDc.final}</span>
              <span className="badge">Atk +{sheet.spellcasting.attackBonus.final}</span>
              <span className="badge">
                Prepared {sheet.spellcasting.preparedCount}/{sheet.spellcasting.maxPrepared}
              </span>
            </div>
          </div>
          {ECONOMY_SECTIONS.flatMap((s) =>
            (s.key === 'free'
              ? [...sheet.actionsByEconomy.free, ...sheet.actionsByEconomy.special]
              : sheet.actionsByEconomy[s.key]
            ).filter((act) => isSpellActivity(act) && matchesFilter(act))
          ).map((act) => (
            <div key={act.id} className="forge-list-row">
              <div>
                <strong>{act.name}</strong>{' '}
                {act.concentration && <span className="conc-badge">CONC</span>}
                {act.ritual && <span className="ritual-badge">RITUAL</span>}
                {act.resourceCost && (
                  <span className="cost-badge">{formatResourceBadge(act.resourceCost.poolId)}</span>
                )}
                {act.spellMeta && (
                  <div className="forge-muted" style={{ fontSize: 10 }}>
                    {[act.spellMeta.castingTime, act.spellMeta.range, act.spellMeta.duration]
                      .filter(Boolean)
                      .join(' • ')}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary tabular forge-nowrap"
                onClick={() => onTriggerActivity(act)}
              >
                {formatActivityActionLabel(act, act.computedDamage)}
              </button>
            </div>
          ))}
        </section>
      )}

      {layoutVariant === 'classic' && beyondTab === 'inventory' && (
        <section className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">EQUIPMENT &amp; ATTUNEMENT</div>
            {onOpenGearDrawer && (
              <button type="button" className="btn btn-primary" onClick={onOpenGearDrawer}>
                Manage Gear &amp; Currency
              </button>
            )}
          </div>
          <div className="pill-row">
            <span className="badge tabular">Attuned: {sheet.attunementCount} / 3</span>
            <span className="badge tabular">AC: {sheet.ac.final}</span>
            <span className="badge tabular">Speed: {sheet.speed.final} ft</span>
          </div>
          <div className="forge-muted">
            Click <strong>Manage Gear &amp; Currency</strong> to equip armor/weapons, attune magic items, track gold pieces, or craft homebrew gear.
          </div>
        </section>
      )}

      {layoutVariant === 'classic' && beyondTab === 'features' && (
        <section className="card forge-stack">
          <div className="card-header">
            <div className="forge-section-label">FEATURES, SENSES &amp; PROFICIENCIES</div>
            {onOpenBuilderDrawer && (
              <button type="button" className="btn btn-primary" onClick={onOpenBuilderDrawer}>
                Open Character Builder
              </button>
            )}
          </div>
          <div className="pill-row">
            <span className="badge tabular">Proficiency +{sheet.proficiencyBonus.final}</span>
            <span className="badge tabular">Passive Perception {sheet.passivePerception}</span>
            <span className="badge tabular">Initiative {sheet.initiative.final >= 0 ? `+${sheet.initiative.final}` : sheet.initiative.final}</span>
          </div>
          <div className="forge-muted">
            All class features, feats, saving throws, and custom character notes are editable in the Character Builder or Gear &amp; Notes drawer.
          </div>
        </section>
      )}

      {(layoutVariant === 'unified' || beyondTab === 'actions') &&
        ECONOMY_SECTIONS.map(({ key, label }) => {
        const pool =
          key === 'free'
            ? [...sheet.actionsByEconomy.free, ...sheet.actionsByEconomy.special]
            : sheet.actionsByEconomy[key];
        const items = pool.filter(
          (act) => matchesFilter(act) && (layoutVariant === 'unified' || !isSpellActivity(act))
        );
        return (
          <section key={key} className="card">
            <div className="card-header">
              <div className="forge-section-label">
                {label.toUpperCase()} ({items.length})
              </div>
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
