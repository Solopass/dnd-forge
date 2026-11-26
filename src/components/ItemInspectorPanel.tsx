import React, { useState } from 'react';
import { ResolvedActivity, ResolvedCharacterSheet } from '../types/character';
import { CompendiumEntity } from '../types/compendium';
import { parse5eToolsEntries } from '../engine/tags';
import { scaleDiceForUpcast } from '../engine/dice';
import { canHaveMagicBonus, clampMagicBonus, displayItemName } from '../engine/magic-variants';
import { EntityImage } from './EntityImage';

interface ItemInspectorPanelProps {
  item: CompendiumEntity | null;
  sheet: ResolvedCharacterSheet;
  onTriggerActivity: (activity: ResolvedActivity, slotLevelOverride?: number, asRitual?: boolean) => void;
  onRollInlineExpression: (label: string, expression: string) => void;
  onToggleEquipped: (id: string) => void;
  onTogglePrepared: (id: string) => void;
  onToggleAttuned: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onUpdateContainer: (id: string, container: string) => void;
  onDepositToPartyStash: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onUpdateMagic?: (id: string, patch: { magicBonus?: 0 | 1 | 2 | 3; customName?: string }) => void;
  /** Opens the Report / fix editor for the compendium entry this item came from (omitted when it is not from the compendium). */
  onReportFix?: (item: CompendiumEntity) => void;
  onBackToCombat?: () => void;
}

export const ItemInspectorPanel: React.FC<ItemInspectorPanelProps> = ({
  item,
  sheet,
  onTriggerActivity,
  onRollInlineExpression,
  onToggleEquipped,
  onTogglePrepared,
  onToggleAttuned,
  onUpdateQuantity,
  onUpdateContainer,
  onDepositToPartyStash,
  onRemoveItem,
  onUpdateMagic,
  onReportFix,
  onBackToCombat,
}) => {
  const [upcastLevel, setUpcastLevel] = useState<number | null>(null);

  if (!item) {
    return (
      <div className="card forge-stack" style={{ padding: 14 }}>
        <div className="forge-section-label">ITEM &amp; SPELL INSPECTOR</div>
        <div className="forge-muted text-md">
          Click any <strong>spell, weapon, inventory item, or feature/feat</strong> on your sheet to inspect its full rules text, metadata, and rollable actions here.
        </div>
      </div>
    );
  }

  const allResolvedActivities = [
    ...sheet.actionsByEconomy.action,
    ...sheet.actionsByEconomy.bonus_action,
    ...sheet.actionsByEconomy.reaction,
    ...sheet.actionsByEconomy.free,
    ...sheet.actionsByEconomy.special,
  ].filter((a) => a.parentItemId === item.id);

  const isPhysical =
    item.category === 'weapon' ||
    item.category === 'armor' ||
    item.category === 'shield' ||
    item.category === 'gear';

  const isSpell = item.category === 'spell';

  const renderTaggedText = (text: string, keyPrefix: string) => {
    const segments = parse5eToolsEntries(text);
    return segments.map((seg, i) => {
      if (seg.kind === 'text') return <span key={`${keyPrefix}-${i}`}>{seg.value}</span>;
      if (seg.kind === 'roll') {
        return (
          <button
            key={`${keyPrefix}-${i}`}
            type="button"
            className="inline-roll-chip"
            title={`Roll ${seg.expression}`}
            onClick={() => onRollInlineExpression(`${item.name}: ${seg.display}`, seg.expression)}
          >
            {seg.display}
          </button>
        );
      }
      if (seg.kind === 'save') {
        return (
          <span key={`${keyPrefix}-${i}`} className="badge" style={{ margin: '0 2px' }}>
            {seg.display}
          </span>
        );
      }
      return (
        <span
          key={`${keyPrefix}-${i}`}
          className="tag-ref-chip"
          title={`${seg.category}: ${seg.name}`}
        >
          {seg.display}
        </span>
      );
    });
  };

  return (
    <div className="card forge-stack gap-4">
      <div className="forge-row-between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>{displayItemName(item)}</div>
          <div className="pill-row" style={{ marginTop: 4 }}>
            <span className="badge">{item.category.toUpperCase()}</span>
            {item.ruleset && <span className="badge">{item.ruleset}</span>}
            {item.source && <span className="badge">{item.source}</span>}
            {item.alsoIn && item.alsoIn.length > 0 && (
              <span className="badge" title="Duplicate copies folded into this entry">
                also in: {item.alsoIn.join(', ')}
              </span>
            )}
            {isSpell && item.spellLevel !== undefined && (
              <span className="badge tabular">
                {item.spellLevel === 0 ? 'Cantrip' : `Level ${item.spellLevel}`}
              </span>
            )}
            {item.concentration && <span className="conc-badge">CONC</span>}
            {item.ritual && <span className="ritual-badge">RITUAL</span>}
            {item.weaponMastery && (
              <span
                className="badge"
                style={{ borderColor: 'var(--accent-amber-border)', color: 'var(--accent-amber)' }}
              >
                Mastery: {item.weaponMastery}
              </span>
            )}
          </div>
        </div>
        <div className="forge-row gap-2">
          {onReportFix && (
            <button type="button" className="btn text-sm" title="Report a mistake in this entry or propose a fix" onClick={() => onReportFix(item)}>
              Report / fix
            </button>
          )}
          {onBackToCombat && (
            <button type="button" className="btn text-sm" onClick={onBackToCombat}>
              Combat
            </button>
          )}
        </div>
      </div>

      {item.imageUrl && (
        <EntityImage src={item.imageUrl} name={item.name} category={item.category} size="inspector" artCredit={item.artCredit} />
      )}

      {/* Quick State Controls */}
      {isPhysical && (
        <div className="subpanel forge-row" style={{ padding: '6px 8px', flexWrap: 'wrap', gap: 6 }}>
          <button
            type="button"
            className={`pill ${item.equipped ? 'active' : ''}`}
            onClick={() => onToggleEquipped(item.id)}
          >
            {item.equipped ? 'Equipped' : 'Equip'}
          </button>
          {item.requiresAttunement && (
            <button
              type="button"
              className={`pill ${item.attuned ? 'active' : ''}`}
              onClick={() => onToggleAttuned(item.id)}
            >
              {item.attuned ? 'Attuned' : 'Attune'}
            </button>
          )}
          <div className="forge-row" style={{ gap: 3 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '1px 6px', fontSize: 11 }}
              onClick={() => onUpdateQuantity(item.id, -1)}
            >
              -
            </button>
            <span className="tabular" style={{ fontSize: 11, minWidth: 24, textAlign: 'center' }}>
              ×{item.quantity ?? 1}
            </span>
            <button
              type="button"
              className="btn"
              style={{ padding: '1px 6px', fontSize: 11 }}
              onClick={() => onUpdateQuantity(item.id, 1)}
            >
              +
            </button>
          </div>
          <select
            aria-label="Item container"
            className="forge-input"
            style={{ padding: '2px 6px', fontSize: 11, width: 105 }}
            value={item.container ?? ''}
            onChange={(e) => onUpdateContainer(item.id, e.target.value)}
          >
            <option value="">Carried</option>
            <option value="Backpack">Backpack</option>
            <option value="Bag of Holding">Bag of Holding</option>
            <option value="Pouch">Pouch</option>
          </select>
          <button
            type="button"
            className="btn text-sm"
            onClick={() => onDepositToPartyStash(item.id)}
          >
            → Party
          </button>
        </div>
      )}

      {isPhysical && canHaveMagicBonus(item) && onUpdateMagic && (
        <div className="subpanel magic-row">
          <label className="forge-muted text-sm" htmlFor={`magic-bonus-${item.id}`}>Magic bonus</label>
          <select
            id={`magic-bonus-${item.id}`}
            aria-label="Magic bonus"
            className="forge-input magic-row__bonus"
            value={item.magicBonus ?? 0}
            onChange={(e) => onUpdateMagic(item.id, { magicBonus: clampMagicBonus(Number(e.target.value)) })}
          >
            <option value={0}>+0</option>
            <option value={1}>+1</option>
            <option value={2}>+2</option>
            <option value={3}>+3</option>
          </select>
          <input
            type="text"
            aria-label="Custom item name"
            className="forge-input magic-row__name"
            placeholder={`Name (default: ${item.name})`}
            defaultValue={item.customName ?? ''}
            key={`${item.id}-${item.customName ?? ''}`}
            onBlur={(e) => {
              if (e.target.value.trim() !== (item.customName ?? '')) onUpdateMagic(item.id, { customName: e.target.value });
            }}
          />
        </div>
      )}

      {isSpell && (
        <div className="subpanel forge-row-between" style={{ padding: '6px 8px', flexWrap: 'wrap', gap: 6 }}>
          <div className="pill-row">
            {item.alwaysPrepared ? (
              <span className="badge" style={{ color: 'var(--accent-amber)' }}>
                Always Prepared
              </span>
            ) : (item.spellLevel ?? 0) > 0 ? (
              <button
                type="button"
                className={`pill ${item.prepared ? 'active' : ''}`}
                onClick={() => onTogglePrepared(item.id)}
              >
                {item.prepared ? 'Prepared ★' : 'Prepare Spell'}
              </button>
            ) : (
              <span className="badge">Cantrip (Always Ready)</span>
            )}
          </div>
        </div>
      )}

      {/* Spell / Item Metadata Grid */}
      {(isSpell || item.acFormula || item.acFlatBonus || item.weight) && (
        <div
          className="subpanel"
          style={{
            padding: '8px 10px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '6px 10px',
            fontSize: 11,
          }}
        >
          {item.castingTime && (
            <div>
              <span className="forge-muted">Casting Time:</span> <strong>{item.castingTime}</strong>
            </div>
          )}
          {item.range && (
            <div>
              <span className="forge-muted">Range:</span> <strong>{item.range}</strong>
            </div>
          )}
          {item.components && (
            <div>
              <span className="forge-muted">Components:</span> <strong>{item.components}</strong>
            </div>
          )}
          {item.duration && (
            <div>
              <span className="forge-muted">Duration:</span> <strong>{item.duration}</strong>
            </div>
          )}
          {item.acFormula && (
            <div>
              <span className="forge-muted">Base AC:</span>{' '}
              <strong>
                {item.acFormula.base}
                {item.acFormula.dexCap === null
                  ? ' + DEX'
                  : item.acFormula.dexCap > 0
                    ? ` + DEX (max ${item.acFormula.dexCap})`
                    : ''}
              </strong>
            </div>
          )}
          {item.acFlatBonus !== undefined && (
            <div>
              <span className="forge-muted">AC Bonus:</span> <strong>+{item.acFlatBonus}</strong>
            </div>
          )}
          {item.weight !== undefined && (
            <div>
              <span className="forge-muted">Weight:</span> <strong>{item.weight} lb</strong>
            </div>
          )}
        </div>
      )}

      {/* Full Description / Blocks of Text */}
      <div className="forge-stack" style={{ gap: 6, fontSize: 12, lineHeight: 1.5 }}>
        {item.entries.length > 0 ? (
          item.entries.map((para, idx) => (
            <div key={idx} className="pre-wrap">
              {renderTaggedText(para, `entry-${idx}`)}
            </div>
          ))
        ) : (
          <div className="forge-muted text-sm">
            No description text recorded for this item yet.
          </div>
        )}
      </div>

      {/* Rollable Activities */}
      {allResolvedActivities.length > 0 && (
        <div className="forge-stack" style={{ gap: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          <div className="forge-section-label">ACTIONS &amp; ROLLS</div>
          {allResolvedActivities.map((act) => {
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
            const chosenSlot = upcastLevel ?? baseSlotLvl;
            const extraLevels = baseSlotLvl > 0 ? Math.max(0, chosenSlot - baseSlotLvl) : 0;
            const previewDamage =
              act.computedDamage && act.upcastDicePerLevel && extraLevels > 0
                ? scaleDiceForUpcast(act.computedDamage, act.upcastDicePerLevel, extraLevels)
                : act.computedDamage;

            return (
              <div key={act.id} className="subpanel forge-row-between" style={{ padding: '6px 8px', flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <strong className="text-md">{act.name}</strong>
                  <div className="forge-muted tabular text-sm">
                    {act.computedAttackBonus !== null &&
                      `Hit ${act.computedAttackBonus >= 0 ? `+${act.computedAttackBonus}` : act.computedAttackBonus}`}
                    {act.computedSaveDc !== null && `DC ${act.computedSaveDc} ${act.saveAbility?.toUpperCase()}`}
                    {previewDamage && ` • ${previewDamage} ${act.damageType ?? ''}`}
                  </div>
                </div>
                <div className="forge-row gap-1">
                  {higherSlots.length > 1 && (
                    <select
                      aria-label="Upcast slot level"
                      className="forge-input tabular"
                      style={{ padding: '2px 4px', fontSize: 11, width: 52 }}
                      value={chosenSlot}
                      onChange={(e) => setUpcastLevel(Number.parseInt(e.target.value, 10))}
                    >
                      {higherSlots.map((s) => (
                        <option key={s.lvl} value={s.lvl}>
                          L{s.lvl}
                        </option>
                      ))}
                    </select>
                  )}
                  {act.ritual && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onTriggerActivity(act, undefined, true)}
                    >
                      Ritual
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onTriggerActivity(act, baseSlotLvl > 0 ? chosenSlot : undefined)}
                  >
                    {act.type === 'attack'
                      ? 'Attack'
                      : act.type === 'save'
                        ? 'Cast / Save'
                        : act.type === 'heal'
                          ? 'Heal'
                          : 'Use'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="forge-row-between" style={{ paddingTop: 4, borderTop: '1px solid var(--border-subtle)' }}>
        <span className="forge-muted text-xs">
          ID: {item.id}
        </span>
        <button
          type="button"
          className="btn"
          style={{ fontSize: 10, color: 'var(--accent-red)' }}
          onClick={() => onRemoveItem(item.id)}
        >
          Remove from Sheet
        </button>
      </div>
    </div>
  );
};
