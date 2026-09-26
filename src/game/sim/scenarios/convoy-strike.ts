import { createGame } from '../create';
import type { GameState, Ship, ShipKind } from '../types';
import { getTerrain, snapToNavigable } from '../world';

export const STRIKE_EXIT_RADIUS = 4;
export const STRIKE_MERCHANT_ID = 'strike-merchant';

const HULL: Record<
  'merchant' | 'destroyer' | 'patrol',
  { hp: number; speed: number; name: string }
> = {
  merchant: { hp: 95, speed: 1.15, name: 'MERCHANT' },
  destroyer: { hp: 120, speed: 2.35, name: 'DESTROYER' },
  patrol: { hp: 50, speed: 2.6, name: 'PATROL' },
};

function place(state: GameState, dist: number, lateral: number): { x: number; y: number } {
  const sub = state.submarine;
  const x = sub.x + Math.cos(sub.heading) * dist - Math.sin(sub.heading) * lateral;
  const y = sub.y + Math.sin(sub.heading) * dist + Math.cos(sub.heading) * lateral;
  if (state.worldVersion !== 'legacy-v1') return { x, y };
  return snapToNavigable(getTerrain(state.terrainSeed), x, y, 0.1);
}

function hull(kind: ShipKind, id: string, x: number, y: number, heading: number): Ship {
  const stats = HULL[kind as 'merchant' | 'destroyer' | 'patrol'];
  return {
    id,
    kind,
    name: stats.name,
    x,
    y,
    heading,
    speed: stats.speed,
    hp: stats.hp,
    maxHp: stats.hp,
    alert: 0.2,
    holdContact: 0,
    weaponCooldown: 4,
    patrolIndex: 0,
    path: [],
    repathTimer: 0,
    suspicion: 0,
  };
}

/** Seed-19 patrol start, three contacts 18 units down the bow, exit 16 beyond them. */
export function createConvoyStrike(seed = 19): GameState {
  const state = createGame(seed);
  const merchant = place(state, 18, 0);
  const destroyer = place(state, 18, -4);
  const patrol = place(state, 18, 4);
  const exit = place(state, 34, 0);
  const heading = state.submarine.heading;
  return {
    ...state,
    scenario: 'convoy-strike',
    assistanceAutoFire: false,
    missionFlavor: 'SINK THE MERCHANT · REACH THE EXIT',
    strikeExit: exit,
    ships: [
      hull('merchant', STRIKE_MERCHANT_ID, merchant.x, merchant.y, heading),
      hull('destroyer', 'strike-destroyer', destroyer.x, destroyer.y, heading),
      hull('patrol', 'strike-patrol', patrol.x, patrol.y, heading + Math.PI),
    ],
  };
}

export function strikeMerchantGone(state: GameState): boolean {
  return !state.ships.some((ship) => ship.id === STRIKE_MERCHANT_ID);
}

export type StrikeStage = 'attack' | 'extract' | 'complete';

/** Attack until the merchant is gone, then extraction, then victory. */
export function strikeStage(state: GameState): StrikeStage | null {
  if (state.scenario !== 'convoy-strike' || !state.strikeExit) return null;
  if (state.phase === 'victory') return 'complete';
  if (strikeMerchantGone(state) && state.stats.shipsSunk > 0) return 'extract';
  return 'attack';
}

/**
 * Degrees clockwise from north, same conversion as `headingDegrees` on the helm tape.
 * Simulation heading 0 is +X. Distance is sim units.
 */
export function extractionCue(state: GameState): {
  x: number;
  y: number;
  radius: number;
  distance: number;
  bearingDeg: number;
} | null {
  const exit = state.strikeExit;
  if (!exit || state.scenario !== 'convoy-strike') return null;
  const dx = exit.x - state.submarine.x;
  const dy = exit.y - state.submarine.y;
  const simHeading = Math.atan2(dy, dx);
  const bearingDeg = Math.round(((-simHeading * 180) / Math.PI + 90 + 360) % 360);
  return {
    x: exit.x,
    y: exit.y,
    radius: STRIKE_EXIT_RADIUS,
    distance: Math.hypot(dx, dy),
    bearingDeg,
  };
}

export function insideStrikeExit(state: GameState): boolean {
  const exit = state.strikeExit;
  if (!exit) return false;
  return Math.hypot(state.submarine.x - exit.x, state.submarine.y - exit.y) <= STRIKE_EXIT_RADIUS;
}
