import { describe, expect, it } from 'vitest';
import { foamUniform, swellCascadeGain } from '../../src/render/ocean/sea-gains';

/** The pre-P14 formulas, written out verbatim so identity is checked against the original code. */
const oldSwell = (sea: number): number => 0.72 * (0.35 + sea * 0.65);
const oldFoam = (foamAmount: number, foamScale: number, spectral: boolean): number =>
  foamAmount * foamScale * (spectral ? 0.22 : 1);

describe('swellCascadeGain', () => {
  it('equals the old swell formula exactly when the gain is absent', () => {
    for (const sea of [0, 0.3, 0.93]) {
      expect(swellCascadeGain(sea, undefined)).toBe(oldSwell(sea));
    }
  });

  it('scales linearly with the swell gain', () => {
    const base = oldSwell(0.3);
    expect(swellCascadeGain(0.3, 1.54)).toBeCloseTo(base * 1.54, 12);
    expect(swellCascadeGain(0.93, 2)).toBeCloseTo(oldSwell(0.93) * 2, 12);
  });

  it('treats a NaN or non-finite gain as 1', () => {
    expect(swellCascadeGain(0.3, Number.NaN)).toBe(oldSwell(0.3));
    expect(swellCascadeGain(0.3, Number.POSITIVE_INFINITY)).toBe(oldSwell(0.3));
    expect(swellCascadeGain(0.3, Number.NEGATIVE_INFINITY)).toBe(oldSwell(0.3));
  });
});

describe('foamUniform', () => {
  it('equals the old foam formula exactly when the whitecap gain is absent', () => {
    for (const scale of [1, 1.35]) {
      for (const spectral of [true, false]) {
        expect(foamUniform(0.14, undefined, scale, spectral)).toBe(oldFoam(0.14, scale, spectral));
      }
    }
  });

  it('scales linearly with the whitecap gain', () => {
    expect(foamUniform(0.14, 1.54, 1, false)).toBeCloseTo(0.14 * 1.54, 12);
    expect(foamUniform(0.14, 2, 1.35, true)).toBeCloseTo(oldFoam(0.14, 1.35, true) * 2, 12);
  });

  it('treats a NaN or non-finite whitecap gain as 1', () => {
    expect(foamUniform(0.14, Number.NaN, 1.35, true)).toBe(oldFoam(0.14, 1.35, true));
    expect(foamUniform(0.14, Number.POSITIVE_INFINITY, 1, false)).toBe(oldFoam(0.14, 1, false));
  });
});
