import {
  ISLAND_MESH_RADIUS_FACTOR,
  ISLAND_SPECS,
  sampleIslandHeight,
  sampleSeabedY,
} from '../../core/terrain';
import { DEPTH_TARGET, LAND_LEVEL, METERS_PER_UNIT, WORLD_SIZE } from '../sim/constants';
import { clampSim, depthToMeters, simToWorldMeters, worldMetersToSim } from '../sim/coords';
import type { Point } from '../sim/types';
import {
  emptyWorldMeta,
  metresToNormalizedBed,
  type NavigationProfile,
  type WorldDefinition,
  worldCacheKey,
} from './definition';

/** 1 m canonical grid across the 640 m sector. */
export const LITTORAL_SPACING_M = 1;
export const LITTORAL_GRID = Math.round((WORLD_SIZE * METERS_PER_UNIT) / LITTORAL_SPACING_M);
export const CHANNEL_MAX_WATER_M = 28;
export const PLAYER_RADIUS_SIM = 0.35;
export const KEEL_CLEARANCE_M = 1.6;
export const SURFACE_SHIP_DRAFT_M = 1;
export const ENEMY_SUB_CRUISE_DEPTH = 0.35;
export const SNAP_MAX_RADIUS_SIM = WORLD_SIZE;

const ATTACK_WATER_M = depthToMeters(DEPTH_TARGET.attack) + KEEL_CLEARANCE_M;
const DEEP_WATER_M = depthToMeters(DEPTH_TARGET.deep) + KEEL_CLEARANCE_M;
const FOB_SIM = { x: WORLD_SIZE * 0.08, y: WORLD_SIZE * 0.08 };
const FOB_M = simToWorldMeters(FOB_SIM.x, FOB_SIM.y);
const START_M = { x: 0, z: 0 };

const cache = new Map<string, WorldDefinition>();
let sharedBed: Float32Array | null = null;
let sharedNormalized: number[] | null = null;

/** Combined visual signed bed: islands over seabed. Dry footprints are this field at ≥ 0. */
export function sampleSignedTerrainMetres(wx: number, wz: number): number {
  let height = sampleSeabedY(wx, wz);
  for (const island of ISLAND_SPECS) {
    const lx = wx - island.cx;
    const lz = wz - island.cz;
    const lim = island.radius * ISLAND_MESH_RADIUS_FACTOR;
    if (lx * lx + lz * lz > lim * lim) continue;
    height = Math.max(height, sampleIslandHeight(lx, lz, island));
  }
  return height;
}

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const ab2 = abx * abx + abz * abz;
  if (ab2 < 1e-8) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

/** Corridor water targets in metres. Never applied to dry cells. */
export function corridorMinWaterMetres(wx: number, wz: number): number {
  let target = 0;
  const startR = Math.hypot(wx - START_M.x, wz - START_M.z);
  if (startR <= 64) target = Math.max(target, DEEP_WATER_M + 0.4);
  if (Math.hypot(wx - FOB_M.x, wz - FOB_M.z) <= 40) target = Math.max(target, ATTACK_WATER_M + 0.8);
  if (distToSegment(wx, wz, START_M.x, START_M.z, FOB_M.x, FOB_M.z) <= 36) {
    target = Math.max(target, ATTACK_WATER_M + 0.8);
  }
  if (startR >= 130 && startR <= 270) target = Math.max(target, ATTACK_WATER_M + 0.8);
  return target;
}

export function applyChannelDeepening(original: number, wx: number, wz: number): number {
  if (original >= 0) return original;
  const target = corridorMinWaterMetres(wx, wz);
  if (target <= 0) return original;
  return Math.max(-CHANNEL_MAX_WATER_M, Math.min(original, -target));
}

function gridWorldCoord(index: number, origin: number, spacing: number, grid: number): number {
  const clamped = Math.max(0, Math.min(grid - 1, index));
  return origin + (clamped + 0.5) * spacing;
}

function buildCanonicalBed(): { metres: Float32Array; normalized: number[] } {
  const grid = LITTORAL_GRID;
  const origin = -((WORLD_SIZE * METERS_PER_UNIT) / 2);
  const metres = new Float32Array(grid * grid);
  for (let z = 0; z < grid; z++) {
    const wz = gridWorldCoord(z, origin, LITTORAL_SPACING_M, grid);
    for (let x = 0; x < grid; x++) {
      const wx = gridWorldCoord(x, origin, LITTORAL_SPACING_M, grid);
      metres[z * grid + x] = applyChannelDeepening(sampleSignedTerrainMetres(wx, wz), wx, wz);
    }
  }
  const normalized = new Array<number>(WORLD_SIZE * WORLD_SIZE);
  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const world = simToWorldMeters(x + 0.5, y + 0.5);
      normalized[y * WORLD_SIZE + x] = metresToNormalizedBed(
        sampleBedMetresFromGrid(metres, world.x, world.z),
      );
    }
  }
  return { metres, normalized };
}

function sampleBedMetresFromGrid(metres: Float32Array, wx: number, wz: number): number {
  const grid = LITTORAL_GRID;
  const origin = -((WORLD_SIZE * METERS_PER_UNIT) / 2);
  const extent = grid * LITTORAL_SPACING_M;
  const fx = ((wx - origin) / extent) * grid - 0.5;
  const fz = ((wz - origin) / extent) * grid - 0.5;
  const x0 = Math.max(0, Math.min(grid - 1, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(grid - 1, Math.floor(fz)));
  const x1 = Math.max(0, Math.min(grid - 1, x0 + 1));
  const z1 = Math.max(0, Math.min(grid - 1, z0 + 1));
  const tx = fx - Math.floor(fx);
  const tz = fz - Math.floor(fz);
  const a = metres[z0 * grid + x0]!;
  const b = metres[z0 * grid + x1]!;
  const c = metres[z1 * grid + x0]!;
  const d = metres[z1 * grid + x1]!;
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

function sharedField(): { metres: Float32Array; normalized: number[] } {
  if (sharedBed && sharedNormalized) return { metres: sharedBed, normalized: sharedNormalized };
  const built = buildCanonicalBed();
  sharedBed = built.metres;
  sharedNormalized = built.normalized;
  return built;
}

export function createLittoralWorld(seed: number, size = WORLD_SIZE): WorldDefinition {
  const key = worldCacheKey('littoral-v2', seed, size);
  const cached = cache.get(key);
  if (cached) return cached;
  const field = sharedField();
  const origin = -((size * METERS_PER_UNIT) / 2);
  const world: WorldDefinition = {
    ...emptyWorldMeta('littoral-v2', seed, size),
    seaLevelNormalized: LAND_LEVEL,
    bedNormalized: field.normalized,
    bedMetres: field.metres,
    bedGridSize: LITTORAL_GRID,
    bedSpacingMetres: LITTORAL_SPACING_M,
    bedOriginMetres: origin,
  };
  cache.set(key, world);
  return world;
}

export function sampleLittoralBedMetres(world: WorldDefinition, wx: number, wz: number): number {
  const metres = world.bedMetres;
  if (!metres) return sampleSignedTerrainMetres(wx, wz);
  return sampleBedMetresFromGrid(metres, wx, wz);
}

export function sampleLittoralBedSim(world: WorldDefinition, simX: number, simY: number): number {
  const worldPos = simToWorldMeters(simX, simY);
  return sampleLittoralBedMetres(world, worldPos.x, worldPos.z);
}

export function littoralWaterDepthSim(world: WorldDefinition, simX: number, simY: number): number {
  return Math.max(0, -sampleLittoralBedSim(world, simX, simY));
}

export function littoralIsLand(world: WorldDefinition, simX: number, simY: number): boolean {
  return sampleLittoralBedSim(world, simX, simY) >= 0;
}

export function playerNavProfile(depthNormalized: number): NavigationProfile {
  return {
    radiusSim: PLAYER_RADIUS_SIM,
    requiredWaterMetres: depthToMeters(depthNormalized) + KEEL_CLEARANCE_M,
  };
}

export function surfaceShipNavProfile(radiusSim: number): NavigationProfile {
  return { radiusSim, requiredWaterMetres: SURFACE_SHIP_DRAFT_M };
}

export function enemySubNavProfile(): NavigationProfile {
  return playerNavProfile(ENEMY_SUB_CRUISE_DEPTH);
}

export function maxBedInSimBox(
  world: WorldDefinition,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const metres = world.bedMetres;
  if (!metres || world.bedGridSize == null || world.bedOriginMetres == null) {
    return sampleLittoralBedSim(world, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  const a = simToWorldMeters(Math.min(x0, x1), Math.min(y0, y1));
  const b = simToWorldMeters(Math.max(x0, x1), Math.max(y0, y1));
  const grid = world.bedGridSize;
  const origin = world.bedOriginMetres;
  const spacing = world.bedSpacingMetres ?? LITTORAL_SPACING_M;
  const toIndex = (value: number) =>
    Math.max(0, Math.min(grid - 1, Math.floor((value - origin) / spacing)));
  const ix0 = toIndex(a.x);
  const ix1 = toIndex(b.x);
  const iz0 = toIndex(a.z);
  const iz1 = toIndex(b.z);
  let maxBed = -Infinity;
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const sample = metres[iz * grid + ix]!;
      if (sample > maxBed) maxBed = sample;
    }
  }
  return maxBed;
}

function inPlayableBounds(x: number, y: number): boolean {
  return x >= 1 && y >= 1 && x < WORLD_SIZE - 1 && y < WORLD_SIZE - 1;
}

export function isNavigable(
  world: WorldDefinition,
  x: number,
  y: number,
  profile: NavigationProfile,
): boolean {
  if (!inPlayableBounds(x, y)) return false;
  const maxBed = maxBedInSimBox(
    world,
    x - profile.radiusSim,
    y - profile.radiusSim,
    x + profile.radiusSim,
    y + profile.radiusSim,
  );
  if (maxBed >= 0) return false;
  return -maxBed >= profile.requiredWaterMetres;
}

export function snapWorld(
  world: WorldDefinition,
  x: number,
  y: number,
  profile: NavigationProfile,
): Point {
  const cx = clampSim(x);
  const cy = clampSim(y);
  if (isNavigable(world, cx, cy, profile)) return { x: cx, y: cy };
  for (let radius = 1; radius <= SNAP_MAX_RADIUS_SIM; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const px = clampSim(cx + dx);
        const py = clampSim(cy + dy);
        if (isNavigable(world, px, py, profile)) return { x: px, y: py };
      }
    }
  }
  throw new Error(`snapWorld: no cell within ${SNAP_MAX_RADIUS_SIM} (seed=${world.seed})`);
}

export function segmentNavigable(
  world: WorldDefinition,
  start: Point,
  goal: Point,
  profile: NavigationProfile,
  step = 0.35,
): boolean {
  const distance = Math.hypot(goal.x - start.x, goal.y - start.y);
  const samples = Math.max(1, Math.ceil(distance / step));
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const x = start.x + (goal.x - start.x) * t;
    const y = start.y + (goal.y - start.y) * t;
    if (!isNavigable(world, x, y, profile)) return false;
  }
  return true;
}

export function missionStartSim(seed: number): Point {
  return { x: WORLD_SIZE / 2 - 6 + (seed % 7), y: WORLD_SIZE / 2 };
}

export function missionBaseSim(): Point {
  return { x: FOB_SIM.x, y: FOB_SIM.y };
}

export function missionConvoyApproachSim(seed: number): Point {
  return {
    x: WORLD_SIZE / 2 + 9 + ((seed >>> 3) % 9),
    y: WORLD_SIZE / 2 + ((seed >>> 6) % 7),
  };
}

export function worldMetersFromSim(point: Point): { x: number; z: number } {
  return simToWorldMeters(point.x, point.y);
}

export function simFromWorldMetres(x: number, z: number): Point {
  return worldMetersToSim(x, z);
}

/**
 * Renderer hull-floor clamp in `src/render/scene.ts` is left in place this pass.
 * CPU v2 collision is authoritative when `worldVersion === 'littoral-v2'`;
 * default missions remain legacy-v1 and still need the visual clamp.
 */
export const RENDERER_HULL_CLAMP_REMAINS = true;
