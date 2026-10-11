import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES } from '../../src/render/quality';
import {
  RAIN_RIPPLE_RATE,
  RAIN_STREAK_CAPS,
  rainRippleRate,
  rainStreakCount,
  rainStreakSegment,
  wrapAround,
} from '../../src/render/fx/rain';

describe('rain density scaling', () => {
  it('has no streaks without rain, on low quality or under reduced motion', () => {
    expect(rainStreakCount(0, 'high', false)).toBe(0);
    expect(rainStreakCount(0.01, 'high', false)).toBe(0);
    expect(rainStreakCount(1, 'low', false)).toBe(0);
    expect(rainStreakCount(1, 'high', true)).toBe(0);
    expect(rainStreakCount(1, 'medium', true)).toBe(0);
    expect(rainStreakCount(Number.NaN, 'high', false)).toBe(0);
  });

  it('scales monotonically with rain intensity up to the quality cap', () => {
    let previous = 0;
    for (const rain of [0.1, 0.3, 0.5, 0.7, 1]) {
      const count = rainStreakCount(rain, 'high', false);
      expect(count).toBeGreaterThan(previous);
      previous = count;
    }
    expect(rainStreakCount(1, 'high', false)).toBe(RAIN_STREAK_CAPS.high);
    expect(rainStreakCount(5, 'high', false)).toBe(RAIN_STREAK_CAPS.high);
  });

  it('lower quality draws fewer streaks than higher quality at equal intensity', () => {
    expect(RAIN_STREAK_CAPS.high).toBeGreaterThan(RAIN_STREAK_CAPS.medium);
    expect(RAIN_STREAK_CAPS.medium).toBeGreaterThan(RAIN_STREAK_CAPS.low);
    expect(RAIN_STREAK_CAPS.low).toBe(0);
    expect(rainStreakCount(0.7, 'medium', false)).toBeLessThan(rainStreakCount(0.7, 'high', false));
  });

  it('stays inside the quality profile particle budget', () => {
    for (const name of ['high', 'medium', 'low'] as const) {
      expect(RAIN_STREAK_CAPS[name]).toBeLessThanOrEqual(QUALITY_PROFILES[name].particleCap);
    }
  });

  it('ripple rate follows the same gates and scales with intensity', () => {
    expect(rainRippleRate(0, 'high', false)).toBe(0);
    expect(rainRippleRate(1, 'low', false)).toBe(0);
    expect(rainRippleRate(1, 'high', true)).toBe(0);
    expect(rainRippleRate(1, 'high', false)).toBe(RAIN_RIPPLE_RATE.high);
    expect(rainRippleRate(0.5, 'high', false)).toBeLessThan(rainRippleRate(1, 'high', false));
    expect(rainRippleRate(1, 'medium', false)).toBeLessThan(rainRippleRate(1, 'high', false));
  });
});

describe('rain streak geometry', () => {
  it('wraps an offset into the half-open box around the camera', () => {
    for (const value of [-130, -31, -30, -0.5, 0, 29.9, 30, 61, 4000]) {
      const wrapped = wrapAround(value, 60);
      expect(wrapped).toBeGreaterThanOrEqual(-30);
      expect(wrapped).toBeLessThan(30);
    }
    expect(wrapAround(10, 60)).toBe(10);
  });

  it('falls through the volume and wraps top to bottom', () => {
    const out = new Float32Array(6);
    const params = { height: 40, fall: 18, slantX: 0, slantZ: 0, length: 1 };
    rainStreakSegment(out, 0, 5, 0.25, 7, 0, params);
    const y0 = out[1]!;
    rainStreakSegment(out, 0, 5, 0.25, 7, 0.1, params);
    expect(out[1]!).toBeLessThan(y0);
    for (const t of [0, 0.4, 1.3, 25.7]) {
      rainStreakSegment(out, 0, 0, 0.9, 0, t, params);
      expect(out[1]!).toBeGreaterThanOrEqual(0);
      expect(out[1]!).toBeLessThanOrEqual(40);
    }
  });

  it('writes a segment whose tail trails the head and leans with the wind', () => {
    const out = new Float32Array(6);
    rainStreakSegment(out, 0, 0, 0.5, 0, 0, {
      height: 40,
      fall: 18,
      slantX: 6,
      slantZ: -3,
      length: 1.2,
    });
    // Head (x0,y0,z0) then tail (x1,y1,z1): the tail is higher and up-wind.
    expect(out[4]!).toBeGreaterThan(out[1]!);
    expect(out[3]!).toBeLessThan(out[0]!);
    expect(out[5]!).toBeGreaterThan(out[2]!);
    const length = Math.hypot(out[3]! - out[0]!, out[4]! - out[1]!, out[5]! - out[2]!);
    expect(length).toBeCloseTo(1.2, 4);
  });
});
