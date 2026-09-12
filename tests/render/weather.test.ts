import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import {
  WeatherController,
  presentationOcean,
  sampleLightning,
  weatherPresetFromSeaState,
} from '../../src/render/environment/weather';

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
});
