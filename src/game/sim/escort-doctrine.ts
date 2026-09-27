import { shipMaxSpeed } from './sonar';
import type { GameState, Ship } from './types';

const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Escort kinds that run the anti-sub doctrine state machine. */
export const DOCTRINE_KINDS: ReadonlySet<Ship['kind']> = new Set([
  'destroyer',
  'patrol',
  'cruiser',
]);

/* ------------------------------------------------------------------ *
 * Doctrine tuning — all sim units, all seconds.
 * ------------------------------------------------------------------ */

/** Leave the screen for the hunt once alert and a contact coincide. */
export const PROSECUTE_ALERT = 0.25;
/** Commit to a depth-charge run inside this range of the predicted datum. */
export const ATTACK_RUN_RANGE = 6;
/** No more than this many escorts run at once — the rest hold the contact. */
export const ATTACK_RUN_CAP = 2;
/** Drop the stern/K-gun pattern this close to the predicted datum. */
export const PATTERN_DROP_RANGE = 1.0;
/** Run at this fraction of class speed over the top of the boat. */
export const ATTACK_RUN_SPEED_FRAC = 0.8;
/** Hold the run this far past the datum before turning back. */
export const REATTACK_OVERSHOOT = 5;
/** Hedgehogs fire when the predicted datum sits inside this forward envelope. */
export const HEDGEHOG_MIN_RANGE = 2;
export const HEDGEHOG_MAX_RANGE = 4.5;
export const HEDGEHOG_ARC = (25 * Math.PI) / 180;
/** Contact this stale pushes the escort into expanding-square search. */
export const SEARCH_AFTER = 6;
/** Give up the datum after this long without a fix and return to screen. */
export const SEARCH_GIVE_UP = 45;
/** Search circle radius grows at this rate. */
export const SEARCH_RADIUS_GROWTH = 0.15;
/** Velocity estimate time constant: each fix moves the track halfway. */
const VELOCITY_BLEND = 0.5;
const MIN_FIX_INTERVAL = 0.5;

export interface EscortIntent {
  /** Updated ship — doctrine fields only change here. */
  ship: Ship;
  /** Desired heading override, or null to keep screen/path steering. */
  heading: number | null;
  /** Fraction of class max speed, or null to keep the standing rule. */
  speedFrac: number | null;
  /** Ordnance to release this step, if any. */
  action: 'pattern' | 'hedgehog' | null;
  /** Aim point for a hedgehog volley — the predicted datum. */
  aimX?: number;
  aimY?: number;
}

const holding = (ship: Ship): EscortIntent => ({
  ship,
  heading: null,
  speedFrac: null,
  action: null,
});

/**
 * The escort's best estimate of where the boat is *now*: last fix plus the
 * smoothed velocity advanced by fix age plus the escort's time to arrive.
 */
export function predictDatum(ship: Ship, time: number): { x: number; y: number } | null {
  if (ship.datumX === undefined || ship.datumY === undefined) return null;
  const sinceFix = Math.max(0, time - (ship.lastFixTime ?? time));
  const speed = shipMaxSpeed[ship.kind] * ATTACK_RUN_SPEED_FRAC;
  const toDatum = Math.hypot(ship.datumX - ship.x, ship.datumY - ship.y);
  const eta = speed > 0 ? toDatum / speed : 0;
  const lead = sinceFix + eta;
  return {
    x: ship.datumX + (ship.datumVx ?? 0) * lead,
    y: ship.datumY + (ship.datumVy ?? 0) * lead,
  };
}

/**
 * One doctrine step for a destroyer/patrol/cruiser. `fix` is this step's own
 * sensor detection of the boat; datum fields carry it between steps so the
 * escort hunts the *track*, not the live position.
 */
export function escortIntent(
  ship: Ship,
  fix: { x: number; y: number } | null,
  state: GameState,
  dt: number,
  attackRunners: number,
): EscortIntent {
  let next: Ship = {
    ...ship,
    doctrineTimer: (ship.doctrineTimer ?? 0) + dt,
  };

  // Datum update: each fix re-centres the track and half-corrects velocity.
  if (fix) {
    const dtFix = Math.max(MIN_FIX_INTERVAL, state.time - (next.lastFixTime ?? -Infinity));
    if (!Number.isFinite(dtFix)) {
      next.datumVx = 0;
      next.datumVy = 0;
    } else if (next.datumX !== undefined && next.datumY !== undefined) {
      const vx = (fix.x - next.datumX) / dtFix;
      const vy = (fix.y - next.datumY) / dtFix;
      next.datumVx = (next.datumVx ?? 0) + (vx - (next.datumVx ?? 0)) * VELOCITY_BLEND;
      next.datumVy = (next.datumVy ?? 0) + (vy - (next.datumVy ?? 0)) * VELOCITY_BLEND;
    }
    next.datumX = fix.x;
    next.datumY = fix.y;
    next.lastFixTime = state.time;
  }
  // A shared contact (lastKnown set by cueing or the alarm net) seeds a datum.
  if (next.datumX === undefined && ship.lastKnownX !== undefined && ship.lastKnownY !== undefined) {
    next.datumX = ship.lastKnownX;
    next.datumY = ship.lastKnownY;
    next.datumVx = 0;
    next.datumVy = 0;
  }

  const sinceFix = state.time - (next.lastFixTime ?? -Infinity);
  const predicted = predictDatum(next, state.time);
  const predDist = predicted
    ? Math.hypot(predicted.x - next.x, predicted.y - next.y)
    : Infinity;
  const stale = !fix && (!Number.isFinite(sinceFix) || sinceFix > SEARCH_AFTER);
  const dropOrHedgehog = (): 'pattern' | 'hedgehog' | null => {
    if (next.weaponCooldown > 0 || !predicted) return null;
    const bearing = normalize(Math.atan2(predicted.y - next.y, predicted.x - next.x) - next.heading);
    if (
      next.holdContact > 0 &&
      predDist >= HEDGEHOG_MIN_RANGE &&
      predDist <= HEDGEHOG_MAX_RANGE &&
      Math.abs(bearing) <= HEDGEHOG_ARC
    )
      return 'hedgehog';
    return null;
  };

  switch (next.doctrine ?? 'screen') {
    case 'screen': {
      if (ship.alert > PROSECUTE_ALERT && ship.holdContact > 0 && predicted) {
        next = { ...next, doctrine: 'prosecute', doctrineTimer: 0 };
        return {
          ship: next,
          heading: Math.atan2(predicted.y - next.y, predicted.x - next.x),
          speedFrac: 1,
          action: null,
        };
      }
      return holding(next);
    }
    case 'prosecute': {
      if (!predicted || stale) {
        return { ship: { ...next, doctrine: 'search', doctrineTimer: 0 }, heading: null, speedFrac: null, action: null };
      }
      // Commit to the run once inside range and the lane is free.
      const doctrine =
        predDist <= ATTACK_RUN_RANGE && attackRunners < ATTACK_RUN_CAP ? 'attackRun' : 'prosecute';
      if (doctrine === 'attackRun') next = { ...next, doctrine, doctrineTimer: 0 };
      return {
        ship: next,
        heading: Math.atan2(predicted.y - next.y, predicted.x - next.x),
        speedFrac: doctrine === 'attackRun' ? ATTACK_RUN_SPEED_FRAC : 1,
        action: dropOrHedgehog(),
        aimX: predicted.x,
        aimY: predicted.y,
      };
    }
    case 'attackRun': {
      if (predicted && predDist <= PATTERN_DROP_RANGE && next.weaponCooldown <= 0) {
        return {
          ship: { ...next, doctrine: 'reattack', doctrineTimer: 0 },
          heading: next.heading,
          speedFrac: ATTACK_RUN_SPEED_FRAC,
          action: 'pattern',
          aimX: predicted.x,
          aimY: predicted.y,
        };
      }
      if (!predicted) {
        return { ship: { ...next, doctrine: 'search', doctrineTimer: 0 }, heading: null, speedFrac: null, action: null };
      }
      return {
        ship: next,
        heading: Math.atan2(predicted.y - next.y, predicted.x - next.x),
        speedFrac: ATTACK_RUN_SPEED_FRAC,
        action: dropOrHedgehog(),
        aimX: predicted.x,
        aimY: predicted.y,
      };
    }
    case 'reattack': {
      // Run the course out 5 u past the datum, then come around.
      const datumX = next.datumX ?? next.x;
      const datumY = next.datumY ?? next.y;
      const past =
        (next.x - datumX) * Math.cos(next.heading) + (next.y - datumY) * Math.sin(next.heading);
      if (past >= REATTACK_OVERSHOOT || !predicted) {
        const doctrine = !stale && predicted ? 'prosecute' : 'search';
        return { ship: { ...next, doctrine, doctrineTimer: 0 }, heading: null, speedFrac: null, action: null };
      }
      return {
        ship: next,
        heading: next.heading,
        speedFrac: ATTACK_RUN_SPEED_FRAC,
        action: null,
      };
    }
    case 'search': {
      if (fix) {
        return { ship: { ...next, doctrine: 'prosecute', doctrineTimer: 0 }, heading: null, speedFrac: null, action: null };
      }
      if ((next.doctrineTimer ?? 0) >= SEARCH_GIVE_UP) {
        // Cold trail: release the datum, cool the alert, rejoin the screen.
        return {
          ship: {
            ...next,
            doctrine: 'screen',
            doctrineTimer: 0,
            suspicion: 0,
            datumX: undefined,
            datumY: undefined,
            datumVx: 0,
            datumVy: 0,
          },
          heading: null,
          speedFrac: null,
          action: null,
        };
      }
      // Expanding circle about the last datum.
      const radius = Math.max(1.5, SEARCH_RADIUS_GROWTH * (next.doctrineTimer ?? 0));
      const datumX = next.datumX ?? next.x;
      const datumY = next.datumY ?? next.y;
      const angle = Math.atan2(next.y - datumY, next.x - datumX) + 1.1;
      const aimX = datumX + Math.cos(angle) * radius;
      const aimY = datumY + Math.sin(angle) * radius;
      return {
        ship: next,
        heading: Math.atan2(aimY - next.y, aimX - next.x),
        speedFrac: 0.55,
        action: null,
      };
    }
    default:
      return holding(next);
  }
}

/* ------------------------------------------------------------------ *
 * Merchant evasion — zig-zag when alerted, scatter when a consort dies.
 * ------------------------------------------------------------------ */

export const ZIG_AMPLITUDE = 0.45;
export const ZIG_PERIOD = 24;
export const SCATTER_RANGE = 25;
export const SCATTER_TIME = 30;
/** A convoy hit stays "fresh" this long for scatter purposes. */
const HIT_MEMORY = 0.5;

export interface MerchantIntent {
  ship: Ship;
  heading: number | null;
  speedFrac: number | null;
}

export function merchantIntent(
  ship: Ship,
  baseHeading: number,
  state: GameState,
  dt: number,
): MerchantIntent {
  let next = ship;
  // A torpedo strike anywhere in the convoy sends every merchant running.
  const victim = state.ships.find(
    (other) =>
      other.id !== ship.id &&
      other.lastHitTime !== undefined &&
      state.time - other.lastHitTime < HIT_MEMORY &&
      Math.hypot(ship.x - (other.lastHitX ?? other.x), ship.y - (other.lastHitY ?? other.y)) <=
        SCATTER_RANGE,
  );
  if (victim) {
    next = {
      ...next,
      scatterTimer: SCATTER_TIME,
      scatterX: victim.lastHitX ?? victim.x,
      scatterY: victim.lastHitY ?? victim.y,
    };
  }
  const scatterTimer = Math.max(0, (next.scatterTimer ?? 0) - dt);
  if (scatterTimer !== next.scatterTimer) next = { ...next, scatterTimer };
  if (scatterTimer > 0 && next.scatterX !== undefined && next.scatterY !== undefined) {
    return {
      ship: next,
      heading: Math.atan2(next.y - next.scatterY, next.x - next.scatterX),
      speedFrac: 1,
    };
  }
  if (next.alert > 0.3) {
    // Snake the base course, biased away from the threat datum when one exists.
    const zig =
      ZIG_AMPLITUDE *
      Math.sign(Math.sin((2 * Math.PI * state.time) / ZIG_PERIOD + next.patrolIndex));
    const away =
      next.lastKnownX !== undefined && next.lastKnownY !== undefined
        ? Math.atan2(next.y - next.lastKnownY, next.x - next.lastKnownX)
        : baseHeading;
    return { ship: next, heading: normalize(away + zig), speedFrac: 1 };
  }
  return { ship: next, heading: null, speedFrac: null };
}
