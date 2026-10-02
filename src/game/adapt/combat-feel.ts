/**
 * Camera shake derived from detonation events. Shake scales with the munition
 * yield and falls off with the world-metre distance to the camera. Reduced
 * motion passes `shakeScale = 0` and always gets zero.
 */
export function detonationShake(opts: {
  yieldPower: number;
  distanceMeters: number;
  shakeScale: number;
}): number {
  if (opts.shakeScale <= 0) return 0;
  if (!Number.isFinite(opts.distanceMeters)) return 0;
  const yieldNorm = Math.min(1.5, Math.max(0.4, opts.yieldPower / 50));
  const falloff = Math.max(0, 1 - opts.distanceMeters / 384);
  return 0.85 * yieldNorm * falloff * opts.shakeScale;
}
