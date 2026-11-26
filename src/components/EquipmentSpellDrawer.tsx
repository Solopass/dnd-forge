import { useState } from 'react';
import { RawCharacterState } from '../types/character';
import { Activity, CompendiumEntity, ItemCategory } from '../types/compendium';
import { AbilityKey, ActionEconomy } from '../types/core';
import { ModalDialog } from './ModalDialog';
import { displayItemName } from '../engine/magic-variants';

interface EquipmentSpellDrawerProps {
  isOpen: boolean;
  items: CompendiumEntity[];
  attunementCount: number;
  strScore: number;
  preparedCount: number;
  maxPrepared: number | null;
  currency?: RawCharacterState['currency'];
  notes?: RawCharacterState['notes'];
  structuredProficiencies?: RawCharacterState['structuredProficiencies'];
  details?: RawCharacterState['details'];
  onClose: () => void;
  onToggleEquipped: (id: string) => void;
  onTogglePrepared: (id: string) => void;
  onToggleAttuned: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onUpdateContainer?: (id: string, container: string) => void;
  onDepositToPartyStash?: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onUpdateCurrency: (coin: 'cp' | 'sp' | 'ep' | 'gp' | 'pp', value: number) => void;
  onSimplifyCurrency?: () => void;
  onUpdateNotes: (patch: Partial<NonNullable<RawCharacterState['notes']>>) => void;
  onUpdateStructuredProficiencies?: (patch: Partial<NonNullable<RawCharacterState['structuredProficiencies']>>) => void;
  onUpdateDetails?: (patch: Partial<NonNullable<RawCharacterState['details']>>) => void;
  onCreateHomebrew: (entity: CompendiumEntity, addToSheet: boolean) => Promise<void>;
}

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

export function EquipmentSpellDrawer({
  isOpen,
  items,
  attunementCount,
  strScore: _strScore,
  preparedCount,
  maxPrepared,
  currency,
  notes,
  structuredProficiencies,
  details,
  onClose,
  onToggleEquipped,
  onTogglePrepared,
  onToggleAttuned,
  onUpdateQuantity,
  onUpdateContainer,
  onDepositToPartyStash,
  onRemoveItem,
  onUpdateCurrency,
  onSimplifyCurrency,
  onUpdateNotes,
  onUpdateStructuredProficiencies,
  onUpdateDetails,
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
  const [hbImageUrl, setHbImageUrl] = useState('');

  const coins = currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const totalGpValue =
    coins.pp * 10 + coins.gp + coins.ep * 0.5 + coins.sp * 0.1 + coins.cp * 0.01;

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
      imageUrl: hbImageUrl.trim() || undefined,
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
    setHbImageUrl('');
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
          <div className="forge-row-between forge-muted tabular text-sm wrap gap-2">
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
                  <strong>{displayItemName(item)}</strong>{' '}
                  <span className="forge-muted text-sm">
                    ({item.category.toUpperCase()})
                    {item.container ? ` • [${item.container}]` : ''}
                  </span>
                </div>

                <div className="pill-row" style={{ alignItems: 'center' }}>
                  {isPhysical && onUpdateContainer && (
                    <select
                      aria-label={`${item.name} container`}
                      className="forge-input"
                      style={{ padding: '2px 4px', fontSize: 10, width: 92 }}
                      value={item.container ?? ''}
                      onChange={(e) => onUpdateContainer(item.id, e.target.value)}
                    >
                      <option value="">Carried</option>
                      <option value="Backpack">Backpack</option>
                      <option value="Bag of Holding">Bag of Holding</option>
                      <option value="Pouch">Pouch</option>
                    </select>
                  )}
                  {isPhysical && onDepositToPartyStash && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 10, padding: '2px 6px' }}
                      title="Move 1 to Party Shared Inventory"
                      onClick={() => onDepositToPartyStash(item.id)}
                    >
                      → Party
                    </button>
                  )}
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
            <div className="forge-row-between wrap gap-2">
              <span className="forge-section-label mb-0">
                CURRENCY
              </span>
              <div className="forge-row gap-2">
                <span className="tabular forge-muted">
                  Total Value: <strong>{totalGpValue.toFixed(2)} GP</strong>
                </span>
                {onSimplifyCurrency && (
                  <button type="button" className="btn" onClick={onSimplifyCurrency}>
                    Simplify Coins
                  </button>
                )}
              </div>
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

          {onUpdateStructuredProficiencies && (
            <div className="card forge-stack">
              <div className="forge-section-label">STRUCTURED PROFICIENCIES &amp; LANGUAGES</div>
              {(
                [
                  ['armor', 'Armor (comma-separated)', 'Light, Medium, Shields'],
                  ['weapons', 'Weapons (comma-separated)', 'Simple, Martial, Longsword'],
                  ['tools', 'Tools (comma-separated)', "Thieves' Tools, Smith's Tools"],
                  ['languages', 'Languages (comma-separated)', 'Common, Elvish, Draconic'],
                ] as const
              ).map(([field, label, placeholder]) => (
                <label key={field} className="forge-field">
                  <span className="forge-label">{label}</span>
                  <input
                    type="text"
                    className="forge-input"
                    value={(structuredProficiencies?.[field] ?? []).join(', ')}
                    placeholder={placeholder}
                    onChange={(e) =>
                      onUpdateStructuredProficiencies({
                        [field]: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          )}

          {onUpdateDetails && (
            <div className="card forge-stack">
              <div className="forge-section-label">CHARACTER DESCRIPTION &amp; TRAITS</div>
              <div className="forge-row wrap gap-2">
                {(
                  [
                    ['alignment', 'Alignment'],
                    ['size', 'Size'],
                    ['age', 'Age'],
                    ['height', 'Height'],
                    ['weight', 'Weight'],
                    ['eyes', 'Eyes'],
                    ['skin', 'Skin'],
                    ['hair', 'Hair'],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="forge-field" style={{ flex: '1 1 110px' }}>
                    <span className="forge-label">{label}</span>
                    <input
                      type="text"
                      className="forge-input"
                      value={details?.[field] ?? ''}
                      onChange={(e) => onUpdateDetails({ [field]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
              {(
                [
                  ['traits', 'Personality Traits'],
                  ['ideals', 'Ideals'],
                  ['bonds', 'Bonds'],
                  ['flaws', 'Flaws'],
                  ['allies', 'Allies & Organizations'],
                  ['backstory', 'Backstory'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="forge-field">
                  <span className="forge-label">{label}</span>
                  <textarea
                    rows={field === 'backstory' ? 3 : 2}
                    className="forge-input"
                    value={details?.[field] ?? ''}
                    onChange={(e) => onUpdateDetails({ [field]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}

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
            <span className="forge-label">IMAGE URL OR PATH (OPTIONAL)</span>
            <input
              type="text"
              className="forge-input"
              value={hbImageUrl}
              onChange={(e) => setHbImageUrl(e.target.value)}
              placeholder="./images/items/my-item.png or https://..."
            />
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
