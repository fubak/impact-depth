import { describe, expect, it } from 'vitest';
import {
  SUB_DEPTH_RATE,
  integrateSubmarineDepth,
  submarineDivePitch,
} from '../../src/game/sim/submarine-motion';
import { DEPTH_TARGET } from '../../src/game/sim/constants';

describe('submarine depth integration', () => {
  it('approaches attack depth over several seconds, not in one tick', () => {
    let z: number = DEPTH_TARGET.surface;
    const dt = 1 / 60;
    z = integrateSubmarineDepth(z, DEPTH_TARGET.attack, dt);
    expect(z).toBeLessThan(DEPTH_TARGET.surface + SUB_DEPTH_RATE * dt + 1e-6);
    expect(z).toBeGreaterThan(DEPTH_TARGET.surface);
    for (let i = 0; i < 60; i++) z = integrateSubmarineDepth(z, DEPTH_TARGET.attack, dt);
    expect(z).toBeGreaterThan(DEPTH_TARGET.surface + 0.05);
    expect(z).toBeLessThan(DEPTH_TARGET.attack);
    for (let i = 0; i < 600; i++) z = integrateSubmarineDepth(z, DEPTH_TARGET.attack, dt);
    expect(z).toBeCloseTo(DEPTH_TARGET.attack, 2);
  });

  it('pitches bow down while diving and bow up while surfacing', () => {
    expect(submarineDivePitch(0.06, 0.5)).toBeGreaterThan(0.15);
    expect(submarineDivePitch(0.82, 0.06)).toBeLessThan(-0.15);
    expect(Math.abs(submarineDivePitch(0.5, 0.5))).toBeLessThan(0.02);
  });
});
