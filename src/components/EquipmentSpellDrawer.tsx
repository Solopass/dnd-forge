import { useState } from 'react';
import { RawCharacterState } from '../types/character';
import { Activity, CompendiumEntity, ItemCategory } from '../types/compendium';
import { AbilityKey, ActionEconomy } from '../types/core';
import { ModalDialog } from './ModalDialog';

interface EquipmentSpellDrawerProps {
  isOpen: boolean;
  items: CompendiumEntity[];
  attunementCount: number;
  strScore: number;
  preparedCount: number;
  maxPrepared: number | null;
  currency?: RawCharacterState['currency'];
  notes?: RawCharacterState['notes'];
  onClose: () => void;
  onToggleEquipped: (id: string) => void;
  onTogglePrepared: (id: string) => void;
  onToggleAttuned: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onRemoveItem: (id: string) => void;
  onUpdateCurrency: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
  onUpdateNotes: (patch: Partial<NonNullable<RawCharacterState['notes']>>) => void;
  onCreateHomebrew: (entity: CompendiumEntity, addToSheet: boolean) => Promise<void>;
}

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

export function EquipmentSpellDrawer({
  isOpen,
  items,
  attunementCount,
  strScore,
  preparedCount,
  maxPrepared,
  currency,
  notes,
  onClose,
  onToggleEquipped,
  onTogglePrepared,
  onToggleAttuned,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateCurrency,
  onUpdateNotes,
  onCreateHomebrew,
}: EquipmentSpellDrawerProps) {
  const [tab, setTab] = useState<'gear' | 'notes' | 'homebrew'>('gear');

  // Homebrew Creator Form State
  const [hbName, setHbName] = useState('');
  const [hbCategory, setHbCategory] = useState<ItemCategory>('weapon');
  const [hbEconomy, setHbEconomy] = useState<ActionEconomy>('action');
  const [hbActType, setHbActType] = useState<Activity['type']>('attack');
  const [hbAbility, setHbAbility] = useState<AbilityKey>('str');
  const [hbDamage, setHbDamage] = useState('1d8 + @str');
  const [hbDmgType, setHbDmgType] = useState('slashing');
  const [hbAcBase, setHbAcBase] = useState('');
  const [hbAcBonus, setHbAcBonus] = useState('');
  const [hbSpellLevel, setHbSpellLevel] = useState('1');
  const [hbConc, setHbConc] = useState(false);
  const [hbDesc, setHbDesc] = useState('');

  const coins = currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const totalGpValue =
    coins.pp * 10 + coins.gp + coins.ep * 0.5 + coins.sp * 0.1 + coins.cp * 0.01;
  const totalWeight = items.reduce(
    (sum, it) => sum + (it.weight ?? 0) * (it.quantity ?? 1),
    0
  );
  const carryCapacity = strScore * 15;

  const handleSaveHomebrew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hbName.trim()) return;
    const id = `hb-${hbName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const parsedAcBase = Number.parseInt(hbAcBase, 10);
    const parsedAcBonus = Number.parseInt(hbAcBonus, 10);
    const parsedSpellLvl = Number.parseInt(hbSpellLevel, 10);

    const activity: Activity | null =
      hbCategory === 'armor' || hbCategory === 'shield'
        ? null
        : {
            id: `act-${id}`,
            name: hbName.trim(),
            type: hbActType,
            actionEconomy: hbEconomy,
            attackAbility: hbActType === 'attack' ? hbAbility : undefined,
            attackBonusFormula:
              hbActType === 'attack' ? `@${hbAbility} + @prof` : undefined,
            saveAbility: hbActType === 'save' ? hbAbility : undefined,
            saveDcFormula: hbActType === 'save' ? '8 + @prof + @spell' : undefined,
            damageFormula: hbDamage.trim() || undefined,
            damageType: hbDmgType.trim() || undefined,
            description: hbDesc.trim() || hbName.trim(),
          };

    const entity: CompendiumEntity = {
      id,
      name: hbName.trim(),
      source: 'Homebrew',
      ruleset: 'homebrew',
      category: hbCategory,
      equipped: true,
      prepared: true,
      concentration: hbConc,
      spellLevel: hbCategory === 'spell' && !Number.isNaN(parsedSpellLvl) ? parsedSpellLvl : undefined,
      acFormula:
        hbCategory === 'armor' && !Number.isNaN(parsedAcBase)
          ? { base: parsedAcBase, dexCap: parsedAcBase >= 16 ? 0 : 2 }
          : undefined,
      acFlatBonus: !Number.isNaN(parsedAcBonus) ? parsedAcBonus : undefined,
      activities: activity ? [activity] : [],
      entries: [hbDesc.trim() || hbName.trim()],
    };

    await onCreateHomebrew(entity, true);
    setHbName('');
    setHbDesc('');
    setTab('gear');
  };

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        <>
          Equipment (<span className="tabular">{attunementCount}/3</span> Attuned), Notes &amp; Homebrew
        </>
      }
    >
      <div className="pill-row" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={`pill ${tab === 'gear' ? 'active' : ''}`}
          onClick={() => setTab('gear')}
        >
          Gear &amp; Spells ({items.length})
        </button>
        <button
          type="button"
          className={`pill ${tab === 'notes' ? 'active' : ''}`}
          onClick={() => setTab('notes')}
        >
          Currency &amp; Notes
        </button>
        <button
          type="button"
          className={`pill ${tab === 'homebrew' ? 'active' : ''}`}
          onClick={() => setTab('homebrew')}
        >
          + Create Homebrew
        </button>
      </div>

      {tab === 'gear' && (
        <div className="forge-stack">
          <div className="forge-row-between forge-muted tabular" style={{ fontSize: 11, flexWrap: 'wrap', gap: 6 }}>
            <span>
              Carried Weight: <strong>{totalWeight.toFixed(1)}</strong> / {carryCapacity} lb
            </span>
            {maxPrepared !== null && (
              <span style={{ color: preparedCount > maxPrepared ? 'var(--accent-amber)' : 'var(--text-secondary)' }}>
                Prepared Spells: <strong>{preparedCount}</strong> / {maxPrepared}
              </span>
            )}
            <span>
              Purse: <strong>{totalGpValue.toFixed(2)} gp</strong>
            </span>
          </div>

          {items.map((item) => {
            const isPhysical =
              item.category === 'armor' ||
              item.category === 'shield' ||
              item.category === 'weapon' ||
              item.category === 'gear';
            return (
              <div key={item.id} className="forge-list-row">
                <div>
                  <strong>{item.name}</strong>{' '}
                  <span className="forge-muted" style={{ fontSize: 11 }}>
                    ({item.category.toUpperCase()})
                    {item.weight ? ` • ${item.weight} lb` : ''}
                  </span>
                </div>

                <div className="pill-row" style={{ alignItems: 'center' }}>
                  {isPhysical && (
                    <div className="forge-row">
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Decrease ${item.name} quantity`}
                        onClick={() => onUpdateQuantity(item.id, -1)}
                      >
                        -
                      </button>
                      <span className="tabular" style={{ minWidth: 22, textAlign: 'center', fontSize: 11 }}>
                        ×{item.quantity ?? 1}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Increase ${item.name} quantity`}
                        onClick={() => onUpdateQuantity(item.id, 1)}
                      >
                        +
                      </button>
                    </div>
                  )}

                  {isPhysical && (
                    <button
                      type="button"
                      className={`pill ${item.equipped ? 'active' : ''}`}
                      onClick={() => onToggleEquipped(item.id)}
                    >
                      {item.equipped ? 'Equipped' : 'Stowed'}
                    </button>
                  )}

                  {item.category === 'spell' && (item.spellLevel ?? 0) > 0 && (
                    item.alwaysPrepared ? (
                      <span className="pill active" title="Always prepared via subclass">
                        Always Prepared
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`pill ${item.prepared !== false ? 'active' : ''}`}
                        onClick={() => onTogglePrepared(item.id)}
                      >
                        {item.prepared !== false ? 'Prepared' : 'Unprepared'}
                      </button>
                    )
                  )}

                  {item.requiresAttunement && (
                    <button
                      type="button"
                      className={`pill ${item.attuned ? 'active' : ''}`}
                      onClick={() => onToggleAttuned(item.id)}
                    >
                      {item.attuned ? 'Attuned' : 'Unattuned'}
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-danger"
                    title="Remove from sheet"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => onRemoveItem(item.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'notes' && (
        <div className="forge-stack">
          <div className="card forge-stack">
            <div className="forge-row-between">
              <span className="forge-section-label" style={{ marginBottom: 0 }}>
                CURRENCY
              </span>
              <span className="tabular forge-muted">
                Total Value: <strong>{totalGpValue.toFixed(2)} GP</strong>
              </span>
            </div>
            <div className="forge-ability-grid-6">
              {COINS.map((coin) => (
                <label key={coin} className="forge-field">
                  <span className="forge-label">{coin.toUpperCase()}</span>
                  <input
                    type="number"
                    min={0}
                    value={coins[coin]}
                    onChange={(e) => onUpdateCurrency(coin, Number.parseInt(e.target.value, 10) || 0)}
                    className="forge-input tabular"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="card forge-stack">
            <label className="forge-field">
              <span className="forge-label">PROFICIENCIES &amp; LANGUAGES</span>
              <textarea
                rows={2}
                className="forge-input"
                value={notes?.proficiencies ?? ''}
                onChange={(e) => onUpdateNotes({ proficiencies: e.target.value })}
                placeholder="Common, Elvish, Thieves' Tools, Martial Weapons..."
              />
            </label>
            <label className="forge-field">
              <span className="forge-label">CHARACTER BIO &amp; TRAITS</span>
              <textarea
                rows={3}
                className="forge-input"
                value={notes?.bio ?? ''}
                onChange={(e) => onUpdateNotes({ bio: e.target.value })}
                placeholder="Appearance, ideals, bonds, flaws..."
              />
            </label>
            <label className="forge-field">
              <span className="forge-label">CAMPAIGN &amp; SESSION NOTES</span>
              <textarea
                rows={4}
                className="forge-input"
                value={notes?.campaign ?? ''}
                onChange={(e) => onUpdateNotes({ campaign: e.target.value })}
                placeholder="Quest hooks, NPCs, loot reminders..."
              />
            </label>
          </div>
        </div>
      )}

      {tab === 'homebrew' && (
        <form onSubmit={handleSaveHomebrew} className="card forge-stack">
          <div className="forge-grid-3">
            <label className="forge-field">
              <span className="forge-label">ITEM / SPELL NAME</span>
              <input
                required
                type="text"
                className="forge-input"
                value={hbName}
                onChange={(e) => setHbName(e.target.value)}
                placeholder="Sunblade +2"
              />
            </label>
            <label className="forge-field">
              <span className="forge-label">CATEGORY</span>
              <select
                className="forge-input"
                value={hbCategory}
                onChange={(e) => setHbCategory(e.target.value as ItemCategory)}
              >
                <option value="weapon">Weapon</option>
                <option value="armor">Armor</option>
                <option value="shield">Shield</option>
                <option value="spell">Spell</option>
                <option value="feat">Feat / Feature</option>
                <option value="gear">Gear</option>
              </select>
            </label>
            <label className="forge-field">
              <span className="forge-label">ACTION ECONOMY</span>
              <select
                className="forge-input"
                value={hbEconomy}
                onChange={(e) => setHbEconomy(e.target.value as ActionEconomy)}
              >
                <option value="action">Action</option>
                <option value="bonus_action">Bonus Action</option>
                <option value="reaction">Reaction</option>
                <option value="free">Free</option>
              </select>
            </label>
          </div>

          <div className="forge-grid-3">
            <label className="forge-field">
              <span className="forge-label">ACTIVITY TYPE</span>
              <select
                className="forge-input"
                value={hbActType}
                onChange={(e) => setHbActType(e.target.value as Activity['type'])}
              >
                <option value="attack">Attack Roll</option>
                <option value="save">Saving Throw</option>
                <option value="heal">Healing</option>
                <option value="utility">Utility</option>
              </select>
            </label>
            <label className="forge-field">
              <span className="forge-label">ABILITY</span>
              <select
                className="forge-input"
                value={hbAbility}
                onChange={(e) => setHbAbility(e.target.value as AbilityKey)}
              >
                <option value="str">STR</option>
                <option value="dex">DEX</option>
                <option value="con">CON</option>
                <option value="int">INT</option>
                <option value="wis">WIS</option>
                <option value="cha">CHA</option>
              </select>
            </label>
            <label className="forge-field">
              <span className="forge-label">DAMAGE / HEAL FORMULA</span>
              <input
                type="text"
                className="forge-input tabular"
                value={hbDamage}
                onChange={(e) => setHbDamage(e.target.value)}
                placeholder="1d8 + @str"
              />
            </label>
          </div>

          <div className="forge-grid-3">
            <label className="forge-field">
              <span className="forge-label">DAMAGE TYPE</span>
              <input
                type="text"
                className="forge-input"
                value={hbDmgType}
                onChange={(e) => setHbDmgType(e.target.value)}
                placeholder="radiant"
              />
            </label>
            {hbCategory === 'spell' ? (
              <label className="forge-field">
                <span className="forge-label">SPELL LEVEL (0=CANTRIP)</span>
                <input
                  type="number"
                  min={0}
                  max={9}
                  className="forge-input tabular"
                  value={hbSpellLevel}
                  onChange={(e) => setHbSpellLevel(e.target.value)}
                />
              </label>
            ) : (
              <label className="forge-field">
                <span className="forge-label">ARMOR BASE AC (OPTIONAL)</span>
                <input
                  type="number"
                  className="forge-input tabular"
                  value={hbAcBase}
                  onChange={(e) => setHbAcBase(e.target.value)}
                  placeholder="16"
                />
              </label>
            )}
            <label className="forge-field">
              <span className="forge-label">FLAT AC BONUS (OPTIONAL)</span>
              <input
                type="number"
                className="forge-input tabular"
                value={hbAcBonus}
                onChange={(e) => setHbAcBonus(e.target.value)}
                placeholder="+1"
              />
            </label>
          </div>

          <label className="forge-row">
            <input
              type="checkbox"
              checked={hbConc}
              onChange={(e) => setHbConc(e.target.checked)}
            />
            <span>Requires Concentration</span>
          </label>

          <label className="forge-field">
            <span className="forge-label">DESCRIPTION / 5e.tools TAGS</span>
            <textarea
              rows={2}
              className="forge-input"
              value={hbDesc}
              onChange={(e) => setHbDesc(e.target.value)}
              placeholder="Deals {@damage 1d8+@str} radiant damage..."
            />
          </label>

          <div className="forge-row-end">
            <button type="submit" className="btn btn-primary">
              Save &amp; Add to Sheet
            </button>
          </div>
        </form>
      )}
    </ModalDialog>
  );
}
