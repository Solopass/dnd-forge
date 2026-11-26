export const CR_XP_TABLE: Record<string, number> = {
  '0': 10,
  '1/8': 25,
  '1/4': 50,
  '1/2': 100,
  '1': 200,
  '2': 450,
  '3': 700,
  '4': 1100,
  '5': 1800,
  '6': 2300,
  '7': 2900,
  '8': 3900,
  '9': 5000,
  '10': 5900,
  '11': 7200,
  '12': 8400,
  '13': 10000,
  '14': 11500,
  '15': 13000,
  '16': 15000,
  '17': 18000,
  '18': 20000,
  '19': 22000,
  '20': 25000,
  '21': 33000,
  '22': 41000,
  '23': 50000,
  '24': 62000,
  '25': 75000,
  '26': 90000,
  '27': 105000,
  '28': 120000,
  '29': 135000,
  '30': 155000,
};

export const PARTY_XP_THRESHOLDS: Record<number, readonly [number, number, number, number]> = {
  1: [25, 50, 75, 100],
  2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],
  4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],
  8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600],
  12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],
  14: [1250, 2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],
  18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900],
  20: [2800, 5700, 8500, 12700],
};

const DECIMAL_CR: Record<string, string> = { '0.125': '1/8', '0.25': '1/4', '0.5': '1/2' };

/** The SRD JSON stores fractional CRs as decimals ("0.25"); the XP table and UI use "1/4". */
export function normalizeCr(cr: string): string {
  const t = cr.trim();
  return DECIMAL_CR[t] ?? t;
}

export function crToXp(cr?: string): number {
  if (!cr) return 0;
  return CR_XP_TABLE[normalizeCr(cr)] ?? 0;
}

export function getEncounterMultiplier(monsterCount: number): number {
  if (monsterCount <= 0) return 1;
  if (monsterCount === 1) return 1;
  if (monsterCount === 2) return 1.5;
  if (monsterCount <= 6) return 2;
  if (monsterCount <= 10) return 2.5;
  if (monsterCount <= 14) return 3;
  return 4;
}

export type DifficultyRating = 'Trivial' | 'Easy' | 'Medium' | 'Hard' | 'Deadly';

export interface EncounterDifficultyResult {
  rawXp: number;
  adjustedXp: number;
  rating: DifficultyRating;
  thresholds: { easy: number; medium: number; hard: number; deadly: number };
}

export function evaluateEncounterDifficulty(
  pcLevels: number[],
  monsterCrs: string[]
): EncounterDifficultyResult {
  const effectiveLevels = pcLevels.length > 0 ? pcLevels : [1];
  const thresholds = { easy: 0, medium: 0, hard: 0, deadly: 0 };

  for (const rawLvl of effectiveLevels) {
    const lvl = Math.max(1, Math.min(20, Math.round(rawLvl)));
    const row = PARTY_XP_THRESHOLDS[lvl] ?? [25, 50, 75, 100];
    thresholds.easy += row[0];
    thresholds.medium += row[1];
    thresholds.hard += row[2];
    thresholds.deadly += row[3];
  }

  const rawXp = monsterCrs.reduce((sum, cr) => sum + crToXp(cr), 0);
  const multiplier = getEncounterMultiplier(monsterCrs.length);
  const adjustedXp = Math.round(rawXp * multiplier);

  let rating: DifficultyRating = 'Trivial';
  if (adjustedXp >= thresholds.deadly) rating = 'Deadly';
  else if (adjustedXp >= thresholds.hard) rating = 'Hard';
  else if (adjustedXp >= thresholds.medium) rating = 'Medium';
  else if (adjustedXp >= thresholds.easy) rating = 'Easy';

  return { rawXp, adjustedXp, rating, thresholds };
}
