import { LAND_LEVEL, WORLD_SIZE } from '../sim/constants';
import { createTerrain, isLand, terrainHeight, type Terrain } from '../sim/world';
import { emptyWorldMeta, type WorldDefinition, worldCacheKey } from './definition';

const cache = new Map<string, WorldDefinition>();

/** Wrap existing gameplay terrain. Queries remain bit-identical to `createTerrain`. */
export function createLegacyWorld(seed: number, size = WORLD_SIZE): WorldDefinition {
  const key = worldCacheKey('legacy-v1', seed, size);
  const cached = cache.get(key);
  if (cached) return cached;
  const terrain = createTerrain(seed, size);
  const world: WorldDefinition = {
    ...emptyWorldMeta('legacy-v1', seed, size),
    bedNormalized: terrain.heights,
  };
  cache.set(key, world);
  return world;
}

export function legacyTerrain(world: WorldDefinition): Terrain {
  return { seed: world.seed, size: world.size, heights: world.bedNormalized };
}

export function legacyHeight(world: WorldDefinition, x: number, y: number): number {
  return terrainHeight(legacyTerrain(world), x, y);
}

export function legacyIsLand(world: WorldDefinition, x: number, y: number): boolean {
  return isLand(legacyTerrain(world), x, y);
}

export function legacyLandMask(world: WorldDefinition): number[] {
  const mask = new Array<number>(world.size * world.size);
  for (let y = 0; y < world.size; y++) {
    for (let x = 0; x < world.size; x++) {
      mask[y * world.size + x] = legacyHeight(world, x + 0.5, y + 0.5) >= LAND_LEVEL ? 1 : 0;
    }
  }
  return mask;
}
