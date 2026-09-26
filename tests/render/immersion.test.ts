import { describe, expect, it } from 'vitest';
import {
  IMMERSION_HYSTERESIS,
  PLAYER_HULL_FOG_EXEMPT_M,
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
