import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AtmosphereSettings } from '../../src/core/types';
import { Atmosphere, snapToShadowTexel } from '../../src/render/atmosphere';

const base = {
  timeOfDay: 0.5,
  sunElevation: 40,
  sunAzimuth: 120,
  fogDensity: 0.01,
  sunIntensity: 1,
} as unknown as AtmosphereSettings;

describe('atmosphere render stability', () => {
  it('reuses fog and background; density is reasserted, not decayed', () => {
    const a = new Atmosphere();
    const scene = new THREE.Scene();
    a.apply(base, scene);
    const fog = scene.fog as THREE.FogExp2;
    const bg = scene.background;
    fog.density *= 0.55; // what OutdoorLighting does between frames
    a.apply(base, scene);
    expect(scene.fog).toBe(fog);
    expect(scene.background).toBe(bg);
    expect(fog.density).toBeCloseTo(0.01, 10);
  });

  it('keeps castShadow true over a day sweep (toggling recompiles materials)', () => {
    const a = new Atmosphere();
    const scene = new THREE.Scene();
    for (let t = 0; t <= 1; t += 0.05) {
      a.apply({ ...base, timeOfDay: t }, scene);
      expect(a.sun.castShadow).toBe(true);
    }
    a.apply({ ...base, timeOfDay: 0.0 }, scene);
    expect(a.sun.shadow.intensity).toBe(0);
  });

  it('snapped position is stable under sub-texel movement', () => {
    const d = new THREE.Vector3(0.4, 0.8, 0.2).normalize();
    const texel = 280 / 2048;
    const p = new THREE.Vector3(10.01, 0, 20.02);
    const a = snapToShadowTexel(p, d);
    // Sub-texel move within the light-space plane (depth-axis motion is not snapped).
    const inPlane = new THREE.Vector3()
      .crossVectors(d, new THREE.Vector3(0, 1, 0))
      .setLength(0.001);
    const b = snapToShadowTexel(p.clone().add(inPlane), d);
    expect(b.distanceTo(a)).toBeLessThan(1e-6);
    expect(a.distanceTo(p)).toBeLessThan(texel * 1.5);
  });
});
