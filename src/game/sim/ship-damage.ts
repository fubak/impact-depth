import { clampSim } from './coords';
import type { Ship, ShipKind, SinkStyle } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Seconds a lethally-hit hull stays on the surface — escorts go fast. */
export const SINK_DURATION: Record<ShipKind, number> = {
  merchant: 16,
  battleship: 22,
  cruiser: 16,
  destroyer: 11,
  patrol: 8,
  sub: 7,
};

/** A sinking hull loses way at this rate (u/s). */
export const SINKING_DECEL = 0.3;
/** Progressive flooding growth — unchecked water takes the ship. */
export const FLOODING_GROWTH = 0.02;
/** Damage control only wins while flooding is still minor. */
export const DAMAGE_CONTROL_RATE = 0.015;
export const DAMAGE_CONTROL_LIMIT = 0.5;
/** Hull point drain per second of full flooding. */
export const FLOODING_HP_RATE = 3;
/** Fires burn themselves out — or down into the hull. */
export const FIRE_DECAY = 0.03;
export const FIRE_HP_RATE = 1;
/** Deck-gun wounds: light flooding, sometimes a fire. */
export const SHELL_FLOODING = 0.1;
export const SHELL_FIRE_CHANCE = 0.3;
export const SINK_STYLE_LIST: SinkStyle = 'list';

/**
 * Arcade-readable hull radii shared with ordnance-physics — also the
 * half-length used to project a hit along the hull axis.
 */
export function hullHalfLength(ship: Pick<Ship, 'kind'>): number {
  switch (ship.kind) {
    case 'sub':
      return 1.35;
    case 'battleship':
      return 2.1;
    case 'cruiser':
      return 1.75;
    case 'merchant':
      return 1.85;
    case 'destroyer':
      return 1.45;
    case 'patrol':
      return 1.15;
    default:
      return 1.25;
  }
}

export type HitLocation = 'bow' | 'amidships' | 'stern';

export interface HitLocationResult {
  location: HitLocation;
  /** +1 bow … -1 stern along the hull axis. */
  along: number;
  /** +1 starboard / -1 port — the side the track crossed. */
  listSide: number;
}

/** Where a torpedo track struck: project the impact point on the hull axis. */
export function locateHit(ship: Ship, x: number, y: number): HitLocationResult {
  const dx = x - ship.x;
  const dy = y - ship.y;
  const cos = Math.cos(ship.heading);
  const sin = Math.sin(ship.heading);
  const along = clamp((dx * cos + dy * sin) / hullHalfLength(ship), -1, 1);
  const lateral = -dx * sin + dy * cos;
  return {
    location: along > 0.5 ? 'bow' : along < -0.5 ? 'stern' : 'amidships',
    along,
    listSide: lateral >= 0 ? 1 : -1,
  };
}

export interface TorpedoHitOutcome {
  ship: Ship;
  location: HitLocation;
  /** True when this hit put the hull on the bottom run. */
  lethal: boolean;
  /** Damage actually applied to hp. */
  applied: number;
}

/**
 * A torpedo hit wounds by where it lands: amidships breaks the back, the bow
 * floods hardest, the stern kills the screws. Surface hulls catch fire.
 */
export function applyTorpedoHit(ship: Ship, x: number, y: number, damage: number): TorpedoHitOutcome {
  const hit = locateHit(ship, x, y);
  const lethalBefore = ship.sinking !== undefined;
  let applied = damage;
  let flooding = ship.flooding;
  let speedFactor = ship.speedFactor;
  let style: SinkStyle;
  if (hit.location === 'amidships') {
    applied = damage * 1.2;
    flooding += 0.35;
    style = 'break';
  } else if (hit.location === 'bow') {
    flooding += 0.45;
    style = 'bow';
  } else {
    speedFactor = ship.speedFactor * 0.4;
    flooding += 0.25;
    style = 'stern';
  }
  const hp = ship.hp - applied;
  const lethal = hp <= 0;
  return {
    location: hit.location,
    lethal,
    applied,
    ship: {
      ...ship,
      hp,
      flooding: clamp(flooding, 0, 1),
      speedFactor: clamp(speedFactor, 0, 1),
      fire: ship.kind === 'sub' ? ship.fire : Math.min(1, ship.fire + 0.6),
      listSide: hit.listSide,
      ...(lethal && !lethalBefore
        ? { sinking: ship.sinkDuration, sinkStyle: style }
        : {}),
    },
  };
}

/** Deck-gun splash on a ship: light flooding and a chance of fire. */
export function applyShellHit(ship: Ship, damage: number, fireRoll: number): TorpedoHitOutcome {
  const hp = ship.hp - damage;
  const lethal = hp <= 0;
  return {
    location: 'amidships',
    lethal,
    applied: damage,
    ship: {
      ...ship,
      hp,
      flooding: clamp(ship.flooding + SHELL_FLOODING, 0, 1),
      fire: fireRoll < SHELL_FIRE_CHANCE ? Math.min(1, ship.fire + 0.6) : ship.fire,
      ...(lethal && ship.sinking === undefined
        ? { sinking: ship.sinkDuration, sinkStyle: SINK_STYLE_LIST }
        : {}),
    },
  };
}

/**
 * Per-step damage model for one hull. Returns null once the wreck is fully
 * gone — the caller counts the kill and drops the ship from state.
 *
 * Alive: flooding grows on itself, the crew fights it only while it is minor,
 * and every point of flooding bleeds hp. Sinking: dead in the water, drifting
 * on a decaying way until the countdown ends.
 */
export function advanceShipDamage(ship: Ship, dt: number): { ship: Ship | null; becameSinking: boolean } {
  if (ship.sinking !== undefined) {
    const speed = Math.max(0, ship.speed - SINKING_DECEL * dt);
    const sinking = ship.sinking - dt;
    if (sinking <= 0) return { ship: null, becameSinking: false };
    return {
      becameSinking: false,
      ship: {
        ...ship,
        sinking,
        speed,
        x: clampSim(ship.x + Math.cos(ship.heading) * speed * dt),
        y: clampSim(ship.y + Math.sin(ship.heading) * speed * dt),
      },
    };
  }
  const control = ship.flooding < DAMAGE_CONTROL_LIMIT ? DAMAGE_CONTROL_RATE : 0;
  const flooding = clamp(ship.flooding + (FLOODING_GROWTH * ship.flooding - control) * dt, 0, 1);
  const fire = Math.max(0, ship.fire - FIRE_DECAY * dt);
  const hp = ship.hp - (FLOODING_HP_RATE * ship.flooding + FIRE_HP_RATE * ship.fire) * dt;
  if (hp <= 0) {
    return {
      becameSinking: true,
      ship: {
        ...ship,
        hp: 0,
        flooding,
        fire,
        sinking: ship.sinkDuration,
        sinkStyle: ship.sinkStyle ?? SINK_STYLE_LIST,
      },
    };
  }
  if (flooding === ship.flooding && hp === ship.hp && fire === ship.fire)
    return { ship, becameSinking: false };
  return { ship: { ...ship, flooding, hp, fire }, becameSinking: false };
}
