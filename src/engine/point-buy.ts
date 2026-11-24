import { AbilityKey } from '../types/core';

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

export const POINT_BUY_COST_TABLE: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export const DEFAULT_POINT_BUY_SCORES: Record<AbilityKey, number> = {
  str: 8,
  dex: 8,
  con: 8,
  int: 8,
  wis: 8,
  cha: 8,
};

export function computePointBuyCost(score: number): number {
  const clamped = Math.max(POINT_BUY_MIN, Math.min(POINT_BUY_MAX, Math.round(score)));
  return POINT_BUY_COST_TABLE[clamped] ?? 0;
}

export function computePointBuyTotal(scores: Record<AbilityKey, number>): number {
  return (Object.values(scores) as number[]).reduce((sum, score) => sum + computePointBuyCost(score), 0);
}

export function canAdjustPointBuy(
  scores: Record<AbilityKey, number>,
  key: AbilityKey,
  delta: 1 | -1
): boolean {
  const current = scores[key];
  const next = current + delta;
  if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return false;
  if (delta < 0) return true;
  const candidate = { ...scores, [key]: next };
  return computePointBuyTotal(candidate) <= POINT_BUY_BUDGET;
}
