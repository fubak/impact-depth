import { describe, expect, it } from 'vitest';
import {
  SURFACE_HEIGHT_TOLERANCE_M,
  oceanDisplacementAt,
  oceanInverseDisplacementAt,
  type SurfaceEvalContext,
} from '../../src/render/ocean/surface';
import { PROBE_FRAGMENT } from '../../src/render/ocean/surface-probes';

function planarContext(amp: number, k: number): SurfaceEvalContext {
  return {
    sampleCascade: (index, worldX) => {
      if (index !== 0) return { x: 0, y: 0, z: 0 };
      return { x: 0, y: amp * Math.sin(k * worldX), z: 0 };
    },
    lengths: [1792, 211, 27.3],
    bed: -20,
    coastalDelay: 0,
    coastalExposure: 1,
    swellDirection: [1, 0],
    waveHeight: 1,
    wetBand: 0.4,
  };
}

describe('shared ocean displacement evaluator', () => {
  it('matches a vertical planar swell within the documented metre tolerance', () => {
    const amp = 0.8;
    const k = 0.12;
    const ctx = planarContext(amp, k);
    const x = 4.5;
    const displaced = oceanDisplacementAt(x, 0, ctx);
    const source = oceanInverseDisplacementAt(x, 0, ctx);
    const atSource = oceanDisplacementAt(source.x, source.z, ctx);
    expect(Math.abs(displaced.y - amp * Math.sin(k * x))).toBeLessThan(SURFACE_HEIGHT_TOLERANCE_M);
    expect(Math.abs(atSource.y - displaced.y)).toBeLessThan(SURFACE_HEIGHT_TOLERANCE_M);
  });

  it('applies bed coverage so land samples do not lift like open water', () => {
    const ctx: SurfaceEvalContext = {
      ...planarContext(1.2, 0.2),
      bed: 2,
    };
    const open = oceanDisplacementAt(4.5, 0, planarContext(1.2, 0.2));
    const land = oceanDisplacementAt(4.5, 0, ctx);
    expect(Math.abs(open.y)).toBeGreaterThan(0.2);
    expect(Math.abs(land.y)).toBeLessThan(Math.abs(open.y) * 0.25);
  });
});

describe('probe shader shares the ocean surface evaluator', () => {
  it('samples oceanDisplacement after inverse mapping instead of summing raw cascades', () => {
    expect(PROBE_FRAGMENT).toContain('oceanDisplacement');
    expect(PROBE_FRAGMENT).toContain('oceanInverseDisplacement');
    expect(PROBE_FRAGMENT).not.toMatch(/uDisplacement0,\s*p\/uLength/);
  });
});
