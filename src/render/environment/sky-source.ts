export type SkyLightingSource = 'hdr-pmrem' | 'procedural-sky-pmrem';

export function pickSkyLightingSource(opts: {
  hdrReady: boolean;
  hdrFailed: boolean;
  isNight: boolean;
}): SkyLightingSource {
  if (opts.hdrFailed || !opts.hdrReady) return 'procedural-sky-pmrem';
  // Night keeps procedural PMREM so the noon HDR does not light a night patrol.
  if (opts.isNight) return 'procedural-sky-pmrem';
  return 'hdr-pmrem';
}
