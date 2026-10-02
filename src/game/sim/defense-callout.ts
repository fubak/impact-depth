import type { DepthCharge, GameMessage, GameState, Torpedo } from './types';

const HUNTERS = new Set(['destroyer', 'patrol', 'cruiser', 'battleship', 'sub']);

export type DefenseCallout = 'SEARCH' | 'LOCKED' | 'INCOMING' | null;

/** A fresh enemy release near the boat earns its own shout, once per window. */
const RELEASE_CALLOUT_TTL = 4;
const RELEASE_CALLOUT_RANGE = 12;

/**
 * Callouts for ordnance entering the water this step. The message id is the
 * throttle — while it lives in state.messages the same callout cannot repeat.
 */
export function releaseCallouts(
  state: GameState,
  newCharges: readonly DepthCharge[],
  newTorpedoes: readonly Torpedo[],
): GameMessage[] {
  const sub = state.submarine;
  const messages: GameMessage[] = [];
  const has = (id: string) =>
    state.messages.some((message) => message.id === id) ||
    messages.some((message) => message.id === id);
  if (
    newCharges.some(
      (charge) => Math.hypot(charge.x - sub.x, charge.y - sub.y) <= RELEASE_CALLOUT_RANGE,
    ) &&
    !has('callout-charges')
  ) {
    messages.push({
      id: 'callout-charges',
      text: 'DEPTH CHARGES IN THE WATER',
      ttl: RELEASE_CALLOUT_TTL,
    });
  }
  if (newTorpedoes.some((torpedo) => torpedo.owner === 'enemy') && !has('callout-torpedo')) {
    messages.push({
      id: 'callout-torpedo',
      text: 'TORPEDO IN THE WATER',
      ttl: RELEASE_CALLOUT_TTL,
    });
  }
  return messages;
}

/** One word for the threat the player has to answer right now. */
export function defenseCallout(state: GameState): DefenseCallout {
  const sub = state.submarine;
  const near = (x: number, y: number, limit: number) => Math.hypot(x - sub.x, y - sub.y) <= limit;
  const incoming =
    state.torpedoes.some(
      (torpedo) => torpedo.owner === 'enemy' && near(torpedo.x, torpedo.y, 16),
    ) || state.depthCharges.some((charge) => near(charge.x, charge.y, 12) && charge.fuse <= 8);
  if (incoming) return 'INCOMING';
  const hunters = state.ships.filter(
    (ship) => HUNTERS.has(ship.kind) && ship.sinking === undefined,
  );
  if (hunters.some((ship) => ship.alert > 0.45 && ship.holdContact > 0)) return 'LOCKED';
  if (hunters.some((ship) => ship.alert >= 0.25)) return 'SEARCH';
  return null;
}
