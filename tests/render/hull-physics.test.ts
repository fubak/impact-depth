import { describe, expect, it } from 'vitest';
import { clampSurfaceHullY } from '../../src/render/presentation/coordinates';

describe('surface hull water physics', () => {
  it('cannot fly above the sheet or sink deeper than draft', () => {
    expect(clampSurfaceHullY(4, 0.2, 0.5, -20)).toBeCloseTo(0.28, 5);
    expect(clampSurfaceHullY(-8, 0.2, 0.5, -20)).toBeCloseTo(0.2 - 0.5, 5);
  });

  it('cannot clip through the cay', () => {
    expect(clampSurfaceHullY(-2, 0.2, 0.5, 3)).toBeGreaterThan(3);
  });
});
