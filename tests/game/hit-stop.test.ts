import { describe, expect, it } from 'vitest';
import type { HitNumber } from '../../src/game/adapt/hit-numbers';
import {
  HIT_STOP_CRIT_S,
  HIT_STOP_ELITE_KILL_S,
  HIT_STOP_KILL_S,
  hitStopSeconds,
} from '../../src/game/adapt/hit-stop';

const num = (kind: HitNumber['kind'], elite = false): HitNumber => ({
  id: `${kind}-x`,
  kind,
  x: 0,
  y: 0,
  amount: 10,
  elite,
});

describe('hitStopSeconds', () => {
  it('uses the documented durations', () => {
    expect(HIT_STOP_CRIT_S).toBe(0.09);
    expect(HIT_STOP_KILL_S).toBe(0.4);
    expect(HIT_STOP_ELITE_KILL_S).toBe(0.55);
  });

  it('is zero for no numbers and for damage only', () => {
    expect(hitStopSeconds([], 1)).toBe(0);
    expect(hitStopSeconds([num('damage')], 1)).toBe(0);
  });

  it('gives the crit stop for a crit', () => {
    expect(hitStopSeconds([num('crit')], 1)).toBe(0.09);
  });

  it('gives the kill stop for a kill', () => {
    expect(hitStopSeconds([num('kill')], 1)).toBe(0.4);
  });

  it('gives the longer stop for an elite kill', () => {
    expect(hitStopSeconds([num('kill', true)], 1)).toBe(0.55);
  });

  it('takes the maximum, never the sum, of crit and kill', () => {
    expect(hitStopSeconds([num('crit'), num('kill')], 1)).toBe(0.4);
  });

  it('is zero when freezeScale is zero', () => {
    expect(hitStopSeconds([num('kill', true)], 0)).toBe(0);
  });

  it('scales by freezeScale', () => {
    expect(hitStopSeconds([num('kill')], 0.5)).toBeCloseTo(0.2, 10);
  });

  it('clamps freezeScale into 0..1', () => {
    expect(hitStopSeconds([num('kill')], 3)).toBe(0.4);
    expect(hitStopSeconds([num('kill')], -1)).toBe(0);
  });
});
