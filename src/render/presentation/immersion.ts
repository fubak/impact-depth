/**
 * Camera / fog immersion from a sampled water height.
 *
 * Hysteresis stops single-pixel waterline flicker. Callers must not force the
 * eye above crests to hide missing underwater work — keep every POV usable.
 */

export const IMMERSION_HYSTERESIS = 0.12;
/** Mean-sea fallback when no probe has arrived yet. */
export const MEAN_SEA_HEIGHT = 0;

export interface ImmersionState {
  readonly underwater: boolean;
  readonly waterHeight: number;
  readonly eyeRelative: number;
}

export interface ImmersionInput {
  readonly eyeY: number;
  /** Latest sampled surface height, or `null` to use mean sea. */
  readonly sampledWaterHeight: number | null;
  readonly previousUnderwater: boolean;
  readonly hysteresis?: number;
}

export function resolveWaterHeight(sampledWaterHeight: number | null): number {
  return sampledWaterHeight === null || !Number.isFinite(sampledWaterHeight)
    ? MEAN_SEA_HEIGHT
    : sampledWaterHeight;
}

/**
 * Enter water below `water - band`, leave above `water + band`.
 * Does not clamp the camera itself.
 */
export function isUnderwaterWithHysteresis(
  eyeY: number,
  waterHeight: number,
  previouslyUnder: boolean,
  hysteresis = IMMERSION_HYSTERESIS,
): boolean {
  const band = Math.max(0, hysteresis);
  return previouslyUnder ? eyeY < waterHeight + band : eyeY < waterHeight - band;
}

export function updateImmersion(input: ImmersionInput): ImmersionState {
  const waterHeight = resolveWaterHeight(input.sampledWaterHeight);
  const underwater = isUnderwaterWithHysteresis(
    input.eyeY,
    waterHeight,
    input.previousUnderwater,
    input.hysteresis ?? IMMERSION_HYSTERESIS,
  );
  return {
    underwater,
    waterHeight,
    eyeRelative: input.eyeY - waterHeight,
  };
}

/**
 * Fog / background blend 0 (dry) … 1 (deep). Uses the hysteresis bit so a
 * bobbing periscope does not strobe the underwater grade.
 */
export function immersionFogFactor(eyeY: number, waterHeight: number, underwater: boolean): number {
  if (!underwater) return 0;
  const depth = Math.max(0, waterHeight - eyeY);
  return clamp01((depth + IMMERSION_HYSTERESIS) / 12);
}

/** Chase orbit is ~26 m. The player hull skips exponential fog inside this radius. */
export const PLAYER_HULL_FOG_EXEMPT_M = 30;
/** Metres over which the exemption hands back to scene fog. */
export const PLAYER_HULL_FOG_FADE_M = 8;

/**
 * Player boat while the eye is under the surface. Periscope keeps its own
 * transparency ghost; contacts never use this path.
 */
export function playerUnderwaterSubject(
  underwater: boolean,
  depthMetres: number,
  peri: boolean,
): boolean {
  return underwater && depthMetres > 0.5 && !peri;
}

/**
 * 0 = no fog on the player hull, 1 = full scene fog. Above water the weight
 * stays 1 so the surface grade is unchanged at the same distance.
 */
export function playerHullFogWeight(distanceMetres: number, underwater: boolean): number {
  if (!underwater || !Number.isFinite(distanceMetres)) return 1;
  if (distanceMetres <= PLAYER_HULL_FOG_EXEMPT_M) return 0;
  return clamp01((distanceMetres - PLAYER_HULL_FOG_EXEMPT_M) / PLAYER_HULL_FOG_FADE_M);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
