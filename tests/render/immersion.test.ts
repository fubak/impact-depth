import { describe, expect, it } from 'vitest';
import {
  IMMERSION_HYSTERESIS,
  PLAYER_HULL_FOG_EXEMPT_M,
  immersionDepthFactor,
  immersionExposure,
  immersionFogColor,
  immersionFogDensity,
  immersionFogFactor,
  isUnderwaterWithHysteresis,
  playerHullFogWeight,
  playerUnderwaterSubject,
  resolveWaterHeight,
  updateImmersion,
} from '../../src/render/presentation/immersion';

describe('camera immersion hysteresis', () => {
  it('falls back to mean sea when no probe has arrived', () => {
    expect(resolveWaterHeight(null)).toBe(0);
    expect(resolveWaterHeight(Number.NaN)).toBe(0);
    expect(resolveWaterHeight(1.4)).toBe(1.4);
  });

  it('does not flicker across a crest within the hysteresis band', () => {
    const water = 0.4;
    expect(isUnderwaterWithHysteresis(water - 0.05, water, false)).toBe(false);
    expect(isUnderwaterWithHysteresis(water - IMMERSION_HYSTERESIS - 0.01, water, false)).toBe(
      true,
    );
    expect(isUnderwaterWithHysteresis(water + 0.05, water, true)).toBe(true);
    expect(isUnderwaterWithHysteresis(water + IMMERSION_HYSTERESIS + 0.01, water, true)).toBe(
      false,
    );
  });

  it('reports fog only while the hysteresis bit says underwater', () => {
    const dry = updateImmersion({
      eyeY: 2,
      sampledWaterHeight: 0.3,
      previousUnderwater: false,
    });
    expect(dry.underwater).toBe(false);
    expect(immersionFogFactor(2, 0.3, false)).toBe(0);

    const wet = updateImmersion({
      eyeY: -2,
      sampledWaterHeight: 0.5,
      previousUnderwater: true,
    });
    expect(wet.underwater).toBe(true);
    expect(wet.eyeRelative).toBeCloseTo(-2.5);
    expect(immersionFogFactor(-2, 0.5, true)).toBeGreaterThan(0.1);
  });

  it('exempts the player hull from fog inside 30 m only while the eye is under', () => {
    expect(PLAYER_HULL_FOG_EXEMPT_M).toBe(30);
    expect(playerHullFogWeight(26, true)).toBe(0);
    expect(playerHullFogWeight(30, true)).toBe(0);
    expect(playerHullFogWeight(34, true)).toBeGreaterThan(0);
    expect(playerHullFogWeight(34, true)).toBeLessThan(1);
    expect(playerHullFogWeight(42, true)).toBe(1);
    expect(playerHullFogWeight(26, false)).toBe(1);
  });

  it('marks only a submerged player boat seen from underwater, not periscope', () => {
    expect(playerUnderwaterSubject(true, 18, false)).toBe(true);
    expect(playerUnderwaterSubject(true, 0.5, false)).toBe(false);
    expect(playerUnderwaterSubject(false, 18, false)).toBe(false);
    expect(playerUnderwaterSubject(true, 18, true)).toBe(false);
  });
});

describe('depth-graded underwater lighting', () => {
  /**
   * WHY: the dive must read as sinking into dark water — turquoise haze just
   * under the surface, navy by ~30 m — or depth is invisible to the player.
   */
  it('darkens fog colour monotonically from turquoise to navy by ~30 m', () => {
    const shallow = immersionFogColor(0.5);
    const mid = immersionFogColor(15);
    const deep = immersionFogColor(30);
    // Bright turquoise just under the surface, dark navy at 30 m.
    expect(shallow.g).toBeGreaterThan(0.35);
    expect(deep.b).toBeLessThan(0.1);
    expect(mid.g).toBeLessThan(shallow.g);
    expect(deep.g).toBeLessThan(mid.g);
    for (const c of [shallow, mid, deep]) {
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.b).toBeGreaterThanOrEqual(0);
    }
  });

  it('raises fog density and lowers exposure monotonically with depth', () => {
    let prevD = -1;
    let prevE = 2;
    for (let d = 0; d <= 40; d += 2) {
      const density = immersionFogDensity(d);
      const exposure = immersionExposure(d);
      expect(density).toBeGreaterThanOrEqual(prevD);
      expect(exposure).toBeLessThanOrEqual(prevE);
      prevD = density;
      prevE = exposure;
    }
    expect(immersionFogDensity(0)).toBeCloseTo(0.011);
    expect(immersionExposure(0)).toBe(1);
    expect(immersionExposure(30)).toBeCloseTo(0.6, 5);
  });

  it('is continuous across the surface transition — no pop on dive entry', () => {
    // Just above water the grade is identity; epsilon below must match.
    expect(immersionDepthFactor(0)).toBe(0);
    expect(immersionDepthFactor(0.001)).toBeLessThan(0.001);
    expect(immersionExposure(0.001)).toBeGreaterThan(0.999);
    expect(immersionFogDensity(0.001)).toBeLessThan(0.0111);
    expect(immersionFogColor(0.001).g).toBeCloseTo(immersionFogColor(0).g, 4);
    // Past the grade depth it saturates instead of running away.
    expect(immersionDepthFactor(60)).toBe(1);
  });
});
