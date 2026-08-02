import { describe, expect, it } from 'vitest';
import { depthToMeters, metersToDepth, simToWorldMeters, worldMetersToSim } from '../../src/game/sim/coords';

describe('game coordinates', () => {
  it('round-trips simulation coordinates through Three.js meters', () => {
    const sim = worldMetersToSim(simToWorldMeters(23.75, 71.25).x, simToWorldMeters(23.75, 71.25).z);
    expect(sim).toEqual({ x: 23.75, y: 71.25 });
  });
  it('round-trips normalized depth through meters', () => {
    expect(metersToDepth(depthToMeters(0.45))).toBeCloseTo(0.45, 12);
  });
});
