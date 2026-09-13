import type { ViewMode } from '../core/types';

/**
 * World-click targeting. Empty water plots a waypoint even when a ship is
 * close in world space. Selection requires an actual hit or screen-proximate
 * contact. Mean-sea-plane picking and HUD gating stay with the caller.
 */

const WATER_PLOT_VIEWS: ReadonlySet<ViewMode> = new Set(['tactical', 'free', 'map']);

/** Left-click water orders are only comprehensible in tactical, free, and map. */
export function canPlotFromView(mode: ViewMode): boolean {
  return WATER_PLOT_VIEWS.has(mode);
}

export type WorldClickDecision =
  | { readonly action: 'select'; readonly id: string }
  | { readonly action: 'plot' };

export interface ScreenContact {
  readonly id: string;
  readonly ndcX: number;
  readonly ndcY: number;
  /** Clip-space w; behind-camera contacts are ignored. */
  readonly clipW?: number;
}

export interface PixelContact {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Pixel radius for a fat-finger / distant-hull screen pick. */
export const SCREEN_PROXIMATE_PX = 28;
/** Tactical-map icon slop. Larger than the 1.4–1.7 SVG radius, not a world ring. */
export const MAP_PROXIMATE_PX = 14;

export function clientToNdc(
  clientX: number,
  clientY: number,
  canvas: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - canvas.left) / Math.max(1, canvas.width)) * 2 - 1,
    y: -(((clientY - canvas.top) / Math.max(1, canvas.height)) * 2 - 1),
  };
}

export function ndcDistancePx(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  width: number,
  height: number,
): number {
  const dx = ((ax - bx) * width) / 2;
  const dy = ((ay - by) * height) / 2;
  return Math.hypot(dx, dy);
}

export function findScreenProximateContact(
  ndcX: number,
  ndcY: number,
  contacts: readonly ScreenContact[],
  width: number,
  height: number,
  radiusPx = SCREEN_PROXIMATE_PX,
): string | null {
  let bestId: string | null = null;
  let best = radiusPx;
  for (const contact of contacts) {
    if (contact.clipW !== undefined && contact.clipW <= 0) continue;
    const dist = ndcDistancePx(ndcX, ndcY, contact.ndcX, contact.ndcY, width, height);
    if (dist <= best) {
      best = dist;
      bestId = contact.id;
    }
  }
  return bestId;
}

export function findPixelProximateContact(
  clickX: number,
  clickY: number,
  contacts: readonly PixelContact[],
  radiusPx = MAP_PROXIMATE_PX,
): string | null {
  let bestId: string | null = null;
  let best = radiusPx;
  for (const contact of contacts) {
    const dist = Math.hypot(contact.x - clickX, contact.y - clickY);
    if (dist <= best) {
      best = dist;
      bestId = contact.id;
    }
  }
  return bestId;
}

/**
 * Select only an actual ray/circle hit or a screen-proximate contact.
 * Nearby-in-world is not a reason to steal an empty-water waypoint plot.
 */
export function resolveWorldClick(
  rayHitId: string | null,
  screenProximateId: string | null,
): WorldClickDecision {
  if (rayHitId) return { action: 'select', id: rayHitId };
  if (screenProximateId) return { action: 'select', id: screenProximateId };
  return { action: 'plot' };
}
