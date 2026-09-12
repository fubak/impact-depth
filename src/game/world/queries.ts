import { createLegacyWorld, legacyHeight, legacyIsLand } from './legacy';
import { createLittoralWorld, littoralIsLand, sampleLittoralBedSim } from './littoral';
import { metresToNormalizedBed, type WorldDefinition, type WorldVersion } from './definition';

export function getWorld(version: WorldVersion, seed: number, size?: number): WorldDefinition {
  if (version === 'littoral-v2') return createLittoralWorld(seed, size);
  return createLegacyWorld(seed, size);
}

export function worldHeight(world: WorldDefinition, x: number, y: number): number {
  if (world.version === 'littoral-v2') {
    return metresToNormalizedBed(sampleLittoralBedSim(world, x, y));
  }
  return legacyHeight(world, x, y);
}

export function worldIsLand(world: WorldDefinition, x: number, y: number): boolean {
  if (world.version === 'littoral-v2') return littoralIsLand(world, x, y);
  return legacyIsLand(world, x, y);
}
