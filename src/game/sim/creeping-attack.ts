/**
 * Creeping attack (Capt. F. J. Walker). With two or more escorts prosecuting
 * the same slow contact, the one nearest the datum that actually holds contact
 * becomes the HOLDER: it stays outside the sonar dead zone, slows right down,
 * keeps pinging and feeds fresh datum fixes to the second ship, the CREEPER.
 * The creeper closes slowly and silent (no active ping, low noise) and drops
 * only when it is inside PATTERN_DROP_RANGE of the holder's datum, the signal.
 * If the holder loses contact the roles dissolve and both revert to the
 * ordinary search in escort-doctrine.ts.
 *
 * Pure and deterministic. Roles are derived from the previous step's state, so
 * they carry one step of lag and never depend on iteration order.
 */
import { BLIND_ZONE } from './contact';
import {
  DOCTRINE_KINDS,
  PATTERN_DROP_RANGE,
  SEARCH_AFTER,
  type EscortIntent,
} from './escort-doctrine';
import type { GameState, Ship } from './types';

/** Holder stands off at about 1.6 x the blind radius so the boat stays in the beam. */
export const HOLDER_STANDOFF = 1.6 * BLIND_ZONE;
/** Holder circles at this radius (just outside the standoff). */
const HOLDER_ORBIT_RADIUS = HOLDER_STANDOFF + 0.7;
/** Inside this radius the holder stops closing and circles. */
const HOLDER_ORBIT_BAND = HOLDER_STANDOFF + 1.2;
export const HOLDER_SPEED_FRAC = 0.35;
export const CREEPER_SPEED_FRAC = 0.3;
/** Creeping speeds apply inside this range of the datum; farther out the run-in is flat out. */
export const CREEP_ENGAGE_RANGE = 12;
/** A boat faster than this (u/s) outruns a creeper: the ordinary attack run takes over. */
export const CREEP_MAX_TARGET_SPEED = 0.5;
/** The holder pings on this cadence (s), faster than the global escort sweep. */
export const HOLDER_PING_PERIOD = 2;
/** The creeper trusts the holder's signal for this long after its last fix. */
export const SIGNAL_MAX_AGE = 3;
/** Holder fixes this fresh (s) are passed on to the creeper; older ones are not. */
const FEED_MAX_AGE = 0.1;
/** Datums this close describe the same contact. */
const SAME_CONTACT_RANGE = 10;

export interface CreepAssignment {
  role: 'holder' | 'creeper';
  partnerId: string;
}

const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type Tracking = Ship & { datumX: number; datumY: number };

const isProsecuting = (ship: Ship): ship is Tracking =>
  DOCTRINE_KINDS.has(ship.kind) &&
  ship.sinking === undefined &&
  ship.doctrine === 'prosecute' &&
  ship.datumX !== undefined &&
  ship.datumY !== undefined;

const distToDatum = (ship: Tracking) => Math.hypot(ship.x - ship.datumX, ship.y - ship.datumY);

/** Holder's datum advanced by its velocity estimate over the (capped) fix age. */
export function signalPoint(holder: Ship, time: number): { x: number; y: number } {
  const age = clamp(time - (holder.lastFixTime ?? time), 0, SIGNAL_MAX_AGE);
  return {
    x: (holder.datumX ?? holder.x) + (holder.datumVx ?? 0) * age,
    y: (holder.datumY ?? holder.y) + (holder.datumVy ?? 0) * age,
  };
}

const freshFix = (ship: Ship, time: number, maxAge: number) =>
  time - (ship.lastFixTime ?? -Infinity) <= maxAge;

/** The creeper keeps its place in the pair while it runs out and listens after a drop. */
const isRunningOut = (ship: Ship, holderId: string) =>
  DOCTRINE_KINDS.has(ship.kind) &&
  ship.sinking === undefined &&
  ship.doctrine === 'reattack' &&
  ship.role === 'creeper' &&
  ship.creepPartnerId === holderId;

/** Who is holder and who is creeper this step. Empty unless a pair can run. */
export function assignCreepRoles(state: GameState): ReadonlyMap<string, CreepAssignment> {
  const none = new Map<string, CreepAssignment>();
  const prosecuting = state.ships.filter(isProsecuting);
  const capable = prosecuting.filter(
    (ship) =>
      // A sitting holder keeps the job until its fix goes stale, exactly when the
      // doctrine itself would drop it to search.
      (ship.holdContact > 0 || ship.role === 'holder') &&
      freshFix(ship, state.time, SEARCH_AFTER) &&
      Math.hypot(ship.datumVx ?? 0, ship.datumVy ?? 0) <= CREEP_MAX_TARGET_SPEED,
  );
  if (capable.length === 0) return none;

  const nearest = (a: Tracking, b: Tracking) =>
    distToDatum(a) - distToDatum(b) || b.holdContact - a.holdContact || a.id.localeCompare(b.id);
  const partnersOf = (holder: Tracking): Ship[] => [
    ...prosecuting.filter(
      (other) =>
        other.id !== holder.id &&
        Math.hypot(other.datumX - holder.datumX, other.datumY - holder.datumY) <=
          SAME_CONTACT_RANGE,
    ),
    ...state.ships.filter((other) => isRunningOut(other, holder.id)),
  ];

  // Sticky roles: a holder keeps the job while it keeps contact and a partner remains.
  const holders = [...capable].sort(nearest);
  const holder =
    holders.find((ship) => ship.role === 'holder' && partnersOf(ship).length > 0) ??
    holders.find((ship) => partnersOf(ship).length > 0);
  if (!holder) return none;

  const partners = partnersOf(holder).sort((a, b) => {
    const dist = (s: Ship) => Math.hypot(s.x - holder.datumX, s.y - holder.datumY);
    return dist(a) - dist(b) || a.id.localeCompare(b.id);
  });
  const creeper =
    partners.find((ship) => ship.role === 'creeper' && ship.creepPartnerId === holder.id) ??
    partners[0]!;
  return new Map<string, CreepAssignment>([
    [holder.id, { role: 'holder', partnerId: creeper.id }],
    [creeper.id, { role: 'creeper', partnerId: holder.id }],
  ]);
}

const crossedBoundary = (time: number, dt: number, period: number) =>
  Math.floor(time / period) !== Math.floor((time - dt) / period);

/**
 * Does this escort send an active ping this step? Ordinary escorts follow the
 * global sweep, the holder also pings on its own cadence, the creeper never.
 */
export function creepSweepPulse(
  role: CreepAssignment['role'] | undefined,
  globalPulse: boolean,
  time: number,
  dt: number,
): boolean {
  if (role === 'creeper') return false;
  if (role === 'holder') return globalPulse || crossedBoundary(time, dt, HOLDER_PING_PERIOD);
  return globalPulse;
}

/**
 * The holder's current fix, handed to the creeper while it is fresh. `time` is
 * when the holder took it, so the creeper's track goes stale with the holder's.
 */
export function creeperFeed(
  holder: Ship | undefined,
  time: number,
): { x: number; y: number; time: number } | null {
  if (!holder || holder.datumX === undefined || holder.datumY === undefined) return null;
  if (holder.lastFixTime === undefined || !freshFix(holder, time, FEED_MAX_AGE)) return null;
  return { x: holder.datumX, y: holder.datumY, time: holder.lastFixTime };
}

/**
 * Holder: close slowly to the standoff radius, then circle there so the boat
 * stays in the beam and out of the dead zone. Never releases ordnance.
 */
export function holderIntent(base: EscortIntent, state: GameState): EscortIntent {
  const ship = base.ship;
  if (ship.datumX === undefined || ship.datumY === undefined) return { ...base, action: null };
  const signal = signalPoint(ship, state.time);
  const dx = ship.x - signal.x;
  const dy = ship.y - signal.y;
  const dist = Math.hypot(dx, dy);
  if (dist > CREEP_ENGAGE_RANGE) return { ...base, action: null };
  if (dist > HOLDER_ORBIT_BAND) {
    return {
      ...base,
      heading: Math.atan2(-dy, -dx),
      speedFrac: clamp(0.12 + 0.06 * (dist - HOLDER_ORBIT_BAND), 0.12, HOLDER_SPEED_FRAC),
      action: null,
    };
  }
  const outward = Math.atan2(dy, dx);
  const radial = clamp((dist - HOLDER_ORBIT_RADIUS) * 0.8, -0.8, 0.8);
  return {
    ...base,
    heading: normalize(outward + Math.PI / 2 + radial),
    speedFrac: 0.15,
    action: null,
  };
}

/**
 * Creeper: run in slowly along the holder's signal and drop only inside the
 * pattern range of it, on a fresh signal. `ship` is the pre-step hull.
 */
export function creeperIntent(
  base: EscortIntent,
  ship: Ship,
  holder: Ship | undefined,
  state: GameState,
): EscortIntent {
  if (!holder || holder.datumX === undefined) return { ...base, action: null };
  const signal = signalPoint(holder, state.time);
  const dist = Math.hypot(ship.x - signal.x, ship.y - signal.y);
  if (
    dist <= PATTERN_DROP_RANGE &&
    freshFix(holder, state.time, SIGNAL_MAX_AGE) &&
    ship.weaponCooldown <= 0
  ) {
    return {
      ship: { ...base.ship, doctrine: 'reattack', doctrineTimer: 0 },
      heading: ship.heading,
      speedFrac: CREEPER_SPEED_FRAC,
      action: 'pattern',
      aimX: signal.x,
      aimY: signal.y,
    };
  }
  return {
    ship: base.ship,
    heading: Math.atan2(signal.y - ship.y, signal.x - ship.x),
    speedFrac: dist > CREEP_ENGAGE_RANGE ? 1 : CREEPER_SPEED_FRAC,
    action: null,
    aimX: signal.x,
    aimY: signal.y,
  };
}
