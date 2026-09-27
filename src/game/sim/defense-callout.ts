import type { GameState } from './types';

const HUNTERS = new Set(['destroyer', 'patrol', 'cruiser', 'battleship', 'sub']);

export type DefenseCallout = 'SEARCH' | 'LOCKED' | 'INCOMING' | null;

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
