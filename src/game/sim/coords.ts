import { MAX_DEPTH, METERS_PER_UNIT, WORLD_SIZE } from './constants';

export function simToWorldMeters(x: number, y: number): { x: number; z: number } {
  return { x: (x - WORLD_SIZE / 2) * METERS_PER_UNIT, z: (y - WORLD_SIZE / 2) * METERS_PER_UNIT };
}
export function worldMetersToSim(x: number, z: number): { x: number; y: number } {
  return { x: x / METERS_PER_UNIT + WORLD_SIZE / 2, y: z / METERS_PER_UNIT + WORLD_SIZE / 2 };
}
/**
 * Map sim depth into render meters that fit the playable bathymetry
 * (seabed tops out near −28 m). Deep orders stay below the layer without
 * burying the hull under the floor mesh.
 */
export const METERS_PER_DEPTH = 24;
export function depthToMeters(z: number): number { return z * METERS_PER_DEPTH; }
export function metersToDepth(meters: number): number { return meters / METERS_PER_DEPTH; }
export function clampSim(value: number): number { return Math.max(0, Math.min(WORLD_SIZE - Number.EPSILON, value)); }
export function clampDepth(value: number): number { return Math.max(0, Math.min(MAX_DEPTH, value)); }
