import { describe, expect, it } from 'vitest';
import { computeVisibleCells } from '../vtt-vision';
import { resolveTargetAttack, resolveTargetSaves } from '../target-combat';
import { generateRandomEncounter, generateRandomNpc, generateRandomTavern } from '../improv';
import { tabletopSoundboard } from '../soundboard';
import { CombatantNode } from '../../types/combat';
import { Activity } from '../../types/compendium';

describe('Tactical VTT Line-of-Sight & Target-Aware Combat', () => {
  it('computes PC vision radius and blocks line-of-sight behind wall cells', () => {
    const pc: CombatantNode = {
      id: 'pc-1',
      name: 'Ranger',
      kind: 'pc',
      x: 2,
      y: 2,
      visionFeet: 30, // 6 cells at 5ft/cell
      initiative: 15,
      dexModifier: 3,
      ac: 16,
      hp: { current: 30, max: 30, temp: 0 },
      conditions: [],
      turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
    };

    const visible = computeVisibleCells(pc ? [pc] : [], 12, 12, 5, [{ x: 4, y: 2, kind: 'wall' }]);
    // Origin and wall face are visible
    expect(visible.has('2,2')).toBe(true);
    expect(visible.has('3,2')).toBe(true);
    expect(visible.has('4,2')).toBe(true);
    // Behind the wall is occluded
    expect(visible.has('5,2')).toBe(false);
    expect(visible.has('6,2')).toBe(false);
    // Out of 30ft radius is occluded
    expect(visible.has('2,10')).toBe(false);
  });

  it('resolves targeted attacks with crit doubling, resistance halving, and immunity nullification', () => {
    const sword: Activity = {
      id: 'atk-1',
      name: 'Flame Tongue',
      type: 'attack',
      actionEconomy: 'action',
      attackBonusFormula: '+7',
      damageFormula: '2d6+4',
      damageType: 'fire',
    };

    const resistantTarget: CombatantNode = {
      id: 'mob-res',
      name: 'Fire Elemental',
      kind: 'monster',
      initiative: 10,
      dexModifier: 3,
      ac: 13,
      hp: { current: 50, max: 50, temp: 0 },
      conditions: [],
      monsterMeta: { ac: 13, hp: 50, dexModifier: 3, resistances: ['fire'] },
      turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
    };

    const hitRes = resolveTargetAttack(sword, resistantTarget, 'normal', 7, (expr) =>
      expr.startsWith('1d20')
        ? { total: 18, isCrit: false, isFumble: false }
        : { total: 15, isCrit: false, isFumble: false }
    );
    expect(hitRes.hit).toBe(true);
    expect(hitRes.appliedDamage).toBe(7); // floor(15 / 2)
    expect(hitRes.nextHp).toBe(43);

    const critRes = resolveTargetAttack(sword, resistantTarget, 'normal', 7, (expr) => {
      if (expr.startsWith('1d20')) return { total: 27, isCrit: true, isFumble: false };
      expect(expr).toBe('4d6+4'); // doubled dice on crit
      return { total: 20, isCrit: false, isFumble: false };
    });
    expect(critRes.isCrit).toBe(true);
    expect(critRes.appliedDamage).toBe(10);

    const immuneTarget: CombatantNode = {
      ...resistantTarget,
      id: 'mob-imm',
      monsterMeta: { ac: 13, hp: 50, dexModifier: 3, immunities: ['fire'] },
    };
    const immRes = resolveTargetAttack(sword, immuneTarget, 'normal', 7, () => ({
      total: 20,
      isCrit: false,
      isFumble: false,
    }));
    expect(immRes.hit).toBe(true);
    expect(immRes.appliedDamage).toBe(0);
    expect(immRes.nextHp).toBe(50);
  });

  it('resolves group AoE saves with half damage on pass and full damage on fail', () => {
    const fireball: Activity = {
      id: 'spell-fb',
      name: 'Fireball',
      type: 'save',
      actionEconomy: 'action',
      saveAbility: 'dex',
      saveDcFormula: '15',
      damageFormula: '8d6',
      damageType: 'fire',
    };

    const goblin: CombatantNode = {
      id: 'g1',
      name: 'Goblin',
      kind: 'monster',
      initiative: 12,
      dexModifier: 2,
      ac: 15,
      hp: { current: 30, max: 30, temp: 0 },
      conditions: [],
      turnEconomyUsed: { action: false, bonus_action: false, reaction: false, free: false, special: false },
    };
    const ogre: CombatantNode = {
      ...goblin,
      id: 'o1',
      name: 'Ogre',
      dexModifier: -1,
      hp: { current: 59, max: 59, temp: 0 },
    };

    const outcomes = resolveTargetSaves(fireball, [goblin, ogre], 15, (expr) => {
      if (expr === '8d6') return { total: 28 };
      if (expr.includes('+2')) return { total: 16 }; // Goblin passes DC 15
      return { total: 8 }; // Ogre fails DC 15
    });

    expect(outcomes[0]?.passed).toBe(true);
    expect(outcomes[0]?.appliedDamage).toBe(14);
    expect(outcomes[0]?.nextHp).toBe(16);
    expect(outcomes[1]?.passed).toBe(false);
    expect(outcomes[1]?.appliedDamage).toBe(28);
    expect(outcomes[1]?.nextHp).toBe(31);
  });

  it('generates improv NPCs, taverns, scaled encounters, and clamps soundboard volume', () => {
    const npc = generateRandomNpc(() => 0.25);
    expect(npc.category).toBe('npc');
    expect(npc.title.length).toBeGreaterThan(3);

    const tavern = generateRandomTavern(() => 0.5);
    expect(tavern.category).toBe('location');
    expect(tavern.summary).toContain('Barkeep:');

    const enc = generateRandomEncounter([5, 5, 5, 5], 'Forest', () => 0.3);
    expect(enc.environment).toBe('Forest');
    expect(enc.monsters.length).toBeGreaterThan(0);
    expect(enc.adjustedXp).toBeGreaterThan(0);

    tabletopSoundboard.setVolume(1.5);
    expect(tabletopSoundboard.getVolume()).toBe(1);
    tabletopSoundboard.setVolume(-0.2);
    expect(tabletopSoundboard.getVolume()).toBe(0);
  });
});
