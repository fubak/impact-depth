import { LAND_LEVEL, WORLD_SIZE } from './constants';
import { clampDepth, clampSim } from './coords';
import type { Point } from './types';

export interface Terrain {
  seed: number;
  size: number;
  heights: readonly number[];
}

function hash(seed: number, x: number, y: number): number {
  let n = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function smooth(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const fade = (v: number) => v * v * (3 - 2 * v);
  const a = hash(seed, ix, iy);
  const b = hash(seed, ix + 1, iy);
  const c = hash(seed, ix, iy + 1);
  const d = hash(seed, ix + 1, iy + 1);
  const top = a + (b - a) * fade(tx);
  const bottom = c + (d - c) * fade(tx);
  return top + (bottom - top) * fade(ty);
}

/** Deterministic, allocation-free-at-runtime 96×96 seabed heightfield. */
const terrainCache = new Map<number, Terrain>();

export function createTerrain(seed: number, size = WORLD_SIZE): Terrain {
  const key = (seed >>> 0) ^ (size << 20);
  const cached = terrainCache.get(key);
  if (cached) return cached;
  const heights = new Array<number>(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coast = Math.min(x, y, size - 1 - x, size - 1 - y) / (size * 0.15);
      const continentalShelf = Math.max(0, 1 - coast) * 0.38;
      const fbm =
        smooth(seed, x, y, 28) * 0.48 +
        smooth(seed + 101, x, y, 11) * 0.28 +
        smooth(seed + 202, x, y, 4) * 0.12;
      heights[y * size + x] = Math.min(1, Math.max(0, 0.08 + fbm + continentalShelf));
    }
  }
  const terrain = { seed: seed >>> 0, size, heights };
  terrainCache.set(key, terrain);
  return terrain;
}

export function getTerrain(seed: number): Terrain {
  return createTerrain(seed);
}

export function terrainHeight(terrain: Terrain, x: number, y: number): number {
  const ix = Math.max(0, Math.min(terrain.size - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(terrain.size - 1, Math.floor(y)));
  return terrain.heights[iy * terrain.size + ix]!;
}

export function isLand(terrain: Terrain, x: number, y: number): boolean {
  return terrainHeight(terrain, x, y) >= LAND_LEVEL;
}

export function snapToNavigable(terrain: Terrain, x: number, y: number, depth = 0.5): Point {
  const cx = clampSim(x);
  const cy = clampSim(y);
  if (!isLand(terrain, cx, cy)) return { x: cx, y: cy };
  for (let radius = 1; radius < terrain.size; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const px = clampSim(cx + dx);
        const py = clampSim(cy + dy);
        if (!isLand(terrain, px, py) && depth <= 1) return { x: px, y: py };
      }
    }
  }
  return { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
}

export function isCrushedBySeamount(
  terrain: Terrain,
  x: number,
  y: number,
  depth: number,
): boolean {
  return depth > clampDepth(1 - terrainHeight(terrain, x, y) + 0.08);
}
