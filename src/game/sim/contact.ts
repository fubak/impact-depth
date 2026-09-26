import { passiveRange } from './sonar';
import type { GameState, Ship } from './types';

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
  return distance <= passiveRange(ship.kind, sub.noise, listenerDepth, sub.z, masking);
}

/** Player ping must not hand every escort the boat's exact lat/long. */
export function hasContact(ship: Ship, state: GameState): boolean {
  return canSeeSubmarine(ship, state) || canHearSubmarine(ship, state);
}
