import { describe, expect, it } from 'vitest';
import { crToXp, evaluateEncounterDifficulty, normalizeCr } from '../encounter-math';

describe('fractional CRs from the SRD JSON (audit D3)', () => {
  it('normalizes decimal CRs to the table keys', () => {
    expect(normalizeCr('0.25')).toBe('1/4');
    expect(normalizeCr(' 0.125 ')).toBe('1/8');
    expect(normalizeCr('0.5')).toBe('1/2');
    expect(normalizeCr('3')).toBe('3');
  });

  it('counts XP for a "0.25" goblin the same as a "1/4" goblin', () => {
    expect(crToXp('0.25')).toBe(50);
    expect(crToXp('1/4')).toBe(50);
    expect(evaluateEncounterDifficulty([3, 3], ['0.25', '0.25']).rawXp).toBe(100);
  });
});
