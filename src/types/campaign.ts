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
  updatedAt: string;
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

export interface CampaignRecord {
  id: string;
  name: string;
  setting: string;
  clock: WorldClockState;
  partyXpTotal: number;
  partyLootGp: number;
  partyLootItems: string[];
  entries: CampaignEntry[];
  createdAt: string;
}
