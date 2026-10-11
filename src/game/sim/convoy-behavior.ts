/**
 * Merchant convoy behaviour layered over `merchantIntent` (escort-doctrine.ts):
 *
 *  - Zigzag: an alerted convoy's lead hull alternates +/-30 degrees about its
 *    base course every ~40 s of sim time. Followers keep their slots, so the
 *    whole formation snakes with the lead.
 *  - Emergency turn: a torpedo detected inside ~14 u, or a hit on a consort,
 *    swings the hull 45 degrees away from the attack bearing.
 *  - Scatter: after a hit the existing run-away course is spread by ship index
 *    so the merchants fan out instead of stacking on one bearing.
 *
 * Pure and deterministic: ship id and sim time only, never RNG.
 */
import { ALERT_SPREAD_RADIUS } from './constants';
import { PROSECUTE_ALERT, type MerchantIntent } from './escort-doctrine';
import type { ClearFn } from './pathfinding';
import { nearestTorpedoThreat } from './torpedo-threat';
import type { GameState, Ship } from './types';

export const ZIGZAG_ANGLE = Math.PI / 6;
export const ZIGZAG_LEG = 40;
export const EMERGENCY_TURN = Math.PI / 4;
/** A torpedo is heard / sighted this far out. */
export const MERCHANT_TORPEDO_RANGE = 14;
/** Seconds the emergency course is held after a torpedo / after a consort is hit. */
export const EMERGENCY_HOLD_TORPEDO = 10;
export const EMERGENCY_HOLD_HIT = 6;
/** Bearing spread between successive merchants when the convoy scatters (rad). */
export const SCATTER_SPREAD = 0.6;
/** A torpedo counts as aimed at the hull when its track passes this close. */
const TRACK_HALF_WIDTH = 5;
/** Land probe ahead of a candidate emergency course. */
const LAND_PROBE = 5;

const CONVOY_KINDS: ReadonlySet<Ship['kind']> = new Set([
  'merchant',
  'destroyer',
  'patrol',
  'cruiser',
  'battleship',
]);

const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Stable small integer from a ship id. */
function idHash(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash + id.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

/** Signed zigzag offset for this hull at this sim time: +30 deg, then -30 deg, and so on. */
export function zigzagOffset(id: string, time: number): number {
  const leg = Math.floor(Math.max(0, time) / ZIGZAG_LEG);
  return (leg + idHash(id)) % 2 === 0 ? ZIGZAG_ANGLE : -ZIGZAG_ANGLE;
}

/** True when this hull, or any convoy member within the alarm radius, is alerted. */
export function convoyAlerted(ship: Ship, state: GameState): boolean {
  if (ship.alert > PROSECUTE_ALERT) return true;
  return state.ships.some(
    (other) =>
      other.id !== ship.id &&
      other.sinking === undefined &&
      CONVOY_KINDS.has(other.kind) &&
      other.alert > PROSECUTE_ALERT &&
      Math.hypot(other.x - ship.x, other.y - ship.y) <= ALERT_SPREAD_RADIUS,
  );
}

/** Position of this merchant among the live merchants, ordered by id. */
function merchantRank(ship: Ship, ships: readonly Ship[]): number {
  let rank = 0;
  for (const other of ships) {
    if (other.kind === 'merchant' && other.sinking === undefined && other.id < ship.id) rank += 1;
  }
  return rank;
}

/** Rank 0 holds the course; 1, 2, 3, 4... fan out +1, -1, +2, -2 spreads. */
export function scatterOffset(rank: number): number {
  if (rank <= 0) return 0;
  const step = Math.ceil(rank / 2);
  return (rank % 2 === 1 ? 1 : -1) * Math.min(step * SCATTER_SPREAD, Math.PI / 2);
}

function turnAway(ship: Ship, bearing: number, clear: ClearFn | undefined): number {
  const relative = normalize(bearing - ship.heading);
  const side = relative > 1e-9 ? -1 : relative < -1e-9 ? 1 : idHash(ship.id) % 2 === 0 ? 1 : -1;
  const course = (turn: number) => normalize(ship.heading + turn * EMERGENCY_TURN);
  const open = (heading: number) =>
    !clear ||
    clear(ship.x + Math.cos(heading) * LAND_PROBE, ship.y + Math.sin(heading) * LAND_PROBE);
  const preferred = course(side);
  if (open(preferred)) return preferred;
  const other = course(-side);
  return open(other) ? other : preferred;
}

export interface ConvoyOptions {
  /** True for the hull the rest of the convoy forms on (or a lone hull). */
  isAnchor: boolean;
  /** Existing navigation helper; keeps emergency courses off the land. */
  clear?: ClearFn;
}

export function convoyMerchantIntent(
  ship: Ship,
  base: MerchantIntent,
  basePursuit: number,
  state: GameState,
  dt: number,
  options: ConvoyOptions,
): MerchantIntent {
  let next = base.ship;
  const remaining = Math.max(0, (ship.emergencyTimer ?? 0) - dt);

  if (remaining > 0 && ship.emergencyHeading !== undefined) {
    // Hold the ordered emergency course.
    return {
      ship: { ...next, emergencyTimer: remaining, emergencyHeading: ship.emergencyHeading },
      heading: ship.emergencyHeading,
      speedFrac: 1,
    };
  }
  if (ship.emergencyTimer !== undefined && remaining === 0 && ship.emergencyHeading !== undefined) {
    next = { ...next, emergencyTimer: 0, emergencyHeading: undefined };
  }

  // Triggers: a consort was just hit, or a torpedo is running at this hull.
  const freshHit =
    (next.scatterTimer ?? 0) > (ship.scatterTimer ?? 0) &&
    next.scatterX !== undefined &&
    next.scatterY !== undefined;
  // Lookouts only pick a fast torpedo wake out of the swell once the convoy is on alert.
  const threat = convoyAlerted(ship, state)
    ? nearestTorpedoThreat(ship, state.torpedoes, MERCHANT_TORPEDO_RANGE, TRACK_HALF_WIDTH)
    : null;
  if (freshHit || threat) {
    const bearing = freshHit
      ? Math.atan2(next.scatterY! - ship.y, next.scatterX! - ship.x)
      : threat!.bearing;
    const heading = turnAway(ship, bearing, options.clear);
    return {
      ship: {
        ...next,
        emergencyTimer: freshHit ? EMERGENCY_HOLD_HIT : EMERGENCY_HOLD_TORPEDO,
        emergencyHeading: heading,
      },
      heading,
      speedFrac: 1,
    };
  }

  // Scatter: spread the existing run-away bearing by ship index.
  if ((next.scatterTimer ?? 0) > 0 && base.heading !== null) {
    const rank = merchantRank(ship, state.ships);
    return { ...base, ship: next, heading: normalize(base.heading + scatterOffset(rank)) };
  }

  // The merchant's own evasive weave (it has the contact itself) stands.
  if (base.heading !== null) return { ...base, ship: next };

  if (options.isAnchor && convoyAlerted(ship, state)) {
    return {
      ship: next,
      heading: normalize(basePursuit + zigzagOffset(ship.id, state.time)),
      speedFrac: null,
    };
  }
  return { ...base, ship: next };
}
