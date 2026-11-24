import { RollMode } from '../types/core';

export interface DieTermResult {
  expression: string;
  kept: number[];
  dropped: number[];
  subtotal: number;
}

export interface DiceRollResult {
  expression: string;
  mode: RollMode;
  terms: DieTermResult[];
  flatModifier: number;
  total: number;
  isCrit: boolean;
  isFumble: boolean;
}

const DICE_TERM_REGEX = /([+-]?\s*\d*)d(\d+)(?:k([hl])(\d+))?|([+-]?\s*\d+)/gi;

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function resolveRollMode(advantageSources: number, disadvantageSources: number): RollMode {
  if (advantageSources > 0 && disadvantageSources > 0) return 'normal';
  if (advantageSources > 0) return 'advantage';
  if (disadvantageSources > 0) return 'disadvantage';
  return 'normal';
}

export function doubleDiceForCrit(expression: string): string {
  return expression.replace(/(\d*)d(\d+)/gi, (_match, countStr: string, sides: string) => {
    const count = countStr === '' ? 1 : Number.parseInt(countStr, 10);
    return `${count * 2}d${sides}`;
  });
}

export function evaluateDiceExpression(
  rawExpression: string,
  mode: RollMode = 'normal'
): DiceRollResult {
  const cleaned = rawExpression.replace(/\s+/g, '');
  const terms: DieTermResult[] = [];
  let flatModifier = 0;
  let isCrit = false;
  let isFumble = false;

  DICE_TERM_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DICE_TERM_REGEX.exec(cleaned)) !== null) {
    if (match[0] === '') break;

    const diceCountRaw = match[1];
    const sidesRaw = match[2];
    const keepType = match[3]?.toLowerCase() as 'h' | 'l' | undefined;
    const keepCountRaw = match[4];
    const flatRaw = match[5];

    if (sidesRaw !== undefined) {
      const sign = diceCountRaw?.startsWith('-') ? -1 : 1;
      const absCountStr = diceCountRaw?.replace(/^[+-]/, '') ?? '';
      const count = absCountStr === '' ? 1 : Number.parseInt(absCountStr, 10);
      const sides = Number.parseInt(sidesRaw, 10);

      if (count === 1 && sides === 20 && !keepType && mode !== 'normal') {
        const r1 = rollDie(20);
        const r2 = rollDie(20);
        const keptVal = mode === 'advantage' ? Math.max(r1, r2) : Math.min(r1, r2);
        const droppedVal = mode === 'advantage' ? Math.min(r1, r2) : Math.max(r1, r2);
        if (keptVal === 20) isCrit = true;
        if (keptVal === 1) isFumble = true;
        terms.push({
          expression: `1d20(${mode})`,
          kept: [keptVal],
          dropped: [droppedVal],
          subtotal: sign * keptVal,
        });
        continue;
      }

      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        rolls.push(rollDie(sides));
      }

      let kept = [...rolls];
      let dropped: number[] = [];

      if (keepType && keepCountRaw) {
        const keepCount = Math.min(rolls.length, Number.parseInt(keepCountRaw, 10));
        const indexed = rolls.map((val, idx) => ({ val, idx }));
        indexed.sort((a, b) => (keepType === 'h' ? b.val - a.val : a.val - b.val));
        const keptSet = new Set(indexed.slice(0, keepCount).map((entry) => entry.idx));
        kept = rolls.filter((_, idx) => keptSet.has(idx));
        dropped = rolls.filter((_, idx) => !keptSet.has(idx));
      }

      if (count === 1 && sides === 20 && kept[0] === 20) isCrit = true;
      if (count === 1 && sides === 20 && kept[0] === 1) isFumble = true;

      const subtotal = sign * kept.reduce((acc, n) => acc + n, 0);
      terms.push({
        expression: match[0],
        kept,
        dropped,
        subtotal,
      });
    } else if (flatRaw !== undefined) {
      flatModifier += Number.parseInt(flatRaw, 10);
    }
  }

  const diceSum = terms.reduce((acc, term) => acc + term.subtotal, 0);

  return {
    expression: rawExpression,
    mode,
    terms,
    flatModifier,
    total: diceSum + flatModifier,
    isCrit,
    isFumble,
  };
}
