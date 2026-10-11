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

  it('overwrites the oldest live slot when the pool is full', () => {
    const ripples = new RainRipples();
    const step = 0.005;
    // Slot i is born at i * step, so slot 0 is the oldest once the pool fills and every
    // ripple is still inside its life.
    for (let i = 0; i < RAIN_RIPPLE_CAPS.high; i++) {
      ripples.spawn(i, 0, 0.3);
      ripples.update(step, false, 0);
    }
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.high);
    // Column-major matrix: translation x sits at element 12 of each 16-float instance.
    const xOf = (slot: number) => ripples.mesh.instanceMatrix.array[slot * 16 + 12]!;
    ripples.spawn(999, 0, 0.3);
    ripples.update(0, false, 0);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.high);
    expect(xOf(0)).toBe(999);
    expect(xOf(1)).toBe(1);
    // Slot 0 is now the youngest, so the next overflow takes slot 1, the new oldest.
    ripples.spawn(1000, 0, 0.3);
    ripples.update(0, false, 0);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.high);
    expect(xOf(1)).toBe(1000);
    expect(xOf(0)).toBe(999);
    ripples.dispose();
  });

  it('trims live ripples to the medium cap on a drop to medium and to none on low', () => {
    const ripples = new RainRipples();
    for (let i = 0; i < RAIN_RIPPLE_CAPS.high; i++) ripples.spawn(i, -i, 0.3);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.high);
    ripples.setQuality('medium');
    expect(ripples.active).toBeLessThanOrEqual(RAIN_RIPPLE_CAPS.medium);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.medium);
    ripples.spawn(500, -500, 0.3);
    expect(ripples.active).toBe(RAIN_RIPPLE_CAPS.medium);
    ripples.setQuality('low');
    expect(ripples.active).toBe(0);
    ripples.dispose();
  });
});

describe('RainRipples upload gating', () => {
  it('uploads the cleared pool once, then skips idle frames', () => {
    const ripples = new RainRipples();
    ripples.update(0.016, false, 0);
    const matrixVersion = ripples.mesh.instanceMatrix.version;
    const colorVersion = ripples.mesh.instanceColor!.version;
    ripples.update(0.016, false, 0);
    ripples.update(0.016, false, 0);
    expect(ripples.mesh.instanceMatrix.version).toBe(matrixVersion);
    expect(ripples.mesh.instanceColor!.version).toBe(colorVersion);
    expect(ripples.mesh.visible).toBe(false);
    ripples.dispose();
  });

  it('writes the cleared matrix on the frame the last ripple expires, then goes idle', () => {
    const ripples = new RainRipples();
    ripples.spawn(1, 2, 0.5);
    ripples.update(0.016, false, 0);
    expect(ripples.mesh.instanceMatrix.array[0]).toBeGreaterThan(0);
    ripples.update(RIPPLE_LIFE_S, false, 0);
    expect(ripples.active).toBe(0);
    expect(ripples.mesh.instanceMatrix.array[0]).toBe(0);
    expect(ripples.mesh.visible).toBe(false);
    const clearedVersion = ripples.mesh.instanceMatrix.version;
    ripples.update(0.016, false, 0);
    expect(ripples.mesh.instanceMatrix.version).toBe(clearedVersion);
    ripples.dispose();
  });

  it('clears stale matrices on the next update after a reset', () => {
    const ripples = new RainRipples();
    ripples.spawn(1, 2, 0.5);
    ripples.update(0.016, false, 0);
    ripples.reset();
    ripples.update(0.016, false, 0);
    expect(ripples.mesh.instanceMatrix.array[0]).toBe(0);
    expect(ripples.mesh.visible).toBe(false);
    ripples.dispose();
  });

  it('renders a spawn that arrives after an idle period', () => {
    const ripples = new RainRipples();
    ripples.update(0.016, false, 0);
    ripples.update(0.016, false, 0);
    ripples.spawn(3, 4, 0.5);
    ripples.update(0.016, false, 0);
    expect(ripples.active).toBe(1);
    expect(ripples.mesh.visible).toBe(true);
    // Column-major matrix: translation x sits at element 12 of the first instance.
    expect(ripples.mesh.instanceMatrix.array[12]).toBe(3);
    ripples.dispose();
  });
});
