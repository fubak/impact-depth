import { ESCORT_SCREEN_OFFSET } from './constants';
import { shipMaxSpeed } from './sonar';
import type { GameState, Ship } from './types';

/**
 * An escort on screen duty keeps station: it holds the convoy's course and
 * speed, and uses small speed changes (not circles) to stay in its slot. Pure
 * and deterministic. Returns null when the escort has no live anchor.
 */

/** Cruise fraction of class speed for an unalerted hull (matches the movement rule). */
const CRUISE_FRACTION = 0.62;
/** Inside this slot error the escort simply takes the convoy's heading. */
const STATION_RADIUS = 4;
/** Speed gained or shed per unit of along-track error. */
const CATCH_UP_GAIN = 0.4;

const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export interface ScreenIntent {
  heading: number;
  speedFrac: number;
}

export function screenIntent(ship: Ship, state: GameState): ScreenIntent | null {
  const anchor = ship.formationAnchorId
    ? state.ships.find((other) => other.id === ship.formationAnchorId && !other.sinking)
    : undefined;
  if (!anchor) return null;
  const along = ship.formationAlong ?? 0;
  const lateral =
    (ship.formationLateral ?? 0) +
    Math.sin(state.time * 0.22 + ship.patrolIndex * 1.3) * ESCORT_SCREEN_OFFSET;
  const cos = Math.cos(anchor.heading);
  const sin = Math.sin(anchor.heading);
  const slotX = anchor.x + cos * along - sin * lateral;
  const slotY = anchor.y + sin * along + cos * lateral;
  const dx = slotX - ship.x;
  const dy = slotY - ship.y;
  const distance = Math.hypot(dx, dy);
  const slotHeading = Math.atan2(dy, dx);
  const blend = clamp(distance / STATION_RADIUS, 0, 1);
  const heading = anchor.heading + normalize(slotHeading - anchor.heading) * blend;
  const anchorSpeed = anchor.speed * (anchor.alert > 0.3 ? 1 : CRUISE_FRACTION);
  // Error of the slot ahead of (+) or behind (-) the escort along the convoy course.
  const alongError = dx * cos + dy * sin;
  const speed = clamp(anchorSpeed + alongError * CATCH_UP_GAIN, 0.2 * anchorSpeed, shipMaxSpeed[ship.kind]);
  return { heading, speedFrac: speed / shipMaxSpeed[ship.kind] };
}
