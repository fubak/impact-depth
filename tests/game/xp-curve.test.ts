import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/game/sim/api';
import { awardXp, levelForXp, XP_PER_KILL, xpToNext } from '../../src/game/sim/progression';
import type { ShipKind } from '../../src/game/sim/types';

const R8: readonly ShipKind[] = [
  'merchant',
  'merchant',
  'merchant',
  'destroyer',
  'sub',
  'merchant',
  'merchant',
  'patrol',
];

const R15: readonly ShipKind[] = [
  'merchant',
  'merchant',
  'merchant',
  'destroyer',
  'sub',
  'merchant',
  'merchant',
  'merchant',
  'merchant',
  'patrol',
  'destroyer',
  'cruiser',
  'destroyer',
  'battleship',
  'sub',
];

const sumXp = (kills: readonly ShipKind[]): number =>
  kills.reduce((total, kind) => total + XP_PER_KILL[kind], 0);

describe('XP curve reference runs', () => {
  it('R8 pays 660 XP and reaches level 6 (5 level-ups)', () => {
    expect(sumXp(R8)).toBe(660);
    expect(levelForXp(660)).toBe(6);
  });

  it('R15 pays 1700 XP and reaches level 10 (9 level-ups)', () => {
    expect(sumXp(R15)).toBe(1700);
    expect(levelForXp(1700)).toBe(10);
  });

  it('the first merchant kill does not level up', () => {
    expect(XP_PER_KILL.merchant).toBeLessThan(xpToNext(1));
    expect(levelForXp(60)).toBe(1);
  });

  it('agrees with awardXp stepping for R8', () => {
    let s = createGame(7);
    for (const kind of R8) s = awardXp(s, XP_PER_KILL[kind]);
    expect(s.stats.level).toBe(6);
  });

  it('agrees with awardXp stepping for R15', () => {
    let s = createGame(7);
    for (const kind of R15) s = awardXp(s, XP_PER_KILL[kind]);
    expect(s.stats.level).toBe(10);
  });

  it('keeps hull classes ordered', () => {
    const order: ShipKind[] = ['merchant', 'patrol', 'destroyer', 'sub', 'cruiser', 'battleship'];
    for (let i = 1; i < order.length; i++) {
      expect(XP_PER_KILL[order[i - 1]!]).toBeLessThan(XP_PER_KILL[order[i]!]);
    }
  });
});

describe('levelForXp', () => {
  it('has exact boundaries at the cumulative thresholds', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(64)).toBe(1);
    expect(levelForXp(65)).toBe(2);
    expect(levelForXp(159)).toBe(2);
    expect(levelForXp(160)).toBe(3);
  });

  it('treats negative and non-finite XP as level 1', () => {
    expect(levelForXp(-5)).toBe(1);
    expect(levelForXp(Number.NaN)).toBe(1);
  });
});
