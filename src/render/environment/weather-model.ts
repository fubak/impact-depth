/**
 * Pure mapping from the sim's `Environment` (weather + time of day) to the
 * look-dev settings and effect levels the renderer consumes. No Three.js, no
 * DOM, no clock: numbers in, numbers out.
 *
 * Sea parameters come from the physical model in `core/sea-model` (wind ->
 * significant wave height, whitecap coverage, sea state), never from
 * per-preset magic numbers. Presets keep only what is art direction: colours,
 * clarity, sun azimuth.
 *
 * Contract: an environment equal to DEFAULT_ENVIRONMENT returns the base
 * settings object unchanged, so every shipped look (caribbean noon,
 * sunset-passage, ...) renders exactly as before.
 *
 * Engine time-of-day scale (`evaluateAtmosphere`, core/settings):
 *   elevation = lerp(70 * sin((tod - 0.25) * 2pi), sunElevation, 0.7)
 *   tod 0.25 sunrise, 0.5 noon, 0.75 sunset, 0.0 midnight; night is
 *   `elevation < -1.5 || tod < 0.16 || tod > 0.84`.
 * Because `sunElevation` carries 70% of the sun height, each named time sets
 * both `timeOfDay` and `sunElevation`, plus `dayLengthSeconds: 0` so the
 * chosen time holds instead of drifting through the 480 s legacy cycle.
 */
import { seaStateFromWind, significantWaveHeight, whitecapCoverage } from '../../core/sea-model';
import type { AtmosphereSettings, LookDevSettings, OceanSettings } from '../../core/types';
import {
  DEFAULT_ENVIRONMENT,
  type Environment,
  type TimeOfDayId,
} from '../../game/sim/environment';

/** Effect levels the renderer needs beyond the settings blocks. */
export interface WeatherFx {
  /** False at the default environment: the renderer keeps its legacy presets. */
  readonly active: boolean;
  /** Rain intensity 0..1. */
  readonly rain: number;
  /** Lightning strength 0..1 (storm only); gated by reduced motion in the renderer. */
  readonly lightning: number;
  /** Cloud cover 0..1. Map to the shader with {@link cloudCoverageFor}. */
  readonly cloudCover: number;
  /** Haze that cuts sighting range 0..1 (fog plus a little rain). */
  readonly visibilityFog: number;
}

export interface WeatherPresentation {
  readonly settings: LookDevSettings;
  readonly fx: WeatherFx;
}

export const INACTIVE_WEATHER_FX: WeatherFx = Object.freeze({
  active: false,
  rain: 0,
  lightning: 0,
  cloudCover: DEFAULT_ENVIRONMENT.cloud,
  visibilityFog: 0,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const unit = (value: number) => (Number.isFinite(value) ? clamp(value, 0, 1) : 0);

// --- Sea: wind -> look-dev ocean ------------------------------------------------

/** Look-dev waveHeight is a gain (panel 0.15..1.8): metres of Hs mapped onto it. */
const WAVE_HEIGHT_BASE = 0.4;
const WAVE_HEIGHT_PER_METRE = 0.24;
const WAVE_HEIGHT_MIN = 0.15;
const WAVE_HEIGHT_MAX = 1.8;
/** High chop folds the mesh into plates, so choppiness tops out below the panel max. */
const CHOP_BASE = 0.25;
const CHOP_PER_SEA_STATE = 0.65;
const CHOP_MIN = 0.1;
const CHOP_MAX = 0.9;
/** Foam gain: a stylised floor plus the square root of Monahan whitecap coverage. */
const FOAM_BASE = 0.12;
const FOAM_PER_ROOT_COVERAGE = 1.6;
const FOAM_MAX = 0.9;

export function waveHeightFromHs(hsMetres: number): number {
  const hs = Number.isFinite(hsMetres) ? Math.max(0, hsMetres) : 0;
  return clamp(WAVE_HEIGHT_BASE + WAVE_HEIGHT_PER_METRE * hs, WAVE_HEIGHT_MIN, WAVE_HEIGHT_MAX);
}

export function choppinessFromSeaState(seaState: number): number {
  return clamp(CHOP_BASE + CHOP_PER_SEA_STATE * unit(seaState), CHOP_MIN, CHOP_MAX);
}

export function foamFromWind(windMs: number): number {
  return clamp(
    FOAM_BASE + FOAM_PER_ROOT_COVERAGE * Math.sqrt(whitecapCoverage(windMs)),
    0,
    FOAM_MAX,
  );
}

function oceanFor(windMs: number, base: OceanSettings): OceanSettings {
  const seaState = seaStateFromWind(windMs);
  return {
    ...base,
    seaState,
    waveHeight: waveHeightFromHs(significantWaveHeight(windMs)),
    choppiness: choppinessFromSeaState(seaState),
    foamAmount: foamFromWind(windMs),
  };
}

// --- Cloud, rain, fog: light and haze --------------------------------------------

/** Shader coverage for a cloud-cover fraction; keeps the legacy calm..storm range (0.32..0.9). */
export function cloudCoverageFor(cloudCover: number): number {
  return clamp(0.25 + 0.7 * unit(cloudCover), 0, 1);
}

const FOG_DENSITY_PER_VISIBILITY = 0.0045;
const RAIN_VISIBILITY = 0.25;
const SUN_CLOUD_DIM = 0.55;
const SUN_RAIN_DIM = 0.2;
const SUN_FOG_DIM = 0.25;
const SUN_FLOOR = 0.2;
const EXPOSURE_CLOUD_DIM = 0.1;
const EXPOSURE_RAIN_DIM = 0.06;
const EXPOSURE_FOG_DIM = 0.04;

/** Cloud beyond the clear-day reference, so a clear sky dims nothing. 0..1. */
function cloudExcess(cloud: number): number {
  const reference = DEFAULT_ENVIRONMENT.cloud;
  return clamp((unit(cloud) - reference) / (1 - reference), 0, 1);
}

function fxFor(env: Environment): WeatherFx {
  const rain = unit(env.rain);
  return {
    active: true,
    rain,
    lightning: env.weather === 'storm' ? 1 : 0,
    cloudCover: unit(env.cloud),
    visibilityFog: clamp(unit(env.fog) + RAIN_VISIBILITY * rain, 0, 1),
  };
}

// --- Time of day ------------------------------------------------------------------

interface SkyClock {
  readonly timeOfDay: number;
  readonly sunElevation: number;
  readonly sunAzimuth?: number;
}

/** Engine clock values per named time; see the scale in the file header. */
export const TIME_OF_DAY_CLOCK: Readonly<Record<Exclude<TimeOfDayId, 'day'>, SkyClock>> = {
  dawn: { timeOfDay: 0.27, sunElevation: 5, sunAzimuth: 95 },
  dusk: { timeOfDay: 0.74, sunElevation: 6, sunAzimuth: 250 },
  night: { timeOfDay: 0, sunElevation: -10 },
};

/** Where 'day' lands when the base look is not already a high-sun daylight preset. */
const NOON_CLOCK: SkyClock = { timeOfDay: 0.42, sunElevation: 58 };
const DAYLIGHT_MIN_ELEVATION = 35;

function clockFor(time: TimeOfDayId, base: AtmosphereSettings): SkyClock {
  if (time !== 'day') return TIME_OF_DAY_CLOCK[time];
  return base.sunElevation >= DAYLIGHT_MIN_ELEVATION ? base : NOON_CLOCK;
}

function atmosphereFor(
  env: Environment,
  fx: WeatherFx,
  base: AtmosphereSettings,
): AtmosphereSettings {
  const clock = clockFor(env.timeOfDay, base);
  const cloud = cloudExcess(env.cloud);
  const sunDim = clamp(
    1 - SUN_CLOUD_DIM * cloud - SUN_RAIN_DIM * fx.rain - SUN_FOG_DIM * fx.visibilityFog,
    SUN_FLOOR,
    1,
  );
  const exposureDim = clamp(
    1 -
      EXPOSURE_CLOUD_DIM * cloud -
      EXPOSURE_RAIN_DIM * fx.rain -
      EXPOSURE_FOG_DIM * fx.visibilityFog,
    0.5,
    1,
  );
  return {
    ...base,
    timeOfDay: clock.timeOfDay,
    sunElevation: clock.sunElevation,
    sunAzimuth: clock.sunAzimuth ?? base.sunAzimuth,
    dayLengthSeconds: 0,
    fogDensity: base.fogDensity + FOG_DENSITY_PER_VISIBILITY * fx.visibilityFog,
    sunIntensity: base.sunIntensity * sunDim,
    exposure: base.exposure * exposureDim,
  };
}

// --- Public API -------------------------------------------------------------------

/** True when `env` equals the default clear day by value. */
export function isDefaultEnvironment(env: Environment): boolean {
  return (
    env === DEFAULT_ENVIRONMENT ||
    (env.weather === DEFAULT_ENVIRONMENT.weather &&
      env.timeOfDay === DEFAULT_ENVIRONMENT.timeOfDay &&
      env.windMs === DEFAULT_ENVIRONMENT.windMs &&
      env.rain === DEFAULT_ENVIRONMENT.rain &&
      env.fog === DEFAULT_ENVIRONMENT.fog &&
      env.cloud === DEFAULT_ENVIRONMENT.cloud)
  );
}

/**
 * Settings and effects for the current weather and time. Returns `base`
 * itself at the default environment; otherwise a new settings object (the
 * input is never mutated).
 */
export function presentationFor(env: Environment, base: LookDevSettings): WeatherPresentation {
  if (isDefaultEnvironment(env)) return { settings: base, fx: INACTIVE_WEATHER_FX };
  const fx = fxFor(env);
  return {
    settings: {
      ...base,
      atmosphere: atmosphereFor(env, fx, base.atmosphere),
      ocean: oceanFor(env.windMs, base.ocean),
    },
    fx,
  };
}

/**
 * Per-frame wrapper: the sim hands back the same environment reference until
 * a command changes it, so a steady frame reuses the last result and
 * allocates nothing.
 */
export function createPresentationMemo(): (
  env: Environment,
  base: LookDevSettings,
) => WeatherPresentation {
  let lastEnv: Environment | null = null;
  let lastBase: LookDevSettings | null = null;
  let last: WeatherPresentation | null = null;
  return (env, base) => {
    if (last && env === lastEnv && base === lastBase) return last;
    lastEnv = env;
    lastBase = base;
    last = presentationFor(env, base);
    return last;
  };
}
