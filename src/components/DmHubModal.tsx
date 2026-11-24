import { FormEvent, useState } from 'react';
import {
  DM_SCREEN_SECTIONS,
  formatWorldClock,
  generateShopInventory,
  getXpForNextLevel,
  rollTreasure,
  ShopItem,
  TreasureRollResult,
  TreasureTier,
} from '../engine/dm-tools';
import { evaluateEncounterDifficulty } from '../engine/encounter-math';
import { CampaignCategory, CampaignEntry, CampaignRecord } from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CombatEncounterState } from '../types/combat';
import { ModalDialog } from './ModalDialog';

interface DmHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaign: CampaignRecord;
  campaignList: CampaignRecord[];
  characterList: RawCharacterState[];
  activeCharacterName: string;
  activeCharacterGp: number;
  encounter: CombatEncounterState;
  onSwitchCampaign: (id: string) => Promise<void>;
  onCreateCampaign: (name: string, setting: string) => Promise<void>;
  onDeleteCampaign: (id: string) => Promise<void>;
  onUpsertEntry: (entry: Omit<CampaignEntry, 'updatedAt'>) => void;
  onDeleteEntry: (entryId: string) => void;
  onAdvanceClock: (deltaMinutes: number) => void;
  onAddTimer: (label: string, minutes: number) => void;
  onSetWeather: (weather: string) => void;
  onAddPartyLoot: (gp: number, items: string[]) => void;
  onDistributeGold: (totalGp: number) => Promise<void>;
  onBuyShopItem: (item: ShopItem, chargeGold: boolean) => boolean;
  onAwardXp: (totalXp: number) => Promise<void>;
  onMilestoneLevelUp: () => Promise<void>;
  onRollExpression: (label: string, expr: string) => void;
}

const CATEGORIES: Array<{ key: 'all' | CampaignCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'session', label: 'Sessions' },
  { key: 'npc', label: 'NPCs' },
  { key: 'location', label: 'Locations' },
  { key: 'quest', label: 'Quests' },
  { key: 'faction', label: 'Factions' },
  { key: 'handout', label: 'Handouts' },
];

export function DmHubModal({
  isOpen,
  onClose,
  campaign,
  campaignList,
  characterList,
  activeCharacterName,
  activeCharacterGp,
  encounter,
  onSwitchCampaign,
  onCreateCampaign,
  onDeleteCampaign,
  onUpsertEntry,
  onDeleteEntry,
  onAdvanceClock,
  onAddTimer,
  onSetWeather,
  onAddPartyLoot,
  onDistributeGold,
  onBuyShopItem,
  onAwardXp,
  onMilestoneLevelUp,
  onRollExpression,
}: DmHubModalProps) {
  const [tab, setTab] = useState<'binder' | 'clock' | 'loot' | 'dmscreen' | 'xp'>('binder');

  // Campaign Binder State
  const [newCampName, setNewCampName] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | CampaignCategory>('all');
  const [entrySearch, setEntrySearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryCat, setEntryCat] = useState<CampaignCategory>('npc');
  const [entryTitle, setEntryTitle] = useState('');
  const [entrySummary, setEntrySummary] = useState('');
  const [entryBody, setEntryBody] = useState('');
  const [entryStatus, setEntryStatus] = useState<CampaignEntry['status']>('active');

  // World Clock State
  const [timerLabel, setTimerLabel] = useState('');
  const [timerMins, setTimerMins] = useState('60');

  // Loot & Shops State
  const [treasureTier, setTreasureTier] = useState<TreasureTier>('5-10');
  const [treasureMode, setTreasureMode] = useState<'individual' | 'hoard'>('hoard');
  const [lastTreasure, setLastTreasure] = useState<TreasureRollResult | null>(null);
  const [shopTier, setShopTier] = useState<'village' | 'town' | 'city'>('city');

  // DM Screen Filter
  const [dmScreenFilter, setDmScreenFilter] = useState('');

  // XP & Milestones
  const [customXp, setCustomXp] = useState('450');
  const [confirmMilestone, setConfirmMilestone] = useState(false);

  const monsterCrs = encounter.combatants
    .filter((c) => c.kind === 'monster')
    .map((c) => c.cr ?? '1');
  const partyLevels = characterList.map((c) => c.classes.reduce((s, cl) => s + cl.level, 0));
  const encDiff = evaluateEncounterDifficulty(partyLevels, monsterCrs);

  const filteredEntries = campaign.entries.filter((e) => {
    if (catFilter !== 'all' && e.category !== catFilter) return false;
    const q = entrySearch.trim().toLowerCase();
    if (!q) return true;
    return `${e.title} ${e.summary} ${e.body} ${e.tags.join(' ')}`.toLowerCase().includes(q);
  });

  const handleSaveEntry = (ev: FormEvent) => {
    ev.preventDefault();
    if (!entryTitle.trim()) return;
    onUpsertEntry({
      id: editingId ?? `entry-${Date.now().toString(36)}`,
      category: entryCat,
      title: entryTitle.trim(),
      summary: entrySummary.trim() || entryTitle.trim(),
      body: entryBody.trim(),
      tags: [],
      status: entryStatus,
    });
    setEditingId(null);
    setEntryTitle('');
    setEntrySummary('');
    setEntryBody('');
  };

  const shopItems = generateShopInventory(shopTier);
  const filteredDmSections = DM_SCREEN_SECTIONS.filter((sec) => {
    const q = dmScreenFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      sec.title.toLowerCase().includes(q) ||
      sec.rows.some(
        (r) =>
          r.topic.toLowerCase().includes(q) ||
          r.rule.toLowerCase().includes(q) ||
          r.detail.toLowerCase().includes(q)
      )
    );
  });

  return (
    <ModalDialog isOpen={isOpen} wide onClose={onClose} title="DM Campaign Hub & Session Prep">
      <div className="forge-stack">
        <div className="card forge-row-between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="forge-row" style={{ flexWrap: 'wrap' }}>
            <select
              aria-label="Active campaign"
              className="forge-input"
              value={campaign.id}
              onChange={(e) => void onSwitchCampaign(e.target.value)}
              style={{ fontWeight: 700 }}
            >
              {campaignList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.entries.length} notes)
                </option>
              ))}
            </select>
            <input
              aria-label="New campaign name"
              type="text"
              className="forge-input"
              value={newCampName}
              onChange={(e) => setNewCampName(e.target.value)}
              placeholder="New campaign name..."
              style={{ width: 170 }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!newCampName.trim()) return;
                void onCreateCampaign(newCampName, 'Homebrew');
                setNewCampName('');
              }}
            >
              + New Campaign
            </button>
            {campaignList.length > 1 && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void onDeleteCampaign(campaign.id)}
              >
                Del
              </button>
            )}
          </div>
          <span className="tabular forge-muted" style={{ fontSize: 12 }}>
            {formatWorldClock(campaign.clock)} • {campaign.clock.weather}
          </span>
        </div>

        <div className="pill-row">
          {(
            [
              ['binder', 'Campaign Binder'],
              ['clock', 'World Clock'],
              ['loot', 'Loot & Shops'],
              ['dmscreen', 'DM Screen'],
              ['xp', 'Party XP & Milestones'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`pill ${tab === k ? 'active' : ''}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'binder' && (
          <div className="forge-grid-2" style={{ alignItems: 'start' }}>
            <div className="card forge-stack">
              <div className="forge-row-between">
                <div className="pill-row">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className={`pill ${catFilter === c.key ? 'active' : ''}`}
                      onClick={() => setCatFilter(c.key)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                aria-label="Search campaign binder"
                type="text"
                className="forge-input"
                placeholder="Search NPCs, sessions, locations, quests..."
                value={entrySearch}
                onChange={(e) => setEntrySearch(e.target.value)}
              />
              <section className="dm-accordion" aria-label="Campaign binder entries">
                {filteredEntries.length === 0 ? (
                  <div className="forge-muted">No matching entries in this folder.</div>
                ) : (
                  filteredEntries.map((entry) => (
                    <details key={entry.id} open={entry.pinned}>
                      <summary>
                        <span>
                          [{entry.category.toUpperCase()}] <strong>{entry.title}</strong>{' '}
                          <span className="forge-muted" style={{ fontSize: 11 }}>
                            — {entry.summary}
                          </span>
                        </span>
                      </summary>
                      <div className="forge-stack" style={{ padding: '6px 8px 10px' }}>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                          {entry.body || entry.summary}
                        </div>
                        <div className="forge-row">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setEditingId(entry.id);
                              setEntryCat(entry.category);
                              setEntryTitle(entry.title);
                              setEntrySummary(entry.summary);
                              setEntryBody(entry.body);
                              setEntryStatus(entry.status);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => onDeleteEntry(entry.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </details>
                  ))
                )}
              </section>
            </div>

            <form onSubmit={handleSaveEntry} className="card forge-stack">
              <div className="forge-section-label">
                {editingId ? 'EDIT BINDER ENTRY' : 'NEW BINDER ENTRY'}
              </div>
              <div className="forge-grid-2">
                <label className="forge-field">
                  <span className="forge-label">FOLDER</span>
                  <select
                    className="forge-input"
                    value={entryCat}
                    onChange={(e) => setEntryCat(e.target.value as CampaignCategory)}
                  >
                    <option value="session">Session Recap</option>
                    <option value="npc">NPC</option>
                    <option value="location">Location</option>
                    <option value="quest">Quest</option>
                    <option value="faction">Faction</option>
                    <option value="handout">Player Handout</option>
                  </select>
                </label>
                <label className="forge-field">
                  <span className="forge-label">STATUS</span>
                  <select
                    className="forge-input"
                    value={entryStatus}
                    onChange={(e) => setEntryStatus(e.target.value as CampaignEntry['status'])}
                  >
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="secret">DM Secret</option>
                  </select>
                </label>
              </div>
              <label className="forge-field">
                <span className="forge-label">TITLE</span>
                <input
                  required
                  type="text"
                  className="forge-input"
                  value={entryTitle}
                  onChange={(e) => setEntryTitle(e.target.value)}
                  placeholder="Captain Vane, Harbor Tavern..."
                />
              </label>
              <label className="forge-field">
                <span className="forge-label">SHORT SUMMARY</span>
                <input
                  type="text"
                  className="forge-input"
                  value={entrySummary}
                  onChange={(e) => setEntrySummary(e.target.value)}
                  placeholder="Harbormaster who knows about the smuggling cove"
                />
              </label>
              <label className="forge-field">
                <span className="forge-label">DETAILS / DM NOTES</span>
                <textarea
                  rows={5}
                  className="forge-input"
                  value={entryBody}
                  onChange={(e) => setEntryBody(e.target.value)}
                  placeholder="Motivations, clues, secret doors, box text..."
                />
              </label>
              <div className="forge-row">
                <button type="submit" className="btn btn-primary">
                  {editingId ? 'Save Changes' : 'Add to Campaign Binder'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditingId(null);
                      setEntryTitle('');
                      setEntrySummary('');
                      setEntryBody('');
                    }}
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {tab === 'clock' && (
          <div className="forge-grid-2" style={{ alignItems: 'start' }}>
            <div className="card forge-stack">
              <div className="forge-section-label">WORLD CLOCK &amp; REST PACING</div>
              <div className="tabular" style={{ fontSize: 22, fontWeight: 700 }}>
                {formatWorldClock(campaign.clock)}
              </div>
              <label className="forge-field">
                <span className="forge-label">CURRENT WEATHER</span>
                <select
                  className="forge-input"
                  value={campaign.clock.weather}
                  onChange={(e) => onSetWeather(e.target.value)}
                >
                  <option value="Clear Skies">Clear Skies</option>
                  <option value="Overcast & Wind">Overcast &amp; Wind</option>
                  <option value="Heavy Rain (Lightly Obscured)">Heavy Rain (Lightly Obscured)</option>
                  <option value="Dense Fog (Heavily Obscured)">Dense Fog (Heavily Obscured)</option>
                  <option value="Thunderstorm">Thunderstorm</option>
                  <option value="Blizzard / Extreme Cold">Blizzard / Extreme Cold</option>
                </select>
              </label>
              <div className="pill-row">
                <button type="button" className="btn" onClick={() => onAdvanceClock(1)}>+1 Min (10 rnds)</button>
                <button type="button" className="btn" onClick={() => onAdvanceClock(10)}>+10 Min (Dungeon Turn)</button>
                <button type="button" className="btn btn-primary" onClick={() => onAdvanceClock(60)}>+1 Hr (Short Rest)</button>
                <button type="button" className="btn btn-primary" onClick={() => onAdvanceClock(480)}>+8 Hr (Long Rest)</button>
                <button type="button" className="btn" onClick={() => onAdvanceClock(1440)}>+1 Day</button>
              </div>
            </div>

            <div className="card forge-stack">
              <div className="forge-section-label">TORCH, LIGHT &amp; SPELL TIMERS</div>
              <div className="pill-row">
                <button type="button" className="btn" onClick={() => onAddTimer('Torch', 60)}>+ Torch (60m)</button>
                <button type="button" className="btn" onClick={() => onAddTimer('Oil Lantern', 360)}>+ Lantern (6h)</button>
                <button type="button" className="btn" onClick={() => onAddTimer('Pass without Trace', 60)}>+ Pass w/o Trace (1h)</button>
                <button type="button" className="btn" onClick={() => onAddTimer('Mage Armor', 480)}>+ Mage Armor (8h)</button>
              </div>
              <div className="forge-row">
                <input
                  aria-label="Custom timer name"
                  type="text"
                  className="forge-input"
                  value={timerLabel}
                  onChange={(e) => setTimerLabel(e.target.value)}
                  placeholder="Timer name (e.g. Potion Effect)"
                  style={{ flex: 1 }}
                />
                <input
                  aria-label="Timer minutes"
                  type="number"
                  min={1}
                  className="forge-input tabular"
                  value={timerMins}
                  onChange={(e) => setTimerMins(e.target.value)}
                  style={{ width: 68 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onAddTimer(timerLabel, Number.parseInt(timerMins, 10) || 10);
                    setTimerLabel('');
                  }}
                >
                  +Add
                </button>
              </div>
              {campaign.clock.activeTimers.length === 0 ? (
                <div className="forge-muted">No active timers.</div>
              ) : (
                campaign.clock.activeTimers.map((t) => (
                  <div key={t.id} className="forge-list-row">
                    <span>{t.label}</span>
                    <span className="tabular forge-muted">{t.remainingMinutes} min left</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'loot' && (
          <div className="forge-stack">
            <div className="forge-grid-2" style={{ alignItems: 'start' }}>
              <div className="card forge-stack">
                <div className="forge-section-label">SRD TREASURE &amp; HOARD ROLLER</div>
                <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                  <select
                    aria-label="Challenge tier"
                    className="forge-input"
                    value={treasureTier}
                    onChange={(e) => setTreasureTier(e.target.value as TreasureTier)}
                  >
                    <option value="0-4">CR 0–4</option>
                    <option value="5-10">CR 5–10</option>
                    <option value="11-16">CR 11–16</option>
                    <option value="17+">CR 17+</option>
                  </select>
                  <select
                    aria-label="Treasure mode"
                    className="forge-input"
                    value={treasureMode}
                    onChange={(e) => setTreasureMode(e.target.value as 'individual' | 'hoard')}
                  >
                    <option value="individual">Individual</option>
                    <option value="hoard">Treasure Hoard</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setLastTreasure(rollTreasure(treasureTier, treasureMode))}
                  >
                    Roll Treasure
                  </button>
                </div>

                {lastTreasure && (
                  <div className="card forge-stack" style={{ background: 'var(--bg-base)' }}>
                    <div className="tabular">
                      <strong>Rolled Coins ({lastTreasure.totalGpValue.toLocaleString()} GP value):</strong>{' '}
                      {lastTreasure.coins.pp > 0 ? `${lastTreasure.coins.pp} pp ` : ''}
                      {lastTreasure.coins.gp > 0 ? `${lastTreasure.coins.gp} gp ` : ''}
                      {lastTreasure.coins.ep > 0 ? `${lastTreasure.coins.ep} ep ` : ''}
                      {lastTreasure.coins.sp > 0 ? `${lastTreasure.coins.sp} sp ` : ''}
                      {lastTreasure.coins.cp > 0 ? `${lastTreasure.coins.cp} cp` : ''}
                    </div>
                    {lastTreasure.valuables.length > 0 && (
                      <div className="forge-muted">Gems / Art: {lastTreasure.valuables.join(', ')}</div>
                    )}
                    {lastTreasure.magicItems.length > 0 && (
                      <div style={{ color: 'var(--accent-blue)' }}>
                        Magic Items: {lastTreasure.magicItems.join(', ')}
                      </div>
                    )}
                    <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void onDistributeGold(lastTreasure.totalGpValue)}
                      >
                        Split GP to Party ({characterList.length} PCs)
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          onAddPartyLoot(lastTreasure.totalGpValue, [
                            ...lastTreasure.valuables,
                            ...lastTreasure.magicItems,
                          ])
                        }
                      >
                        Save to Party Stash
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="card forge-stack">
                <div className="forge-section-label">PARTY TREASURY &amp; SHARED STASH</div>
                <div className="tabular">
                  Shared Gold: <strong>{campaign.partyLootGp.toLocaleString()} GP</strong>{' '}
                  <button
                    type="button"
                    className="btn"
                    style={{ marginLeft: 8 }}
                    disabled={campaign.partyLootGp < characterList.length}
                    onClick={() => void onDistributeGold(campaign.partyLootGp)}
                  >
                    Distribute All GP
                  </button>
                </div>
                <div className="forge-muted" style={{ fontSize: 12 }}>
                  Stash Items ({campaign.partyLootItems.length}):{' '}
                  {campaign.partyLootItems.join(', ') || 'None'}
                </div>
                <div className="forge-muted tabular">
                  Active Buyer: <strong>{activeCharacterName}</strong> ({activeCharacterGp} GP in purse)
                </div>
              </div>
            </div>

            <div className="card forge-stack">
              <div className="forge-row-between" style={{ flexWrap: 'wrap' }}>
                <span className="forge-section-label" style={{ marginBottom: 0 }}>
                  MERCHANT SHOP GENERATOR
                </span>
                <div className="pill-row">
                  {(['village', 'town', 'city'] as const).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      className={`pill ${shopTier === tier ? 'active' : ''}`}
                      onClick={() => setShopTier(tier)}
                    >
                      {tier.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div tabIndex={0} role="region" aria-labelledby="shop-table-caption" className="table-wrapper">
                <table className="dm-table" style={{ '--label-2': '"Type"', '--label-3': '"Price"', '--label-4': '"Actions"' } as React.CSSProperties}>
                  <caption id="shop-table-caption" className="sr-only">Merchant shop inventory</caption>
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Type / Notes</th>
                      <th scope="col">Price</th>
                      <th scope="col">Purchase</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopItems.map((item) => (
                      <tr key={item.id}>
                        <th scope="row">{item.name}</th>
                        <td>
                          {item.category} ({item.rarity}) — {item.notes}
                        </td>
                        <td className="tabular">{item.priceGp} GP</td>
                        <td>
                          <div className="forge-row">
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => onBuyShopItem(item, true)}
                            >
                              Buy ({item.priceGp}g)
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => onBuyShopItem(item, false)}
                            >
                              Give Free
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'dmscreen' && (
          <div className="forge-stack">
            <input
              aria-label="Filter DM screen rules"
              type="text"
              className="forge-input"
              placeholder="Filter DM Screen (cover, light, travel, DC, damage)..."
              value={dmScreenFilter}
              onChange={(e) => setDmScreenFilter(e.target.value)}
            />
            <section className="dm-accordion" aria-label="DM Screen reference tables">
              {filteredDmSections.map((sec, sIdx) => (
                <details key={sec.id} open={sIdx === 0 || Boolean(dmScreenFilter.trim())}>
                  <summary>
                    <span>{sec.title}</span>
                  </summary>
                  <div style={{ padding: '6px 8px 10px' }}>
                    <div tabIndex={0} role="region" aria-labelledby={`${sec.id}-cap`} className="table-wrapper">
                      <table
                        className="dm-table"
                        style={
                          {
                            '--label-2': JSON.stringify(sec.headers[1]),
                            '--label-3': JSON.stringify(sec.headers[2]),
                          } as React.CSSProperties
                        }
                      >
                        <caption id={`${sec.id}-cap`} className="sr-only">
                          {sec.caption}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">{sec.headers[0]}</th>
                            <th scope="col">{sec.headers[1]}</th>
                            <th scope="col">{sec.headers[2]}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.rows.map((row) => (
                            <tr key={row.topic}>
                              <th scope="row">{row.topic}</th>
                              <td className="tabular">
                                {row.diceExpr ? (
                                  <button
                                    type="button"
                                    className="inline-tag-btn"
                                    onClick={() => onRollExpression(row.topic, row.diceExpr!)}
                                  >
                                    {row.rule}
                                  </button>
                                ) : (
                                  row.rule
                                )}
                              </td>
                              <td>{row.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ))}
            </section>
          </div>
        )}

        {tab === 'xp' && (
          <div className="forge-stack">
            <div className="card forge-grid-2" style={{ alignItems: 'center' }}>
              <div className="forge-stack">
                <div className="forge-section-label">PARTY XP &amp; MILESTONE AWARDS</div>
                <div className="forge-muted tabular">
                  Current Encounter Total: <strong>{encDiff.rawXp.toLocaleString()} XP</strong> ({Math.floor(encDiff.rawXp / Math.max(1, characterList.length)).toLocaleString()} XP per PC) • Campaign XP Earned: {campaign.partyXpTotal.toLocaleString()}
                </div>
                <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                  <input
                    aria-label="XP amount to award party"
                    type="number"
                    min={0}
                    className="forge-input tabular"
                    value={customXp}
                    onChange={(e) => setCustomXp(e.target.value)}
                    style={{ width: 100 }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void onAwardXp(Number.parseInt(customXp, 10) || 0)}
                  >
                    Award Total XP (Split)
                  </button>
                  {encDiff.rawXp > 0 && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void onAwardXp(encDiff.rawXp)}
                    >
                      Award Encounter XP ({encDiff.rawXp})
                    </button>
                  )}
                </div>
              </div>

              <div className="forge-stack">
                <div className="forge-section-label">MILESTONE LEVEL PROGRESSION</div>
                {!confirmMilestone ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setConfirmMilestone(true)}
                  >
                    Milestone Level-Up (+1 All PCs)
                  </button>
                ) : (
                  <div className="forge-row" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={async () => {
                        await onMilestoneLevelUp();
                        setConfirmMilestone(false);
                      }}
                    >
                      Confirm +1 Level for {characterList.length} PC(s)
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConfirmMilestone(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div tabIndex={0} role="region" aria-labelledby="party-xp-cap" className="table-wrapper">
                <table className="dm-table" style={{ '--label-2': '"Class"', '--label-3': '"XP"', '--label-4': '"Next Level"' } as React.CSSProperties}>
                  <caption id="party-xp-cap" className="sr-only">Party character XP roster</caption>
                  <thead>
                    <tr>
                      <th scope="col">Character</th>
                      <th scope="col">Class &amp; Level</th>
                      <th scope="col">Current XP</th>
                      <th scope="col">Next Level Threshold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {characterList.map((ch) => {
                      const totalLvl = ch.classes.reduce((s, cl) => s + cl.level, 0);
                      const curXp = ch.xp ?? 0;
                      const nextXp = getXpForNextLevel(totalLvl);
                      const ready = nextXp !== null && curXp >= nextXp;
                      return (
                        <tr key={ch.id}>
                          <th scope="row">{ch.name}</th>
                          <td>{ch.classes.map((cl) => `${cl.className} ${cl.level}`).join(' / ')}</td>
                          <td className="tabular">{curXp.toLocaleString()} XP</td>
                          <td className="tabular">
                            {nextXp === null ? 'Max Level (20)' : `${nextXp.toLocaleString()} XP`}
                            {ready && <span className="turn-badge">READY TO LEVEL!</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalDialog>
  );
}
