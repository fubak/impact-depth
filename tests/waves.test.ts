import { describe, expect, it } from 'vitest';
import { sampleAttitude, sampleGerstner, scaledWaves, seaStateLabel, BASE_WAVES } from '../src/core/waves';

describe('Gerstner wave sampling', () => {
  it('returns finite height and normals for base waves', () => {
    const waves = scaledWaves(1, 0.7, 0.5);
    const s = sampleGerstner(3, -4, 1.25, waves);
    expect(Number.isFinite(s.height)).toBe(true);
    expect(Number.isFinite(s.normalY)).toBe(true);
    expect(s.normalY).toBeGreaterThan(0.2);
  });

  it('scales amplitude with wave height and sea state', () => {
    const calm = scaledWaves(0.5, 0.5, 0.1);
    const rough = scaledWaves(1.5, 0.5, 0.9);
    expect(rough[0]!.amplitude).toBeGreaterThan(calm[0]!.amplitude);
  });

  it('is deterministic for the same inputs', () => {
    const waves = scaledWaves(1, 0.8, 0.6);
    const a = sampleGerstner(10, 20, 5, waves);
    const b = sampleGerstner(10, 20, 5, waves);
    expect(a).toEqual(b);
  });

  it('produces attitude samples with finite pitch/roll', () => {
    const waves = scaledWaves(1.2, 0.9, 0.7);
    const a = sampleAttitude(0, 0, 2, waves, 0.4, 5);
    expect(Number.isFinite(a.heave)).toBe(true);
    expect(Number.isFinite(a.pitch)).toBe(true);
    expect(Number.isFinite(a.roll)).toBe(true);
  });

  it('exposes four directional components', () => {
    expect(BASE_WAVES).toHaveLength(4);
  });

  it('labels sea state bands', () => {
    expect(seaStateLabel(0.05)).toContain('CALM');
    expect(seaStateLabel(0.95)).toContain('HIGH');
  });
});
