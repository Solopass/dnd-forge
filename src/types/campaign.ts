export type CampaignCategory = 'session' | 'npc' | 'location' | 'quest' | 'faction' | 'handout';

export interface CampaignEntry {
  id: string;
  category: CampaignCategory;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  status: 'active' | 'completed' | 'secret';
  pinned?: boolean;
  imageDataUrl?: string;
  updatedAt: string;
}

export interface WorldMapPin {
  id: string;
  xPct: number;
  yPct: number;
  label: string;
  kind: 'location' | 'quest' | 'npc' | 'danger';
  entryId?: string;
  notes?: string;
}

export interface SharedHandoutPayload {
  id: string;
  title: string;
  summary: string;
  body: string;
  imageDataUrl?: string;
  senderName: string;
}

export interface ClockTimer {
  id: string;
  label: string;
  remainingMinutes: number;
}

export interface WorldClockState {
  day: number;
  hour: number;
  minute: number;
  calendarName: string;
  weather: string;
  activeTimers: ClockTimer[];
}

export interface DowntimeProject {
  id: string;
  ownerName: string;
  title: string;
  kind: 'craft' | 'scribe' | 'train' | 'bastion';
  daysDone: number;
  daysTotal: number;
  notes?: string;
}

export interface ExternalRepoConfig {
  owner: string;
  repo: string;
  branch?: string;
  packPath?: string;
  lastSyncedAt?: string;
}

/** A pack the DM linked to this campaign. `sha` is the pinned commit players are synced to ("" = not pinned yet). */
export interface CampaignPack {
  owner: string;
  repo: string;
  ref: string;
  sha: string;
  enabled: boolean;
}

export interface CampaignRecord {
  id: string;
  name: string;
  setting: string;
  clock: WorldClockState;
  partyXpTotal: number;
  partyLootGp: number;
  partyLootItems: string[];
  partyStash?: import('./compendium').CompendiumEntity[];
  entries: CampaignEntry[];
  worldMapImageDataUrl?: string;
  worldMapPins?: WorldMapPin[];
  downtimeProjects?: DowntimeProject[];
  /** Packs linked to this campaign; the Live Table syncs the enabled, pinned ones to players. */
  packs: CampaignPack[];
  /** Older single-repo link (campaign-pack.json). Still read for old backups: it is migrated into `packs` on load. */
  externalRepo?: ExternalRepoConfig;
  createdAt: string;
}
