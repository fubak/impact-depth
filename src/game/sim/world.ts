import { ISLAND_MESH_RADIUS_FACTOR, ISLAND_SPECS } from '../../core/terrain';
import { LAND_LEVEL, METERS_PER_UNIT, WORLD_SIZE } from './constants';
import { clampDepth, clampSim, worldMetersToSim } from './coords';
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

/** Peak height contributed by decorative island discs so visuals match collision. */
function islandHeight(x: number, y: number): number {
  let peak = 0;
  for (const island of ISLAND_SPECS) {
    const center = worldMetersToSim(island.cx, island.cz);
    const radius = (island.radius * ISLAND_MESH_RADIUS_FACTOR) / METERS_PER_UNIT;
    const distance = Math.hypot(x - center.x, y - center.y);
    if (distance >= radius) continue;
    const t = 1 - distance / radius;
    peak = Math.max(peak, LAND_LEVEL + 0.05 + t * t * 0.22);
  }
  return peak;
}

/** Deterministic seabed heightfield sized to WORLD_SIZE. */
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
      const base = Math.min(1, Math.max(0, 0.08 + fbm + continentalShelf));
      heights[y * size + x] = Math.max(base, islandHeight(x + 0.5, y + 0.5));
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

/** Below this depth fraction the rock can crush the hull; shallower is always safe. */
export const SEAMOUNT_CRUSH_DEPTH = 0.62;

export function isCrushedBySeamount(
  terrain: Terrain,
  x: number,
  y: number,
  depth: number,
): boolean {
  // Require clear encroachment into the rock — attack-depth transit near
  // shallow shelves must not be an instant hull shredder.
  return depth > SEAMOUNT_CRUSH_DEPTH && depth > clampDepth(1 - terrainHeight(terrain, x, y) + 0.2);
}
