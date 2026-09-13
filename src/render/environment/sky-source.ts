export type SkyLightingSource = 'hdr-pmrem' | 'procedural-sky-pmrem';

export function pickSkyLightingSource(opts: {
  hdrReady: boolean;
  hdrFailed: boolean;
  isNight: boolean;
  weatherPreset?: 'calm' | 'breeze' | 'storm';
  sunY?: number;
}): SkyLightingSource {
  if (opts.hdrFailed || !opts.hdrReady) return 'procedural-sky-pmrem';
  // Night keeps procedural PMREM so the noon HDR does not light a night patrol.
  if (opts.isNight) return 'procedural-sky-pmrem';
  if (opts.weatherPreset === 'storm') return 'procedural-sky-pmrem';
  // Golden hour / low sun: noon HDR would fight the directional sun color.
  if (opts.sunY !== undefined && opts.sunY < 0.22) return 'procedural-sky-pmrem';
  return 'hdr-pmrem';
}
