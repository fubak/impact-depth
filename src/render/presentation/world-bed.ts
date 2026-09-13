import { sampleSeabedY } from '../../core/terrain';
import type { WorldVersion } from '../../game/world/definition';
import { sampleLittoralBedMetres } from '../../game/world/littoral';
import { getWorld } from '../../game/world/queries';

/** Visual keel clearance above the sampled bed. */
export const PRESENTATION_BED_CLEARANCE_M = 0.45;

/** Canonical presentation bed for the active world. Does not write GameState. */
export function presentationBedY(
  version: WorldVersion,
  terrainSeed: number,
  worldX: number,
  worldZ: number,
): number {
  if (version === 'littoral-v2') {
    return sampleLittoralBedMetres(getWorld(version, terrainSeed), worldX, worldZ);
  }
  return sampleSeabedY(worldX, worldZ);
}

export function clampPresentationY(rawY: number, bedY: number): number {
  const floor = Number.isFinite(bedY)
    ? bedY + PRESENTATION_BED_CLEARANCE_M
    : Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(rawY)) {
    return Number.isFinite(floor) ? floor : 0;
  }
  return Math.max(rawY, floor);
}
