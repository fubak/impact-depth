import { describe, expect, it } from 'vitest';
import { entityDepthY, SURFACE_SPLASH_Y } from '../../src/render/presentation/coordinates';

describe('weapon water physics', () => {
  it('runs player fish at launch depth, not the sea plane', () => {
    const y = entityDepthY(0.28);
    expect(y).toBeLessThan(-5);
    expect(y).not.toBeCloseTo(SURFACE_SPLASH_Y, 1);
  });

  it('only puts a surface wake on shallow runners', () => {
    const deepY = entityDepthY(0.7);
    const shallowY = entityDepthY(0.04);
    expect(deepY).toBeLessThan(-1.5);
    expect(shallowY).toBeGreaterThan(-1.5);
  });
});
