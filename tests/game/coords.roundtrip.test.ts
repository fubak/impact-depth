import { describe, expect, it } from 'vitest';
import {
  depthToMeters,
  metersToDepth,
  METERS_PER_DEPTH,
  simToWorldMeters,
  worldMetersToSim,
} from '../../src/game/sim/coords';
import { entityDepthY, SURFACE_SPLASH_Y } from '../../src/render/presentation/coordinates';

describe('game coordinates', () => {
  it('round-trips simulation coordinates through Three.js meters', () => {
    const sim = worldMetersToSim(
      simToWorldMeters(23.75, 71.25).x,
      simToWorldMeters(23.75, 71.25).z,
    );
    expect(sim).toEqual({ x: 23.75, y: 71.25 });
  });
  it('round-trips normalized depth through meters', () => {
    expect(metersToDepth(depthToMeters(0.45))).toBeCloseTo(0.45, 12);
  });
  it('maps sim depth with 24 m per unit, not the old 5 m weapon scale', () => {
    expect(METERS_PER_DEPTH).toBe(24);
    expect(entityDepthY(0.5)).toBe(-12);
    expect(entityDepthY(0.5)).not.toBe(-0.5 * 5);
    expect(SURFACE_SPLASH_Y).toBeCloseTo(0.08, 8);
    expect(SURFACE_SPLASH_Y).not.toBe(entityDepthY(0.5));
  });
  it('keeps surface pickups on the splash plane rather than airborne crate height', () => {
    expect(SURFACE_SPLASH_Y).toBeLessThan(0.5);
    expect(SURFACE_SPLASH_Y).toBeGreaterThan(0);
  });
});
