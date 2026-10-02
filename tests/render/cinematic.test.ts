import { describe, expect, it } from 'vitest';
import {
  KELVIN_HALF_ANGLE,
  WAKE_FOAM_DEPTH_LIMIT_M,
  snapWakeOrigin,
  wakeIntensity,
} from '../../src/render/ocean/wake-foam';
import {
  HullDynamics,
  hullTuningForSpan,
  runningAttitude,
} from '../../src/render/presentation/hull-dynamics';
import { pickSkyLightingSource } from '../../src/render/environment/sky-source';
import {
  DEFAULT_SETTINGS,
  PRESETS,
  isPresetId,
  presentationDayPhase,
} from '../../src/core/settings';
import { evaluateAtmosphere } from '../../src/render/atmosphere';
import { postProfileFor } from '../../src/render/post';

describe('cinematic rendering', () => {
  describe('wakeIntensity', () => {
    it('returns 0 below planing threshold (0.3 m/s)', () => {
      expect(wakeIntensity(0.3)).toBe(0);
    });

    it('returns 0 at or beyond depth limit', () => {
      expect(wakeIntensity(5, WAKE_FOAM_DEPTH_LIMIT_M)).toBe(0);
      expect(wakeIntensity(5, WAKE_FOAM_DEPTH_LIMIT_M + 0.1)).toBe(0);
    });

    it('increases monotonically with speed', () => {
      const i1 = wakeIntensity(1);
      const i2 = wakeIntensity(3);
      const i3 = wakeIntensity(8);
      expect(i1).toBeGreaterThan(0);
      expect(i2).toBeGreaterThan(i1);
      expect(i3).toBeGreaterThan(i2);
    });

    it('clamps to 1 at high speed', () => {
      expect(wakeIntensity(20)).toBeLessThanOrEqual(1);
    });

    it('returns 0 for non-finite speed', () => {
      expect(wakeIntensity(Number.NaN)).toBe(0);
      expect(wakeIntensity(Number.POSITIVE_INFINITY)).toBe(0);
      expect(wakeIntensity(Number.NEGATIVE_INFINITY)).toBe(0);
    });
  });

  describe('snapWakeOrigin', () => {
    it('aligns x and z to integer multiples of texel size', () => {
      const extent = 300;
      const resolution = 768;
      const texel = extent / resolution;
      const origin = snapWakeOrigin(123.456, 789.012, extent, resolution);
      expect(origin.x % texel).toBeCloseTo(0, 5);
      expect(origin.z % texel).toBeCloseTo(0, 5);
    });

    it('keeps snapped origin within one texel of (follow - extent/2)', () => {
      const extent = 300;
      const resolution = 512;
      const texel = extent / resolution;
      const followX = 100;
      const followZ = 200;
      const origin = snapWakeOrigin(followX, followZ, extent, resolution);
      const centerOffset = Math.abs(
        origin.x + extent / 2 - followX + (origin.z + extent / 2 - followZ),
      );
      expect(centerOffset).toBeLessThanOrEqual(Math.sqrt(2) * texel);
    });
  });

  describe('KELVIN_HALF_ANGLE', () => {
    it('equals arcsin(1/3), approximately 19.47 degrees', () => {
      const degrees = (KELVIN_HALF_ANGLE * 180) / Math.PI;
      expect(degrees).toBeCloseTo(19.47, 1);
    });
  });

  describe('runningAttitude', () => {
    it('returns near-zero pitch/roll/heave when stationary', () => {
      const attitude = runningAttitude(0, 0, 0, 0);
      expect(Math.abs(attitude.pitch)).toBeLessThan(0.01);
      expect(Math.abs(attitude.roll)).toBeLessThan(0.01);
      expect(Math.abs(attitude.heave)).toBeLessThan(0.01);
    });

    it('increases bow-up pitch and negative heave (squat) with speed', () => {
      const slow = runningAttitude(2, 0, 0, 0);
      const fast = runningAttitude(8, 0, 0, 0);
      expect(fast.pitch).toBeGreaterThan(slow.pitch);
      expect(fast.heave).toBeLessThan(slow.heave);
    });

    it('rolls outward with yaw rate (starboard-down positive)', () => {
      const portTurn = runningAttitude(4, -0.3, 0, 0);
      const starboardTurn = runningAttitude(4, 0.3, 0, 0);
      expect(portTurn.roll).toBeLessThan(0);
      expect(starboardTurn.roll).toBeGreaterThan(0);
    });

    it('eliminates speed effects at depth 5', () => {
      const fast = runningAttitude(8, 0, 0, 5);
      expect(Math.abs(fast.pitch)).toBeLessThan(0.01);
      expect(Math.abs(fast.heave)).toBeLessThan(0.01);
    });
  });

  describe('HullDynamics', () => {
    it('first update returns the target pose', () => {
      const dynamics = new HullDynamics();
      const target = { heave: 0.3, pitch: 0.05, roll: -0.1 };
      const result = dynamics.update({
        entityId: 'test-1',
        dt: 1 / 60,
        target,
        speed: 0,
        heading: 0,
        span: 8,
        depth: 0,
      });
      expect(result.heave).toBeCloseTo(target.heave, 5);
      expect(result.pitch).toBeCloseTo(target.pitch, 5);
      expect(result.roll).toBeCloseTo(target.roll, 5);
    });

    it('converges toward constant target within 0.01 over 600 steps', () => {
      const dynamics = new HullDynamics();
      const target = { heave: 0.3, pitch: 0.05, roll: -0.1 };
      const dt = 1 / 60;
      let pose = dynamics.update({
        entityId: 'test-2',
        dt,
        target,
        speed: 0,
        heading: 0,
        span: 8,
        depth: 0,
      });
      for (let i = 0; i < 600; i++) {
        pose = dynamics.update({
          entityId: 'test-2',
          dt,
          target,
          speed: 0,
          heading: 0,
          span: 8,
          depth: 0,
        });
      }
      expect(Math.abs(pose.heave - target.heave)).toBeLessThan(0.01);
      expect(Math.abs(pose.pitch - target.pitch)).toBeLessThan(0.01);
      expect(Math.abs(pose.roll - target.roll)).toBeLessThan(0.01);
    });

    it('overshoots roll on step change due to underdamping', () => {
      const dynamics = new HullDynamics();
      const dt = 1 / 60;
      let pose = dynamics.update({
        entityId: 'test-3',
        dt,
        target: { heave: 0, pitch: 0, roll: 0 },
        speed: 0,
        heading: 0,
        span: 8,
        depth: 0,
      });
      let maxRoll = 0;
      for (let i = 0; i < 400; i++) {
        pose = dynamics.update({
          entityId: 'test-3',
          dt,
          target: { heave: 0, pitch: 0, roll: -0.2 },
          speed: 0,
          heading: 0,
          span: 8,
          depth: 0,
        });
        maxRoll = Math.min(maxRoll, pose.roll);
      }
      expect(Math.abs(maxRoll)).toBeGreaterThan(0.2);
    });

    it('leaves pose unchanged with dt 0', () => {
      const dynamics = new HullDynamics();
      const dt = 1 / 60;
      let pose = dynamics.update({
        entityId: 'test-4',
        dt,
        target: { heave: 0.2, pitch: 0.05, roll: -0.1 },
        speed: 0,
        heading: 0,
        span: 8,
        depth: 0,
      });
      const before = { ...pose };
      pose = dynamics.update({
        entityId: 'test-4',
        dt: 0,
        target: { heave: 0.5, pitch: 0.3, roll: 0.3 },
        speed: 0,
        heading: 0,
        span: 8,
        depth: 0,
      });
      expect(pose.heave).toBeCloseTo(before.heave, 5);
      expect(pose.pitch).toBeCloseTo(before.pitch, 5);
      expect(pose.roll).toBeCloseTo(before.roll, 5);
    });
  });

  describe('hullTuningForSpan', () => {
    it('roll period exceeds pitch period', () => {
      const tuning = hullTuningForSpan(8);
      expect(tuning.roll.period).toBeGreaterThan(tuning.pitch.period);
    });

    it('larger span increases roll period', () => {
      const small = hullTuningForSpan(4);
      const large = hullTuningForSpan(16);
      expect(large.roll.period).toBeGreaterThan(small.roll.period);
    });
  });

  describe('pickSkyLightingSource', () => {
    it('uses procedural sky when HDR not ready', () => {
      const source = pickSkyLightingSource({
        hdrReady: false,
        hdrFailed: false,
        isNight: false,
        sunElevation: 60,
      });
      expect(source).toBe('procedural-sky-pmrem');
    });

    it('uses procedural sky at low sun elevation', () => {
      const source = pickSkyLightingSource({
        hdrReady: true,
        hdrFailed: false,
        isNight: false,
        sunElevation: 10,
      });
      expect(source).toBe('procedural-sky-pmrem');
    });

    it('uses HDR at high sun elevation when ready', () => {
      const source = pickSkyLightingSource({
        hdrReady: true,
        hdrFailed: false,
        isNight: false,
        sunElevation: 60,
      });
      expect(source).toBe('hdr-pmrem');
    });

    it('defaults to HDR when sunElevation omitted and HDR ready', () => {
      const source = pickSkyLightingSource({
        hdrReady: true,
        hdrFailed: false,
        isNight: false,
      });
      expect(source).toBe('hdr-pmrem');
    });

    it('uses procedural sky at night', () => {
      const source = pickSkyLightingSource({
        hdrReady: true,
        hdrFailed: false,
        isNight: true,
        sunElevation: 60,
      });
      expect(source).toBe('procedural-sky-pmrem');
    });
  });

  describe('presentationDayPhase', () => {
    it('holds timeOfDay constant when dayLengthSeconds is 0', () => {
      const atmosphere = { ...DEFAULT_SETTINGS.atmosphere, dayLengthSeconds: 0 };
      expect(presentationDayPhase(atmosphere, 0)).toBeCloseTo(atmosphere.timeOfDay, 5);
      expect(presentationDayPhase(atmosphere, 100)).toBeCloseTo(atmosphere.timeOfDay, 5);
      expect(presentationDayPhase(atmosphere, 1000)).toBeCloseTo(atmosphere.timeOfDay, 5);
    });

    it('advances 0.5 in [0, 1) over half dayLengthSeconds when undefined (480s default)', () => {
      const atmosphere = { ...DEFAULT_SETTINGS.atmosphere, dayLengthSeconds: undefined };
      const start = presentationDayPhase(atmosphere, 0);
      const half = presentationDayPhase(atmosphere, 240);
      const wrapped = ((half - start + 1) % 1 + 1) % 1;
      expect(wrapped).toBeCloseTo(0.5, 1);
    });
  });

  describe('presets', () => {
    it('sunset-passage is a valid preset', () => {
      expect(isPresetId('sunset-passage')).toBe(true);
    });

    it('sunset-passage evaluates with high golden value and not at night', () => {
      const state = evaluateAtmosphere(PRESETS['sunset-passage'].atmosphere);
      expect(state.golden).toBeGreaterThan(0.6);
      expect(state.isNight).toBe(false);
      expect(state.sunElevation).toBeGreaterThan(2);
      expect(state.sunElevation).toBeLessThan(15);
    });

    it('caribbean-noon has low golden value', () => {
      const state = evaluateAtmosphere(PRESETS['caribbean-noon'].atmosphere);
      expect(state.golden).toBeLessThan(0.2);
    });
  });

  describe('evaluateAtmosphere continuity', () => {
    it('produces smooth sunColor transitions over elevation sweep', () => {
      const base = { ...DEFAULT_SETTINGS.atmosphere, timeOfDay: 0.5, sunAzimuth: 120, sunElevation: 0 };
      let prevColor = evaluateAtmosphere(base).sunColor;
      let maxChange = 0;
      for (let elev = 0.5; elev <= 60; elev += 0.5) {
        const state = evaluateAtmosphere({ ...base, sunElevation: elev });
        const change = Math.max(
          Math.abs(state.sunColor.r - prevColor.r),
          Math.abs(state.sunColor.g - prevColor.g),
          Math.abs(state.sunColor.b - prevColor.b),
        );
        maxChange = Math.max(maxChange, change);
        prevColor = state.sunColor;
      }
      expect(maxChange).toBeLessThan(0.08);
    });
  });

  describe('postProfileFor', () => {
    it('low quality has no bloom', () => {
      const profile = postProfileFor('low');
      expect(profile.bloom).toBe(false);
    });

    it('high quality samples 4x MSAA', () => {
      const profile = postProfileFor('high');
      expect(profile.samples).toBe(4);
    });

    it('software renderer samples 0', () => {
      const profile = postProfileFor('high', true);
      expect(profile.samples).toBe(0);
    });
  });
});
