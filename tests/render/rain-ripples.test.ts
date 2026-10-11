import { describe, expect, it } from 'vitest';
import {
  RAIN_RIPPLE_CAPS,
  RIPPLE_LIFE_S,
  RIPPLE_MAX_RADIUS,
  RIPPLE_MIN_RADIUS,
  RainRipples,
  rippleFade,
  rippleRadius,
} from '../../src/render/fx/rain-ripples';

describe('rain ripple caps', () => {
  it('scales the ripple pool by quality tier and draws none on low', () => {
    expect(RAIN_RIPPLE_CAPS.high).toBeGreaterThan(RAIN_RIPPLE_CAPS.medium);
    expect(RAIN_RIPPLE_CAPS.medium).toBeGreaterThan(RAIN_RIPPLE_CAPS.low);
    expect(RAIN_RIPPLE_CAPS.low).toBe(0);
  });
});

describe('rippleRadius', () => {
  it('starts at the minimum radius', () => {
    expect(rippleRadius(0, 0.5)).toBeCloseTo(RIPPLE_MIN_RADIUS, 9);
  });

  it('grows monotonically and reaches the maximum at strength 0.5 at the end of its life', () => {
    let previous = -Infinity;
    for (let age = 0; age <= RIPPLE_LIFE_S; age += 0.05) {
      const radius = rippleRadius(age, 0.5);
      expect(radius).toBeGreaterThanOrEqual(previous);
      previous = radius;
    }
    expect(rippleRadius(RIPPLE_LIFE_S, 0.5)).toBeCloseTo(RIPPLE_MAX_RADIUS, 9);
  });

  it('ends at 0.84 for strength 0.3', () => {
    expect(rippleRadius(RIPPLE_LIFE_S, 0.3)).toBeCloseTo(0.84, 9);
  });
});

describe('rippleFade', () => {
  it('is 1 at birth, between 0 and 1 mid-life, and 0 at or after the life', () => {
    expect(rippleFade(0)).toBe(1);
    const mid = rippleFade(0.45);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(rippleFade(0.9)).toBe(0);
    expect(rippleFade(5)).toBe(0);
  });
});

describe('RainRipples', () => {
  it('creates its instance colour buffer in the constructor and starts hidden', () => {
    const ripples = new RainRipples();
    expect(ripples.mesh.instanceColor).not.toBeNull();
    expect(ripples.mesh.name).toBe('rain-ripples');
    expect(ripples.mesh.visible).toBe(false);
    expect(ripples.active).toBe(0);
    ripples.dispose();
  });

  it('caps live ripples at the high-quality pool size', () => {
    const ripples = new RainRipples();
    for (let i = 0; i < 200; i++) ripples.spawn(i, -i, 0.3);
    expect(ripples.active).toBeLessThanOrEqual(96);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.high);
    ripples.dispose();
  });

  it('caps live ripples at the medium pool size after a quality change', () => {
    const ripples = new RainRipples();
    ripples.setQuality('medium');
    for (let i = 0; i < 200; i++) ripples.spawn(i, -i, 0.3);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.medium);
    ripples.dispose();
  });

  it('draws nothing on low quality', () => {
    const ripples = new RainRipples();
    ripples.setQuality('low');
    ripples.spawn(1, 2, 0.5);
    expect(ripples.active).toBe(0);
    ripples.dispose();
  });

  it('spawns nothing under reduced motion', () => {
    const ripples = new RainRipples();
    ripples.setReducedMotion(true);
    ripples.spawn(1, 2, 0.5);
    expect(ripples.active).toBe(0);
    ripples.dispose();
  });

  it('expires ripples after their life', () => {
    const ripples = new RainRipples();
    ripples.spawn(1, 2, 0.5);
    expect(ripples.active).toBe(1);
    ripples.update(1.0, false, 0);
    expect(ripples.active).toBe(0);
    expect(ripples.mesh.visible).toBe(false);
    ripples.dispose();
  });

  it('keeps ripples alive while paused', () => {
    const ripples = new RainRipples();
    ripples.spawn(1, 2, 0.5);
    ripples.update(5, true, 0);
    expect(ripples.active).toBe(1);
    expect(ripples.mesh.visible).toBe(true);
    ripples.dispose();
  });

  it('kills everything on reset', () => {
    const ripples = new RainRipples();
    ripples.spawn(1, 2, 0.5);
    ripples.spawn(3, 4, 0.5);
    ripples.reset();
    expect(ripples.active).toBe(0);
    ripples.dispose();
  });
});
