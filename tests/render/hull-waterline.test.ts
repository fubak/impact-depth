import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUB_HULL_HEIGHT_M,
  VISUAL_PERI_SAIL_M,
  visualKeelY,
} from '../../src/render/presentation/coordinates';

describe('visualKeelY', () => {
  const h = DEFAULT_SUB_HULL_HEIGHT_M;

  it('keeps the sail above mean sea on the surface order', () => {
    const keel = visualKeelY(1.44, h);
    const mast = keel + h;
    expect(mast).toBeGreaterThan(0.8);
    expect(keel).toBeGreaterThan(-1.2);
  });

  it('parks the sail on the waterline at periscope depth instead of burying a 2 m hull', () => {
    const keel = visualKeelY(6.72, h);
    expect(keel + h).toBeCloseTo(VISUAL_PERI_SAIL_M);
    expect(keel).toBeGreaterThan(-2.5);
    expect(visualKeelY(6.72, h)).not.toBe(-6.72);
  });

  it('uses true −depth once the boat is at attack or deep', () => {
    expect(visualKeelY(12, h)).toBe(-12);
    expect(visualKeelY(19.7, h)).toBeCloseTo(-19.7);
  });

  it('ignores a non-finite hull height so a poisoned AABB cannot sink the boat', () => {
    expect(visualKeelY(1.44, Number.NaN)).toBe(visualKeelY(1.44, h));
  });
});
