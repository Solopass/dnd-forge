export type RulesetPreset = '2014' | '2024' | 'custom';

export interface HouseRulesConfig {
  exhaustionRule: '2014' | '2024';
  potionAction: 'action' | 'bonus_action';
  weaponMastery: 'enabled' | 'disabled';
  surpriseRule: '2014' | '2024';
  flankingRule: 'off' | 'advantage' | 'plus2';
  critRule: 'standard' | 'crunchy';
}

export const RULESET_2014_DEFAULTS: HouseRulesConfig = {
  exhaustionRule: '2014',
  potionAction: 'action',
  weaponMastery: 'disabled',
  surpriseRule: '2014',
  flankingRule: 'off',
  critRule: 'standard',
};

export const RULESET_2024_DEFAULTS: HouseRulesConfig = {
  exhaustionRule: '2024',
  potionAction: 'bonus_action',
  weaponMastery: 'enabled',
  surpriseRule: '2024',
  flankingRule: 'off',
  critRule: 'standard',
};

export const HOUSE_RULES_STORAGE_KEY = 'dnd-forge-house-rules';

export function detectRulesetPreset(config: HouseRulesConfig): RulesetPreset {
  const is2014 = (Object.keys(RULESET_2014_DEFAULTS) as Array<keyof HouseRulesConfig>).every(
    (k) => config[k] === RULESET_2014_DEFAULTS[k]
  );
  if (is2014) return '2014';

  const is2024 = (Object.keys(RULESET_2024_DEFAULTS) as Array<keyof HouseRulesConfig>).every(
    (k) => config[k] === RULESET_2024_DEFAULTS[k]
  );
  if (is2024) return '2024';

  return 'custom';
}

export function readStoredHouseRules(): HouseRulesConfig {
  try {
    const raw = localStorage.getItem(HOUSE_RULES_STORAGE_KEY);
    if (!raw) return { ...RULESET_2024_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<HouseRulesConfig>;
    return {
      ...RULESET_2024_DEFAULTS,
      ...parsed,
    };
  } catch {
    return { ...RULESET_2024_DEFAULTS };
  }
}

export function saveHouseRules(config: HouseRulesConfig): void {
  try {
    localStorage.setItem(HOUSE_RULES_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

export interface RuleChoiceOption<K extends keyof HouseRulesConfig = keyof HouseRulesConfig> {
  key: K;
  title: string;
  summary2014vs2024: string;
  options: Array<{
    value: HouseRulesConfig[K];
    label: string;
    detail: string;
  }>;
}

export const RULE_DEFINITIONS: RuleChoiceOption[] = [
  {
    key: 'exhaustionRule',
    title: 'Exhaustion Penalty',
    summary2014vs2024:
      '2014 uses a 6-tier escalating table (disadvantage on checks -> half speed -> disadvantage on attacks/saves). 2024 uses a flat -2 per level to d20 tests & Save DCs plus -5 ft Speed.',
    options: [
      { value: '2014', label: '2014 6-Tier Table', detail: 'Disadv. on checks at 1, half speed at 2, disadv. on attacks/saves at 3.' },
      { value: '2024', label: '2024 Linear (-2 / level)', detail: '-2 per level to d20 rolls & Save DCs, -5 ft Speed per level.' },
    ],
  },
  {
    key: 'potionAction',
    title: 'Drinking a Healing Potion',
    summary2014vs2024:
      '2014 requires a full Action to drink a Potion of Healing. 2024 (and a popular 5e house rule) allows drinking it as a Bonus Action.',
    options: [
      { value: 'action', label: '2014 Standard (Action)', detail: 'Potions of Healing stay in Actions.' },
      { value: 'bonus_action', label: '2024 / House Rule (Bonus Action)', detail: 'Potions of Healing appear in Bonus Actions.' },
    ],
  },
  {
    key: 'weaponMastery',
    title: '2024 Weapon Mastery',
    summary2014vs2024:
      '2024 adds Weapon Mastery properties (Graze miss damage, Topple prone save, Sap, Vex, Push, Slow, Cleave, Nick). 2014 omits them.',
    options: [
      { value: 'enabled', label: '2024 Enabled', detail: 'Show Mastery badges and apply Graze / Topple effects in combat.' },
      { value: 'disabled', label: '2014 Classic (Disabled)', detail: 'Hide Weapon Mastery badges and treat weapons as classic 5e.' },
    ],
  },
  {
    key: 'surpriseRule',
    title: 'Surprise in Combat',
    summary2014vs2024:
      'In 2014, Surprised creatures cannot move or take actions on Turn 1. In 2024, Surprised creatures simply roll Initiative with Disadvantage.',
    options: [
      { value: '2014', label: '2014 Skip Turn 1', detail: 'Surprised creatures lose movement and actions on Round 1.' },
      { value: '2024', label: '2024 Disadvantage on Initiative', detail: 'Surprised creatures act normally after rolling Initiative at Disadvantage.' },
    ],
  },
  {
    key: 'flankingRule',
    title: 'Flanking (Optional Rule)',
    summary2014vs2024:
      'Core 5e (both 2014 and 2024) has no flanking bonus by default. Many tables use the DMG Advantage rule or a +2 bonus.',
    options: [
      { value: 'off', label: 'Off (Standard 5e)', detail: 'No flanking bonus.' },
      { value: 'advantage', label: 'DMG Optional (Advantage)', detail: 'Melee attacks gain Advantage when flanking.' },
      { value: 'plus2', label: 'House Rule (+2 to Hit)', detail: 'Melee attacks gain +2 when flanking.' },
    ],
  },
  {
    key: 'critRule',
    title: 'Critical Hit Damage',
    summary2014vs2024:
      'Standard 5e rolls twice as many damage dice on a Natural 20. Crunchy Crits maximize the base dice and roll the extra dice.',
    options: [
      { value: 'standard', label: 'Standard 5e (2× Dice)', detail: 'Roll double damage dice on a critical hit.' },
      { value: 'crunchy', label: 'Crunchy Crits (Max + Roll)', detail: 'Maximize base dice + roll bonus dice on a critical hit.' },
    ],
  },
];
