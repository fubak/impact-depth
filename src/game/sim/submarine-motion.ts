import { clampDepth } from './coords';

/** Sim-depth units per second. ~1.9 m/s at 24 m per unit — fleet-boat dive, not a snap. */
export const SUB_DEPTH_RATE = 0.08;
/** Extra pitch (rad) per unit of depth error. Bow down when diving (z increases). */
export const SUB_DIVE_PITCH_GAIN = 1.65;
export const SUB_DIVE_PITCH_MAX = 0.3;

export function integrateSubmarineDepth(
  z: number,
  targetDepth: number,
  dt: number,
  rate = SUB_DEPTH_RATE,
): number {
  const maxStep = Math.max(0, rate) * Math.max(0, dt);
  const error = targetDepth - z;
  const step = Math.max(-maxStep, Math.min(maxStep, error));
  return clampDepth(z + step);
}

/** Bow-down positive while ordered deeper than current. */
export function submarineDivePitch(
  z: number,
  targetDepth: number,
  max = SUB_DIVE_PITCH_MAX,
  gain = SUB_DIVE_PITCH_GAIN,
): number {
  const error = targetDepth - z;
  return Math.max(-max, Math.min(max, error * gain));
}
