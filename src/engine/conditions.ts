import { AbilityKey, RollMode } from '../types/core';
import { resolveRollMode } from './dice';

export const CONDITION_RULES: Record<string, string> = {
  Blinded: "Can't see; auto-fails sight checks. Attacks against you have Advantage; your attacks have Disadvantage.",
  Charmed: "Can't attack the charmer or target them with harmful effects. Charmer has Advantage on social checks.",
  Deafened: "Can't hear and auto-fails any ability check requiring hearing.",
  Exhaustion: 'Cumulative penalty levels (-2 per level in 2024; escalating penalties/halved speed in 2014).',
  Frightened: 'Disadvantage on ability checks and attacks while source of fear is in sight; cannot willingly move closer.',
  Grappled: 'Speed becomes 0 and cannot benefit from any bonus to speed.',
  Incapacitated: "Cannot take actions, bonus actions, or reactions (breaks Concentration).",
  Invisible: 'Impossible to see without special sense; your attacks have Advantage and attacks against you have Disadvantage.',
  Paralyzed: "Incapacitated, can't move or speak; auto-fails STR/DEX saves; melee hits within 5 ft are critical hits.",
  Petrified: 'Turned to stone, incapacitated, resistant to all damage, immune to poison and disease.',
  Poisoned: 'Disadvantage on attack rolls and ability checks.',
  Prone: 'Only crawl unless standing up (half speed); Disadvantage on attacks; melee attacks within 5 ft have Advantage.',
  Restrained: 'Speed 0; Disadvantage on DEX saves and attacks; attacks against you have Advantage.',
  Stunned: "Incapacitated, can't move, speak falteringly; auto-fails STR/DEX saves; attacks against you have Advantage.",
  Unconscious: "Incapacitated, drops held items, falls Prone; auto-fails STR/DEX saves; melee hits within 5 ft are crits.",
};

export function resolveConditionRollMode(
  conditions: string[],
  kind: 'attack' | 'check' | 'save',
  saveAbility?: AbilityKey,
  baseMode: RollMode = 'normal'
): { mode: RollMode; reasons: string[] } {
  let adv = baseMode === 'advantage' ? 1 : 0;
  let dis = baseMode === 'disadvantage' ? 1 : 0;
  const reasons: string[] = [];

  for (const raw of conditions) {
    const c = raw.toLowerCase();
    if (kind === 'attack') {
      if (c === 'invisible') {
        adv += 1;
        reasons.push('ADV: Invisible');
      }
      if (c === 'blinded' || c === 'frightened' || c === 'poisoned' || c === 'prone' || c === 'restrained') {
        dis += 1;
        reasons.push(`DIS: ${raw}`);
      }
    } else if (kind === 'check') {
      if (c === 'frightened' || c === 'poisoned') {
        dis += 1;
        reasons.push(`DIS: ${raw}`);
      }
    } else if (kind === 'save' && saveAbility === 'dex') {
      if (c === 'restrained') {
        dis += 1;
        reasons.push(`DIS: ${raw}`);
      }
    }
  }

  return {
    mode: resolveRollMode(adv, dis),
    reasons,
  };
}
