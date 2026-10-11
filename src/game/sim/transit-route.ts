import { WORLD_CENTER } from './constants';
import type { Point } from './types';

/**
 * Merchant convoys and capital ships do not circle: they steam long straight
 * legs between two ends of a lane that crosses the sector, then swing round
 * (the existing steering gives a wide turn) and come back. Pure and
 * deterministic: seed, wave and slot only.
 */

/** Both lane ends sit on this circle around the map centre, sim units. */
export const LANE_END_RADIUS = 54;
/** Closest the lane passes the map centre (where the patrol starts). */
export const LANE_OFFSET_MIN = 20;
export const LANE_OFFSET_SPAN = 10;
/** The convoy lead starts this far along the lane so its column fits inside the map. */
export const COLUMN_LEAD = 34;

export interface TransitLane {
  readonly a: Point;
  readonly b: Point;
  /** Heading from `a` toward `b`. */
  readonly heading: number;
}

/** Slot 0 is the convoy lane; the battleship (slot 1) takes the opposite side, and each wave flips sides. */
export function transitLane(seed: number, wave: number, slot: number): TransitLane {
  const bearing = (((seed * 17 + wave * 29 + slot * 137) % 360) * Math.PI) / 180;
  const offset = LANE_OFFSET_MIN + ((seed * 7 + wave * 13 + slot * 5) % LANE_OFFSET_SPAN);
  const side = (wave + slot) % 2 === 1 ? 1 : -1;
  const dx = Math.cos(bearing);
  const dy = Math.sin(bearing);
  const half = Math.sqrt(LANE_END_RADIUS ** 2 - offset ** 2);
  const cx = WORLD_CENTER - dy * offset * side;
  const cy = WORLD_CENTER + dx * offset * side;
  return {
    a: { x: cx - dx * half, y: cy - dy * half },
    b: { x: cx + dx * half, y: cy + dy * half },
    heading: bearing,
  };
}

/** The point `distance` along the lane from end `a`. */
export function laneEntry(lane: TransitLane, distance: number): Point {
  return {
    x: lane.a.x + Math.cos(lane.heading) * distance,
    y: lane.a.y + Math.sin(lane.heading) * distance,
  };
}

/** Roving escorts and boats sweep long out-and-back legs, not circles. */
export const ROVE_RADIUS = 40;
const ROVE_SPAN = (110 * Math.PI) / 180;

export function roveLegs(seed: number, wave: number, index: number): readonly Point[] {
  const bearing = (((seed * 17 + wave * 29 + index * 137) % 360) * Math.PI) / 180;
  return [bearing, bearing + ROVE_SPAN].map((angle) => ({
    x: WORLD_CENTER + Math.cos(angle) * ROVE_RADIUS,
    y: WORLD_CENTER + Math.sin(angle) * ROVE_RADIUS,
  }));
}
