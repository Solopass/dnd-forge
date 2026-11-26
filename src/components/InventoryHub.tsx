import React, { useState } from 'react';
import { CampaignRecord } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CompendiumEntity, ItemCategory } from '../types/compendium';
import { displayItemName } from '../engine/magic-variants';

interface InventoryHubProps {
  mode: 'personal' | 'party' | 'both';
  characterName: string;
  items: CompendiumEntity[];
  currency?: RawCharacterState['currency'];
  attunementCount: number;
  campaign: CampaignRecord | null;
  onToggleEquipped: (id: string) => void;
  onToggleAttuned: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onUpdateContainer?: (id: string, container: string) => void;
  onUpdateCurrency?: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
  onSimplifyCurrency?: () => void;
  onDepositToPartyStash?: (id: string) => void;
  onClaimPartyStashItem?: (stashId: string) => void;
  onAddPartyStashItem?: (name: string, category: ItemCategory, quantity: number) => void;
  onOpenGearDrawer?: () => void;
  onInspectItem?: (itemId: string) => void;
  onOpenCompendium?: (category: ItemCategory) => void;
}

const CONTAINERS = ['All', 'Equipped', 'Carried', 'Backpack', 'Bag of Holding', 'Pouch'] as const;
const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

export const InventoryHub: React.FC<InventoryHubProps> = ({
  mode,
  characterName,
  items,
  currency,
  attunementCount,
  campaign,
  onToggleEquipped,
  onToggleAttuned,
  onUpdateQuantity,
  onUpdateContainer,
  onUpdateCurrency,
  onSimplifyCurrency,
  onDepositToPartyStash,
  onClaimPartyStashItem,
  onAddPartyStashItem,
  onOpenGearDrawer,
  onInspectItem,
  onOpenCompendium,
}) => {
  const [activeView, setActiveView] = useState<'personal' | 'party'>(
    mode === 'party' ? 'party' : 'personal'
  );
  const [containerFilter, setContainerFilter] = useState<string>('All');
  const [stashName, setStashName] = useState('');
  const [stashQty, setStashQty] = useState(1);

  const view = mode === 'both' ? activeView : mode;
  const coins = currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const totalGpValue =
    coins.pp * 10 + coins.gp + coins.ep * 0.5 + coins.sp * 0.1 + coins.cp * 0.01;

  const gearItems = items.filter(
    (i) =>
      i.category === 'weapon' ||
      i.category === 'armor' ||
      i.category === 'shield' ||
      i.category === 'gear'
  );

  const filteredPersonal = gearItems.filter((item) => {
    if (containerFilter === 'All') return true;
    if (containerFilter === 'Equipped') return Boolean(item.equipped);
    if (containerFilter === 'Carried') return !item.container;
    return item.container === containerFilter;
  });

  const partyStash = campaign?.partyStash ?? [];

  return (
    <div className="forge-stack">
      {mode === 'both' && (
        <div className="forge-row-between wrap gap-2">
          <div className="pill-row">
            <button
              type="button"
              className={`pill ${view === 'personal' ? 'active' : ''}`}
              onClick={() => setActiveView('personal')}
            >
              My Inventory ({gearItems.length})
            </button>
            <button
              type="button"
              className={`pill ${view === 'party' ? 'active' : ''}`}
              onClick={() => setActiveView('party')}
            >
              Party Shared ({partyStash.length})
            </button>
          </div>
          {onOpenGearDrawer && (
            <button type="button" className="btn" onClick={onOpenGearDrawer}>
              Full Gear Drawer
            </button>
          )}
        </div>
      )}

      {view === 'personal' && (
        <div className="forge-stack">
          <div className="forge-row-between wrap gap-2">
            <div className="pill-row tabular text-sm">
              <span className="badge">Attuned {attunementCount}/3</span>
              <span className="badge">Purse {totalGpValue.toFixed(1)} gp</span>
            </div>
            <div className="forge-row gap-2">
              {onOpenCompendium && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => onOpenCompendium('gear')}
                >
                  + Add Gear
                </button>
              )}
              {onSimplifyCurrency && (
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                  onClick={onSimplifyCurrency}
                  title="Convert CP/SP/EP into optimal PP/GP/SP/CP"
                >
                  Simplify Coins
                </button>
              )}
            </div>
          </div>

          {onUpdateCurrency && (
            <div className="forge-row wrap gap-1">
              {COINS.map((coin) => (
                <div
                  key={coin}
                  className="subpanel forge-row"
                  style={{ padding: '2px 6px', gap: 4, fontSize: 11 }}
                >
                  <span className="forge-muted">{coin.toUpperCase()}</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '0 4px', fontSize: 10 }}
                    onClick={() => onUpdateCurrency(coin, Math.max(0, coins[coin] - 1))}
                  >
                    -
                  </button>
                  <strong className="tabular">{coins[coin]}</strong>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '0 4px', fontSize: 10 }}
                    onClick={() => onUpdateCurrency(coin, coins[coin] + 1)}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pill-row text-xs">
            {CONTAINERS.map((c) => (
              <button
                key={c}
                type="button"
                className={`pill ${containerFilter === c ? 'active' : ''}`}
                onClick={() => setContainerFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="forge-stack" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {filteredPersonal.length === 0 ? (
              <div className="forge-muted text-md">
                No items in {containerFilter}.
              </div>
            ) : (
              filteredPersonal.map((item) => (
                <div key={item.id} className="forge-list-row">
                  <div style={{ minWidth: 0 }}>
                    {onInspectItem ? (
                      <button
                        type="button"
                        onClick={() => onInspectItem(item.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'inherit',
                          font: 'inherit',
                          cursor: 'pointer',
                          textAlign: 'left',
                          textDecoration: 'underline',
                          textDecorationColor: 'var(--border-subtle)',
                          textUnderlineOffset: 2,
                        }}
                        title="Open full details in right Inspector panel"
                      >
                        <strong>{displayItemName(item)}</strong>
                      </button>
                    ) : (
                      <strong>{displayItemName(item)}</strong>
                    )}{' '}
                    <span className="forge-muted text-xs">
                      {item.category.toUpperCase()}
                      {item.container ? ` • ${item.container}` : ''}
                    </span>
                  </div>
                  <div className="pill-row" style={{ alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '1px 5px', fontSize: 10 }}
                      onClick={() => onUpdateQuantity(item.id, -1)}
                    >
                      -
                    </button>
                    <span className="tabular text-sm">
                      ×{item.quantity ?? 1}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '1px 5px', fontSize: 10 }}
                      onClick={() => onUpdateQuantity(item.id, 1)}
                    >
                      +
                    </button>
                    {onUpdateContainer && (
                      <select
                        aria-label={`${item.name} container`}
                        className="forge-input"
                        style={{ padding: '1px 4px', fontSize: 10, width: 78 }}
                        value={item.container ?? ''}
                        onChange={(e) => onUpdateContainer(item.id, e.target.value)}
                      >
                        <option value="">Carried</option>
                        <option value="Backpack">Backpack</option>
                        <option value="Bag of Holding">Bag of Holding</option>
                        <option value="Pouch">Pouch</option>
                      </select>
                    )}
                    <button
                      type="button"
                      className={`pill ${item.equipped ? 'active' : ''}`}
                      onClick={() => onToggleEquipped(item.id)}
                    >
                      {item.equipped ? 'Eq' : 'Equip'}
                    </button>
                    {item.requiresAttunement && (
                      <button
                        type="button"
                        className={`pill ${item.attuned ? 'active' : ''}`}
                        onClick={() => onToggleAttuned(item.id)}
                      >
                        {item.attuned ? 'Att' : 'Attune'}
                      </button>
                    )}
                    {onDepositToPartyStash && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '1px 6px', fontSize: 10 }}
                        title="Send 1 to Party Shared Inventory"
                        onClick={() => onDepositToPartyStash(item.id)}
                      >
                        → Party
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'party' && (
        <div className="forge-stack">
          <div className="forge-row-between wrap gap-2">
            <span className="forge-muted text-sm">
              Shared across party • Claiming moves 1 to <strong>{characterName}</strong>
            </span>
            {campaign && (
              <span className="badge tabular">
                Party Gold: {campaign.partyLootGp.toLocaleString()} GP
              </span>
            )}
          </div>

          {onAddPartyStashItem && (
            <form
              className="forge-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!stashName.trim()) return;
                onAddPartyStashItem(stashName, 'gear', stashQty);
                setStashName('');
                setStashQty(1);
              }}
            >
              <input
                type="text"
                className="forge-input flex-1"
                placeholder="Add shared item (e.g. Potion of Healing, Rope)..."
                value={stashName}
                onChange={(e) => setStashName(e.target.value)}
              />
              <input
                type="number"
                min={1}
                className="forge-input tabular"
                style={{ width: 52 }}
                value={stashQty}
                onChange={(e) => setStashQty(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
              />
              <button type="submit" className="btn btn-primary">
                + Stash
              </button>
            </form>
          )}

          <div className="forge-stack" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {partyStash.length === 0 ? (
              <div className="forge-muted text-md">
                Party Shared Inventory is empty. Deposit items from your inventory or add shared loot above.
              </div>
            ) : (
              partyStash.map((item) => (
                <div key={item.id} className="forge-list-row">
                  <div>
                    <strong>{displayItemName(item)}</strong>{' '}
                    <span className="badge tabular">×{item.quantity ?? 1}</span>
                    {item.entries[0] && (
                      <div className="forge-muted text-xs">
                        {item.entries[0]}
                      </div>
                    )}
                  </div>
                  {onClaimPartyStashItem && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => onClaimPartyStashItem(item.id)}
                    >
                      Claim →
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
