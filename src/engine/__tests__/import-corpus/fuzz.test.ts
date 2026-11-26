import { describe, expect, it } from 'vitest';
import type { CompendiumEntity } from '../../../types/compendium';
import { runImportPipeline, runImportPipelineOnEntities } from '../../import-pipeline';
import { expectValidEntity } from './validate';

// Seeded random mutations of valid entities: whatever comes out of the mutation, the pipeline must not
// throw and every input must end accepted (valid), repaired (valid + notes) or rejected (with a reason).
const SEED = 20261126;
const ITERATIONS = 500;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const BASES: CompendiumEntity[] = [
  { id: 'f-rope', name: 'Fuzz Rope', source: 'Fuzz', ruleset: '2014', category: 'gear', weight: 10, quantity: 1, activities: [], entries: ['Fifty feet of rope.', 'Second paragraph.'] },
  { id: 'f-sword', name: 'Fuzz Sword', source: 'Fuzz', ruleset: '2024', category: 'weapon', weaponMastery: 'Graze', activities: [{ id: 'act-f-sword', name: 'Slash', type: 'attack', actionEconomy: 'action', attackAbility: 'str', attackBonusFormula: '@mod+@prof', damageFormula: '1d8+@mod', damageType: 'slashing' }], entries: ['A blade.'] },
  { id: 'f-mail', name: 'Fuzz Mail', source: 'Fuzz', ruleset: '2014', category: 'armor', acFormula: { base: 14, dexCap: 2 }, activities: [], entries: ['Rings.'] },
  { id: 'f-bolt', name: 'Fuzz Bolt', source: 'Fuzz', ruleset: '2014', category: 'spell', spellLevel: 3, classes: ['Wizard'], castingTime: '1 action', range: '120 feet', components: 'V, S', duration: 'Instantaneous', concentration: false, ritual: false, activities: [{ id: 'act-f-bolt', name: 'Bolt', type: 'save', actionEconomy: 'action', saveAbility: 'dex', saveDcFormula: '8+@prof+@spell', damageFormula: '8d6', damageType: 'fire', upcastDicePerLevel: '1d6', resourceCost: { poolId: 'spell_slot_3', amount: 1 } }], entries: ['A {@damage 8d6} bolt of fire.'] },
  { id: 'f-ogre', name: 'Fuzz Ogre', source: 'Fuzz', ruleset: '2014', category: 'monster', monsterMeta: { ac: 11, hp: 59, dexModifier: -1, cr: '2', size: 'large', speeds: '40 ft.', resistances: ['fire'], traits: ['Big: it is big.'] }, activities: [{ id: 'act-f-club', name: 'Greatclub', type: 'attack', actionEconomy: 'action', attackBonusFormula: '6', damageFormula: '2d8+4' }], entries: ['A large brute.'] },
  { id: 'f-feat', name: 'Fuzz Feat', source: 'Fuzz', ruleset: '2024', category: 'feat', modifiers: [{ target: 'initiative', value: 5 }], activities: [], entries: ['You are quick.'] },
];

const JUNK: Array<() => unknown> = [
  () => null,
  () => undefined,
  () => 42,
  () => -7.5,
  () => Number.NaN,
  () => Number.POSITIVE_INFINITY,
  () => '',
  () => '   ',
  () => 'text',
  () => '0.25',
  () => '1d8 + STR',
  () => '�\u0000\u0007\uD800',
  () => 'x'.repeat(120000),
  () => true,
  () => [],
  () => [null, 1, 'a', [2, [3]]],
  () => ({}),
  () => ({ name: 'nested', entries: [['deep', ['deeper']]] }),
  () => '<script>alert(1)</script><p>hi</p>',
  () => '{@damage 1d6',
  () => '{@b',
];

function mutate(value: unknown, rnd: () => number, depth = 0): unknown {
  if (Array.isArray(value)) {
    const copy = value.map((v) => mutate(v, rnd, depth + 1));
    if (copy.length > 0 && rnd() < 0.3) copy.splice(Math.floor(rnd() * copy.length), 1);
    return copy;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const roll = rnd();
      if (roll < 0.12) continue; // drop the field
      if (roll < 0.3) out[k] = JUNK[Math.floor(rnd() * JUNK.length)]!();
      else out[k] = depth < 3 ? mutate(v, rnd, depth + 1) : v;
    }
    if (rnd() < 0.05) out['__proto__'] = { polluted: true };
    return out;
  }
  return value;
}

describe('import fuzz: seeded mutations never throw and never lose an input without a reason', () => {
  it(`${ITERATIONS} iterations (seed ${SEED})`, () => {
    const rnd = mulberry32(SEED);
    let accepted = 0;
    let repaired = 0;
    let rejected = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const base = BASES[i % BASES.length]!;
      let input = mutate(structuredClone(base), rnd);
      if (rnd() < 0.15) input = JUNK[Math.floor(rnd() * JUNK.length)]!(); // sometimes the whole thing is junk
      const viaText = i % 2 === 0;
      const result = viaText
        ? runImportPipeline(JSON.stringify(Array.isArray(input) ? input : [input]) ?? 'null')
        : runImportPipelineOnEntities([input]);
      // every input is accounted for: something came out, or there is a reason why not
      const outcomes = result.accepted.length + result.rejected.length + result.characters.length + result.warnings.length;
      expect(outcomes, `iteration ${i}: ${JSON.stringify(input)?.slice(0, 200)}`).toBeGreaterThan(0);
      for (const r of result.rejected) {
        expect(r.reason.length).toBeGreaterThan(0);
        expect(r.source.length).toBeGreaterThan(0);
      }
      for (const e of result.accepted) expectValidEntity(e);
      expect(result.repaired.length).toBeLessThanOrEqual(result.accepted.length);
      for (const r of result.repaired) expect(r.notes.length).toBeGreaterThan(0);
      accepted += result.accepted.length;
      repaired += result.repaired.length;
      rejected += result.rejected.length;
    }
    // the mutations are strong enough to exercise all three outcomes
    expect(accepted).toBeGreaterThan(50);
    expect(repaired).toBeGreaterThan(20);
    expect(rejected).toBeGreaterThan(20);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    console.log(`fuzz: ${ITERATIONS} iterations, ${accepted} accepted (${repaired} repaired), ${rejected} rejected`);
  });

  it('is deterministic for a fixed seed', () => {
    const run = () => {
      const rnd = mulberry32(SEED);
      return JSON.stringify(Array.from({ length: 30 }, (_, i) => runImportPipelineOnEntities([mutate(structuredClone(BASES[i % BASES.length]!), rnd)]).accepted.length));
    };
    expect(run()).toBe(run());
  });
});
