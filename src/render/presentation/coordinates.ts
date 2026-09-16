import { depthToMeters, simToWorldMeters } from '../../game/sim/coords';

export { depthToMeters, simToWorldMeters };

/** Mean-sea splash / wake film. Distinct from submerged entity Y. */
export const SURFACE_SPLASH_Y = 0.08;

/** Fitted LA / Akula height when AABB has not been measured yet. */
export const DEFAULT_SUB_HULL_HEIGHT_M = 2.2;
/** Sim surface/peri stay in this band; attack/deep use true −depth. */
export const VISUAL_SURFACE_DEPTH_M = 2.5;
export const VISUAL_PERI_DEPTH_M = 9;
/** How much of the toy hull sits above mean sea on the surface order. */
export const VISUAL_SURFACE_ABOVE_FRACTION = 0.55;
/** Sail/deck clearance above mean sea on the periscope order. */
export const VISUAL_PERI_SAIL_M = 1.15;

export function metersToEntityY(depthMeters: number): number {
  return -depthMeters;
}

/** Underwater entity Y from sim depth (positive down, 24 m per unit). */
export function entityDepthY(simDepth: number): number {
  return metersToEntityY(depthToMeters(simDepth));
}

/**
 * Keel Y so a short fitted hull still reads on the water at surface/peri.
 * Attack and deep keep true −depth (the ocean shader must punch the lid).
 */
/**
 * Fallback when a hull-body mesh is missing. Kept low so superstructure
 * stays above the sheet (0.42 of AABB buried decks).
 */
export const SURFACE_DRAFT_FRACTION = 0.14;

/** Keep a surface hull between the sheet and its draft, then above the bed. */
export function clampSurfaceHullY(y: number, waterY: number, draft: number, bedY: number): number {
  const water = Number.isFinite(waterY) ? waterY : 0;
  const d = Math.max(0.15, Number.isFinite(draft) ? draft : 0.4);
  let next = Number.isFinite(y) ? y : water - d;
  next = Math.min(water + 0.08, next);
  next = Math.max(water - d, next);
  const floor = Number.isFinite(bedY) ? bedY + 0.45 : Number.NEGATIVE_INFINITY;
  return Math.max(next, floor);
}

export function surfaceDraftMetres(hullHeightMetres = DEFAULT_SUB_HULL_HEIGHT_M): number {
  const height = Math.max(
    1.5,
    Number.isFinite(hullHeightMetres) ? hullHeightMetres : DEFAULT_SUB_HULL_HEIGHT_M,
  );
  return height * SURFACE_DRAFT_FRACTION;
}

export function visualKeelY(
  depthMetres: number,
  hullHeightMetres = DEFAULT_SUB_HULL_HEIGHT_M,
): number {
  const height = Math.max(
    1.5,
    Number.isFinite(hullHeightMetres) ? hullHeightMetres : DEFAULT_SUB_HULL_HEIGHT_M,
  );
  const depth = Math.max(0, Number.isFinite(depthMetres) ? depthMetres : 0);
  if (depth <= VISUAL_SURFACE_DEPTH_M) {
    const below = Math.min(depth, height * (1 - VISUAL_SURFACE_ABOVE_FRACTION));
    return -below;
  }
  if (depth < VISUAL_PERI_DEPTH_M) {
    return VISUAL_PERI_SAIL_M - height;
  }
  return -depth;
}
