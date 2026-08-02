import { MAX_DEPTH, METERS_PER_UNIT, WORLD_SIZE } from './constants';

export function simToWorldMeters(x: number, y: number): { x: number; z: number } {
  return { x: (x - WORLD_SIZE / 2) * METERS_PER_UNIT, z: (y - WORLD_SIZE / 2) * METERS_PER_UNIT };
}
export function worldMetersToSim(x: number, z: number): { x: number; y: number } {
  return { x: x / METERS_PER_UNIT + WORLD_SIZE / 2, y: z / METERS_PER_UNIT + WORLD_SIZE / 2 };
}
export function depthToMeters(z: number): number { return z * 55; }
export function metersToDepth(meters: number): number { return meters / 55; }
export function clampSim(value: number): number { return Math.max(0, Math.min(WORLD_SIZE - Number.EPSILON, value)); }
export function clampDepth(value: number): number { return Math.max(0, Math.min(MAX_DEPTH, value)); }
