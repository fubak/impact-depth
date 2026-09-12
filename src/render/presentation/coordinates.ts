import { depthToMeters, simToWorldMeters } from '../../game/sim/coords';

export { depthToMeters, simToWorldMeters };

/** Mean-sea splash / wake film. Distinct from submerged entity Y. */
export const SURFACE_SPLASH_Y = 0.08;

export function metersToEntityY(depthMeters: number): number {
  return -depthMeters;
}

/** Underwater entity Y from sim depth (positive down, 24 m per unit). */
export function entityDepthY(simDepth: number): number {
  return metersToEntityY(depthToMeters(simDepth));
}
