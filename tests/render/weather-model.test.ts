import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PRESETS, presentationDayPhase } from '../../src/core/settings';
import {
  seaStateFromWind,
  significantWaveHeight,
  whitecapCoverage,
} from '../../src/core/sea-model';
import type { LookDevSettings, PresetId } from '../../src/core/types';
import {
  DEFAULT_ENVIRONMENT,
  TIME_OF_DAY_IDS,
  WEATHER_KINDS,
  environmentFor,
  type Environment,
  type WeatherKind,
} from '../../src/game/sim/environment';
import { evaluateAtmosphere } from '../../src/render/atmosphere';
import {
  INACTIVE_WEATHER_FX,
  choppinessFromSeaState,
  cloudCoverageFor,
  createPresentationMemo,
  foamFromWind,
  isDefaultEnvironment,
  presentationFor,
  waveHeightFromHs,
} from '../../src/render/environment/weather-model';

const WINDS = [3, 6, 10, 15, 20];
const withWind = (windMs: number): Environment => ({ ...DEFAULT_ENVIRONMENT, windMs });
const presented = (weather: WeatherKind, time: 'dawn' | 'day' | 'dusk' | 'night' = 'day') =>
  presentationFor(environmentFor(weather, time), DEFAULT_SETTINGS);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe('identity at the default environment (A3 render side)', () => {
  it('returns the base settings object for every shipped preset', () => {
    for (const id of Object.keys(PRESETS) as PresetId[]) {
      const base = PRESETS[id];
      const result = presentationFor(DEFAULT_ENVIRONMENT, base);
      expect(result.settings).toBe(base);
      expect(result.fx).toBe(INACTIVE_WEATHER_FX);
      expect(result.fx.active).toBe(false);
    }
  });

  it('treats an equal-by-value default environment as the default', () => {
    const copy: Environment = { ...DEFAULT_ENVIRONMENT };
    expect(isDefaultEnvironment(copy)).toBe(true);
    expect(presentationFor(copy, DEFAULT_SETTINGS).settings).toBe(DEFAULT_SETTINGS);
    expect(isDefaultEnvironment(environmentFor('clear', 'night'))).toBe(false);
    expect(isDefaultEnvironment(environmentFor('storm', 'day'))).toBe(false);
  });

  it('keeps the sunset-passage clock and drift behaviour untouched by default', () => {
    const sunset = PRESETS['sunset-passage'];
    const result = presentationFor(DEFAULT_ENVIRONMENT, sunset);
    expect(result.settings.atmosphere.timeOfDay).toBe(0.74);
    expect(result.settings.atmosphere.dayLengthSeconds).toBe(0);
  });

  it('never mutates its input, even for a rough environment', () => {
    const base = deepFreeze(structuredClone(DEFAULT_SETTINGS));
    const result = presentationFor(environmentFor('storm', 'night'), base);
    expect(result.settings).not.toBe(base);
    expect(base.ocean.seaState).toBe(DEFAULT_SETTINGS.ocean.seaState);
    expect(base.atmosphere.timeOfDay).toBe(DEFAULT_SETTINGS.atmosphere.timeOfDay);
  });

  it('memoizes by reference so a steady frame allocates nothing', () => {
    const memo = createPresentationMemo();
    const env = environmentFor('rain', 'dusk');
    const first = memo(env, DEFAULT_SETTINGS);
    expect(memo(env, DEFAULT_SETTINGS)).toBe(first);
    const next: LookDevSettings = { ...DEFAULT_SETTINGS };
    expect(memo(env, next)).not.toBe(first);
    expect(memo(environmentFor('storm', 'dusk'), next).fx.lightning).toBe(1);
  });
});

describe('ocean parameters follow the physical sea model (A13)', () => {
  it('derives seaState from wind with the shared sea-model function', () => {
    for (const wind of WINDS) {
      expect(presentationFor(withWind(wind), DEFAULT_SETTINGS).settings.ocean.seaState).toBe(
        seaStateFromWind(wind),
      );
    }
  });

  it('derives waveHeight from significant wave height and foam from whitecap coverage', () => {
    for (const wind of WINDS) {
      const ocean = presentationFor(withWind(wind), DEFAULT_SETTINGS).settings.ocean;
      expect(ocean.waveHeight).toBe(waveHeightFromHs(significantWaveHeight(wind)));
      expect(ocean.foamAmount).toBe(foamFromWind(wind));
      expect(ocean.choppiness).toBe(choppinessFromSeaState(seaStateFromWind(wind)));
    }
    expect(foamFromWind(10)).toBeGreaterThan(foamFromWind(0));
    expect(whitecapCoverage(20)).toBeGreaterThan(whitecapCoverage(10));
  });

  it('is strictly monotone with wind for every wave parameter', () => {
    const oceans = WINDS.map((w) => presentationFor(withWind(w), DEFAULT_SETTINGS).settings.ocean);
    for (let i = 1; i < oceans.length; i++) {
      const lo = oceans[i - 1]!;
      const hi = oceans[i]!;
      expect(hi.seaState).toBeGreaterThan(lo.seaState);
      expect(hi.waveHeight).toBeGreaterThan(lo.waveHeight);
      expect(hi.choppiness).toBeGreaterThan(lo.choppiness);
      expect(hi.foamAmount).toBeGreaterThan(lo.foamAmount);
    }
  });

  it('stays inside the ranges the renderer and look-dev panel accept', () => {
    for (const wind of [0, 1, 30, 60, Number.NaN]) {
      const ocean = presentationFor(withWind(wind), DEFAULT_SETTINGS).settings.ocean;
      expect(ocean.seaState).toBeGreaterThanOrEqual(0);
      expect(ocean.seaState).toBeLessThanOrEqual(1);
      expect(ocean.waveHeight).toBeGreaterThanOrEqual(0.15);
      expect(ocean.waveHeight).toBeLessThanOrEqual(1.8);
      expect(ocean.choppiness).toBeGreaterThanOrEqual(0.1);
      expect(ocean.choppiness).toBeLessThanOrEqual(1.2);
      expect(ocean.foamAmount).toBeGreaterThanOrEqual(0);
      expect(ocean.foamAmount).toBeLessThanOrEqual(1);
      expect(Number.isFinite(ocean.waveHeight)).toBe(true);
    }
  });

  it('does not depend on a per-preset magic number: the base preset only supplies colour', () => {
    const env = environmentFor('storm', 'day');
    const a = presentationFor(env, PRESETS['caribbean-noon']).settings.ocean;
    const b = presentationFor(env, PRESETS['sunset-passage']).settings.ocean;
    expect(a.seaState).toBe(b.seaState);
    expect(a.waveHeight).toBe(b.waveHeight);
    expect(a.choppiness).toBe(b.choppiness);
    expect(a.foamAmount).toBe(b.foamAmount);
    expect(b.deepColor).toBe(PRESETS['sunset-passage'].ocean.deepColor);
    expect(b.clarity).toBe(PRESETS['sunset-passage'].ocean.clarity);
  });

  it('makes a storm rougher than a clear day on every axis', () => {
    const clear = presented('clear').settings.ocean;
    const storm = presented('storm').settings.ocean;
    expect(storm.seaState).toBeGreaterThan(clear.seaState);
    expect(storm.waveHeight).toBeGreaterThan(clear.waveHeight);
    expect(storm.choppiness).toBeGreaterThan(clear.choppiness);
    expect(storm.foamAmount).toBeGreaterThan(clear.foamAmount);
    expect(storm.seaState).toBeGreaterThanOrEqual(0.6);
  });

  it('keeps the weather kinds ordered by wind: fog calm < overcast < rain < storm', () => {
    const sea = (w: WeatherKind) => presented(w).settings.ocean.seaState;
    expect(sea('fog')).toBeLessThan(sea('overcast'));
    expect(sea('overcast')).toBeLessThan(sea('rain'));
    expect(sea('rain')).toBeLessThan(sea('storm'));
  });
});

describe('time of day maps onto the engine clock and holds', () => {
  const at = (time: 'dawn' | 'day' | 'dusk' | 'night') =>
    presentationFor(environmentFor('clear', time), DEFAULT_SETTINGS).settings.atmosphere;

  it('puts the sun below the horizon only at night', () => {
    const night = evaluateAtmosphere(at('night'));
    const dawn = evaluateAtmosphere(at('dawn'));
    const day = evaluateAtmosphere(at('day'));
    const dusk = evaluateAtmosphere(at('dusk'));
    expect(night.isNight).toBe(true);
    expect(night.sunElevation).toBeLessThan(0);
    for (const state of [dawn, day, dusk]) expect(state.isNight).toBe(false);
  });

  it('dawn and dusk are low golden-hour suns, day is high, and they differ in time and side', () => {
    const dawn = at('dawn');
    const dusk = at('dusk');
    const dawnState = evaluateAtmosphere(dawn);
    const duskState = evaluateAtmosphere(dusk);
    const dayState = evaluateAtmosphere(at('day'));
    for (const state of [dawnState, duskState]) {
      expect(state.sunElevation).toBeGreaterThan(0);
      expect(state.sunElevation).toBeLessThan(14);
      expect(state.golden).toBeGreaterThan(0.5);
    }
    expect(dayState.sunElevation).toBeGreaterThan(35);
    expect(dawn.timeOfDay).toBeLessThan(0.5);
    expect(dusk.timeOfDay).toBeGreaterThan(0.5);
    expect(dusk.sunAzimuth).not.toBe(dawn.sunAzimuth);
  });

  it('holds a chosen time: dayLengthSeconds is 0 so the phase never drifts', () => {
    for (const time of TIME_OF_DAY_IDS) {
      // Partly cloudy keeps 'day' off the default-environment identity path.
      const atmosphere = presentationFor(environmentFor('partly-cloudy', time), DEFAULT_SETTINGS)
        .settings.atmosphere;
      expect(atmosphere.dayLengthSeconds).toBe(0);
      expect(presentationDayPhase(atmosphere, 0)).toBe(presentationDayPhase(atmosphere, 5000));
    }
  });

  it('day with weather keeps a bright noon sky when the base preset is a sunset', () => {
    const sunset = presentationFor(environmentFor('rain', 'day'), PRESETS['sunset-passage']);
    expect(evaluateAtmosphere(sunset.settings.atmosphere).sunElevation).toBeGreaterThan(35);
  });

  it('day keeps the base sun for a daylight preset', () => {
    const noon = presentationFor(environmentFor('overcast', 'day'), DEFAULT_SETTINGS).settings;
    expect(noon.atmosphere.timeOfDay).toBe(DEFAULT_SETTINGS.atmosphere.timeOfDay);
    expect(noon.atmosphere.sunElevation).toBe(DEFAULT_SETTINGS.atmosphere.sunElevation);
  });
});

describe('rain, fog, cloud and lightning follow the weather kind (A14)', () => {
  it('rains only in rain and storm, storm hardest', () => {
    for (const kind of WEATHER_KINDS) {
      const { fx } = presented(kind);
      if (kind === 'rain' || kind === 'storm') expect(fx.rain).toBeGreaterThan(0);
      else expect(fx.rain).toBe(0);
    }
    expect(presented('storm').fx.rain).toBeGreaterThan(presented('rain').fx.rain);
  });

  it('flashes lightning only in a storm', () => {
    for (const kind of WEATHER_KINDS) {
      const { fx } = presented(kind);
      expect(fx.lightning).toBe(kind === 'storm' ? 1 : 0);
    }
  });

  it('orders cloud cover clear < partly cloudy < overcast', () => {
    const cloud = (w: WeatherKind) => presented(w).fx.cloudCover;
    expect(cloud('clear')).toBeLessThan(cloud('partly-cloudy'));
    expect(cloud('partly-cloudy')).toBeLessThan(cloud('overcast'));
    expect(cloudCoverageFor(cloud('clear'))).toBeLessThan(cloudCoverageFor(cloud('overcast')));
    for (const kind of WEATHER_KINDS) {
      const coverage = cloudCoverageFor(cloud(kind));
      expect(coverage).toBeGreaterThanOrEqual(0);
      expect(coverage).toBeLessThanOrEqual(1);
    }
  });

  it('fog weather is the thickest haze and clear air adds none', () => {
    const density = (w: WeatherKind) => presented(w).settings.atmosphere.fogDensity;
    const base = DEFAULT_SETTINGS.atmosphere.fogDensity;
    expect(density('clear')).toBe(base);
    expect(density('fog')).toBeGreaterThan(density('storm'));
    expect(density('storm')).toBeGreaterThan(density('rain'));
    expect(density('rain')).toBeGreaterThan(density('overcast'));
    expect(presented('fog').fx.visibilityFog).toBeGreaterThan(presented('storm').fx.visibilityFog);
    expect(presented('clear').fx.visibilityFog).toBe(0);
  });

  it('dims the sun and exposure as cloud, rain and fog build', () => {
    const sun = (w: WeatherKind) => presented(w).settings.atmosphere.sunIntensity;
    const exposure = (w: WeatherKind) => presented(w).settings.atmosphere.exposure;
    expect(sun('clear')).toBe(DEFAULT_SETTINGS.atmosphere.sunIntensity);
    expect(exposure('clear')).toBe(DEFAULT_SETTINGS.atmosphere.exposure);
    expect(sun('partly-cloudy')).toBeLessThan(sun('clear'));
    expect(sun('overcast')).toBeLessThan(sun('partly-cloudy'));
    expect(sun('rain')).toBeLessThan(sun('overcast'));
    expect(sun('storm')).toBeLessThanOrEqual(sun('rain'));
    expect(sun('storm')).toBeGreaterThan(0);
    expect(exposure('storm')).toBeLessThan(exposure('clear'));
    expect(exposure('storm')).toBeGreaterThan(DEFAULT_SETTINGS.atmosphere.exposure * 0.6);
  });

  it('marks every non-default environment as an active presentation', () => {
    expect(presented('clear', 'night').fx.active).toBe(true);
    expect(presented('storm').fx.active).toBe(true);
  });
});
