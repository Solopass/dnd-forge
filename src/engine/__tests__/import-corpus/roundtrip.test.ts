import { describe, expect, it } from 'vitest';
import type { CompendiumEntity } from '../../../types/compendium';
import { buildCampaignPackExport } from '../../campaign-repo-sync';
import { runImportPipeline } from '../../import-pipeline';
import { createDefaultCampaign } from '../../dm-tools';

// Export a pack, read it back: the entities must come out identical (not "similar").
const FULL: CompendiumEntity[] = [
  { id: 'rt-rope', name: 'Round Rope', source: 'Round Trip', ruleset: '2014', category: 'gear', weight: 10, quantity: 2, imageUrl: 'https://example.com/rope.png', activities: [], entries: ['Fifty feet.', 'Hempen.'] },
  { id: 'rt-sword', name: 'Round Sword', source: 'Round Trip', ruleset: '2024', category: 'weapon', weaponMastery: 'Graze', activities: [{ id: 'act-rt-sword', name: 'Slash', type: 'attack', actionEconomy: 'action', attackAbility: 'str', attackBonusFormula: '@mod+@prof', damageFormula: '1d8+@mod', damageType: 'slashing' }], entries: ['A blade.'] },
  { id: 'rt-mail', name: 'Round Mail', source: 'Round Trip', ruleset: '2014', category: 'armor', acFormula: { base: 14, dexCap: 2 }, activities: [], entries: ['Rings.'] },
  { id: 'rt-shield', name: 'Round Shield', source: 'Round Trip', ruleset: '2014', category: 'shield', acFlatBonus: 2, activities: [], entries: [] },
  { id: 'rt-bolt', name: 'Round Bolt', source: 'Round Trip', ruleset: '2014', category: 'spell', spellLevel: 3, classes: ['Wizard', 'Sorcerer'], castingTime: '1 action', range: '120 feet', components: 'V, S, M (a pinch of sulfur)', duration: 'Instantaneous', concentration: false, ritual: true, activities: [{ id: 'act-rt-bolt', name: 'Bolt', type: 'save', actionEconomy: 'action', saveAbility: 'dex', saveDcFormula: '8+@prof+@spell', damageFormula: '8d6', damageType: 'fire', upcastDicePerLevel: '1d6', resourceCost: { poolId: 'spell_slot_3', amount: 1 } }], entries: ['A {@damage 8d6} bolt of fire.'] },
  { id: 'rt-ogre', name: 'Round Ogre', source: 'Round Trip', ruleset: '2014', category: 'monster', monsterMeta: { ac: 11, hp: 59, dexModifier: -1, cr: '1/4', size: 'large', speeds: '40 ft.', senses: 'darkvision 60 ft.', resistances: ['fire'], immunities: ['poison'], vulnerabilities: ['cold'], legendaryActionsMax: 3, rechargeAbility: { name: 'Breath', minRoll: 5 }, traits: ['Big: it is big.'] }, activities: [{ id: 'act-rt-club', name: 'Greatclub', type: 'attack', actionEconomy: 'action', attackBonusFormula: '6', damageFormula: '2d8+4' }], entries: ['A large brute.'] },
  { id: 'rt-feat', name: 'Round Feat', source: 'Round Trip', ruleset: '2024', category: 'feat', modifiers: [{ target: 'initiative', value: 5, condition: 'while conscious' }], activities: [], entries: ['You are quick.'] },
  { id: 'rt-ring', name: 'Round Ring', source: 'Round Trip', ruleset: 'homebrew', category: 'gear', requiresAttunement: true, attuned: false, activities: [], entries: ['Shiny.'] },
];

describe('round trip: export a pack, import it again', () => {
  it('campaign pack export -> pipeline gives identical entities', () => {
    const text = buildCampaignPackExport(createDefaultCampaign(), FULL);
    const r = runImportPipeline(text, { name: 'campaign-pack.json' });
    expect(r.rejected).toEqual([]);
    expect(r.repaired).toEqual([]);
    expect(r.accepted).toEqual(FULL);
  });

  it('a plain JSON export of the same entities is identical too, and importing twice changes nothing', () => {
    const once = runImportPipeline(JSON.stringify(FULL, null, 2), { name: 'export.json' });
    expect(once.accepted).toEqual(FULL);
    const twice = runImportPipeline(JSON.stringify(once.accepted), { name: 'again.json' });
    expect(twice.accepted).toEqual(once.accepted);
    expect(twice.repaired).toEqual([]);
  });

  it('a backup bundle round trip keeps the compendium', () => {
    const bundle = { app: 'dnd-forge', version: 3, compendium: FULL, characters: [] };
    const r = runImportPipeline(JSON.stringify(bundle));
    expect(r.format).toBe('app-bundle');
    expect((r.bundle as { compendium: unknown }).compendium).toEqual(FULL);
  });
});

// whitespace inside formulas is tidied ("@spell + @prof" -> "@spell+@prof"): same meaning, so compare that way
const tight = (acts: CompendiumEntity['activities']) =>
  JSON.parse(JSON.stringify(acts, (k, v: unknown) => (typeof v === 'string' && /Formula$|PerLevel$/.test(k) ? v.replace(/\s+/g, '') : v))) as CompendiumEntity['activities'];

describe('the built-in SRD data goes through the pipeline untouched', () => {
  it('no rejections, no repairs, activities and numbers identical', async () => {
    const { BUILTIN_CONTENT_PACKS } = await import('../../srd-packs');
    const { runImportPipelineOnEntities } = await import('../../import-pipeline');
    for (const pack of BUILTIN_CONTENT_PACKS) {
      const r = runImportPipelineOnEntities(pack.entities);
      expect(r.rejected, pack.id).toEqual([]);
      expect(r.repaired.map((x) => `${x.entity.name}: ${x.notes.join('; ')}`), pack.id).toEqual([]);
      r.accepted.forEach((e, i) => {
        const orig = pack.entities[i]!;
        expect(e.id).toBe(orig.id);
        expect(e.activities, orig.id).toEqual(tight(orig.activities));
        expect(e.monsterMeta, orig.id).toEqual(orig.monsterMeta);
        expect(e.spellLevel, orig.id).toBe(orig.spellLevel);
      });
    }
  });
});
