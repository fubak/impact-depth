/**
 * Weather and light as sim truth. Pure data + pure factor functions: the
 * renderer reads `Environment` to dress the scene, the sim multiplies its
 * detection ranges, ship speed and ordnance scatter by these factors.
 *
 * Contract: DEFAULT_ENVIRONMENT (clear day, light breeze) yields exactly 1
 * from every factor, so default play is bit-for-bit what it was before.
 * Factors depend only on the Environment, never on RNG or wall-clock.
 */
import { seaStateFromWind } from '../../core/sea-model';

export type WeatherKind = 'clear' | 'partly-cloudy' | 'overcast' | 'rain' | 'storm' | 'fog';
export type TimeOfDayId = 'dawn' | 'day' | 'dusk' | 'night';

export const WEATHER_KINDS: readonly WeatherKind[] = [
  'clear',
  'partly-cloudy',
  'overcast',
  'rain',
  'storm',
  'fog',
];
export const TIME_OF_DAY_IDS: readonly TimeOfDayId[] = ['dawn', 'day', 'dusk', 'night'];

export interface Environment {
  readonly weather: WeatherKind;
  readonly timeOfDay: TimeOfDayId;
  /** 10 m wind speed, m/s. Drives sea state through core/sea-model. */
  readonly windMs: number;
  /** Rain intensity 0..1. */
  readonly rain: number;
  /** Fog thickness 0..1. */
  readonly fog: number;
  /** Cloud cover 0..1. */
  readonly cloud: number;
}

interface WeatherProfile {
  readonly windMs: number;
  readonly rain: number;
  readonly fog: number;
  readonly cloud: number;
}

const WEATHER_PROFILES: Readonly<Record<WeatherKind, WeatherProfile>> = {
  clear: { windMs: 4, rain: 0, fog: 0, cloud: 0.1 },
  'partly-cloudy': { windMs: 5.5, rain: 0, fog: 0, cloud: 0.5 },
  overcast: { windMs: 7, rain: 0, fog: 0, cloud: 0.9 },
  rain: { windMs: 9, rain: 0.7, fog: 0.15, cloud: 0.85 },
  storm: { windMs: 19, rain: 1, fog: 0.25, cloud: 1 },
  fog: { windMs: 3, rain: 0, fog: 0.8, cloud: 0.6 },
};

/** Wind of the default sector sea; every factor is 1 here and never rises above 1. */
export const REFERENCE_WIND_MS = WEATHER_PROFILES.clear.windMs;

export function environmentFor(weather: WeatherKind, timeOfDay: TimeOfDayId): Environment {
  return { weather, timeOfDay, ...WEATHER_PROFILES[weather] };
}

export const DEFAULT_ENVIRONMENT: Environment = environmentFor('clear', 'day');

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** How much rougher than the default sector sea this is, 0 (default or calmer) .. 1 (Beaufort 9+). */
function roughness(env: Environment): number {
  const reference = seaStateFromWind(REFERENCE_WIND_MS);
  return clamp((seaStateFromWind(env.windMs) - reference) / (1 - reference), 0, 1);
}

/** Ambient noise rises with wind and rain, so every hydrophone hears less far. 0.45..1. */
export function sonarRangeFactor(env: Environment): number {
  return clamp(1 - 0.45 * roughness(env) - 0.12 * clamp(env.rain, 0, 1), 0.45, 1);
}

const LIGHT_VISIBILITY: Readonly<Record<TimeOfDayId, number>> = {
  dawn: 0.7,
  day: 1,
  dusk: 0.7,
  night: 0.35,
};

/** Sighting range of a raised scope, snorkel or surfaced hull. Light, fog and rain. 0.15..1. */
export function visualRangeFactor(env: Environment): number {
  const fog = 1 - 0.7 * clamp(env.fog, 0, 1);
  const rain = 1 - 0.3 * clamp(env.rain, 0, 1);
  return clamp(LIGHT_VISIBILITY[env.timeOfDay] * fog * rain, 0.15, 1);
}

/** Heavy seas cost every surface ship speed. 0.6..1 (storm ~0.78). */
export function shipSpeedFactor(env: Environment): number {
  return clamp(1 - 0.24 * roughness(env), 0.6, 1);
}

/** Ships pitch and roll: ordnance patterns land wider in rough seas. 1.. (storm ~2.1). */
export function patternScatter(env: Environment): number {
  return 1 + 1.2 * roughness(env);
}
