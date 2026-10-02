import { describe, expect, it } from 'vitest';
import { evaluateAtmosphere } from '../../src/render/atmosphere';

describe('daylight envelope', () => {
  it('keeps hemisphere fill below the key sun so hulls have real shadows', () => {
    const noon = evaluateAtmosphere({
      timeOfDay: 0.5,
      sunElevation: 62,
      sunAzimuth: 35,
      fogDensity: 0.012,
      exposure: 1,
      sunIntensity: 1,
    });
    expect(noon.isNight).toBe(false);
    expect(noon.ambient).toBeLessThan(0.65);
    expect(noon.ambient).toBeGreaterThan(0.3);
  });
});
