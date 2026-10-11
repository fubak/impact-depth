import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { AtmosphereSettings } from '../../src/core/types';
import { environmentFor } from '../../src/game/sim/environment';
import { Atmosphere, evaluateAtmosphere } from '../../src/render/atmosphere';
import {
  applyGradeLights,
  gradeAtmosphereState,
  oceanKeyLight,
} from '../../src/render/environment/atmosphere-grade';
import {
  IDENTITY_GRADE,
  lightGradeFor,
  NIGHT_SKY_FLOOR,
} from '../../src/render/environment/light-grade';
import { presentationFor } from '../../src/render/environment/weather-model';

const night = {
  timeOfDay: 0,
  sunElevation: -10,
  sunAzimuth: 120,
  fogDensity: 0.001,
  sunIntensity: 1,
} as unknown as AtmosphereSettings;

const dayBase = DEFAULT_SETTINGS.atmosphere;

function lightReadout(a: Atmosphere, scene: THREE.Scene) {
  return {
    hemi: a.hemi.intensity,
    ambient: a.ambient.intensity,
    moon: a.moon.intensity,
    rim: a.rim.intensity,
    rimPos: a.rim.position.toArray(),
    env: scene.environmentIntensity,
  };
}

function saturationOf(color: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl.s;
}

describe('atmosphere grade', () => {
  it('identity: no grade, undefined and IDENTITY_GRADE light the scene the same', () => {
    for (const settings of [night, dayBase]) {
      const sceneA = new THREE.Scene();
      const sceneB = new THREE.Scene();
      const sceneC = new THREE.Scene();
      const a = new Atmosphere();
      const b = new Atmosphere();
      const c = new Atmosphere();
      a.apply(settings, sceneA, 0);
      b.apply(settings, sceneB, 0, { grade: undefined });
      c.apply(settings, sceneC, 0, { grade: IDENTITY_GRADE });
      const expected = lightReadout(a, sceneA);
      expect(lightReadout(b, sceneB)).toEqual(expected);
      expect(lightReadout(c, sceneC)).toEqual(expected);
    }
  });

  it('identity: gradeAtmosphereState returns the same state object', () => {
    const s = evaluateAtmosphere(night);
    expect(gradeAtmosphereState(s, undefined)).toBe(s);
    expect(gradeAtmosphereState(s, IDENTITY_GRADE)).toBe(s);
  });

  it('night grade floors the ambient and adds a moon rim from above', () => {
    const grade = lightGradeFor(environmentFor('clear', 'night'));
    const scene = new THREE.Scene();
    const a = new Atmosphere();
    a.apply(night, scene, 0, { grade });
    expect(a.hemi.intensity).toBeGreaterThanOrEqual(0.42);
    expect(a.moon.intensity).toBeGreaterThanOrEqual(0.55);
    expect(a.rim.intensity).toBeCloseTo(0.4, 5);
    expect(a.rim.position.y).toBeGreaterThan(6);
    expect(scene.environmentIntensity).toBeGreaterThanOrEqual(0.4);

    const plain = new Atmosphere();
    plain.apply(night, new THREE.Scene(), 0);
    expect(plain.rim.intensity).toBe(0);
  });

  it('grading desaturates overcast dusk, cuts golden and leaves the input unchanged', () => {
    const env = environmentFor('overcast', 'dusk');
    const s0 = evaluateAtmosphere(presentationFor(env, DEFAULT_SETTINGS).settings.atmosphere);
    const horizonBefore = s0.skyHorizon.clone();
    const goldenBefore = s0.golden;
    const s1 = gradeAtmosphereState(s0, lightGradeFor(env));
    expect(s1.golden).toBeLessThan(s0.golden * 0.3);
    expect(saturationOf(s1.skyHorizon)).toBeLessThan(saturationOf(s0.skyHorizon));
    expect(s0.skyHorizon.equals(horizonBefore)).toBe(true);
    expect(s0.golden).toBe(goldenBefore);
  });

  it('night sky floor: sky and fog channels never drop below the floor', () => {
    const env = environmentFor('storm', 'night');
    const s0 = evaluateAtmosphere(presentationFor(env, DEFAULT_SETTINGS).settings.atmosphere);
    const s1 = gradeAtmosphereState(s0, lightGradeFor(env));
    for (const color of [s1.skyTop, s1.skyHorizon, s1.fogColor]) {
      expect(color.r).toBeGreaterThanOrEqual(NIGHT_SKY_FLOOR[0]);
      expect(color.g).toBeGreaterThanOrEqual(NIGHT_SKY_FLOOR[1]);
      expect(color.b).toBeGreaterThanOrEqual(NIGHT_SKY_FLOOR[2]);
    }
  });

  it('applyGradeLights leaves the day lights alone when the grade has no night terms', () => {
    const grade = lightGradeFor(environmentFor('overcast', 'day'));
    const a = new Atmosphere();
    const scene = new THREE.Scene();
    a.apply(dayBase, scene, 0);
    const moonBefore = a.moon.intensity;
    const rimBefore = a.rim.intensity;
    applyGradeLights(
      { hemi: a.hemi, ambient: a.ambient, moon: a.moon, rim: a.rim },
      evaluateAtmosphere(dayBase),
      grade,
      scene,
    );
    expect(a.moon.intensity).toBe(moonBefore);
    expect(a.rim.intensity).toBe(rimBefore);
  });

  it('oceanKeyLight uses the moon only at night with glint', () => {
    const grade = lightGradeFor(environmentFor('clear', 'night'));
    const nightState = evaluateAtmosphere(night);
    const key = oceanKeyLight(nightState, grade);
    expect(key.dir.y).toBeGreaterThan(0);
    expect(key.color.b).toBeCloseTo(0.55, 2);

    const day = evaluateAtmosphere(dayBase);
    const sun = oceanKeyLight(day, grade);
    expect(sun.dir).toEqual({ x: day.sunDir.x, y: day.sunDir.y, z: day.sunDir.z });
    expect(sun.color).toEqual({ r: day.sunColor.r, g: day.sunColor.g, b: day.sunColor.b });
    expect(oceanKeyLight(nightState, undefined).dir).toEqual({
      x: nightState.sunDir.x,
      y: nightState.sunDir.y,
      z: nightState.sunDir.z,
    });
  });
});
