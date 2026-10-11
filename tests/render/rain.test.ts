import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES } from '../../src/render/quality';
import {
  RAIN_RIPPLE_RATE,
  RAIN_STREAK_CAPS,
  RAIN_STREAK_HALF_WIDTH,
  rainRippleRate,
  rainStreakCount,
  rainStreakQuad,
  rainStreakSegment,
  rainTintChannel,
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

describe('rain tint floor, camera-facing quads and ripple focus', () => {
  it('floors each tint channel so rain never goes darker than a visible grey', () => {
    expect(rainTintChannel(0.05)).toBe(0.32);
    expect(rainTintChannel(0.8)).toBe(0.8);
    expect(rainTintChannel(Number.NaN)).toBe(0.32);
  });

  it('builds a camera-facing quad whose midpoint sits on the head and whose width is the half-width', () => {
    const out = new Float32Array(18);
    const seg = [5, 10, 5, 5.3, 12, 5.2];
    const ok = rainStreakQuad(out, 0, seg, 0, 20, 0, RAIN_STREAK_HALF_WIDTH);
    expect(ok).toBe(true);
    const vertex = (i: number) => [out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!];
    const v0 = vertex(0);
    const v1 = vertex(1);
    for (let k = 0; k < 3; k++) {
      expect((v0[k]! + v1[k]!) / 2).toBeCloseTo(seg[k]!, 6);
    }
    expect(Math.hypot(v1[0]! - v0[0]!, v1[1]! - v0[1]!, v1[2]! - v0[2]!)).toBeCloseTo(2 * 0.022, 6);
    // Side vector is horizontal and perpendicular to (head - camera) in XZ.
    const sideX = v1[0]! - v0[0]!;
    const sideZ = v1[2]! - v0[2]!;
    expect(sideX * (5 - 0) + sideZ * (5 - 0)).toBeCloseTo(0, 5);
  });

  it('orders the second triangle as tail+side, head-side, tail-side', () => {
    const out = new Float32Array(18);
    const seg = [5, 10, 5, 5.3, 12, 5.2];
    rainStreakQuad(out, 0, seg, 0, 20, 0, RAIN_STREAK_HALF_WIDTH);
    const vertex = (i: number) => [out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!];
    const v0 = vertex(0);
    const v1 = vertex(1);
    const v2 = vertex(2);
    const v3 = vertex(3);
    const v4 = vertex(4);
    const v5 = vertex(5);
    for (let k = 0; k < 3; k++) {
      const side = (v1[k]! - v0[k]!) / 2;
      const tail = seg[3 + k]!;
      expect(v2[k]!).toBeCloseTo(tail + side, 6);
      expect(v4[k]!).toBeCloseTo(tail + side, 6);
      expect(v3[k]!).toBeCloseTo(v0[k]!, 6);
      expect(v5[k]!).toBeCloseTo(tail - side, 6);
    }
  });

  it('stays finite when the camera sits exactly above the head in XZ', () => {
    const out = new Float32Array(18);
    const ok = rainStreakQuad(out, 0, [5, 10, 5, 5.3, 12, 5.2], 5, 30, 5, RAIN_STREAK_HALF_WIDTH);
    expect(ok).toBe(true);
    for (const value of out) expect(Number.isFinite(value)).toBe(true);
  });

  it('collapses a streak to a zero-area quad on the head when the head is within 4 m of the camera', () => {
    const out = new Float32Array(18);
    const ok = rainStreakQuad(out, 0, [1, 1, 1, 1.2, 2, 1.1], 0, 0, 0, RAIN_STREAK_HALF_WIDTH);
    expect(ok).toBe(false);
    for (let v = 0; v < 6; v++) {
      expect([out[v * 3], out[v * 3 + 1], out[v * 3 + 2]]).toEqual([1, 1, 1]);
    }
  });

  it('keeps the ripple rate high enough to read at full rain and zero on low quality', () => {
    expect(RAIN_RIPPLE_RATE.high).toBeGreaterThanOrEqual(60);
    expect(RAIN_RIPPLE_RATE.low).toBe(0);
  });
});
