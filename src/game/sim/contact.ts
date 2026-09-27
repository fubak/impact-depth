import { passiveRange, shipMaxSpeed } from './sonar';
import type { GameState, Ship } from './types';

/** Stern arc where own wake blanks the hydrophones (radians each side of dead astern). */
const BAFFLE_ARC = (40 * Math.PI) / 180;
/** Inside this horizontal range a surface escort cannot hear a boat below the layer. */
const BLIND_ZONE = 1.3;
/** Running the ship this hard blankets the arrays in flow noise. */
const FLOW_NOISE_RATIO = 0.7;
/** An active ping is interceptable far beyond passive range — the loud fix. */
const PING_INTERCEPT_RANGE_SCALE = 2;
const PING_NOISE_FLOOR = 0.8;

const VISUAL_RANGE: Record<Ship['kind'], number> = {
  merchant: 9,
  patrol: 12,
  destroyer: 13,
  cruiser: 14,
  battleship: 15,
  sub: 8,
};

/** Surfaced / snorkel / high scope — escorts can see the boat. */
export function isVisuallyExposed(sub: GameState['submarine']): boolean {
  if (sub.z < 0.14) return true;
  if (sub.snorkel && sub.z < 0.36) return true;
  if (sub.scopeUp && sub.z < 0.34) return true;
  return false;
}

export function canSeeSubmarine(ship: Ship, state: GameState): boolean {
  const sub = state.submarine;
  const distance = Math.hypot(ship.x - sub.x, ship.y - sub.y);
  if (!isVisuallyExposed(sub)) return false;
  return distance <= VISUAL_RANGE[ship.kind];
}

export function canHearSubmarine(ship: Ship, state: GameState): boolean {
  const sub = state.submarine;
  const distance = Math.hypot(ship.x - sub.x, ship.y - sub.y);
  const listenerDepth = ship.kind === 'sub' ? 0.35 : 0.02;
  const masking = state.countermeasures.some(
    (cm) => Math.hypot(cm.x - sub.x, cm.y - sub.y) <= cm.radius,
  )
    ? 0.5
    : 1;
  let range = passiveRange(ship.kind, sub.noise, listenerDepth, sub.z, masking);
  if (ship.kind !== 'sub') {
    // Blind zone: the hull masks a boat directly underneath the layer.
    if (sub.z > 0.2 && distance <= BLIND_ZONE) return false;
    // Baffles: own wake dead astern shrinks the ears.
    const astern = Math.atan2(
      Math.sin(Math.atan2(sub.y - ship.y, sub.x - ship.x) - ship.heading),
      Math.cos(Math.atan2(sub.y - ship.y, sub.x - ship.x) - ship.heading),
    );
    if (Math.abs(astern) > Math.PI - BAFFLE_ARC) range *= 0.3;
    // Flow noise over the arrays at high speed.
    if (ship.speed > FLOW_NOISE_RATIO * shipMaxSpeed[ship.kind]) range *= 0.5;
  }
  return distance <= range;
}

/**
 * Direct-path intercept of the player's active ping. A ping punches through
 * the thermocline and carries about twice the passive reach — but it is a
 * bearing-only sensation: it alerts the escort without yielding a fix.
 */
export function canHearPing(ship: Ship, state: GameState): boolean {
  if (state.sonarPing <= 0) return false;
  const sub = state.submarine;
  const distance = Math.hypot(ship.x - sub.x, ship.y - sub.y);
  const listenerDepth = ship.kind === 'sub' ? 0.35 : 0.02;
  const masking = state.countermeasures.some(
    (cm) => Math.hypot(cm.x - sub.x, cm.y - sub.y) <= cm.radius,
  )
    ? 0.5
    : 1;
  const noise = Math.max(PING_NOISE_FLOOR, sub.noise);
  const range =
    passiveRange(ship.kind, noise, listenerDepth, listenerDepth, masking) *
    PING_INTERCEPT_RANGE_SCALE;
  return distance <= range;
}

/** Player ping must not hand every escort the boat's exact lat/long. */
export function hasContact(ship: Ship, state: GameState): boolean {
  return canSeeSubmarine(ship, state) || canHearSubmarine(ship, state);
}
