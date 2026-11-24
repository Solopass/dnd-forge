import { useState } from 'react';
import { RawCharacterState, ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { ActionEconomy, RollMode } from '../types/core';
import { UiMode } from '../engine/ui-mode';
import { parse5eToolsEntries } from '../engine/tags';
import { scaleDiceForUpcast } from '../engine/dice';
import { BackpackIcon, ScrollIcon, SparklesIcon, SwordsIcon } from './Icons';

interface ActionEconomyBoardProps {
  sheet: ResolvedCharacterSheet;
  rawChar?: RawCharacterState;
  layoutVariant?: UiMode;
  rollMode: RollMode;
  onChangeRollMode: (mode: RollMode) => void;
  onTriggerActivity: (activity: ResolvedActivity, slotLevelOverride?: number, asRitual?: boolean) => void;
  onRollInlineExpression: (label: string, expression: string) => void;
  onToggleEquipped?: (itemId: string) => void;
  onToggleAttuned?: (itemId: string) => void;
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
  rawChar,
  layoutVariant = 'classic',
  rollMode,
  onChangeRollMode,
  onTriggerActivity,
  onRollInlineExpression,
  onToggleEquipped,
  onToggleAttuned,
  onOpenGearDrawer,
  onOpenBuilderDrawer,
}: ActionEconomyBoardProps) {
  const [beyondTab, setBeyondTab] = useState<'actions' | 'spells' | 'inventory' | 'features'>('actions');
  const [filter, setFilter] = useState<'all' | 'attack' | 'save' | 'heal' | 'summon' | 'concentration'>('all');
  const [search, setSearch] = useState('');
  const [upcastOverrides, setUpcastOverrides] = useState<Record<string, number>>({});

  const isSpellActivity = (act: ResolvedActivity): boolean =>
    Boolean(act.spellMeta || act.resourceCost?.poolId.startsWith('spell_slot_'));

  const renderActivityRow = (act: ResolvedActivity) => {
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
  };

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
              ['actions', 'Actions', <SwordsIcon key="i-a" size={13} />],
              ['spells', 'Spells', <SparklesIcon key="i-s" size={13} />],
              ['inventory', 'Inventory', <BackpackIcon key="i-i" size={13} />],
              ['features', 'Features & Notes', <ScrollIcon key="i-f" size={13} />],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={beyondTab === key}
              className={`beyond-tab ${beyondTab === key ? 'active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => setBeyondTab(key)}
            >
              {icon}
              <span>{label}</span>
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
          ).map(renderActivityRow)}
        </section>
      )}

      {layoutVariant === 'classic' && beyondTab === 'inventory' && (() => {
        const gearItems = (rawChar?.items ?? []).filter(
          (i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'shield' || i.category === 'gear'
        );
        const cur = rawChar?.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
        return (
          <section className="card forge-stack">
            <div className="card-header">
              <div className="forge-section-label">EQUIPMENT, CURRENCY &amp; ATTUNEMENT ({gearItems.length})</div>
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
              <span className="badge tabular">
                Purse: {cur.pp}pp • {cur.gp}gp • {cur.sp}sp • {cur.cp}cp
              </span>
            </div>
            {gearItems.length === 0 ? (
              <div className="forge-muted">No gear carried yet. Click Manage Gear &amp; Currency to add items.</div>
            ) : (
              gearItems.map((item) => (
                <div key={item.id} className="forge-list-row">
                  <div>
                    <strong>{item.name}</strong>{' '}
                    <span className="badge">{item.category.toUpperCase()}</span>
                    {(item.quantity ?? 1) > 1 && <span className="badge tabular">×{item.quantity}</span>}
                    {item.entries[0] && (
                      <div className="forge-muted" style={{ fontSize: 11 }}>{item.entries[0]}</div>
                    )}
                  </div>
                  <div className="forge-row">
                    {onToggleEquipped && (
                      <button
                        type="button"
                        className={`pill ${item.equipped ? 'active' : ''}`}
                        onClick={() => onToggleEquipped(item.id)}
                      >
                        {item.equipped ? 'Equipped' : 'Equip'}
                      </button>
                    )}
                    {item.requiresAttunement && onToggleAttuned && (
                      <button
                        type="button"
                        className={`pill ${item.attuned ? 'active' : ''}`}
                        onClick={() => onToggleAttuned(item.id)}
                      >
                        {item.attuned ? 'Attuned' : 'Attune'}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        );
      })()}

      {layoutVariant === 'classic' && beyondTab === 'features' && (() => {
        const featItems = (rawChar?.items ?? []).filter(
          (i) => i.category === 'feature' || i.category === 'feat' || i.category === 'infusion'
        );
        return (
          <section className="card forge-stack">
            <div className="card-header">
              <div className="forge-section-label">FEATURES, FEATS &amp; NOTES ({featItems.length})</div>
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
            {featItems.length === 0 ? (
              <div className="forge-muted">No class features or feats listed yet.</div>
            ) : (
              featItems.map((feat) => (
                <div key={feat.id} className="forge-list-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <div>
                    <strong>{feat.name}</strong>{' '}
                    <span className="badge">{feat.category.toUpperCase()}</span>
                    {feat.source && <span className="forge-muted" style={{ fontSize: 11 }}> • {feat.source}</span>}
                  </div>
                  {feat.entries.length > 0 && (
                    <div className="forge-muted" style={{ fontSize: 12 }}>
                      {renderTaggedDescription(feat.name, feat.entries[0] ?? '')}
                    </div>
                  )}
                </div>
              ))
            )}
            {rawChar?.notes && (rawChar.notes.proficiencies || rawChar.notes.bio || rawChar.notes.campaign) && (
              <div className="subpanel forge-stack" style={{ padding: 8 }}>
                <div className="forge-section-label">PROFICIENCIES &amp; NOTES</div>
                {rawChar.notes.proficiencies && (
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                    <strong>Proficiencies:</strong> {rawChar.notes.proficiencies}
                  </div>
                )}
                {rawChar.notes.bio && (
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{rawChar.notes.bio}</div>
                )}
                {rawChar.notes.campaign && (
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{rawChar.notes.campaign}</div>
                )}
              </div>
            )}
          </section>
        );
      })()}

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
              items.map(renderActivityRow)
            )}
          </section>
        );
      })}
    </main>
  );
}
