/**
 * Light grade: how weather and night change the light the renderer shows. Pure data and pure
 * factor functions, no Three.js. The atmosphere and sky code read a LightGrade and apply it to
 * their own lights and colours. A clear day (and clear dawn or dusk) returns IDENTITY_GRADE, so
 * default play looks exactly as it did before.
 */
import { DEFAULT_ENVIRONMENT, type Environment } from '../../game/sim/environment';

export interface LightGrade {
  /** Minimum HemisphereLight intensity. */
  readonly ambientFloor: number;
  /** Added to the AmbientLight intensity. */
  readonly ambientAdd: number;
  /** Minimum moon DirectionalLight intensity at night. */
  readonly moonIntensity: number;
  /** Rim light intensity from the moon side at night. */
  readonly moonRim: number;
  /** 0..1 strength of moonlight used as the ocean key light at night. */
  readonly moonGlint: number;
  /** Linear RGB floor for skyTop, skyHorizon and fogColor at night. */
  readonly skyFloor: readonly [number, number, number];
  /** 0..1 pull toward luminance grey (sky, horizon, fog; sun at half). */
  readonly desaturate: number;
  /** Multiplies AtmosphereState.golden (flattens overcast sunsets). */
  readonly goldenScale: number;
  /** Minimum scene.environmentIntensity at night. */
  readonly envIntensityFloor: number;
}

export const IDENTITY_GRADE: LightGrade = Object.freeze({
  ambientFloor: 0,
  ambientAdd: 0,
  moonIntensity: 0,
  moonRim: 0,
  moonGlint: 0,
  skyFloor: [0, 0, 0] as const,
  desaturate: 0,
  goldenScale: 1,
  envIntensityFloor: 0,
});

export const NIGHT_AMBIENT_FLOOR = 0.42;
export const NIGHT_STORM_FLOOR_ADD = 0.06;
export const NIGHT_AMBIENT_ADD = 0.08;
export const NIGHT_MOON = 0.55;
export const NIGHT_MOON_CLOUD_CUT = 0.25;
export const NIGHT_RIM = 0.4;
export const NIGHT_RIM_CLOUD_CUT = 0.18;
export const NIGHT_GLINT_CLOUD_CUT = 0.6;
export const NIGHT_ENV_FLOOR = 0.4;
export const OVERCAST_AMBIENT_ADD = 0.1;
export const DESAT_PER_CLOUD = 0.7;
export const DESAT_PER_FOG = 0.6;
export const DESAT_MAX = 0.85;
export const GOLDEN_CUT_PER_CLOUD = 0.85;
export const GOLDEN_CUT_PER_FOG = 0.7;
export const GOLDEN_MIN = 0.1;

export const NIGHT_SKY_FLOOR: readonly [number, number, number] = [0.03, 0.045, 0.075];

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Clamps to 0..1 and maps NaN to 0. */
const unit = (value: number): number => (Number.isNaN(value) ? 0 : clamp(value, 0, 1));

/**
 * Cloud cover above the clear-day reference, 0..1:
 * clamp((cloud - DEFAULT_ENVIRONMENT.cloud) / (1 - DEFAULT_ENVIRONMENT.cloud), 0, 1). NaN gives 0.
 */
export function cloudExcess(cloud: number): number {
  if (Number.isNaN(cloud)) return 0;
  const reference = DEFAULT_ENVIRONMENT.cloud;
  return clamp((cloud - reference) / (1 - reference), 0, 1);
}

export function lightGradeFor(env: Environment): LightGrade {
  const o = cloudExcess(env.cloud);
  const f = unit(env.fog);
  const night = env.timeOfDay === 'night';
  if (!night && o === 0 && f === 0) return IDENTITY_GRADE;

  const desaturate = Math.min(DESAT_MAX, Math.max(DESAT_PER_CLOUD * o, DESAT_PER_FOG * f));
  const goldenScale = clamp(
    1 - Math.max(GOLDEN_CUT_PER_CLOUD * o, GOLDEN_CUT_PER_FOG * f),
    GOLDEN_MIN,
    1,
  );
  const ambientAdd = (night ? NIGHT_AMBIENT_ADD : 0) + OVERCAST_AMBIENT_ADD * o;

  if (!night) {
    return { ...IDENTITY_GRADE, desaturate, goldenScale, ambientAdd };
  }

  return {
    ambientFloor: NIGHT_AMBIENT_FLOOR + NIGHT_STORM_FLOOR_ADD * o,
    ambientAdd,
    moonIntensity: NIGHT_MOON - NIGHT_MOON_CLOUD_CUT * o,
    moonRim: NIGHT_RIM - NIGHT_RIM_CLOUD_CUT * o,
    moonGlint: 1 - NIGHT_GLINT_CLOUD_CUT * o,
    skyFloor: NIGHT_SKY_FLOOR,
    desaturate,
    goldenScale,
    envIntensityFloor: NIGHT_ENV_FLOOR,
  };
}
