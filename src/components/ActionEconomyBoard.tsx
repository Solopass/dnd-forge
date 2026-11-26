import { useState } from 'react';
import { RawCharacterState, ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { ActionEconomy, ActiveBuffState, RollMode } from '../types/core';
import { UiMode } from '../engine/ui-mode';
import { resolveConditionRollMode } from '../engine/conditions';
import { parse5eToolsEntries } from '../engine/tags';
import { scaleDiceForUpcast } from '../engine/dice';
import { BackpackIcon, ScrollIcon, SparklesIcon, SwordsIcon } from './Icons';
import { InventoryHub } from './InventoryHub';
import { CampaignRecord } from '../types/campaign';
import { ItemCategory } from '../types/compendium';

interface ActionEconomyBoardProps {
  sheet: ResolvedCharacterSheet;
  rawChar?: RawCharacterState;
  layoutVariant?: UiMode;
  rollMode: RollMode;
  onChangeRollMode: (mode: RollMode) => void;
  onTriggerActivity: (activity: ResolvedActivity, slotLevelOverride?: number, asRitual?: boolean) => void;
  onRollInlineExpression: (label: string, expression: string) => void;
  onToggleEquipped?: (itemId: string) => void;
  onTogglePrepared?: (itemId: string) => void;
  onToggleAttuned?: (itemId: string) => void;
  onAdjustResource?: (poolId: string, delta: number) => void;
  onOpenGearDrawer?: () => void;
  onOpenBuilderDrawer?: () => void;
  activeBuffs?: ActiveBuffState;
  flankingRule?: 'off' | 'advantage' | 'plus2';
  onToggleBuff?: (key: keyof ActiveBuffState) => void;
  onDivineSmite?: (slotLevel: number) => void;
  onRollCheck?: (label: string, modifier: number) => void;
  campaign?: CampaignRecord | null;
  onUpdateQuantity?: (itemId: string, delta: number) => void;
  onUpdateContainer?: (itemId: string, container: string) => void;
  onUpdateCurrency?: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
  onSimplifyCurrency?: () => void;
  onDepositToPartyStash?: (itemId: string) => void;
  onClaimPartyStashItem?: (stashId: string) => void;
  onAddPartyStashItem?: (name: string, category: ItemCategory, quantity: number) => void;
  onInspectItem?: (itemId: string) => void;
  onOpenCompendium?: (category: ItemCategory) => void;
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
  onTogglePrepared,
  onToggleAttuned,
  onAdjustResource,
  onOpenGearDrawer,
  onOpenBuilderDrawer,
  activeBuffs,
  flankingRule = 'off',
  onToggleBuff,
  onDivineSmite,
  onRollCheck,
  campaign,
  onUpdateQuantity,
  onUpdateContainer,
  onUpdateCurrency,
  onSimplifyCurrency,
  onDepositToPartyStash,
  onClaimPartyStashItem,
  onAddPartyStashItem,
  onInspectItem,
  onOpenCompendium,
}: ActionEconomyBoardProps) {
  const [beyondTab, setBeyondTab] = useState<'actions' | 'spells' | 'inventory' | 'features'>('actions');
  const [filter, setFilter] = useState<'all' | 'attack' | 'save' | 'heal' | 'summon' | 'concentration'>('all');
  const [search, setSearch] = useState('');
  const [spellbookFilter, setSpellbookFilter] = useState<'all' | 'prepared'>('all');
  const [upcastOverrides, setUpcastOverrides] = useState<Record<string, number>>({});
  const [smiteLevel, setSmiteLevel] = useState(1);
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('dnd-forge-pinned-actions');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const togglePin = (actId: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(actId) ? prev.filter((id) => id !== actId) : [...prev, actId];
      try {
        localStorage.setItem('dnd-forge-pinned-actions', JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

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
          {onInspectItem ? (
            <button
              type="button"
              onClick={() => onInspectItem(act.parentItemId)}
              className="action-economy__button"
              title="Open full details in right Inspector panel"
            >
              <strong>{act.name}</strong>
            </button>
          ) : (
            <strong>{act.name}</strong>
          )}{' '}
          <span className="forge-muted text-sm">
            ({act.parentItemName})
          </span>
          {act.concentration && <span className="conc-badge">CONC</span>}
          {act.ritual && <span className="ritual-badge">RITUAL</span>}
          {act.weaponMastery && (
            <span
              className="badge action-economy__badge"
              title={`2024 Weapon Mastery: ${act.weaponMastery}`}
            >
              Mastery: {act.weaponMastery}
            </span>
          )}
          {act.resourceCost && (
            <span className="cost-badge">
              {formatResourceBadge(act.resourceCost.poolId)}
            </span>
          )}
          {act.spellMeta && (
            <div className="forge-muted text-xs">
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
          <button
            type="button"
            className="btn btn-sm action-economy__btn"
            style={{ color: pinnedIds.includes(act.id) ? 'var(--accent-amber)' : 'var(--text-muted)' }}
            title={pinnedIds.includes(act.id) ? 'Unpin from favorites' : 'Pin to favorites'}
            aria-label={pinnedIds.includes(act.id) ? `Unpin ${act.name}` : `Pin ${act.name}`}
            onClick={() => togglePin(act.id)}
          >
            {pinnedIds.includes(act.id) ? '★' : '☆'}
          </button>
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
              className="forge-input tabular action-economy__input"
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
          <span key={i} className="action-economy__span">
            {seg.display}
          </span>
        );
      }
      if (seg.kind === 'ref') {
        return (
          <span key={i} className="action-economy__span-2">
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
          <div className="forge-row-between wrap">
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

          <div className="forge-row-between wrap gap-2">
            {layoutVariant === 'unified' && onOpenCompendium && (
              <div className="forge-row gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-primary action-economy__btn-2"
                  onClick={() => onOpenCompendium('spell')}
                >
                  + Add Spell
                </button>
                <button
                  type="button"
                  className="btn btn-sm action-economy__btn-2"
                  onClick={() => onOpenCompendium('gear')}
                >
                  + Add Gear
                </button>
              </div>
            )}
            {onToggleBuff && (
              <div className="pill-row" aria-label="Combat buff toggles">
                <button
                  type="button"
                  className={`pill ${activeBuffs?.bless ? 'active' : ''}`}
                  title="Add +1d4 to attack rolls"
                  onClick={() => onToggleBuff('bless')}
                >
                  Bless +1d4
                </button>
                {(() => {
                  const hasRage =
                    rawChar?.classes.some((c) => c.className.toLowerCase() === 'barbarian') ||
                    rawChar?.items.some((i) => i.name.toLowerCase().includes('rage'));
                  if (!hasRage) return null;
                  return (
                    <button
                      type="button"
                      className={`pill ${activeBuffs?.rage ? 'active' : ''}`}
                      title="Add +2 damage to weapon attacks"
                      onClick={() => onToggleBuff('rage')}
                    >
                      Rage +2
                    </button>
                  );
                })()}
                {(() => {
                  const hasSneak =
                    rawChar?.classes.some((c) => c.className.toLowerCase() === 'rogue') ||
                    rawChar?.items.some((i) => i.name.toLowerCase().includes('sneak attack'));
                  if (!hasSneak) return null;
                  return (
                    <button
                      type="button"
                      className={`pill ${activeBuffs?.sneakAttack ? 'active' : ''}`}
                      title="Add Sneak Attack dice (+ceil(Level/2)d6)"
                      onClick={() => onToggleBuff('sneakAttack')}
                    >
                      Sneak Atk +{Math.max(1, Math.ceil(sheet.totalLevel / 2))}d6
                    </button>
                  );
                })()}
                {flankingRule !== 'off' && (
                  <button
                    type="button"
                    className={`pill ${activeBuffs?.flanking ? 'active' : ''}`}
                    title={`Optional Flanking rule (${flankingRule === 'advantage' ? 'Advantage on melee attacks' : '+2 to melee attack rolls'})`}
                    onClick={() => onToggleBuff('flanking')}
                  >
                    Flanking {flankingRule === 'advantage' ? '(ADV)' : '(+2)'}
                  </button>
                )}
                {onDivineSmite && (() => {
                  const hasSmite =
                    rawChar?.classes.some((c) => c.className.toLowerCase() === 'paladin') ||
                    rawChar?.items.some((i) => i.name.toLowerCase().includes('divine smite'));
                  if (!hasSmite) return null;
                  const availableSmiteLevels = [1, 2, 3, 4, 5].filter(
                    (lvl) => (sheet.resources.find((r) => r.id === `spell_slot_${lvl}`)?.current ?? 0) > 0
                  );
                  if (availableSmiteLevels.length === 0) return null;
                  const chosen = availableSmiteLevels.includes(smiteLevel)
                    ? smiteLevel
                    : availableSmiteLevels[0]!;
                  const diceCount = Math.min(6, chosen + 1);
                  return (
                    <div className="forge-row gap-1">
                      {availableSmiteLevels.length > 1 && (
                        <select
                          aria-label="Divine Smite slot level"
                          className="forge-input tabular action-economy__input-2"
                          value={chosen}
                          onChange={(e) => setSmiteLevel(Number.parseInt(e.target.value, 10))}
                        >
                          {availableSmiteLevels.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              L{lvl}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="pill action-economy__pill"
                        title={`Spend a Level ${chosen} slot to roll ${diceCount}d8 Radiant Divine Smite`}
                        onClick={() => onDivineSmite(chosen)}
                      >
                        Smite L{chosen} ({diceCount}d8)
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {(() => {
              const autoCond = resolveConditionRollMode(sheet.conditions, 'attack', undefined, rollMode);
              if (autoCond.reasons.length === 0) return null;
              return (
                <span
                  className="badge"
                  style={{
                    borderColor:
                      autoCond.mode === 'disadvantage'
                        ? 'var(--accent-red-border)'
                        : autoCond.mode === 'advantage'
                          ? 'var(--accent-green-border)'
                          : 'var(--border-subtle)',
                    color:
                      autoCond.mode === 'disadvantage'
                        ? 'var(--accent-red)'
                        : autoCond.mode === 'advantage'
                          ? 'var(--accent-green)'
                          : 'var(--text-secondary)',
                  }}
                  title={`Auto condition roll state: ${autoCond.reasons.join(', ')}`}
                >
                  {autoCond.reasons[0]}
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {layoutVariant === 'classic' && beyondTab === 'spells' && (() => {
        const spellSlotPools = sheet.resources
          .map((r) => {
            const m = r.id.match(/^spell_slot_(\d+)$/);
            return m?.[1] ? { lvl: Number.parseInt(m[1], 10), pool: r } : null;
          })
          .filter((x): x is { lvl: number; pool: typeof sheet.resources[number] } => Boolean(x && x.pool.max > 0))
          .sort((a, b) => a.lvl - b.lvl);

        const pactPool = sheet.resources.find(
          (r) => (r.id === 'pact_magic' || r.id === 'auto_class_pact_magic') && r.max > 0
        );

        return (
          <section className="card forge-stack">
            <div className="card-header">
              <div className="forge-section-label">SPELLCASTING</div>
              <div className="pill-row tabular">
                <span className="badge">Save DC {sheet.spellcasting.saveDc.final}</span>
                <span className="badge">Atk +{sheet.spellcasting.attackBonus.final}</span>
                <span
                  className="badge"
                  style={
                    sheet.spellcasting.maxPrepared !== null &&
                    sheet.spellcasting.preparedCount > sheet.spellcasting.maxPrepared
                      ? { color: 'var(--accent-amber)', borderColor: 'var(--accent-amber-border)' }
                      : undefined
                  }
                  title={
                    sheet.spellcasting.maxPrepared !== null &&
                    sheet.spellcasting.preparedCount > sheet.spellcasting.maxPrepared
                      ? 'Over your class prepared spell limit'
                      : undefined
                  }
                >
                  {sheet.spellcasting.maxPrepared !== null
                    ? `Prepared ${sheet.spellcasting.preparedCount}/${sheet.spellcasting.maxPrepared}${
                        sheet.spellcasting.preparedCount > sheet.spellcasting.maxPrepared ? ' ⚠' : ''
                      }`
                    : `Prepared ${sheet.spellcasting.preparedCount}`}
                </span>
                {onOpenCompendium && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary action-economy__btn-2"
                    onClick={() => onOpenCompendium('spell')}
                  >
                    + Add Spell
                  </button>
                )}
              </div>
            </div>
            {(spellSlotPools.length > 0 || pactPool) && (
              <div className="subpanel forge-row action-economy__subpanel">
                {spellSlotPools.map(({ lvl, pool }) => (
                  <div key={pool.id} className="forge-row gap-1">
                    <span className="muted-label tabular">L{lvl}</span>
                    {Array.from({ length: pool.max }).map((_, idx) => {
                      const filled = idx < pool.current;
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`pill ${filled ? 'active' : ''}`}
                          style={{ minWidth: 22, padding: '1px 5px', fontSize: 11 }}
                          aria-label={`Level ${lvl} spell slot ${idx + 1} (${filled ? 'available' : 'spent'})`}
                          title={filled ? `Spend Level ${lvl} slot` : `Restore Level ${lvl} slot`}
                          onClick={() => onAdjustResource?.(pool.id, filled ? -1 : 1)}
                        >
                          {filled ? '●' : '○'}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {pactPool && (
                  <div className="forge-row action-economy__row" style={{ borderLeft: spellSlotPools.length > 0 ? '1px solid var(--border-subtle)' : undefined, paddingLeft: spellSlotPools.length > 0 ? 10 : 0 }}>
                    <span className="muted-label tabular action-economy__muted-label">
                      Pact (SR)
                    </span>
                    {Array.from({ length: pactPool.max }).map((_, idx) => {
                      const filled = idx < pactPool.current;
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`pill ${filled ? 'active' : ''}`}
                          style={{ minWidth: 22, padding: '1px 5px', fontSize: 11, borderColor: 'var(--accent-amber-border)' }}
                          aria-label={`Pact Magic slot ${idx + 1} (${filled ? 'available' : 'spent'})`}
                          title={filled ? 'Spend Pact Magic slot (Short Rest)' : 'Restore Pact Magic slot'}
                          onClick={() => onAdjustResource?.(pactPool.id, filled ? -1 : 1)}
                        >
                          {filled ? '◆' : '◇'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {ECONOMY_SECTIONS.flatMap((s) =>
              (s.key === 'free'
                ? [...sheet.actionsByEconomy.free, ...sheet.actionsByEconomy.special]
                : sheet.actionsByEconomy[s.key]
              ).filter((act) => isSpellActivity(act) && matchesFilter(act))
            ).map(renderActivityRow)}
            {(() => {
              const allSpells = (rawChar?.items ?? [])
                .filter((i) => i.category === 'spell')
                .filter(
                  (i) =>
                    spellbookFilter === 'all' ||
                    Boolean(i.prepared) ||
                    Boolean(i.alwaysPrepared) ||
                    (i.spellLevel ?? 0) === 0
                )
                .sort((a, b) => (a.spellLevel ?? 0) - (b.spellLevel ?? 0) || a.name.localeCompare(b.name));
              if (allSpells.length === 0) {
                return (
                  <div className="forge-muted text-md">
                    No spells on your sheet yet. Click <strong>+ Add Spell</strong> above to browse 650+ spells.
                  </div>
                );
              }
              return (
                <div className="forge-stack action-economy__stack">
                  <div className="forge-row-between wrap gap-2">
                    <div className="forge-section-label mb-0">
                      SPELLBOOK &amp; PREPARATION ({allSpells.length})
                    </div>
                    <div className="pill-row">
                      <button
                        type="button"
                        className={`pill ${spellbookFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setSpellbookFilter('all')}
                      >
                        All Known
                      </button>
                      <button
                        type="button"
                        className={`pill ${spellbookFilter === 'prepared' ? 'active' : ''}`}
                        onClick={() => setSpellbookFilter('prepared')}
                      >
                        Prepared Only
                      </button>
                    </div>
                  </div>
                  {allSpells.map((sp) => (
                    <div key={sp.id} className="forge-list-row action-economy__list-row">
                      <div className="forge-row gap-2 wrap">
                        <span className="badge tabular text-xs">
                          {(sp.spellLevel ?? 0) === 0 ? 'Cantrip' : `L${sp.spellLevel}`}
                        </span>
                        {onInspectItem ? (
                          <button
                            type="button"
                            onClick={() => onInspectItem(sp.id)}
                            className="action-economy__button-2"
                          >
                            <strong>{sp.name}</strong>
                          </button>
                        ) : (
                          <strong>{sp.name}</strong>
                        )}
                        {sp.concentration && <span className="conc-badge">CONC</span>}
                        {sp.ritual && <span className="ritual-badge">RITUAL</span>}
                      </div>
                      {(sp.spellLevel ?? 0) > 0 && !sp.alwaysPrepared && onTogglePrepared ? (
                        <button
                          type="button"
                          className={`pill ${sp.prepared ? 'active' : ''}`}
                          onClick={() => onTogglePrepared(sp.id)}
                        >
                          {sp.prepared ? 'Prepared ★' : 'Prepare'}
                        </button>
                      ) : (
                        <span className="badge text-xs">
                          {sp.alwaysPrepared ? 'Always Prep' : 'Ready'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </section>
        );
      })()}

      {layoutVariant === 'classic' && beyondTab === 'inventory' && rawChar && (
        <section className="card forge-stack">
          <InventoryHub
            mode="both"
            characterName={rawChar.name}
            items={rawChar.items}
            currency={rawChar.currency}
            attunementCount={sheet.attunementCount}
            campaign={campaign ?? null}
            onToggleEquipped={onToggleEquipped ?? (() => {})}
            onToggleAttuned={onToggleAttuned ?? (() => {})}
            onUpdateQuantity={onUpdateQuantity ?? (() => {})}
            onUpdateContainer={onUpdateContainer}
            onUpdateCurrency={onUpdateCurrency}
            onSimplifyCurrency={onSimplifyCurrency}
            onDepositToPartyStash={onDepositToPartyStash}
            onClaimPartyStashItem={onClaimPartyStashItem}
            onAddPartyStashItem={onAddPartyStashItem}
            onOpenGearDrawer={onOpenGearDrawer}
            onInspectItem={onInspectItem}
            onOpenCompendium={onOpenCompendium}
          />
        </section>
      )}

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
              {rawChar?.xp !== undefined && (
                <span className="badge tabular">XP {rawChar.xp.toLocaleString()}</span>
              )}
              {rawChar?.details?.alignment && (
                <span className="badge">{rawChar.details.alignment}</span>
              )}
              {rawChar?.details?.size && (
                <span className="badge">{rawChar.details.size}</span>
              )}
            </div>
            {rawChar?.structuredProficiencies && (
              <div className="subpanel forge-stack action-economy__subpanel-2">
                <div className="forge-section-label">PROFICIENCIES &amp; LANGUAGES</div>
                {rawChar.structuredProficiencies.armor.length > 0 && (
                  <div className="forge-row wrap gap-1">
                    <span className="forge-muted text-sm">Armor:</span>
                    {rawChar.structuredProficiencies.armor.map((a) => (
                      <span key={a} className="badge">{a}</span>
                    ))}
                  </div>
                )}
                {rawChar.structuredProficiencies.weapons.length > 0 && (
                  <div className="forge-row wrap gap-1">
                    <span className="forge-muted text-sm">Weapons:</span>
                    {rawChar.structuredProficiencies.weapons.map((w) => (
                      <span key={w} className="badge">{w}</span>
                    ))}
                  </div>
                )}
                {rawChar.structuredProficiencies.tools.length > 0 && (
                  <div className="forge-row wrap gap-1">
                    <span className="forge-muted text-sm">Tools:</span>
                    {rawChar.structuredProficiencies.tools.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className="pill"
                        title={`Roll ${t} check (+${sheet.proficiencyBonus.final} Prof + DEX)`}
                        onClick={() =>
                          onRollCheck?.(`${t} (Tool)`, sheet.proficiencyBonus.final + sheet.abilities.dex.modifier)
                        }
                      >
                        🎲 {t}
                      </button>
                    ))}
                  </div>
                )}
                {rawChar.structuredProficiencies.languages.length > 0 && (
                  <div className="forge-row wrap gap-1">
                    <span className="forge-muted text-sm">Languages:</span>
                    {rawChar.structuredProficiencies.languages.map((l) => (
                      <span key={l} className="badge">{l}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {rawChar?.details &&
              Object.values(rawChar.details).some((v) => Boolean(v && v.trim())) && (
                <div className="subpanel forge-stack action-economy__subpanel-3">
                  <div className="forge-section-label">CHARACTER DETAILS</div>
                  <div className="pill-row text-sm">
                    {rawChar.details.age && <span className="badge">Age: {rawChar.details.age}</span>}
                    {rawChar.details.height && <span className="badge">Height: {rawChar.details.height}</span>}
                    {rawChar.details.weight && <span className="badge">Weight: {rawChar.details.weight}</span>}
                    {rawChar.details.eyes && <span className="badge">Eyes: {rawChar.details.eyes}</span>}
                    {rawChar.details.skin && <span className="badge">Skin: {rawChar.details.skin}</span>}
                    {rawChar.details.hair && <span className="badge">Hair: {rawChar.details.hair}</span>}
                  </div>
                  {rawChar.details.traits && <div className="text-md"><strong>Traits:</strong> {rawChar.details.traits}</div>}
                  {rawChar.details.ideals && <div className="text-md"><strong>Ideals:</strong> {rawChar.details.ideals}</div>}
                  {rawChar.details.bonds && <div className="text-md"><strong>Bonds:</strong> {rawChar.details.bonds}</div>}
                  {rawChar.details.flaws && <div className="text-md"><strong>Flaws:</strong> {rawChar.details.flaws}</div>}
                  {rawChar.details.allies && <div className="text-md"><strong>Allies:</strong> {rawChar.details.allies}</div>}
                  {rawChar.details.backstory && <div className="text-md pre-wrap"><strong>Backstory:</strong> {rawChar.details.backstory}</div>}
                </div>
              )}
            {featItems.length === 0 ? (
              <div className="forge-muted">No class features or feats listed yet.</div>
            ) : (
              featItems.map((feat) => (
                <div key={feat.id} className="forge-list-row action-economy__list-row-2">
                  <div>
                    {onInspectItem ? (
                      <button
                        type="button"
                        onClick={() => onInspectItem(feat.id)}
                        className="action-economy__button"
                        title="Open full details in right Inspector panel"
                      >
                        <strong>{feat.name}</strong>
                      </button>
                    ) : (
                      <strong>{feat.name}</strong>
                    )}{' '}
                    <span className="badge">{feat.category.toUpperCase()}</span>
                    {feat.source && <span className="forge-muted text-sm"> • {feat.source}</span>}
                  </div>
                  {feat.entries.length > 0 && (
                    <div className="forge-muted text-md">
                      {renderTaggedDescription(feat.name, feat.entries[0] ?? '')}
                    </div>
                  )}
                </div>
              ))
            )}
            {rawChar?.notes && (rawChar.notes.proficiencies || rawChar.notes.bio || rawChar.notes.campaign) && (
              <div className="subpanel forge-stack action-economy__subpanel-4">
                <div className="forge-section-label">PROFICIENCIES &amp; NOTES</div>
                {rawChar.notes.proficiencies && (
                  <div className="pre-wrap text-md">
                    <strong>Proficiencies:</strong> {rawChar.notes.proficiencies}
                  </div>
                )}
                {rawChar.notes.bio && (
                  <div className="pre-wrap text-md">{rawChar.notes.bio}</div>
                )}
                {rawChar.notes.campaign && (
                  <div className="pre-wrap text-md">{rawChar.notes.campaign}</div>
                )}
              </div>
            )}
          </section>
        );
      })()}

      {(layoutVariant === 'unified' || beyondTab === 'actions') && (() => {
        const allAvailable = [
          ...sheet.actionsByEconomy.action,
          ...sheet.actionsByEconomy.bonus_action,
          ...sheet.actionsByEconomy.reaction,
          ...sheet.actionsByEconomy.free,
          ...sheet.actionsByEconomy.special,
        ];
        const pinnedItems = allAvailable.filter((act) => pinnedIds.includes(act.id) && matchesFilter(act));
        if (pinnedItems.length === 0) return null;
        return (
          <section className="card action-economy__card">
            <div className="card-header">
              <div className="forge-section-label action-economy__muted-label">
                ★ PINNED FAVORITES ({pinnedItems.length})
              </div>
            </div>
            {pinnedItems.map(renderActivityRow)}
          </section>
        );
      })()}

      {(layoutVariant === 'unified' || beyondTab === 'actions') &&
        ECONOMY_SECTIONS.map(({ key, label }) => {
        const pool =
          key === 'free'
            ? [...sheet.actionsByEconomy.free, ...sheet.actionsByEconomy.special]
            : sheet.actionsByEconomy[key];
        const items = pool.filter((act) => matchesFilter(act));
        return (
          <section key={key} className="card">
            <div className="card-header">
              <div className="forge-section-label">
                {label.toUpperCase()} ({items.length})
              </div>
            </div>
            {items.length === 0 ? (
              <div className="action-economy__div">No matching actions.</div>
            ) : (
              items.map(renderActivityRow)
            )}
          </section>
        );
      })}
    </main>
  );
}
