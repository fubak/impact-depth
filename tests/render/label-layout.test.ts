import { describe, expect, it } from 'vitest';
import {
  OWN_LABEL_ASPECT,
  OWN_LABEL_FALLBACK_H,
  OWN_LABEL_MAX_H,
  OWN_LABEL_MIN_H,
  OWN_LABEL_SAFE_NDC,
  OWN_LABEL_SCREEN_FRACTION,
  clampLabelNdc,
  ownLabelAnchorY,
  ownLabelWorldHeight,
} from '../../src/render/presentation/label-layout';

const tanHalf = (fovDeg: number) => Math.tan((fovDeg * Math.PI) / 360);

describe('own label constants', () => {
  it('match the specified values', () => {
    expect(OWN_LABEL_ASPECT).toBe(5);
    expect(OWN_LABEL_SCREEN_FRACTION).toBe(0.028);
    expect(OWN_LABEL_MIN_H).toBe(0.35);
    expect(OWN_LABEL_MAX_H).toBe(3.0);
    expect(OWN_LABEL_FALLBACK_H).toBe(1.2);
    expect(OWN_LABEL_SAFE_NDC).toEqual({ xMin: -0.45, xMax: 0.45, yMin: -0.35, yMax: 0.55 });
  });
});

describe('ownLabelWorldHeight', () => {
  it('gives about 0.76 m at chase distance and fov', () => {
    expect(ownLabelWorldHeight(26, 55).toFixed(2)).toBe('0.76');
  });

  it('gives about 1.55 m in tactical view', () => {
    expect(ownLabelWorldHeight(72, 42).toFixed(2)).toBe('1.55');
  });

  it('clamps to the minimum height when close', () => {
    expect(ownLabelWorldHeight(1, 55)).toBe(0.35);
  });

  it('clamps to the maximum height when far', () => {
    expect(ownLabelWorldHeight(5000, 55)).toBe(3.0);
  });

  it('falls back for non-finite or non-positive inputs', () => {
    expect(ownLabelWorldHeight(Number.NaN, 55)).toBe(1.2);
    expect(ownLabelWorldHeight(10, 0)).toBe(1.2);
    expect(ownLabelWorldHeight(-3, 55)).toBe(1.2);
  });

  it('is monotone non-decreasing over distance 1..400 m', () => {
    let previous = ownLabelWorldHeight(1, 55);
    for (let d = 2; d <= 400; d += 1) {
      const h = ownLabelWorldHeight(d, 55);
      expect(h).toBeGreaterThanOrEqual(previous);
      previous = h;
    }
  });

  it('keeps a constant screen fraction of 0.028 for 30..80 m at fov 55', () => {
    for (let d = 30; d <= 80; d += 1) {
      const h = ownLabelWorldHeight(d, 55);
      const fraction = h / (2 * d * tanHalf(55));
      expect(fraction).toBeCloseTo(0.028, 9);
    }
  });

  it('shrinks the chase width below the old 9.6 m plate width', () => {
    const width = ownLabelWorldHeight(26, 55) * OWN_LABEL_ASPECT;
    expect(width).toBeLessThan(9.6);
  });
});

describe('ownLabelAnchorY', () => {
  it('places the sprite centre above the hull and the clearance gap', () => {
    expect(ownLabelAnchorY(-2, 3, 1)).toBe(2.3);
  });
});

describe('clampLabelNdc', () => {
  it('leaves a point inside the safe box unchanged', () => {
    expect(clampLabelNdc(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('clamps a point above and right into the box', () => {
    expect(clampLabelNdc(0.9, 0.9)).toEqual({ x: 0.45, y: 0.55 });
  });

  it('clamps a point below and left into the box', () => {
    expect(clampLabelNdc(-2, -2)).toEqual({ x: -0.45, y: -0.35 });
  });
});
