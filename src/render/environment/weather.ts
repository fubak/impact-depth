import type { AtmosphereSettings, OceanSettings } from '../../core/types';

export type WeatherPresetId = 'calm' | 'breeze' | 'storm';

export interface WeatherGains {
  seaState: number;
  waveHeight: number;
  choppiness: number;
  foamAmount: number;
  fogDensity: number;
  cloudCoverage: number;
  windDetail: number;
}

export interface WeatherSnapshot {
  preset: WeatherPresetId;
  historyTime: number;
  lightning: number;
  gains: WeatherGains;
}

export interface WeatherStepInput {
  dt: number;
  paused: boolean;
  reducedMotion: boolean;
  ocean: OceanSettings;
  atmosphere: AtmosphereSettings;
}

/** Presentation sea conditions. Golden hour stays lighting-only. */
export const WEATHER_PRESETS: Record<
  WeatherPresetId,
  Omit<WeatherGains, 'seaState' | 'waveHeight' | 'choppiness' | 'foamAmount' | 'fogDensity'>
> = {
  calm: { cloudCoverage: 0.32, windDetail: 0.22 },
  breeze: { cloudCoverage: 0.58, windDetail: 0.55 },
  storm: { cloudCoverage: 0.9, windDetail: 1 },
};

export function weatherPresetFromSeaState(seaState: number): WeatherPresetId {
  if (seaState >= 0.6) return 'storm';
  if (seaState <= 0.28) return 'calm';
  return 'breeze';
}

export function presentationOcean(ocean: OceanSettings, preset: WeatherPresetId): OceanSettings {
  const foamScale = preset === 'storm' ? 1.35 : preset === 'calm' ? 0.72 : 1;
  const chopScale = preset === 'storm' ? 1.12 : preset === 'calm' ? 0.85 : 1;
  return {
    ...ocean,
    foamAmount: ocean.foamAmount * foamScale,
    choppiness: ocean.choppiness * chopScale,
  };
}

/** Deterministic storm flashes from presentation history, not gameplay RNG. */
export function sampleLightning(historyTime: number): number {
  const cycle = ((historyTime % 7.4) + 7.4) % 7.4;
  if (cycle >= 6.88 && cycle < 6.98) return 1;
  if (cycle >= 7.06 && cycle < 7.12) return 0.55;
  return 0;
}

export class WeatherController {
  private historyTime = 0;
  private snapshot: WeatherSnapshot | null = null;

  get lastLightning(): number {
    return this.snapshot?.lightning ?? 0;
  }

  get last(): WeatherSnapshot | null {
    return this.snapshot;
  }

  step(input: WeatherStepInput): WeatherSnapshot {
    if (!input.paused) this.historyTime += Math.max(0, input.dt);
    const preset = weatherPresetFromSeaState(input.ocean.seaState);
    const gains: WeatherGains = {
      seaState: input.ocean.seaState,
      waveHeight: input.ocean.waveHeight,
      choppiness: input.ocean.choppiness,
      foamAmount: input.ocean.foamAmount,
      fogDensity:
        input.atmosphere.fogDensity * (preset === 'storm' ? 1.28 : preset === 'calm' ? 0.88 : 1),
      ...WEATHER_PRESETS[preset],
    };
    const lightning =
      input.paused || input.reducedMotion || preset !== 'storm'
        ? 0
        : sampleLightning(this.historyTime);
    this.snapshot = { preset, historyTime: this.historyTime, lightning, gains };
    return this.snapshot;
  }

  reset(): void {
    this.historyTime = 0;
    this.snapshot = null;
  }
}
