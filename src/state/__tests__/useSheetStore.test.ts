// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useSheetStore } from '../useSheetStore';
import { SEED_CHARACTER, SEED_ENCOUNTER } from '../seed';
import { db } from '../../storage/db';
import { APP_VERSION } from '../../version';
import { expectedCompendiumSize } from './compendiumReady';
import type { ResolvedActivity } from '../../types/character';

// startup loads ~4,000 compendium entries; give slow CI runners room beyond Vitest's 5 s default
vi.setConfig({ testTimeout: 30_000 });

async function setup() {
  // computed first (and cached) so it never runs alongside the store's own SRD load
  const size = await expectedCompendiumSize();
  const hook = renderHook(() => useSheetStore(SEED_CHARACTER, SEED_ENCOUNTER));
  // wait for the startup Dexie hydration to finish (it ends by refreshing the compendium from the db)
  // (a slow machine otherwise sees a half-loaded compendium and the default 1 s waitFor times out)
  await waitFor(
    async () => {
      expect(await db.compendium.count()).toBe(size);
      expect(hook.result.current.compendium.length).toBe(size);
      expect(hook.result.current.encounterList.length).toBeGreaterThan(0);
    },
    { timeout: 20_000 }
  );
  return hook;
}

type Hook = Awaited<ReturnType<typeof setup>>;

function logTexts(h: Hook): string[] {
  return h.result.current.consoleLines.map((l) => l.text);
}

const DEFAULT_ECONOMY = { action: false, bonus_action: false, reaction: false, free: false, special: false };

beforeEach(async () => {
  localStorage.setItem('sidereroll-free5e-autosynced', '1');
  await db.delete();
  await db.open();
});

afterEach(async () => {
  // unmount the hook so it stops saving, then wait for its queued Dexie writes:
  // a read-write transaction over every table only starts after earlier ones finish
  cleanup();
  await db.transaction('rw', db.tables, () => undefined);
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useSheetStore characterization', () => {
  it('exposes the full public shape', async () => {
    const h = await setup();
    expect(Object.keys(h.result.current).sort()).toMatchInlineSnapshot(`
      [
        "acceptWebRtcInvite",
        "activeBuffs",
        "activePings",
        "activeSharedHandout",
        "addClockTimer",
        "addCompendiumItemToSheet",
        "addCustomResourcePool",
        "addMapSketchStroke",
        "addMapTemplate",
        "addMonsterToEncounter",
        "addPartyLoot",
        "addPartyStashItem",
        "addPartyToEncounter",
        "addTimedCombatEffect",
        "adjustCombatantHp",
        "adjustHp",
        "adjustLegendaryActions",
        "adjustResourcePool",
        "advanceCampaignClock",
        "advanceDowntimeDays",
        "appendLog",
        "applyLevelUpPlan",
        "applySubclassGrants",
        "assignLootItemToCharacter",
        "awardPartyXp",
        "broadcastMapPing",
        "buyShopItemForActiveCharacter",
        "campaign",
        "campaignList",
        "canRedo",
        "canUndo",
        "cancelPendingImport",
        "characterList",
        "claimCombatantToken",
        "claimPartyStashItem",
        "claimedTokenId",
        "clearAllFog",
        "clearConsoleLog",
        "clearMapSketches",
        "clearMapTemplates",
        "clearTerrain",
        "compendium",
        "completeWebRtcLink",
        "confirmPendingImport",
        "consoleLines",
        "contentFixes",
        "createCampaign",
        "createCharacterFromPreset",
        "createEncounter",
        "createHomebrewEntity",
        "createNewCharacter",
        "createWebRtcInvite",
        "deleteCampaign",
        "deleteCampaignEntry",
        "deleteCharacter",
        "deleteContentFix",
        "deleteDowntimeProject",
        "deleteEncounter",
        "deleteScene",
        "deleteWorldMapPin",
        "depositItemToPartyStash",
        "disconnectLiveTable",
        "dismissInitiativeAlert",
        "dismissRollRequest",
        "dismissToast",
        "distributeGoldToParty",
        "divineSmite",
        "dropConcentration",
        "dupDecisions",
        "duplicateCharacter",
        "duplicateEncounter",
        "effectiveCompendium",
        "encounter",
        "encounterList",
        "enterWildShape",
        "exportContentFixes",
        "fillAllFog",
        "free5eSyncing",
        "hideSharedHandout",
        "hostLocalTable",
        "houseRules",
        "importContentFixes",
        "importDdbPdfFile",
        "importJsonFilePayload",
        "importMarkdownHomebrew",
        "importSingleCharacter",
        "initiativeAlert",
        "installContentPack",
        "joinLocalTable",
        "liveStatus",
        "loadSceneToEncounter",
        "moveCombatantOrder",
        "moveCombatantToken",
        "patchAgainstOriginal",
        "pendingConcDc",
        "pendingImport",
        "pendingRollRequest",
        "persistCharacter",
        "previewFix",
        "proposeContentFix",
        "pushCampaignToRepo",
        "pushCharacterToCampaignRepo",
        "pushEncounterToPeers",
        "pushToast",
        "rawChar",
        "redo",
        "removeCombatant",
        "removeSheetItem",
        "resetEncounter",
        "resolveDuplicateGroup",
        "resolvedSheet",
        "revertWildShape",
        "reviewContentFix",
        "rollAllInitiative",
        "rollCharacterInitiative",
        "rollConcentrationSave",
        "rollDeathSave",
        "rollInlineExpression",
        "rollMode",
        "saveCurrentMapAsScene",
        "scenes",
        "searchCompendium",
        "sendRollRequestToPeers",
        "setCampaignWeather",
        "setCharacterAvatar",
        "setCombatantInitiative",
        "setCombatantPortrait",
        "setCombatantSize",
        "setCombatantVision",
        "setEncounterMapImage",
        "setExhaustion",
        "setRollMode",
        "setStatOverride",
        "setTempHp",
        "setTerrainCell",
        "setWorldMapImage",
        "shareActiveCharacterToPeers",
        "shareHandoutToPlayers",
        "simplifyCurrency",
        "sourcePriority",
        "spendHitDiceBulk",
        "spendHitDie",
        "startEncounterAlert",
        "stepCombatTurn",
        "switchCampaign",
        "switchCharacter",
        "switchEncounter",
        "syncCampaignExternalRepo",
        "syncFree5ePack",
        "takeRest",
        "targetAttackCombatants",
        "targetSaveCombatants",
        "toasts",
        "toggleBuff",
        "toggleCombatantCondition",
        "toggleCombatantEconomy",
        "toggleCombatantHidden",
        "toggleCondition",
        "toggleDefense",
        "toggleFogCells",
        "toggleInspiration",
        "toggleItemAttuned",
        "toggleItemEquipped",
        "toggleItemPrepared",
        "toggleOrRollRecharge",
        "triggerActivity",
        "triggerCombatantActivity",
        "triggerPartyMilestoneLevelUp",
        "undo",
        "undoDuplicateDecision",
        "updateCharacterNotes",
        "updateCurrency",
        "updateDeathSaves",
        "updateDetails",
        "updateEncounterMapSettings",
        "updateHouseRules",
        "updateItemContainer",
        "updateItemMagic",
        "updateItemQuantity",
        "updateSenses",
        "updateSourcePriority",
        "updateSpeeds",
        "updateStructuredProficiencies",
        "upsertCampaignEntry",
        "upsertDowntimeProject",
        "upsertWorldMapPin",
      ]
    `);
  });

  it('adjustHp damage drains temp HP first, then current HP', async () => {
    const h = await setup();
    expect(h.result.current.rawChar.hp).toEqual({ current: 76, max: 76, temp: 9 });
    act(() => h.result.current.adjustHp(-12));
    expect(h.result.current.rawChar.hp).toEqual({ current: 73, max: 76, temp: 0 });
    const pc = h.result.current.encounter.combatants.find((c) => c.id === 'char-armorer-01');
    expect(pc?.hp).toEqual({ current: 73, max: 76, temp: 0 });
  });

  it('adjustHp healing is capped at max HP', async () => {
    const h = await setup();
    act(() => h.result.current.adjustHp(-30));
    expect(h.result.current.rawChar.hp.current).toBe(55);
    act(() => h.result.current.adjustHp(10));
    expect(h.result.current.rawChar.hp.current).toBe(65);
    act(() => h.result.current.adjustHp(500));
    expect(h.result.current.rawChar.hp.current).toBe(76);
  });

  it('setTempHp clamps at zero and temp HP absorbs damage', async () => {
    const h = await setup();
    act(() => h.result.current.setTempHp(-5));
    expect(h.result.current.rawChar.hp.temp).toBe(0);
    act(() => h.result.current.setTempHp(20));
    expect(h.result.current.rawChar.hp.temp).toBe(20);
    act(() => h.result.current.adjustHp(-8));
    expect(h.result.current.rawChar.hp).toEqual({ current: 76, max: 76, temp: 12 });
  });

  it('toggleCondition adds then removes a condition on sheet and combatant', async () => {
    const h = await setup();
    act(() => h.result.current.toggleCondition('Poisoned'));
    expect(h.result.current.rawChar.conditions).toEqual(['Poisoned']);
    expect(h.result.current.encounter.combatants[0]?.conditions).toEqual(['Poisoned']);
    act(() => h.result.current.toggleCondition('Poisoned'));
    expect(h.result.current.rawChar.conditions).toEqual([]);
  });

  it('long rest restores HP and spell slots, short rest does not restore slots', async () => {
    const h = await setup();
    act(() => h.result.current.adjustHp(-40));
    act(() => h.result.current.adjustResourcePool('spell_slot_1', -3));
    const slot1 = () => h.result.current.rawChar.resources.find((r) => r.id === 'spell_slot_1');
    expect(slot1()?.current).toBe(1);
    act(() => h.result.current.takeRest('short_rest'));
    expect(slot1()?.current).toBe(1);
    act(() => h.result.current.takeRest('long_rest'));
    expect(slot1()?.current).toBe(4);
    expect(h.result.current.rawChar.hp.current).toBe(76);
    expect(logTexts(h).some((t) => t.startsWith('Completed Long Rest'))).toBe(true);
  });

  it('spendHitDie spends one hit die and heals within range', async () => {
    const h = await setup();
    act(() => h.result.current.adjustHp(-60));
    const before = h.result.current.rawChar.hp.current;
    const pool = () => h.result.current.rawChar.resources.find((r) => r.id === 'hit_dice');
    const diceBefore = pool()?.current;
    expect(diceBefore).toBeGreaterThan(0);
    act(() => h.result.current.spendHitDie());
    expect(pool()?.current).toBe((diceBefore ?? 0) - 1);
    const healed = h.result.current.rawChar.hp.current - before;
    expect(healed).toBeGreaterThanOrEqual(1);
    expect(healed).toBeLessThanOrEqual(8 + 3);
  });

  it('triggerActivity on a slot spell consumes a slot and starts concentration; dropConcentration ends it', async () => {
    const h = await setup();
    const activity = Object.values(h.result.current.resolvedSheet.actionsByEconomy)
      .flat()
      .find((a: ResolvedActivity) => a.id === 'act-summon-construct') as ResolvedActivity;
    act(() => h.result.current.triggerActivity(activity));
    expect(h.result.current.rawChar.resources.find((r) => r.id === 'spell_slot_3')?.current).toBe(1);
    expect(h.result.current.encounter.activeEffects.some((e) => e.isConcentration)).toBe(true);
    act(() => h.result.current.dropConcentration('char-armorer-01'));
    expect(h.result.current.encounter.activeEffects.some((e) => e.isConcentration)).toBe(false);
    expect(h.result.current.pendingConcDc).toBeNull();
  });

  it('toggleItemEquipped flips the equipped flag', async () => {
    const h = await setup();
    const equipped = () => h.result.current.rawChar.items.find((i) => i.id === 'item-plate')?.equipped;
    expect(equipped()).toBe(true);
    act(() => h.result.current.toggleItemEquipped('item-plate'));
    expect(equipped()).toBe(false);
    act(() => h.result.current.toggleItemEquipped('item-plate'));
    expect(equipped()).toBe(true);
  });

  it('updateCurrency sets one coin and simplifyCurrency normalizes denominations', async () => {
    const h = await setup();
    act(() => h.result.current.updateCurrency('cp', 1234));
    expect(h.result.current.rawChar.currency).toEqual({ cp: 1234, sp: 0, ep: 0, gp: 0, pp: 0 });
    act(() => h.result.current.updateCurrency('gp', 5));
    expect(h.result.current.rawChar.currency).toEqual({ cp: 1234, sp: 0, ep: 0, gp: 5, pp: 0 });
    act(() => h.result.current.simplifyCurrency());
    // 1234 cp + 500 cp = 1734 cp = 1 pp, 7 gp, 3 sp, 4 cp
    expect(h.result.current.rawChar.currency).toEqual({ cp: 4, sp: 3, ep: 0, gp: 7, pp: 1 });
  });

  it('addMonsterToEncounter adds a sorted monster combatant', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Goblin', 15, 7, 2));
    const goblin = h.result.current.encounter.combatants.find((c) => c.name === 'Goblin');
    expect(goblin).toMatchObject({ kind: 'monster', ac: 15, dexModifier: 2, hp: { current: 7, max: 7, temp: 0 } });
    expect(goblin?.initiative).toBeGreaterThanOrEqual(3);
    expect(goblin?.initiative).toBeLessThanOrEqual(22);
    expect(h.result.current.encounter.combatants).toHaveLength(2);
  });

  it('addMonsterToEncounter stores a decimal CR as a fraction so the monster counts XP (audit D3)', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Goblin', 15, 7, 2, [], '0.25'));
    const goblin = h.result.current.encounter.combatants.find((c) => c.name === 'Goblin');
    expect(goblin?.cr).toBe('1/4');
  });

  it('a failed shop purchase names whose purse was short (audit D1)', async () => {
    const h = await setup();
    act(() => h.result.current.updateCurrency('gp', 0));
    const item = { id: 'shop-x', name: 'Longsword', category: 'Weapon', rarity: 'Common' as const, priceGp: 15, notes: '' };
    let ok = true;
    act(() => {
      ok = h.result.current.buyShopItemForActiveCharacter(item, true);
    });
    expect(ok).toBe(false);
    const line = logTexts(h).find((t) => t.includes('Insufficient GP'));
    expect(line).toContain(h.result.current.rawChar.name);
    expect(line).toMatch(/purse/);
  });

  it('the startup log line names the real app version', async () => {
    const h = await setup();
    expect(logTexts(h).some((t) => t.startsWith(`Sidereroll ${APP_VERSION} ready`))).toBe(true);
  });

  it('stepCombatTurn advances the active turn and wraps into a new round', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Goblin', 15, 7, 0));
    expect(h.result.current.encounter.round).toBe(1);
    expect(h.result.current.encounter.activeTurnIndex).toBe(0);
    act(() => h.result.current.stepCombatTurn());
    expect(h.result.current.encounter.activeTurnIndex).toBe(1);
    act(() => h.result.current.stepCombatTurn());
    expect(h.result.current.encounter.round).toBe(2);
    expect(h.result.current.encounter.activeTurnIndex).toBe(0);
  });

  it('adjustCombatantHp hits a monster (temp first) and routes the PC through adjustHp', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Ogre', 11, 59, 0));
    const ogreId = () => h.result.current.encounter.combatants.find((c) => c.name === 'Ogre')!.id;
    act(() => h.result.current.adjustCombatantHp(ogreId(), -20));
    expect(h.result.current.encounter.combatants.find((c) => c.name === 'Ogre')?.hp.current).toBe(39);
    act(() => h.result.current.adjustCombatantHp(ogreId(), 100));
    expect(h.result.current.encounter.combatants.find((c) => c.name === 'Ogre')?.hp.current).toBe(59);
    act(() => h.result.current.adjustCombatantHp('char-armorer-01', -9));
    expect(h.result.current.rawChar.hp).toEqual({ current: 76, max: 76, temp: 0 });
  });

  it('setCombatantInitiative re-sorts the order', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Goblin', 15, 7, 0));
    const goblinId = h.result.current.encounter.combatants.find((c) => c.name === 'Goblin')!.id;
    act(() => h.result.current.setCombatantInitiative(goblinId, 99));
    expect(h.result.current.encounter.combatants[0]?.id).toBe(goblinId);
    act(() => h.result.current.setCombatantInitiative(goblinId, -5));
    expect(h.result.current.encounter.combatants[0]?.id).toBe('char-armorer-01');
  });

  it('rollAllInitiative with fixed dice resets to round 1 and sorts descending', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Goblin', 15, 7, 1));
    act(() => h.result.current.stepCombatTurn());
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // d20 = 11
    act(() => h.result.current.rollAllInitiative());
    const enc = h.result.current.encounter;
    expect(enc.round).toBe(1);
    expect(enc.activeTurnIndex).toBe(0);
    const inits = enc.combatants.map((c) => c.initiative);
    expect([...inits].sort((a, b) => b - a)).toEqual(inits);
    expect(enc.combatants.find((c) => c.name === 'Goblin')?.initiative).toBe(12);
    expect(enc.combatants.find((c) => c.id === 'char-armorer-01')?.initiative).toBe(13);
  });

  it('rollConcentrationSave clears the pending DC and logs maintained or failed', async () => {
    const h = await setup();
    act(() => h.result.current.toggleCondition('Concentrating'));
    act(() => h.result.current.adjustHp(-30));
    expect(h.result.current.pendingConcDc).toBe(15);
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // d20 = 20
    act(() => h.result.current.rollConcentrationSave());
    expect(h.result.current.pendingConcDc).toBeNull();
    expect(logTexts(h).some((t) => t.includes('Concentration Save vs DC 15') && t.includes('MAINTAINED'))).toBe(true);
    act(() => h.result.current.adjustHp(-30));
    expect(h.result.current.pendingConcDc).toBe(15);
    vi.spyOn(Math, 'random').mockReturnValue(0); // d20 = 1
    act(() => h.result.current.rollConcentrationSave(30));
    expect(h.result.current.pendingConcDc).toBeNull();
    expect(logTexts(h).some((t) => t.includes('vs DC 30') && t.includes('FAILED'))).toBe(true);
  });

  it('importMarkdownHomebrew parses a monster statblock into compendium and encounter', async () => {
    const h = await setup();
    const md = `### Owlbear
Armor Class: 13
Hit Points: 59 (7d10 + 21)
16 (+3) 12 (+1) 17 (+3) 3 (-4) 12 (+1) 7 (-2)
Claws. +7 to hit, 2d8 + 5 slashing damage`;
    await act(async () => {
      await h.result.current.importMarkdownHomebrew(md);
    });
    // every import shows a preview first; nothing is written until it is confirmed
    expect(h.result.current.pendingImport?.plan.summary).toBe('0 new, 0 exact duplicates, 1 possible duplicate (review)') // matches the SRD Owlbear (ruleset 'homebrew' is compared with every ruleset);
    expect(h.result.current.encounter.combatants.some((c) => c.name === 'Owlbear')).toBe(false);
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    const mob = h.result.current.encounter.combatants.find((c) => c.name === 'Owlbear');
    expect(mob).toMatchObject({ kind: 'monster', ac: 13, hp: { current: 59, max: 59, temp: 0 }, dexModifier: 1 });
    expect(h.result.current.compendium.some((e) => e.name === 'Owlbear' && e.category === 'monster')).toBe(true);
    expect(logTexts(h).some((t) => t.startsWith('Imported "Owlbear"'))).toBe(true);
  });

  it('importJsonFilePayload imports a custom item into the compendium', async () => {
    const h = await setup();
    const payload = JSON.stringify({
      id: 'custom-test-trinket',
      name: 'Test Trinket of Characterization',
      category: 'gear',
      source: 'Homebrew',
      ruleset: '2024',
      activities: [],
      entries: ['A test-only trinket.'],
    });
    await act(async () => {
      await h.result.current.importJsonFilePayload(payload);
    });
    await act(async () => {
      await h.result.current.confirmPendingImport();
    });
    expect(h.result.current.compendium.some((e) => e.id === 'custom-test-trinket')).toBe(true);
    expect(logTexts(h).some((t) => t.startsWith('Imported 1 custom entity'))).toBe(true);
    await act(async () => {
      await h.result.current.importJsonFilePayload('{not json');
    });
    expect(logTexts(h)[0]).toContain('JSON import failed');
  });

  it('upsertCampaignEntry inserts then updates an entry', async () => {
    const h = await setup();
    const base = { id: 'entry-1', category: 'npc' as const, title: 'Mayor', summary: 's', body: 'b', tags: [], status: 'active' as const };
    act(() => h.result.current.upsertCampaignEntry(base));
    expect(h.result.current.campaign.entries.filter((e) => e.id === 'entry-1')).toHaveLength(1);
    act(() => h.result.current.upsertCampaignEntry({ ...base, title: 'Mayor Vex' }));
    const entries = h.result.current.campaign.entries.filter((e) => e.id === 'entry-1');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Mayor Vex');
    act(() => h.result.current.deleteCampaignEntry('entry-1'));
    expect(h.result.current.campaign.entries.some((e) => e.id === 'entry-1')).toBe(false);
  });

  it('toggleFogCells paints and reveals cells', async () => {
    const h = await setup();
    act(() => h.result.current.toggleFogCells(['1,1', '2,2', '3,3'], 'paint'));
    expect([...(h.result.current.encounter.map?.fogCells ?? [])].sort()).toEqual(['1,1', '2,2', '3,3']);
    act(() => h.result.current.toggleFogCells(['2,2'], 'reveal'));
    expect([...(h.result.current.encounter.map?.fogCells ?? [])].sort()).toEqual(['1,1', '3,3']);
    act(() => h.result.current.clearAllFog());
    expect(h.result.current.encounter.map?.fogCells ?? []).toEqual([]);
  });

  it('undo and redo restore HP and toggle canUndo/canRedo', async () => {
    const h = await setup();
    expect(h.result.current.canUndo).toBe(false);
    act(() => h.result.current.adjustHp(-20));
    expect(h.result.current.rawChar.hp).toEqual({ current: 65, max: 76, temp: 0 });
    expect(h.result.current.canUndo).toBe(true);
    act(() => h.result.current.undo());
    expect(h.result.current.rawChar.hp).toEqual({ current: 76, max: 76, temp: 9 });
    expect(h.result.current.canRedo).toBe(true);
    act(() => h.result.current.redo());
    expect(h.result.current.rawChar.hp).toEqual({ current: 65, max: 76, temp: 0 });
  });

  it('createNewCharacter / switchCharacter / deleteCharacter manage the roster', async () => {
    const h = await setup();
    const startCount = h.result.current.characterList.length;
    await act(async () => {
      await h.result.current.createNewCharacter('Test Hero');
    });
    expect(h.result.current.characterList).toHaveLength(startCount + 1);
    expect(h.result.current.rawChar.name).toBe('Test Hero');
    await act(async () => {
      await h.result.current.switchCharacter('char-armorer-01');
    });
    expect(h.result.current.rawChar.id).toBe('char-armorer-01');
    const heroId = h.result.current.characterList.find((c) => c.name === 'Test Hero')!.id;
    await act(async () => {
      await h.result.current.deleteCharacter(heroId);
    });
    expect(h.result.current.characterList).toHaveLength(startCount);
    expect(await db.characters.get(heroId)).toBeUndefined();
  });

  it('toggleCombatantCondition handles monsters and toggleCombatantEconomy flips usage', async () => {
    const h = await setup();
    act(() => h.result.current.addMonsterToEncounter('Goblin', 15, 7, 0));
    const id = h.result.current.encounter.combatants.find((c) => c.name === 'Goblin')!.id;
    const gob = () => h.result.current.encounter.combatants.find((c) => c.id === id)!;
    act(() => h.result.current.toggleCombatantCondition(id, 'Prone'));
    expect(gob().conditions).toEqual(['Prone']);
    act(() => h.result.current.toggleCombatantEconomy(id, 'reaction'));
    expect(gob().turnEconomyUsed).toEqual({ ...DEFAULT_ECONOMY, reaction: true });
    act(() => h.result.current.removeCombatant(id));
    expect(h.result.current.encounter.combatants.some((c) => c.id === id)).toBe(false);
  });
});
