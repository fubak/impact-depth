export type SkyLightingSource = 'hdr-pmrem' | 'procedural-sky-pmrem';

/** The staged HDR is a high-sun sky; below this elevation it would mislight golden hour. */
export const HDR_MIN_SUN_ELEVATION_DEG = 24;

export function pickSkyLightingSource(opts: {
  hdrReady: boolean;
  hdrFailed: boolean;
  isNight: boolean;
  /** Degrees. Omitted = legacy behaviour (day always uses the HDR). */
  sunElevation?: number;
}): SkyLightingSource {
  if (opts.hdrFailed || !opts.hdrReady) return 'procedural-sky-pmrem';
  // Night keeps procedural PMREM so the noon HDR does not light a night patrol.
  if (opts.isNight) return 'procedural-sky-pmrem';
  // Golden hour: the noon HDR would paint blue-white IBL over a warm key.
  if (opts.sunElevation !== undefined && opts.sunElevation < HDR_MIN_SUN_ELEVATION_DEG) {
    return 'procedural-sky-pmrem';
  }
  return 'hdr-pmrem';
}
