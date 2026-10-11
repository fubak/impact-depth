/**
 * Plan 030 P14: render-only sea gains. Absent or non-finite gains count as 1, so the default
 * sea renders exactly as it did before the gains existed.
 */

function finiteOrOne(gain: number | undefined): number {
  return gain !== undefined && Number.isFinite(gain) ? gain : 1;
}

/** Swell cascade gain for the spectral backend. Identical to the old formula when `swellGain` is absent. */
export function swellCascadeGain(seaState: number, swellGain: number | undefined): number {
  return 0.72 * (0.35 + seaState * 0.65) * finiteOrOne(swellGain);
}

/** Foam uniform for the ocean shader. Identical to the old formula when `whitecapGain` is absent. */
export function foamUniform(
  foamAmount: number,
  whitecapGain: number | undefined,
  foamScale: number,
  spectral: boolean,
): number {
  return foamAmount * finiteOrOne(whitecapGain) * foamScale * (spectral ? 0.22 : 1);
}
