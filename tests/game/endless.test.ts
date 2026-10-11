import { describe, expect, it } from 'vitest';
import { createGame, startMission } from '../../src/game/sim/api';
import { seedWave } from '../../src/game/sim/create';
import {
  canContinueEndless,
  continueEndless,
  ENDLESS_MESSAGE,
  endlessAlert,
  endlessConversions,
  endlessEliteTarget,
  endlessHpMultiplier,
  endlessTier,
  escalateWave,
} from '../../src/game/sim/endless';

describe('endless scaling', () => {
  it('tier, HP, conversions, elites and alert scale as specified', () => {
    expect(endlessTier(2)).toBe(0);
    expect(endlessTier(3)).toBe(1);
    expect(endlessTier(7)).toBe(5);
    // A non-finite wave must never reach escalateWave as NaN hull points.
    expect(endlessTier(Number.NaN)).toBe(0);
    expect(endlessTier(Number.POSITIVE_INFINITY)).toBe(0);

    expect(endlessHpMultiplier(1)).toBeCloseTo(1.15, 6);
    expect(endlessHpMultiplier(5)).toBeCloseTo(1.75, 6);
    expect(endlessHpMultiplier(20)).toBeCloseTo(2.5, 6);

    expect(endlessConversions(1)).toBe(1);
    expect(endlessConversions(2)).toBe(1);
    expect(endlessConversions(3)).toBe(2);
    expect(endlessConversions(5)).toBe(3);
    expect(endlessConversions(9)).toBe(3);

    expect(endlessEliteTarget(1)).toBe(1);
    expect(endlessEliteTarget(2)).toBe(2);
    expect(endlessEliteTarget(4)).toBe(3);
    expect(endlessEliteTarget(9)).toBe(3);

    expect(endlessAlert(1)).toBeCloseTo(0.5, 6);
    expect(endlessAlert(3)).toBeCloseTo(0.7, 6);
    expect(endlessAlert(9)).toBeCloseTo(0.85, 6);
  });

  it('returns the same array before the first endless wave', () => {
    const ships = seedWave(7, 2);
    expect(escalateWave(7, 2, ships)).toBe(ships);
  });

  it('wave 3 converts the last merchant, never the anchor', () => {
    const input = seedWave(7, 3);
    const out = escalateWave(7, 3, input);
    expect(out[0]!.kind).toBe('merchant');
    expect(out.filter((ship) => ship.kind === 'merchant')).toHaveLength(4);
    expect(out[4]!.kind).toBe('destroyer');
    expect(out[4]!.name.endsWith('DESTROYER')).toBe(true);
  });

  it('scales warship hull points', () => {
    const input = seedWave(7, 3);
    const out = escalateWave(7, 3, input);
    let checked = 0;
    input.forEach((ship, i) => {
      if (ship.kind === 'merchant' || out[i]!.elite === true || ship.elite === true) return;
      expect(out[i]!.maxHp).toBe(Math.round(ship.maxHp * 1.15));
      expect(out[i]!.hp).toBe(out[i]!.maxHp);
      checked += 1;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('promotes at least the elite target', () => {
    const elitesIn = (ships: ReturnType<typeof seedWave>) =>
      ships.filter((ship) => ship.elite === true).length;
    expect(elitesIn(escalateWave(7, 3, seedWave(7, 3)))).toBeGreaterThanOrEqual(1);
    expect(elitesIn(escalateWave(7, 7, seedWave(7, 7)))).toBeGreaterThanOrEqual(3);
  });

  it('raises alert', () => {
    const out = escalateWave(7, 3, seedWave(7, 3));
    for (const ship of out) expect(ship.alert).toBeGreaterThanOrEqual(0.5);
  });

  it('never mutates its input and is deterministic', () => {
    const a = seedWave(7, 5);
    const before = JSON.stringify(a);
    const first = escalateWave(7, 5, a);
    expect(JSON.stringify(a)).toBe(before);
    expect(first).toEqual(escalateWave(7, 5, a));
  });

  it('caps HP growth', () => {
    const input = seedWave(7, 40);
    const out = escalateWave(7, 40, input);
    let checked = 0;
    input.forEach((ship, i) => {
      if (ship.kind === 'merchant' || out[i]!.elite === true || ship.elite === true) return;
      expect(out[i]!.maxHp).toBe(Math.round(ship.maxHp * 2.5));
      checked += 1;
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe('continueEndless', () => {
  it('continueEndless only from a patrol victory', () => {
    const s = startMission(createGame(21));

    const playing = { ...s, phase: 'playing' as const };
    expect(continueEndless(playing)).toBe(playing);

    const strike = { ...s, phase: 'victory' as const, scenario: 'convoy-strike' as const };
    expect(continueEndless(strike)).toBe(strike);

    const already = { ...s, phase: 'victory' as const, endless: true };
    expect(continueEndless(already)).toBe(already);

    const victory = { ...s, phase: 'victory' as const };
    expect(canContinueEndless(victory)).toBe(true);
    const next = continueEndless(victory);
    expect(next.phase).toBe('playing');
    expect(next.endless).toBe(true);
    expect(next.messages.some((message) => message.text === 'ENDLESS HUNT')).toBe(true);
    expect(ENDLESS_MESSAGE).toBe('ENDLESS HUNT');
  });

  it('is off by default', () => {
    expect(createGame(7).endless).toBeUndefined();
    expect(startMission(createGame(7)).endless).toBeUndefined();
  });
});
