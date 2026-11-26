import { FormEvent, useState } from 'react';
import {
  DM_SCREEN_SECTIONS,
  exportCampaignToMarkdown,
  formatWorldClock,
  generateShopInventory,
  getXpForNextLevel,
  rollTreasure,
  ShopItem,
  TreasureRollResult,
  TreasureTier,
} from '../engine/dm-tools';
import { evaluateEncounterDifficulty } from '../engine/encounter-math';
import { computeCharacterSheet } from '../engine/rules-math';
import {
  GeneratedEncounter,
  generateRandomEncounter,
  generateRandomNpc,
  generateRandomTavern,
} from '../engine/improv';
import { AmbientPresetId, SfxPresetId, tabletopSoundboard } from '../engine/soundboard';
import { buildCampaignPackTemplate, parseRepoSlug } from '../engine/campaign-repo-sync';
import {
  CampaignCategory,
  CampaignEntry,
  CampaignRecord,
  DowntimeProject,
  ExternalRepoConfig,
  SharedHandoutPayload,
  WorldMapPin,
} from '../types/campaign';
import { RawCharacterState } from '../types/character';
import { CombatEncounterState } from '../types/combat';

export type DmHubTab =
  | 'party'
  | 'binder'
  | 'clock'
  | 'loot'
  | 'dmscreen'
  | 'xp'
  | 'improv'
  | 'worldmap'
  | 'soundboard';

interface DmHubModalProps {
  activeTab?: DmHubTab;
  onTabChange?: (tab: DmHubTab) => void;
  onOpenCharacterSheet?: (characterId: string) => void;
  campaign: CampaignRecord;
  campaignList: CampaignRecord[];
  characterList: RawCharacterState[];
  activeCharacterName: string;
  activeCharacterGp: number;
  encounter: CombatEncounterState;
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
  activeSharedHandout?: SharedHandoutPayload | null;
  onShareHandout?: (entry: CampaignEntry) => void;
  onHideHandout?: () => void;
  onSetWorldMapImage?: (url: string | undefined) => void;
  onUpsertWorldMapPin?: (pin: WorldMapPin) => void;
  onDeleteWorldMapPin?: (pinId: string) => void;
  onSpawnImprovEncounter?: (enc: GeneratedEncounter) => void;
  onPrintPacket?: () => void;
  onAssignLootToCharacter?: (itemName: string, characterId: string) => Promise<void>;
  onUpsertDowntime?: (project: DowntimeProject) => void;
  onAdvanceDowntime?: (deltaDays: number) => void;
  onDeleteDowntime?: (projectId: string) => void;
  onSyncCampaignRepo?: (config?: ExternalRepoConfig) => Promise<void>;
  onPushCampaignRepo?: (config?: ExternalRepoConfig) => Promise<void>;
  onPromptPartyRoll?: (label: string, kind: 'check' | 'save', abilityOrSkill: string, dc?: number) => void;
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
  activeTab: activeTabProp,
  onTabChange,
  onOpenCharacterSheet,
  campaign,
  campaignList,
  characterList,
  activeCharacterName,
  activeCharacterGp,
  encounter,
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
  activeSharedHandout,
  onShareHandout,
  onHideHandout,
  onSetWorldMapImage,
  onUpsertWorldMapPin,
  onDeleteWorldMapPin,
  onSpawnImprovEncounter,
  onPrintPacket,
  onAssignLootToCharacter,
  onUpsertDowntime,
  onAdvanceDowntime,
  onDeleteDowntime,
  onSyncCampaignRepo,
  onPushCampaignRepo,
  onPromptPartyRoll,
}: DmHubModalProps) {
  const [internalTab, setInternalTab] = useState<DmHubTab>('party');
  const tab = activeTabProp ?? internalTab;
  const setTab = (next: DmHubTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };
  const [promptDc, setPromptDc] = useState('12');
  const [dtOwner, setDtOwner] = useState('');
  const [dtTitle, setDtTitle] = useState('');
  const [dtKind, setDtKind] = useState<DowntimeProject['kind']>('craft');
  const [dtDays, setDtDays] = useState('5');
  const [lootRecipientId, setLootRecipientId] = useState<string>('');

  // Campaign Binder State
  const [newCampName, setNewCampName] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | CampaignCategory>('all');
  const [entrySearch, setEntrySearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryCat, setEntryCat] = useState<CampaignCategory>('npc');
  const [entryTitle, setEntryTitle] = useState('');
  const [entrySummary, setEntrySummary] = useState('');
  const [entryBody, setEntryBody] = useState('');
  const [entryImage, setEntryImage] = useState<string | undefined>(undefined);
  const [entryStatus, setEntryStatus] = useState<CampaignEntry['status']>('active');

  // Improv State
  const [improvEnv, setImprovEnv] = useState<'Forest' | 'Dungeon' | 'Urban' | 'Underdark'>('Dungeon');
  const [previewNpc, setPreviewNpc] = useState<Omit<CampaignEntry, 'id' | 'updatedAt'> | null>(null);
  const [previewTavern, setPreviewTavern] = useState<Omit<CampaignEntry, 'id' | 'updatedAt'> | null>(null);
  const [previewEnc, setPreviewEnc] = useState<GeneratedEncounter | null>(null);

  // World Map State
  const [pinLabel, setPinLabel] = useState('');
  const [pinKind, setPinKind] = useState<WorldMapPin['kind']>('location');
  const [pinEntryId, setPinEntryId] = useState('');
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);

  // Soundboard State
  const [activeAmbient, setActiveAmbient] = useState<AmbientPresetId | null>(() =>
    tabletopSoundboard.getActiveLoop()
  );
  const [boardVol, setBoardVol] = useState(() => tabletopSoundboard.getVolume());
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState('');

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
  // null = not edited: the amount follows the current encounter's total XP
  const [customXp, setCustomXp] = useState<string | null>(null);
  const [confirmMilestone, setConfirmMilestone] = useState(false);

  const monsterCrs = encounter.combatants
    .filter((c) => c.kind === 'monster')
    .map((c) => c.cr ?? '1');
  const partyLevels = characterList.map((c) => c.classes.reduce((s, cl) => s + cl.level, 0));
  const encDiff = evaluateEncounterDifficulty(partyLevels, monsterCrs);
  const xpAmountText = customXp ?? String(encDiff.rawXp);
  const xpAmount = Math.max(0, Number.parseInt(xpAmountText, 10) || 0);
  const xpPerPc = Math.floor(xpAmount / Math.max(1, characterList.length));

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
      imageDataUrl: entryImage,
    });
    setEditingId(null);
    setEntryTitle('');
    setEntrySummary('');
    setEntryBody('');
    setEntryImage(undefined);
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

  const dmTabs = [
    ['party', 'Party & Sync'],
    ['binder', 'Campaign Binder'],
    ['clock', 'World Clock'],
    ['loot', 'Loot & Shops'],
    ['dmscreen', 'DM Screen'],
    ['xp', 'Party XP & Milestones'],
    ['improv', 'Improv'],
    ['worldmap', 'World Map'],
    ['soundboard', 'Soundboard'],
  ] as const;

  // The app header already has the campaign picker, so this bar omits it.
  const renderCampaignBar = () => (
    <div className="card forge-row-between wrap gap-3">
      <div className="forge-row wrap">
        <input
          aria-label="New campaign name"
          type="text"
          className="forge-input dm-hub__input-2"
          value={newCampName}
          onChange={(e) => setNewCampName(e.target.value)}
          placeholder="New campaign name..."
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
      <div className="forge-row wrap">
        <span className="tabular forge-muted text-md">
          {formatWorldClock(campaign.clock)} • {campaign.clock.weather}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const md = exportCampaignToMarkdown(campaign);
            const blob = new Blob([md], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'campaign'}.md`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export .md
        </button>
        {onPrintPacket && (
          <button type="button" className="btn" onClick={onPrintPacket}>
            Print Session Packet
          </button>
        )}
      </div>
    </div>
  );

  const hubContent = (
    <div className="forge-stack">

        {tab === 'party' && (
          <div className="forge-stack">
            <div className="card forge-stack">
              <div className="forge-row-between wrap gap-2">
                <span className="forge-section-label mb-0">
                  PARTY CHEAT SHEET ({characterList.length} PCs)
                </span>
                <span className="forge-muted text-sm">
                  Passive Perception, Insight, AC, HP &amp; Spell Save DC at a glance
                </span>
              </div>
              {characterList.length === 0 ? (
                <div className="forge-muted text-md">No player characters saved yet.</div>
              ) : (
                <div className="dm-hub__div">
                  <table className="dm-hub__table">
                    <thead>
                      <tr className="dm-hub__tr">
                        <th className="dm-hub__th">Character</th>
                        <th className="dm-hub__th">AC</th>
                        <th className="dm-hub__th">HP</th>
                        <th className="dm-hub__th">Pass. Perc</th>
                        <th className="dm-hub__th">Pass. Insight</th>
                        <th className="dm-hub__th">Spell DC</th>
                        {onOpenCharacterSheet && <th className="dm-hub__th">Sheet</th>}
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {characterList.map((pc) => {
                        const resolved = computeCharacterSheet(pc);
                        return (
                          <tr key={pc.id} className="dm-hub__tr-2">
                            <td className="dm-hub__td">
                              <strong>{pc.name}</strong>{' '}
                              <span className="forge-muted text-sm">
                                ({pc.classes.map((c) => `${c.className} ${c.level}`).join('/')})
                              </span>
                            </td>
                            <td className="dm-hub__td">{resolved.ac.final}</td>
                            <td className="dm-hub__td">{resolved.hp.current}/{resolved.hp.max}</td>
                            <td className="dm-hub__td">{resolved.passivePerception}</td>
                            <td className="dm-hub__td">{resolved.passiveInsight}</td>
                            <td className="dm-hub__td">
                              {resolved.spellcasting.primaryAbility ? resolved.spellcasting.saveDc.final : '—'}
                            </td>
                            {onOpenCharacterSheet && (
                              <td className="dm-hub__td">
                                <button
                                  type="button"
                                  className="btn"
                                  onClick={() => onOpenCharacterSheet(pc.id)}
                                >
                                  Open Sheet
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {onPromptPartyRoll && (
              <div className="card forge-stack">
                <div className="forge-row-between wrap gap-2">
                  <span className="forge-section-label mb-0">
                    ONE-CLICK LIVE TABLE ROLL PROMPTS
                  </span>
                  <label className="forge-row gap-2 text-sm">
                    <span className="forge-muted">DC:</span>
                    <input
                      type="number"
                      className="forge-input tabular dm-hub__input-3"
                      value={promptDc}
                      onChange={(e) => setPromptDc(e.target.value)}
                    />
                  </label>
                </div>
                <div className="pill-row">
                  {(
                    [
                      { label: 'Perception Check', kind: 'check', key: 'perception' },
                      { label: 'Stealth Check', kind: 'check', key: 'stealth' },
                      { label: 'Insight Check', kind: 'check', key: 'insight' },
                      { label: 'Investigation Check', kind: 'check', key: 'investigation' },
                      { label: 'CON Save', kind: 'save', key: 'con' },
                      { label: 'DEX Save', kind: 'save', key: 'dex' },
                      { label: 'WIS Save', kind: 'save', key: 'wis' },
                    ] as const
                  ).map((p) => {
                    const dcNum = Number.parseInt(promptDc, 10);
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className="btn"
                        onClick={() =>
                          onPromptPartyRoll(
                            p.label,
                            p.kind,
                            p.key,
                            !Number.isNaN(dcNum) && dcNum > 0 ? dcNum : undefined
                          )
                        }
                      >
                        Prompt: {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {onSyncCampaignRepo && (
              <div className="card forge-stack">
                <div className="forge-row-between wrap gap-2">
                  <span className="forge-section-label mb-0">
                    EXTERNAL GITHUB REPO (<code>campaign-pack.json</code>)
                  </span>
                  {campaign.externalRepo?.lastSyncedAt && (
                    <span className="badge tabular">
                      Synced {new Date(campaign.externalRepo.lastSyncedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <div className="forge-muted text-md">
                  Link a GitHub repo (<code>owner/repo</code>) for this campaign&apos;s binder entries, custom DLC, and characters. Use Pack Path to keep multiple campaigns in one shared repo.
                </div>
                <form
                  key={`${campaign.id}-${campaign.externalRepo?.lastSyncedAt ?? 'unsynced'}`}
                  className="forge-row wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const slug = parseRepoSlug(String(fd.get('repoSlug') || ''));
                    const branch = String(fd.get('repoBranch') || 'main').trim() || 'main';
                    const packPath = String(fd.get('repoPath') || 'campaign-pack.json').trim() || 'campaign-pack.json';
                    if (!slug) return;
                    void onSyncCampaignRepo({ owner: slug.owner, repo: slug.repo, branch, packPath });
                  }}
                >
                  <input
                    name="repoSlug"
                    type="text"
                    className="forge-input dm-hub__input-4"
                    defaultValue={
                      campaign.externalRepo
                        ? `${campaign.externalRepo.owner}/${campaign.externalRepo.repo}`
                        : ''
                    }
                    placeholder="Solopass/dnd-campaign-vault"
                  />
                  <input
                    name="repoBranch"
                    type="text"
                    className="forge-input dm-hub__input-5"
                    defaultValue={campaign.externalRepo?.branch ?? 'main'}
                    placeholder="main"
                  />
                  <input
                    name="repoPath"
                    type="text"
                    className="forge-input dm-hub__input-6"
                    defaultValue={campaign.externalRepo?.packPath ?? 'campaign-pack.json'}
                    placeholder="campaign-pack.json"
                    title="Manifest path inside the repo (e.g. campaign-pack.json or campaigns/strahd/campaign-pack.json)"
                  />
                  <button type="submit" className="btn btn-primary">
                    Sync Repo
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void onSyncCampaignRepo({
                        owner: 'Solopass',
                        repo: 'free5e',
                        branch: 'main',
                      })
                    }
                    title="Pull native Free5e Markdown spells & feats directly from Solopass/free5e"
                  >
                    Sync Solopass/free5e
                  </button>
                  {onPushCampaignRepo && (
                    <button
                      type="button"
                      className="btn"
                      onClick={(e) => {
                        const form = e.currentTarget.closest('form');
                        if (!form) {
                          void onPushCampaignRepo();
                          return;
                        }
                        const fd = new FormData(form);
                        const slug = parseRepoSlug(String(fd.get('repoSlug') || ''));
                        const branch = String(fd.get('repoBranch') || 'main').trim() || 'main';
                        const packPath = String(fd.get('repoPath') || 'campaign-pack.json').trim() || 'campaign-pack.json';
                        if (!slug) {
                          void onPushCampaignRepo();
                          return;
                        }
                        void onPushCampaignRepo({ owner: slug.owner, repo: slug.repo, branch, packPath });
                      }}
                      title="Commit this campaign's binder entries and custom DLC back to GitHub (requires PAT in Settings)"
                    >
                      Push Pack
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const blob = new Blob([buildCampaignPackTemplate(campaign.name)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'campaign-pack.json';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Template
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {tab === 'binder' && (
          <div className="forge-grid-2 dm-hub__grid-2">
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
                          <span className="forge-muted text-sm">
                            — {entry.summary}
                          </span>
                        </span>
                      </summary>
                      <div className="forge-stack dm-hub__stack">
                        {entry.imageDataUrl && (
                          <img
                            src={entry.imageDataUrl}
                            alt={entry.title}
                            className="dm-hub__img"
                          />
                        )}
                        <div className="pre-wrap text-md">
                          {entry.body || entry.summary}
                        </div>
                        <div className="forge-row wrap">
                          {onShareHandout && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => onShareHandout(entry)}
                            >
                              Show to Players
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setEditingId(entry.id);
                              setEntryCat(entry.category);
                              setEntryTitle(entry.title);
                              setEntrySummary(entry.summary);
                              setEntryBody(entry.body);
                              setEntryImage(entry.imageDataUrl);
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
              <div className="forge-row wrap">
                <label className="btn clickable">
                  Attach Handout / Portrait Image
                  <input
                    type="file"
                    accept="image/*"
                    className="is-hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === 'string') setEntryImage(reader.result);
                      };
                      reader.readAsDataURL(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                {entryImage && (
                  <button type="button" className="btn" onClick={() => setEntryImage(undefined)}>
                    Clear Image
                  </button>
                )}
              </div>
              {activeSharedHandout && onHideHandout && (
                <div className="subpanel forge-row-between dm-hub__subpanel">
                  <span className="badge">Showing to Players: {activeSharedHandout.title}</span>
                  <button type="button" className="btn" onClick={onHideHandout}>
                    Hide Handout
                  </button>
                </div>
              )}
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
                      setEntryImage(undefined);
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
          <div className="forge-stack">
            <div className="forge-grid-2 dm-hub__grid-2">
            <div className="card forge-stack">
              <div className="forge-section-label">WORLD CLOCK &amp; REST PACING</div>
              <div className="tabular dm-hub__tabular">
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
                  className="forge-input flex-1"
                  value={timerLabel}
                  onChange={(e) => setTimerLabel(e.target.value)}
                  placeholder="Timer name (e.g. Potion Effect)"
                />
                <input
                  aria-label="Timer minutes"
                  type="number"
                  min={1}
                  className="forge-input tabular dm-hub__input-7"
                  value={timerMins}
                  onChange={(e) => setTimerMins(e.target.value)}
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

            <div className="card forge-stack">
              <div className="forge-row-between wrap">
                <div className="forge-section-label">DOWNTIME, CRAFTING &amp; BASTIONS</div>
                {onAdvanceDowntime && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onAdvanceDowntime(1)}
                  >
                    +1 Day Progress
                  </button>
                )}
              </div>

              {onUpsertDowntime && (
                <div className="forge-row wrap">
                  <input
                    aria-label="Downtime owner"
                    type="text"
                    className="forge-input dm-hub__input-2"
                    placeholder="PC or Bastion (e.g. Seraphina)"
                    value={dtOwner}
                    onChange={(e) => setDtOwner(e.target.value)}
                  />
                  <input
                    aria-label="Downtime project title"
                    type="text"
                    className="forge-input dm-hub__input-8"
                    placeholder="Project (e.g. Scribe Spell Scroll)"
                    value={dtTitle}
                    onChange={(e) => setDtTitle(e.target.value)}
                  />
                  <select
                    aria-label="Downtime project kind"
                    className="forge-input dm-hub__input-9"
                    value={dtKind}
                    onChange={(e) => setDtKind(e.target.value as DowntimeProject['kind'])}
                  >
                    <option value="craft">Craft</option>
                    <option value="scribe">Scribe</option>
                    <option value="train">Train</option>
                    <option value="bastion">Bastion</option>
                  </select>
                  <input
                    aria-label="Downtime total days"
                    type="number"
                    min={1}
                    className="forge-input tabular dm-hub__input-7"
                    value={dtDays}
                    onChange={(e) => setDtDays(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (!dtTitle.trim()) return;
                      onUpsertDowntime({
                        id: `dt-${Date.now().toString(36)}`,
                        ownerName: dtOwner.trim() || activeCharacterName,
                        title: dtTitle.trim(),
                        kind: dtKind,
                        daysDone: 0,
                        daysTotal: Math.max(1, Number.parseInt(dtDays, 10) || 5),
                      });
                      setDtTitle('');
                    }}
                  >
                    + Add Project
                  </button>
                </div>
              )}

              {(campaign.downtimeProjects ?? []).length === 0 ? (
                <div className="forge-muted">
                  No active downtime or bastion projects. Projects also advance automatically whenever the World Clock crosses midnight.
                </div>
              ) : (
                <div className="forge-stack">
                  {(campaign.downtimeProjects ?? []).map((proj) => {
                    const pct = Math.min(100, Math.round((proj.daysDone / Math.max(1, proj.daysTotal)) * 100));
                    const complete = proj.daysDone >= proj.daysTotal;
                    return (
                      <div key={proj.id} className="subpanel forge-row-between dm-hub__subpanel-2">
                        <div>
                          <div className="dm-hub__div-2">
                            {proj.title}{' '}
                            <span className="badge">{proj.kind.toUpperCase()}</span>{' '}
                            {complete && (
                              <span className="badge dm-hub__badge">
                                COMPLETE
                              </span>
                            )}
                          </div>
                          <div className="forge-muted text-sm">
                            Owner: {proj.ownerName} • {proj.daysDone} / {proj.daysTotal} days ({pct}%)
                          </div>
                        </div>
                        {onDeleteDowntime && (
                          <button type="button" className="btn" onClick={() => onDeleteDowntime(proj.id)}>
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'loot' && (
          <div className="forge-stack">
            <div className="forge-grid-2 dm-hub__grid-2">
              <div className="card forge-stack">
                <div className="forge-section-label">SRD TREASURE &amp; HOARD ROLLER</div>
                <div className="forge-row wrap">
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
                  <div className="card forge-stack dm-hub__card">
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
                      <div className="dm-hub__div-3">
                        Magic Items: {lastTreasure.magicItems.join(', ')}
                      </div>
                    )}
                    <div className="forge-row wrap">
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
                  Party stash: <strong>{campaign.partyLootGp.toLocaleString()} GP</strong>{' '}
                  <button
                    type="button"
                    className="btn dm-hub__btn"
                    disabled={campaign.partyLootGp < characterList.length}
                    onClick={() => void onDistributeGold(campaign.partyLootGp)}
                  >
                    Distribute All GP
                  </button>
                </div>
                <div className="forge-row-between wrap gap-2">
                  <div className="forge-muted text-md">
                    Stash Items ({campaign.partyLootItems.length})
                  </div>
                  {onAssignLootToCharacter && characterList.length > 0 && campaign.partyLootItems.length > 0 && (
                    <select
                      aria-label="Recipient character for party stash"
                      className="forge-input dm-hub__input-10"
                      value={lootRecipientId || characterList[0]?.id || ''}
                      onChange={(e) => setLootRecipientId(e.target.value)}
                    >
                      {characterList.map((c) => (
                        <option key={c.id} value={c.id}>
                          Give to: {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {campaign.partyLootItems.length === 0 ? (
                  <div className="forge-muted text-md">No items in Party Stash yet.</div>
                ) : (
                  <div className="forge-stack dm-hub__stack-2">
                    {campaign.partyLootItems.map((itemName, idx) => (
                      <div key={`${itemName}-${idx}`} className="forge-list-row">
                        <span className="text-md">{itemName}</span>
                        {onAssignLootToCharacter && characterList.length > 0 && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              void onAssignLootToCharacter(itemName, lootRecipientId || characterList[0]!.id)
                            }
                          >
                            Give to PC
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="forge-muted text-md">
                  The stash is shared by the party. Shop purchases are paid from the active character&apos;s own purse (see Merchant Shop below).
                </div>
              </div>
            </div>

            <div className="card forge-stack">
              <div className="forge-row-between wrap">
                <span className="forge-section-label mb-0">
                  MERCHANT SHOP GENERATOR
                </span>
                <span className="badge tabular" data-testid="shop-purse">
                  {activeCharacterName}&apos;s purse: {activeCharacterGp.toLocaleString()} GP
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
                  <div className="dm-hub__stack">
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
            <div className="card forge-grid-2 dm-hub__card-2">
              <div className="forge-stack">
                <div className="forge-section-label">PARTY XP &amp; MILESTONE AWARDS</div>
                <div className="forge-muted tabular">
                  Current Encounter Total: <strong>{encDiff.rawXp.toLocaleString()} XP</strong> ({Math.floor(encDiff.rawXp / Math.max(1, characterList.length)).toLocaleString()} XP per PC) • Campaign XP Earned: {campaign.partyXpTotal.toLocaleString()}
                </div>
                <div className="forge-row wrap">
                  <label className="forge-muted" htmlFor="dm-xp-amount">
                    XP to award (starts at the encounter total; edit it for a custom amount)
                  </label>
                  <input
                    id="dm-xp-amount"
                    type="number"
                    min={0}
                    className="forge-input tabular dm-hub__input-11"
                    value={xpAmountText}
                    onChange={(e) => setCustomXp(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={xpAmount <= 0}
                    onClick={() => void onAwardXp(xpAmount)}
                  >
                    Award {xpAmount.toLocaleString()} XP to the party ({xpPerPc.toLocaleString()} each)
                  </button>
                  {customXp !== null && (
                    <button type="button" className="btn" onClick={() => setCustomXp(null)}>
                      Use encounter total ({encDiff.rawXp.toLocaleString()})
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
                  <div className="forge-row wrap">
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

        {tab === 'improv' && (
          <div className="forge-grid-2 dm-hub__grid-2">
            <div className="card forge-stack">
              <div className="forge-section-label">ONE-CLICK NPC &amp; TAVERN GENERATORS</div>
              <div className="forge-row wrap">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setPreviewNpc(generateRandomNpc())}
                >
                  Generate Random NPC
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setPreviewTavern(generateRandomTavern())}
                >
                  Generate Random Tavern
                </button>
              </div>
              {previewNpc && (
                <div className="subpanel forge-stack dm-hub__subpanel-3">
                  <strong>{previewNpc.title}</strong>
                  <span className="muted-label">{previewNpc.summary}</span>
                  <div className="pre-wrap text-md">{previewNpc.body}</div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      onUpsertEntry({ id: `npc-${Date.now().toString(36)}`, ...previewNpc });
                      setPreviewNpc(null);
                    }}
                  >
                    Save NPC to Binder
                  </button>
                </div>
              )}
              {previewTavern && (
                <div className="subpanel forge-stack dm-hub__subpanel-3">
                  <strong>{previewTavern.title}</strong>
                  <span className="muted-label">{previewTavern.summary}</span>
                  <div className="pre-wrap text-md">{previewTavern.body}</div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      onUpsertEntry({ id: `tav-${Date.now().toString(36)}`, ...previewTavern });
                      setPreviewTavern(null);
                    }}
                  >
                    Save Tavern to Binder
                  </button>
                </div>
              )}
            </div>

            <div className="card forge-stack">
              <div className="forge-section-label">RANDOM ENCOUNTER GENERATOR</div>
              <div className="forge-row wrap">
                <select
                  aria-label="Encounter environment"
                  className="forge-input"
                  value={improvEnv}
                  onChange={(e) => setImprovEnv(e.target.value as typeof improvEnv)}
                >
                  <option value="Dungeon">Dungeon</option>
                  <option value="Forest">Forest</option>
                  <option value="Urban">Urban</option>
                  <option value="Underdark">Underdark</option>
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    setPreviewEnc(
                      generateRandomEncounter(
                        characterList.map((c) => c.classes.reduce((s, cl) => s + cl.level, 0)),
                        improvEnv
                      )
                    )
                  }
                >
                  Roll Random Encounter
                </button>
              </div>
              {previewEnc && (
                <div className="subpanel forge-stack dm-hub__subpanel-3">
                  <div className="forge-row-between">
                    <strong>{previewEnc.title}</strong>
                    <span className="badge tabular">
                      {previewEnc.difficulty} ({previewEnc.adjustedXp} XP)
                    </span>
                  </div>
                  <div className="text-md">{previewEnc.hook}</div>
                  {onSpawnImprovEncounter && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onSpawnImprovEncounter(previewEnc)}
                    >
                      Spawn into Active Encounter
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'worldmap' && (
          <div className="forge-stack">
            <div className="card forge-row-between wrap gap-3">
              <div className="forge-row wrap">
                <label className="btn clickable">
                  Upload World / Region Map
                  <input
                    type="file"
                    accept="image/*"
                    className="is-hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === 'string') onSetWorldMapImage?.(reader.result);
                      };
                      reader.readAsDataURL(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                {campaign.worldMapImageDataUrl && (
                  <button type="button" className="btn" onClick={() => onSetWorldMapImage?.(undefined)}>
                    Clear World Map
                  </button>
                )}
              </div>
              <div className="forge-row wrap">
                <input
                  type="text"
                  className="forge-input dm-hub__input-12"
                  placeholder="Next pin label..."
                  value={pinLabel}
                  onChange={(e) => setPinLabel(e.target.value)}
                />
                <select
                  aria-label="World map pin type"
                  className="forge-input"
                  value={pinKind}
                  onChange={(e) => setPinKind(e.target.value as WorldMapPin['kind'])}
                >
                  <option value="location">Location</option>
                  <option value="quest">Quest</option>
                  <option value="npc">NPC</option>
                  <option value="danger">Danger</option>
                </select>
                <select
                  aria-label="Link pin to binder entry"
                  className="forge-input"
                  value={pinEntryId}
                  onChange={(e) => setPinEntryId(e.target.value)}
                >
                  <option value="">Link Binder Note (optional)</option>
                  {campaign.entries.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className="card dm-hub__card-3"
              onClick={(e) => {
                if (!onUpsertWorldMapPin) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const xPct = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
                const yPct = Math.max(2, Math.min(98, ((e.clientY - rect.top) / rect.height) * 100));
                const newPin: WorldMapPin = {
                  id: `pin-${Date.now().toString(36)}`,
                  xPct: Number(xPct.toFixed(1)),
                  yPct: Number(yPct.toFixed(1)),
                  label: pinLabel.trim() || `Pin ${(campaign.worldMapPins?.length ?? 0) + 1}`,
                  kind: pinKind,
                  entryId: pinEntryId || undefined,
                };
                onUpsertWorldMapPin(newPin);
                setSelectedPinId(newPin.id);
                setPinLabel('');
              }}
            >
              {campaign.worldMapImageDataUrl ? (
                <img
                  src={campaign.worldMapImageDataUrl}
                  alt="Campaign World Map"
                  className="dm-hub__img-2"
                />
              ) : (
                <div className="forge-muted dm-hub__muted">
                  Upload a region/world map above, or click anywhere on this canvas to drop interactive campaign pins.
                </div>
              )}

              {(campaign.worldMapPins ?? []).map((pin) => {
                const bg =
                  pin.kind === 'danger'
                    ? 'var(--accent-red-dark)'
                    : pin.kind === 'quest'
                      ? 'var(--accent-amber-dark)'
                      : pin.kind === 'npc'
                        ? 'var(--accent-purple-dark)'
                        : 'var(--accent-blue-dark)';
                return (
                  <button
                    key={pin.id}
                    type="button"
                    className="dm-hub__button" style={{ left: `${pin.xPct}%`, top: `${pin.yPct}%`, background: bg, border: selectedPinId === pin.id ? '2px solid var(--text-primary-dark)' : '1px solid var(--bg-base-dark)' }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedPinId(pin.id);
                    }}
                  >
                    {pin.label}
                  </button>
                );
              })}
            </div>

            {selectedPinId && (() => {
              const activePin = (campaign.worldMapPins ?? []).find((p) => p.id === selectedPinId);
              if (!activePin) return null;
              const linked = activePin.entryId
                ? campaign.entries.find((e) => e.id === activePin.entryId)
                : undefined;
              return (
                <div className="card forge-row-between wrap gap-3">
                  <div>
                    <strong>{activePin.label}</strong>{' '}
                    <span className="badge">{activePin.kind.toUpperCase()}</span>
                    {linked && (
                      <div className="muted-label">
                        Linked Binder Note: <strong>{linked.title}</strong> — {linked.summary}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      onDeleteWorldMapPin?.(activePin.id);
                      setSelectedPinId(null);
                    }}
                  >
                    Remove Pin
                  </button>
                </div>
              );
            })()}
          </div>
        )}

        {tab === 'soundboard' && (
          <div className="forge-grid-2 dm-hub__grid-2">
            <div className="card forge-stack">
              <div className="forge-section-label">AMBIENT LOOPS (OFFLINE WEB AUDIO)</div>
              <label className="forge-row">
                <span className="forge-label">MASTER VOLUME</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={boardVol}
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    setBoardVol(v);
                    tabletopSoundboard.setVolume(v);
                  }}
                />
                <span className="badge tabular">{Math.round(boardVol * 100)}%</span>
              </label>
              <div className="pill-row">
                {(
                  [
                    ['tavern', 'Tavern Hearth'],
                    ['rain', 'Steady Rain'],
                    ['dungeon', 'Deep Dungeon'],
                    ['battle', 'Tense Battle'],
                  ] as Array<[AmbientPresetId, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`pill ${activeAmbient === id ? 'active' : ''}`}
                    onClick={() => setActiveAmbient(tabletopSoundboard.toggleAmbient(id))}
                  >
                    {activeAmbient === id ? `Playing: ${label}` : label}
                  </button>
                ))}
                {activeAmbient && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      tabletopSoundboard.stopAmbient();
                      setActiveAmbient(null);
                    }}
                  >
                    Stop Ambient
                  </button>
                )}
              </div>
            </div>

            <div className="card forge-stack">
              <div className="forge-section-label">ONE-SHOT SFX &amp; LOCAL TRACK PLAYER</div>
              <div className="pill-row">
                {(
                  [
                    ['sword', 'Sword Clash'],
                    ['fireball', 'Fireball'],
                    ['thunder', 'Thunder'],
                    ['door', 'Door Creak'],
                    ['coins', 'Coins'],
                    ['fanfare', 'Victory Fanfare'],
                  ] as Array<[SfxPresetId, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="btn"
                    onClick={() => tabletopSoundboard.playSfx(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="forge-row wrap">
                <label className="btn clickable">
                  Load Local Audio Track (MP3/WAV/OGG)
                  <input
                    type="file"
                    accept="audio/*"
                    className="is-hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (customAudioUrl) URL.revokeObjectURL(customAudioUrl);
                      setCustomAudioUrl(URL.createObjectURL(f));
                      setCustomAudioName(f.name);
                      e.target.value = '';
                    }}
                  />
                </label>
                {customAudioName && <span className="muted-label">{customAudioName}</span>}
              </div>
              {customAudioUrl && (
                <audio controls src={customAudioUrl} className="dm-hub__audio" />
              )}
            </div>
          </div>
        )}
    </div>
  );

  if (activeTabProp) {
    return (
      <div className="forge-stack">
        {tab === 'binder' && renderCampaignBar()}
        {hubContent}
      </div>
    );
  }
  return (
    <div className="forge-stack">
      {tab === 'binder' && renderCampaignBar()}
      <div className="dm-studio-shell">
        <nav className="card dm-studio-nav" aria-label="DM Studio sections">
          {dmTabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`unified-rail-btn ${tab === k ? 'active' : ''}`}
              onClick={() => setTab(k)}
            >
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div>{hubContent}</div>
      </div>
    </div>
  );
}
