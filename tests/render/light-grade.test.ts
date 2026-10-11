import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENVIRONMENT,
  environmentFor,
  type TimeOfDayId,
  type WeatherKind,
} from '../../src/game/sim/environment';
import {
  IDENTITY_GRADE,
  cloudExcess,
  lightGradeFor,
} from '../../src/render/environment/light-grade';

describe('lightGradeFor', () => {
  it('is the identity grade (same reference) for the clear-day default and clear dawn/dusk', () => {
    expect(lightGradeFor(DEFAULT_ENVIRONMENT)).toBe(IDENTITY_GRADE);
    expect(lightGradeFor(environmentFor('clear', 'dawn'))).toBe(IDENTITY_GRADE);
    expect(lightGradeFor(environmentFor('clear', 'dusk'))).toBe(IDENTITY_GRADE);
  });

  it('gives the clear night its moonlit floor', () => {
    const grade = lightGradeFor(environmentFor('clear', 'night'));
    expect(grade.ambientFloor).toBeCloseTo(0.42, 3);
    expect(grade.moonIntensity).toBeCloseTo(0.55, 3);
    expect(grade.moonRim).toBeCloseTo(0.4, 3);
    expect(grade.moonGlint).toBeCloseTo(1, 3);
    expect(grade.desaturate).toBeCloseTo(0, 3);
    expect(grade.goldenScale).toBeCloseTo(1, 3);
    expect(grade.ambientAdd).toBeCloseTo(0.08, 3);
    expect(grade.envIntensityFloor).toBeCloseTo(0.4, 3);
  });

  it('lifts the storm night and keeps every sky floor channel above zero', () => {
    const grade = lightGradeFor(environmentFor('storm', 'night'));
    expect(grade.ambientFloor).toBeCloseTo(0.48, 3);
    expect(grade.moonIntensity).toBeCloseTo(0.3, 3);
    expect(grade.moonRim).toBeCloseTo(0.22, 3);
    expect(grade.moonGlint).toBeCloseTo(0.4, 3);
    expect(grade.desaturate).toBeCloseTo(0.7, 3);
    expect(grade.goldenScale).toBeCloseTo(0.15, 3);
    expect(grade.ambientAdd).toBeCloseTo(0.18, 3);
    for (const channel of grade.skyFloor) {
      expect(channel).toBeGreaterThan(0);
    }
  });

  it('flattens overcast sunsets and kills the rim at dusk', () => {
    const grade = lightGradeFor(environmentFor('overcast', 'dusk'));
    expect(grade.desaturate).toBeCloseTo(0.622, 3);
    expect(grade.desaturate).toBeGreaterThanOrEqual(0.5);
    expect(grade.goldenScale).toBeCloseTo(0.244, 3);
    expect(grade.goldenScale).toBeLessThanOrEqual(0.3);
    expect(grade.moonRim).toBe(0);
  });

  it('desaturates fog by day and cuts the golden tint', () => {
    const grade = lightGradeFor(environmentFor('fog', 'day'));
    expect(grade.desaturate).toBeCloseTo(0.48, 3);
    expect(grade.goldenScale).toBeCloseTo(0.44, 3);
  });

  it('partly cloudy day sits between clear and overcast', () => {
    const grade = lightGradeFor(environmentFor('partly-cloudy', 'day'));
    expect(grade.desaturate).toBeCloseTo(0.311, 3);
    expect(grade.goldenScale).toBeCloseTo(0.622, 3);
  });

  it('is monotone across the day weathers: gold falls and desaturation rises with cloud', () => {
    const day = (weather: WeatherKind) => lightGradeFor(environmentFor(weather, 'day'));
    const clear = day('clear');
    const partly = day('partly-cloudy');
    const overcast = day('overcast');
    const storm = day('storm');
    expect(clear.goldenScale).toBeGreaterThanOrEqual(partly.goldenScale);
    expect(partly.goldenScale).toBeGreaterThanOrEqual(overcast.goldenScale);
    expect(overcast.goldenScale).toBeGreaterThanOrEqual(storm.goldenScale);
    expect(clear.desaturate).toBeLessThanOrEqual(partly.desaturate);
    expect(partly.desaturate).toBeLessThanOrEqual(overcast.desaturate);
    expect(overcast.desaturate).toBeLessThanOrEqual(storm.desaturate);
  });

  it('never returns a non-finite value for any weather and time of day', () => {
    const weathers: WeatherKind[] = ['clear', 'partly-cloudy', 'overcast', 'rain', 'storm', 'fog'];
    const times: TimeOfDayId[] = ['dawn', 'day', 'dusk', 'night'];
    for (const weather of weathers) {
      for (const time of times) {
        const grade = lightGradeFor(environmentFor(weather, time));
        expect(Number.isFinite(grade.ambientFloor)).toBe(true);
        expect(Number.isFinite(grade.goldenScale)).toBe(true);
        expect(grade.desaturate).toBeGreaterThanOrEqual(0);
        expect(grade.desaturate).toBeLessThanOrEqual(0.85);
        expect(grade.goldenScale).toBeGreaterThanOrEqual(0.1);
        expect(grade.goldenScale).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('cloudExcess', () => {
  it('is zero at or below the clear-day cloud reference and one at full cover', () => {
    expect(cloudExcess(0.1)).toBe(0);
    expect(cloudExcess(0)).toBe(0);
    expect(cloudExcess(1)).toBe(1);
  });

  it('maps NaN to zero', () => {
    expect(cloudExcess(Number.NaN)).toBe(0);
  });
});
