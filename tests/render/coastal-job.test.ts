import { describe, expect, it } from 'vitest';
import { coastalJobOwnsBind, SpectralBackend } from '../../src/render/ocean/spectral-backend';

describe('coastal async ownership', () => {
  it('rejects a stale build from binding or clearing a newer job', () => {
    expect(coastalJobOwnsBind(3, 3)).toBe(true);
    expect(coastalJobOwnsBind(2, 3)).toBe(false);
    expect(coastalJobOwnsBind(4, 3)).toBe(false);
  });

  it('samples at least 128 cells across the 640 m sector', () => {
    expect(SpectralBackend.COASTAL_RESOLUTION).toBeGreaterThanOrEqual(128);
    expect(SpectralBackend.COASTAL_EXTENT_M).toBeLessThanOrEqual(640);
    expect(
      SpectralBackend.COASTAL_EXTENT_M / SpectralBackend.COASTAL_RESOLUTION,
    ).toBeLessThanOrEqual(5.1);
  });
});
