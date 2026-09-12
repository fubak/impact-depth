import { describe, expect, it } from 'vitest';
import {
  IMMERSION_HYSTERESIS,
  immersionFogFactor,
  isUnderwaterWithHysteresis,
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
});
