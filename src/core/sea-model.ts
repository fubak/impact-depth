/**
 * Pure sea physics shared by the deterministic sim and the renderer.
 * No sim, render, DOM or Three.js imports: numbers in, numbers out.
 *
 * Anchors (see plans/029-naval-realism-weather-pass.md):
 *  - Pierson-Moskowitz fully developed sea: Hs ~ 0.0214 U^2, Tp ~ 0.73 U19.5.
 *  - Monahan whitecap coverage: W ~ 3.84e-6 U^3.41.
 *  - Beaufort wind bands.
 * U is always the 10 m wind speed in metres per second.
 */

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Hs = HS_COEFFICIENT * U^2 for a fully developed sea (metres). */
export const HS_COEFFICIENT = 0.0214;
/** Coastal seas never fully develop; a 128-unit sector shows 60% of ocean-scale heights. */
export const DEFAULT_FETCH_FACTOR = 0.6;
/** Peak period Tp = PEAK_PERIOD_COEFFICIENT * U19.5 (seconds). */
export const PEAK_PERIOD_COEFFICIENT = 0.7303;
/** U19.5 ~ 1.026 * U10. */
export const WIND_19_5_FROM_10 = 1.026;
/** Monahan whitecap law W = WHITECAP_COEFFICIENT * U^WHITECAP_EXPONENT. */
export const WHITECAP_COEFFICIENT = 3.84e-6;
export const WHITECAP_EXPONENT = 3.41;

/** Lower wind edge (m/s) of Beaufort force 0..9; force 9 is "9 and above". */
export const BEAUFORT_LOWER_EDGES: readonly number[] = [
  0, 0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8,
];
export const BEAUFORT_MAX = BEAUFORT_LOWER_EDGES.length - 1;
/** Upper edge of force 9, used for its representative wind (m/s). */
const BEAUFORT_9_UPPER = 24.4;

/** Wind at which the 0..1 sea-state scale saturates (Beaufort 9 lower edge). */
export const SEA_STATE_FULL_WIND = BEAUFORT_LOWER_EDGES[BEAUFORT_MAX]!;
/** Sub-linear so light breezes already read as light-moderate seas (~0.3). */
const SEA_STATE_EXPONENT = 0.75;

const nonNegative = (windMs: number) => (Number.isFinite(windMs) ? Math.max(0, windMs) : 0);

/** Significant wave height of a fully developed sea (metres). */
export function fullyDevelopedHs(windMs: number): number {
  const u = nonNegative(windMs);
  return HS_COEFFICIENT * u * u;
}

/** Significant wave height capped by fetch/duration (metres). */
export function significantWaveHeight(windMs: number, fetchFactor = DEFAULT_FETCH_FACTOR): number {
  return fetchFactor * fullyDevelopedHs(windMs);
}

/** Spectral peak period (seconds). */
export function peakPeriod(windMs: number): number {
  return PEAK_PERIOD_COEFFICIENT * WIND_19_5_FROM_10 * nonNegative(windMs);
}

/** Fraction of the sea surface covered by whitecaps, clamped to 0..1. */
export function whitecapCoverage(windMs: number): number {
  return clamp(WHITECAP_COEFFICIENT * Math.pow(nonNegative(windMs), WHITECAP_EXPONENT), 0, 1);
}

/** Beaufort force 0..9 (anything stronger reads as 9). */
export function beaufortFromWind(windMs: number): number {
  const u = nonNegative(windMs);
  let force = 0;
  for (let i = 1; i < BEAUFORT_LOWER_EDGES.length; i++) {
    if (u >= BEAUFORT_LOWER_EDGES[i]!) force = i;
  }
  return force;
}

/** Representative (mid-band) wind for a Beaufort force; always maps back to the same force. */
export function windFromBeaufort(force: number): number {
  const b = clamp(Math.round(force), 0, BEAUFORT_MAX);
  const lower = BEAUFORT_LOWER_EDGES[b]!;
  const upper = b === BEAUFORT_MAX ? BEAUFORT_9_UPPER : BEAUFORT_LOWER_EDGES[b + 1]!;
  return (lower + upper) / 2;
}

/** Look-dev style sea state: 0 at a dead calm, 1 at Beaufort 9 and above. Monotone. */
export function seaStateFromWind(windMs: number): number {
  return clamp(Math.pow(nonNegative(windMs) / SEA_STATE_FULL_WIND, SEA_STATE_EXPONENT), 0, 1);
}

/** Inverse of {@link seaStateFromWind} (m/s). */
export function windFromSeaState(seaState: number): number {
  return SEA_STATE_FULL_WIND * Math.pow(clamp(seaState, 0, 1), 1 / SEA_STATE_EXPONENT);
}
