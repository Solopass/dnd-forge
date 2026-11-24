import { ReactNode, useRef, useState } from 'react';
import {
  BUILTIN_LAYOUT_PRESETS,
  moveWidgetById,
  reorderWidget,
  resizeWidget,
  toggleWidgetVisibility,
} from '../engine/layout-engine';
import {
  WidgetColSpan,
  WidgetHeightPreset,
  WidgetId,
  WorkspaceLayoutConfig,
} from '../types/layout';
import { RawCharacterState, ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { AbilityKey, ActiveBuffState, RollMode, SkillKey, STANDARD_CONDITIONS } from '../types/core';
import { CombatEncounterState } from '../types/combat';
import { SKILL_ABILITY_MAP } from '../engine/rules-math';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
import { resolveConditionRollMode } from '../engine/conditions';
import { parse5eToolsEntries } from '../engine/tags';
import { scaleDiceForUpcast } from '../engine/dice';

interface ModularCanvasProps {
  layout: WorkspaceLayoutConfig;
  onChangeLayout: (next: WorkspaceLayoutConfig) => void;
  isEditing: boolean;
  onToggleEditing: (editing: boolean) => void;
  onOpenThemeStudio: () => void;
  sheet: ResolvedCharacterSheet;
  rawChar: RawCharacterState;
  rollMode: RollMode;
  onChangeRollMode: (mode: RollMode) => void;
  activeBuffs: ActiveBuffState;
  flankingRule: 'off' | 'advantage' | 'plus2';
  onToggleBuff: (key: keyof ActiveBuffState) => void;
  onDivineSmite: (slotLevel: number) => void;
  onTriggerActivity: (activity: ResolvedActivity, slotLevelOverride?: number, asRitual?: boolean) => void;
  onRollInlineExpression: (label: string, expression: string) => void;
  onAdjustHp: (delta: number) => void;
  onSetTempHp: (temp: number) => void;
  onSetExhaustion: (level: number) => void;
  onRollAbilityCheck: (ability: AbilityKey) => void;
  onRollSavingThrow: (ability: AbilityKey) => void;
  onRollSkillCheck: (skill: SkillKey) => void;
  onToggleCondition: (condition: string) => void;
  onAdjustResource: (poolId: string, delta: number) => void;
  onToggleEquipped: (itemId: string) => void;
  onToggleAttuned: (itemId: string) => void;
  onOpenBuilderDrawer: () => void;
  onOpenGearDrawer: () => void;
  encounter: CombatEncounterState;
  combatDrawerNode: ReactNode;
  miniVttNode: ReactNode;
  consoleLines: Array<{ id: string; text: string; tone: string }>;
}

const VALID_SPANS: WidgetColSpan[] = [3, 4, 6, 8, 12];

export function ModularCanvas({
  layout,
  onChangeLayout,
  isEditing,
  onToggleEditing,
  onOpenThemeStudio,
  sheet,
  rawChar,
  rollMode,
  onChangeRollMode,
  activeBuffs,
  flankingRule,
  onToggleBuff,
  onDivineSmite,
  onTriggerActivity,
  onRollInlineExpression,
  onAdjustHp,
  onSetTempHp,
  onSetExhaustion,
  onRollAbilityCheck,
  onRollSavingThrow,
  onRollSkillCheck,
  onToggleCondition,
  onAdjustResource,
  onToggleEquipped,
  onToggleAttuned,
  onOpenBuilderDrawer,
  onOpenGearDrawer,
  combatDrawerNode,
  miniVttNode,
  consoleLines,
}: ModularCanvasProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hpInput, setHpInput] = useState('5');
  const [condSelect, setCondSelect] = useState('Poisoned');
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('dnd-forge-pinned-actions');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const togglePin = (id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem('dnd-forge-pinned-actions', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const hiddenWidgets = layout.widgets.filter((w) => !w.visible);
  const allActivities: ResolvedActivity[] = [
    ...sheet.actionsByEconomy.action,
    ...sheet.actionsByEconomy.bonus_action,
    ...sheet.actionsByEconomy.reaction,
    ...sheet.actionsByEconomy.free,
    ...sheet.actionsByEconomy.special,
  ];
  const isSpell = (a: ResolvedActivity) =>
    Boolean(a.spellMeta || a.resourceCost?.poolId.startsWith('spell_slot_'));

  const startResizePointer = (widgetId: WidgetId, startSpan: WidgetColSpan, startX: number) => {
    const canvasWidth = canvasRef.current?.getBoundingClientRect().width || 1100;
    const colWidth = canvasWidth / 12;

    const onMove = (ev: PointerEvent) => {
      const deltaCols = Math.round((ev.clientX - startX) / Math.max(40, colWidth));
      const targetRaw = Math.max(3, Math.min(12, startSpan + deltaCols));
      const snapped = VALID_SPANS.reduce((best, cand) =>
        Math.abs(cand - targetRaw) < Math.abs(best - targetRaw) ? cand : best
      );
      onChangeLayout(resizeWidget(layout, widgetId, snapped));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderActivityCompact = (act: ResolvedActivity) => {
    const dmg = act.computedDamage;
    const label =
      act.computedAttackBonus !== null
        ? `${act.computedAttackBonus >= 0 ? '+' : ''}${act.computedAttackBonus} / ${dmg ?? 'Roll'}`
        : act.type === 'save' && act.computedSaveDc !== null
          ? `DC ${act.computedSaveDc} ${act.saveAbility?.toUpperCase() ?? ''}`
          : dmg
            ? scaleDiceForUpcast(dmg, act.upcastDicePerLevel, 0)
            : 'Use';
    const descText = (act.resolvedDescription ?? act.description ?? '').trim();
    const parsed = descText
      ? parse5eToolsEntries(descText)
          .map((s) => (s.kind === 'text' ? s.value : s.display))
          .join('')
      : '';
    return (
      <div key={act.id} className="forge-list-row" style={{ gap: 6 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>
            {act.name}{' '}
            {act.weaponMastery && (
              <span className="badge" style={{ color: 'var(--accent-gold)', fontSize: 10 }}>
                Mastery: {act.weaponMastery}
              </span>
            )}
          </div>
          {parsed && (
            <div className="forge-muted" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {parsed}
            </div>
          )}
        </div>
        <div className="forge-row" style={{ gap: 4 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: '2px 5px', fontSize: 11, color: pinnedIds.includes(act.id) ? 'var(--accent-gold)' : 'var(--text-muted)' }}
            onClick={() => togglePin(act.id)}
            aria-label={pinnedIds.includes(act.id) ? `Unpin ${act.name}` : `Pin ${act.name}`}
          >
            {pinnedIds.includes(act.id) ? '★' : '☆'}
          </button>
          <button
            type="button"
            className="btn btn-primary tabular forge-nowrap"
            onClick={() => onTriggerActivity(act)}
          >
            {label}
          </button>
        </div>
      </div>
    );
  };

  const renderWidgetBody = (id: WidgetId): ReactNode => {
    switch (id) {
      case 'vitals': {
        const hpAmt = Math.max(1, Number.parseInt(hpInput, 10) || 1);
        return (
          <div className="forge-stack">
            <div className="forge-row-between">
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{sheet.name}</div>
                <div className="forge-muted" style={{ fontSize: 11 }}>
                  Lvl {sheet.totalLevel} • {sheet.ruleset.toUpperCase()} • Prof +{sheet.proficiencyBonus.final}
                </div>
              </div>
              <button type="button" className="btn" onClick={onOpenBuilderDrawer}>
                Build
              </button>
            </div>
            <div className="pill-row tabular">
              <span className="badge">AC {sheet.ac.final}</span>
              <span className="badge">
                Init {sheet.initiative.final >= 0 ? `+${sheet.initiative.final}` : sheet.initiative.final}
              </span>
              <span className="badge">Speed {sheet.speed.final} ft</span>
            </div>
            <div className="subpanel forge-row-between" style={{ padding: '8px 10px' }}>
              <div className="tabular">
                <span style={{ fontSize: 20, fontWeight: 800 }}>{sheet.hp.current}</span>
                <span className="forge-muted"> / {sheet.hp.max} HP</span>
                {sheet.hp.temp > 0 && <span className="badge" style={{ marginLeft: 6 }}>+{sheet.hp.temp} Temp</span>}
              </div>
              <div className="forge-row" style={{ gap: 4 }}>
                <input
                  aria-label="HP amount"
                  type="number"
                  min={1}
                  className="forge-input tabular"
                  style={{ width: 52 }}
                  value={hpInput}
                  onChange={(e) => setHpInput(e.target.value)}
                />
                <button type="button" className="btn btn-danger" onClick={() => onAdjustHp(-hpAmt)}>
                  Dmg
                </button>
                <button type="button" className="btn btn-primary" onClick={() => onAdjustHp(hpAmt)}>
                  Heal
                </button>
                <button type="button" className="btn" onClick={() => onSetTempHp(hpAmt)}>
                  +Temp
                </button>
              </div>
            </div>
          </div>
        );
      }

      case 'abilities':
        return (
          <div className="ability-grid">
            {ABILITIES.map((ab) => {
              const stat = sheet.abilities[ab];
              const modSign = stat.modifier >= 0 ? '+' : '';
              const saveSign = stat.save.final >= 0 ? '+' : '';
              return (
                <div key={ab} className="ability-tile">
                  <div className="ability-tile-head">
                    <strong>{ab}</strong>
                    <span className="badge tabular">{stat.score.final}</span>
                  </div>
                  <div className="forge-row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="btn tabular"
                      style={{ flex: 1 }}
                      onClick={() => onRollAbilityCheck(ab)}
                    >
                      {modSign}
                      {stat.modifier}
                    </button>
                    <button
                      type="button"
                      className="btn tabular"
                      style={{ flex: 1 }}
                      title="Saving Throw"
                      onClick={() => onRollSavingThrow(ab)}
                    >
                      Sv {saveSign}
                      {stat.save.final}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );

      case 'skills':
        return (
          <div className="forge-stack">
            <div className="pill-row tabular">
              <span className="badge">PP {sheet.passivePerception}</span>
              <span className="badge">PI {sheet.passiveInvestigation}</span>
              <span className="badge">PIn {sheet.passiveInsight}</span>
            </div>
            <div className="forge-stack" style={{ maxHeight: 240, overflowY: 'auto' }}>
              {(Object.keys(SKILL_ABILITY_MAP) as SkillKey[]).map((sk) => {
                const val = sheet.skills[sk].final;
                return (
                  <div key={sk} className="forge-list-row">
                    <span style={{ fontSize: 12 }}>
                      {sk} <span className="forge-muted">({SKILL_ABILITY_MAP[sk].toUpperCase()})</span>
                    </span>
                    <button
                      type="button"
                      className="btn tabular"
                      onClick={() => onRollSkillCheck(sk)}
                    >
                      {val >= 0 ? `+${val}` : val}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'conditions': {
        const autoCond = resolveConditionRollMode(sheet.conditions, 'attack', undefined, rollMode);
        return (
          <div className="forge-stack">
            <div className="forge-row" style={{ flexWrap: 'wrap' }}>
              <select
                aria-label="Condition selector"
                className="forge-input"
                style={{ flex: 1 }}
                value={condSelect}
                onChange={(e) => setCondSelect(e.target.value)}
              >
                {STANDARD_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={() => onToggleCondition(condSelect)}>
                Toggle
              </button>
              <span className="badge tabular">Exh {sheet.exhaustion}</span>
              <button
                type="button"
                className="btn"
                onClick={() => onSetExhaustion(Math.max(0, sheet.exhaustion - 1))}
              >
                -
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onSetExhaustion(Math.min(6, sheet.exhaustion + 1))}
              >
                +
              </button>
            </div>
            <div className="pill-row">
              {sheet.conditions.length === 0 ? (
                <span className="forge-muted" style={{ fontSize: 12 }}>No active conditions.</span>
              ) : (
                sheet.conditions.map((c) => (
                  <button key={c} type="button" className="pill active" onClick={() => onToggleCondition(c)}>
                    {c} ×
                  </button>
                ))
              )}
              {autoCond.reasons.length > 0 && (
                <span className="badge" style={{ color: 'var(--accent-warning)' }}>
                  {autoCond.reasons[0]}
                </span>
              )}
            </div>
          </div>
        );
      }

      case 'buffs_actions': {
        const nonSpellActions = allActivities.filter((a) => !isSpell(a));
        return (
          <div className="forge-stack">
            <div className="pill-row">
              {(['disadvantage', 'normal', 'advantage'] as RollMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pill ${rollMode === m ? 'active' : ''}`}
                  onClick={() => onChangeRollMode(m)}
                >
                  {m === 'disadvantage' ? 'DIS' : m === 'advantage' ? 'ADV' : 'FLAT'}
                </button>
              ))}
              <button
                type="button"
                className={`pill ${activeBuffs.bless ? 'active' : ''}`}
                onClick={() => onToggleBuff('bless')}
              >
                Bless +1d4
              </button>
              <button
                type="button"
                className={`pill ${activeBuffs.rage ? 'active' : ''}`}
                onClick={() => onToggleBuff('rage')}
              >
                Rage +2
              </button>
              <button
                type="button"
                className={`pill ${activeBuffs.sneakAttack ? 'active' : ''}`}
                onClick={() => onToggleBuff('sneakAttack')}
              >
                Sneak +{Math.max(1, Math.ceil(sheet.totalLevel / 2))}d6
              </button>
              {flankingRule !== 'off' && (
                <button
                  type="button"
                  className={`pill ${activeBuffs.flanking ? 'active' : ''}`}
                  onClick={() => onToggleBuff('flanking')}
                >
                  Flank {flankingRule === 'advantage' ? '(ADV)' : '(+2)'}
                </button>
              )}
              {(sheet.resources.find((r) => r.id === 'spell_slot_1')?.current ?? 0) > 0 && (
                <button type="button" className="pill" onClick={() => onDivineSmite(1)}>
                  Smite L1
                </button>
              )}
            </div>
            <div className="forge-stack">
              {nonSpellActions.length === 0 ? (
                <div className="forge-muted" style={{ fontSize: 12 }}>No weapon/class actions yet.</div>
              ) : (
                nonSpellActions.map(renderActivityCompact)
              )}
            </div>
          </div>
        );
      }

      case 'pinned_favorites': {
        const pinned = allActivities.filter((a) => pinnedIds.includes(a.id));
        return pinned.length === 0 ? (
          <div className="forge-muted" style={{ fontSize: 12 }}>
            Click ☆ on any action or spell to pin your favorites here.
          </div>
        ) : (
          <div className="forge-stack">{pinned.map(renderActivityCompact)}</div>
        );
      }

      case 'spells': {
        const slotPools = sheet.resources
          .map((r) => {
            const m = r.id.match(/^spell_slot_(\d+)$/);
            return m?.[1] ? { lvl: Number.parseInt(m[1], 10), pool: r } : null;
          })
          .filter((x): x is { lvl: number; pool: ResolvedCharacterSheet['resources'][number] } => x !== null && x.pool.max > 0);
        const spellActs = allActivities.filter(isSpell);
        return (
          <div className="forge-stack">
            <div className="pill-row tabular">
              <span className="badge">Save DC {sheet.spellcasting.saveDc.final}</span>
              <span className="badge">Atk +{sheet.spellcasting.attackBonus.final}</span>
            </div>
            {slotPools.length > 0 && (
              <div className="forge-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {slotPools.map(({ lvl, pool }) => (
                  <div key={pool.id} className="forge-row" style={{ gap: 3 }}>
                    <span className="muted-label tabular">L{lvl}</span>
                    {Array.from({ length: pool.max }).map((_, i) => {
                      const filled = i < pool.current;
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`pill ${filled ? 'active' : ''}`}
                          style={{ padding: '1px 5px', fontSize: 10 }}
                          onClick={() => onAdjustResource(pool.id, filled ? -1 : 1)}
                        >
                          {filled ? '●' : '○'}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            <div className="forge-stack">
              {spellActs.length === 0 ? (
                <div className="forge-muted" style={{ fontSize: 12 }}>No prepared spells.</div>
              ) : (
                spellActs.map(renderActivityCompact)
              )}
            </div>
          </div>
        );
      }

      case 'inventory': {
        const gear = rawChar.items.filter(
          (i) => i.category === 'weapon' || i.category === 'armor' || i.category === 'shield' || i.category === 'gear'
        );
        return (
          <div className="forge-stack">
            <div className="forge-row-between">
              <span className="badge tabular">
                GP {rawChar.currency?.gp ?? 0} • Attuned {sheet.attunementCount}/3
              </span>
              <button type="button" className="btn" onClick={onOpenGearDrawer}>
                Manage Gear
              </button>
            </div>
            {gear.map((item) => (
              <div key={item.id} className="forge-list-row">
                <span style={{ fontSize: 12 }}>{item.name}</span>
                <div className="forge-row" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className={`pill ${item.equipped ? 'active' : ''}`}
                    onClick={() => onToggleEquipped(item.id)}
                  >
                    {item.equipped ? 'Eq' : 'Stow'}
                  </button>
                  {item.requiresAttunement && (
                    <button
                      type="button"
                      className={`pill ${item.attuned ? 'active' : ''}`}
                      onClick={() => onToggleAttuned(item.id)}
                    >
                      Att
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'features_notes': {
        const feats = rawChar.items.filter((i) => i.category === 'feature' || i.category === 'feat');
        return (
          <div className="forge-stack">
            {feats.map((f) => (
              <div key={f.id} className="subpanel" style={{ padding: '6px 8px' }}>
                <strong style={{ fontSize: 12 }}>{f.name}</strong>
                {f.entries[0] && <div className="forge-muted" style={{ fontSize: 11 }}>{f.entries[0]}</div>}
              </div>
            ))}
            {rawChar.notes?.bio && <div className="forge-muted" style={{ fontSize: 11 }}>{rawChar.notes.bio}</div>}
          </div>
        );
      }

      case 'combat_tracker':
        return <div style={{ minWidth: 0 }}>{combatDrawerNode}</div>;

      case 'mini_vtt':
        return <div style={{ minWidth: 0 }}>{miniVttNode}</div>;

      case 'dice_console':
        return (
          <div className="forge-stack">
            <div className="forge-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {['1d20', '1d12', '1d10', '1d8', '1d6', '1d4'].map((expr) => (
                <button
                  key={expr}
                  type="button"
                  className="btn tabular"
                  onClick={() => onRollInlineExpression(`Quick ${expr}`, expr)}
                >
                  {expr}
                </button>
              ))}
            </div>
            <div className="forge-stack" style={{ maxHeight: 160, overflowY: 'auto' }}>
              {consoleLines.slice(-8).reverse().map((line) => (
                <div key={line.id} className="forge-muted tabular" style={{ fontSize: 11 }}>
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="modular-shell">
      {isEditing && (
        <div className="modular-edit-bar" role="region" aria-label="Layout editor toolbar">
          <div className="forge-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <strong>Customize Blocks</strong>
            <select
              aria-label="Load layout preset"
              className="forge-input"
              value={layout.id}
              onChange={(e) => {
                const preset = BUILTIN_LAYOUT_PRESETS.find((p) => p.id === e.target.value);
                if (preset) onChangeLayout(structuredClone(preset));
              }}
            >
              {BUILTIN_LAYOUT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  Preset: {p.name}
                </option>
              ))}
              {!BUILTIN_LAYOUT_PRESETS.some((p) => p.id === layout.id) && (
                <option value={layout.id}>{layout.name}</option>
              )}
            </select>
            <button type="button" className="btn" onClick={onOpenThemeStudio}>
              Theme &amp; Share...
            </button>
          </div>
          <div className="forge-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="btn"
              onClick={() => onChangeLayout(structuredClone(BUILTIN_LAYOUT_PRESETS[0]!))}
            >
              Reset Default
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onToggleEditing(false)}>
              Done Editing
            </button>
          </div>
          {hiddenWidgets.length > 0 && (
            <div className="pill-row" style={{ width: '100%' }}>
              <span className="muted-label">Hidden blocks (click to restore):</span>
              {hiddenWidgets.map((hw) => (
                <button
                  key={hw.id}
                  type="button"
                  className="pill"
                  onClick={() => onChangeLayout(toggleWidgetVisibility(layout, hw.id))}
                >
                  + {hw.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        ref={canvasRef}
        className={`modular-canvas ${isEditing ? 'editing' : ''}`}
        style={{
          gap: layout.gap === 'tight' ? 6 : layout.gap === 'wide' ? 16 : 10,
        }}
      >
        {layout.widgets.map((w, idx) => {
          if (!w.visible) return null;
          return (
            <section
              key={w.id}
              className={`widget-frame height-${w.heightPreset} ${isEditing ? 'editing' : ''} ${
                dragOverIndex === idx ? 'drag-over' : ''
              }`}
              style={{ gridColumn: `span ${w.colSpan}` }}
              draggable={isEditing}
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => {
                if (!isEditing) return;
                e.preventDefault();
                setDragOverIndex(idx);
              }}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== idx) {
                  onChangeLayout(reorderWidget(layout, dragIndex, idx));
                }
                setDragIndex(null);
                setDragOverIndex(null);
              }}
            >
              <div className="widget-toolbar">
                <div className="widget-drag-handle">
                  {isEditing && <span aria-hidden="true">⠿</span>}
                  <span>{w.label.toUpperCase()}</span>
                </div>
                {isEditing && (
                  <div className="forge-row" style={{ flexWrap: 'wrap', gap: 4 }}>
                    <button
                      type="button"
                      className="btn"
                      title="Move earlier"
                      onClick={() => onChangeLayout(moveWidgetById(layout, w.id, -1))}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="btn"
                      title="Move later"
                      onClick={() => onChangeLayout(moveWidgetById(layout, w.id, 1))}
                    >
                      →
                    </button>
                    {VALID_SPANS.map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        className={`pill ${w.colSpan === sp ? 'active' : ''}`}
                        style={{ padding: '1px 5px', fontSize: 10 }}
                        onClick={() => onChangeLayout(resizeWidget(layout, w.id, sp))}
                      >
                        {sp === 12 ? 'Full' : `${sp}/12`}
                      </button>
                    ))}
                    <select
                      aria-label={`${w.label} height`}
                      className="forge-input"
                      style={{ padding: '1px 4px', fontSize: 10 }}
                      value={w.heightPreset}
                      onChange={(e) =>
                        onChangeLayout(
                          resizeWidget(layout, w.id, w.colSpan, e.target.value as WidgetHeightPreset)
                        )
                      }
                    >
                      <option value="auto">Auto H</option>
                      <option value="compact">Compact H</option>
                      <option value="tall">Tall H</option>
                    </select>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onChangeLayout(toggleWidgetVisibility(layout, w.id))}
                    >
                      Hide
                    </button>
                  </div>
                )}
              </div>

              <div className="widget-body">{renderWidgetBody(w.id)}</div>

              {isEditing && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${w.label} width`}
                  tabIndex={0}
                  className="widget-resize-handle"
                  title="Drag horizontally to resize width"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startResizePointer(w.id, w.colSpan, e.clientX);
                  }}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
