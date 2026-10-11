import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import {
  WeatherController,
  presentationOcean,
  sampleLightning,
  stormFoamLife,
  weatherPresetFromSeaState,
} from '../../src/render/environment/weather';
import {
  INACTIVE_WEATHER_FX,
  cloudCoverageFor,
  presentationFor,
} from '../../src/render/environment/weather-model';
import { environmentFor } from '../../src/game/sim/environment';

const ocean = DEFAULT_SETTINGS.ocean;
const atmosphere = DEFAULT_SETTINGS.atmosphere;

describe('presentation weather', () => {
  it('maps sea state onto calm, breeze, and storm without a second sun clock', () => {
    expect(weatherPresetFromSeaState(0.12)).toBe('calm');
    expect(weatherPresetFromSeaState(DEFAULT_SETTINGS.ocean.seaState)).toBe('breeze');
    expect(weatherPresetFromSeaState(0.72)).toBe('storm');
    expect(weatherPresetFromSeaState(DEFAULT_SETTINGS.atmosphere.timeOfDay)).not.toBe('storm');
  });

  it('scales foam/chop in a copied ocean block, leaving look-dev settings untouched', () => {
    const storm = presentationOcean(ocean, 'storm');
    expect(storm.foamAmount).toBeGreaterThan(ocean.foamAmount);
    expect(ocean.foamAmount).toBe(DEFAULT_SETTINGS.ocean.foamAmount);
  });

  it('exposes storm foam life matching presentationOcean foamScale', () => {
    expect(stormFoamLife('storm')).toBe(1.35);
    expect(stormFoamLife('breeze')).toBe(1);
    expect(stormFoamLife('calm')).toBe(0.72);
    expect(presentationOcean(ocean, 'storm').foamAmount).toBe(
      ocean.foamAmount * stormFoamLife('storm'),
    );
    expect(presentationOcean(ocean, 'calm').foamAmount).toBe(
      ocean.foamAmount * stormFoamLife('calm'),
    );
  });

  it('freezes history and lightning on pause', () => {
    const weather = new WeatherController();
    const input = {
      dt: 1 / 60,
      paused: false,
      reducedMotion: false,
      ocean: { ...ocean, seaState: 0.8 },
      atmosphere,
    };
    for (let i = 0; i < 500; i++) weather.step(input);
    const live = weather.step(input);
    const frozen = weather.step({ ...input, dt: 1, paused: true });
    expect(frozen.historyTime).toBe(live.historyTime);
    expect(frozen.lightning).toBe(0);
  });

  it('never emits lightning under reduced motion', () => {
    const weather = new WeatherController();
    const input = {
      dt: 1 / 60,
      paused: false,
      reducedMotion: true,
      ocean: { ...ocean, seaState: 0.85 },
      atmosphere,
    };
    let max = 0;
    for (let i = 0; i < 600; i++) max = Math.max(max, weather.step(input).lightning);
    expect(max).toBe(0);
  });

  it('resets presentation history on restart', () => {
    const weather = new WeatherController();
    weather.step({
      dt: 4,
      paused: false,
      reducedMotion: false,
      ocean: { ...ocean, seaState: 0.8 },
      atmosphere,
    });
    expect(weather.last?.historyTime).toBeGreaterThan(0);
    weather.reset();
    expect(weather.lastLightning).toBe(0);
    expect(weather.last).toBeNull();
  });

  it('samples deterministic storm flashes from history time', () => {
    expect(sampleLightning(6.9)).toBe(1);
    expect(sampleLightning(6.9)).toBe(1);
    expect(sampleLightning(0)).toBe(0);
  });

  describe('sim weather drives the controller (Plan 029 E3)', () => {
    const stepWith = (kind: 'clear' | 'rain' | 'storm', time: 'day' | 'night') => {
      const { settings, fx } = presentationFor(environmentFor(kind, time), DEFAULT_SETTINGS);
      return {
        settings,
        fx,
        input: {
          dt: 1 / 60,
          paused: false,
          reducedMotion: false,
          ocean: settings.ocean,
          atmosphere: settings.atmosphere,
          fx,
        },
      };
    };

    it('leaves the legacy path untouched while the fx are inactive', () => {
      const base = new WeatherController().step({
        dt: 1,
        paused: false,
        reducedMotion: false,
        ocean,
        atmosphere,
      });
      const inactive = new WeatherController().step({
        dt: 1,
        paused: false,
        reducedMotion: false,
        ocean,
        atmosphere,
        fx: INACTIVE_WEATHER_FX,
      });
      expect(inactive).toEqual(base);
    });

    it('takes cloud cover from the weather kind, not the sea-state bucket', () => {
      const rain = stepWith('rain', 'day');
      const snapshot = new WeatherController().step(rain.input);
      expect(snapshot.gains.cloudCoverage).toBe(cloudCoverageFor(rain.fx.cloudCover));
      expect(snapshot.gains.fogDensity).toBe(rain.settings.atmosphere.fogDensity);
    });

    it('flashes lightning in a storm at any hour, never in rain or clear air', () => {
      const flashes = (kind: 'clear' | 'rain' | 'storm', time: 'day' | 'night') => {
        const weather = new WeatherController();
        const { input } = stepWith(kind, time);
        let max = 0;
        for (let i = 0; i < 600; i++) max = Math.max(max, weather.step(input).lightning);
        return max;
      };
      expect(flashes('storm', 'day')).toBe(1);
      expect(flashes('storm', 'night')).toBe(1);
      expect(flashes('rain', 'day')).toBe(0);
      expect(flashes('clear', 'night')).toBe(0);
    });

    it('still gates storm lightning on reduced motion', () => {
      const weather = new WeatherController();
      const { input } = stepWith('storm', 'day');
      let max = 0;
      for (let i = 0; i < 600; i++) {
        max = Math.max(max, weather.step({ ...input, reducedMotion: true }).lightning);
      }
      expect(max).toBe(0);
    });
  });
});
