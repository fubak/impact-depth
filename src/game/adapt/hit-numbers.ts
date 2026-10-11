import { xpForKill } from '../sim/progression';
import type { GameState, Ship } from '../sim/types';

export type HitNumberKind = 'damage' | 'crit' | 'kill';

export interface HitNumber {
  readonly id: string;
  readonly kind: HitNumberKind;
  /** Sim units. */
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  readonly elite: boolean;
}

/** Hit and kill numbers derived from one fixed step. Positions are sim units. */
export function deriveHitNumbers(prev: GameState, next: GameState): HitNumber[] {
  return [...hitNumbers(prev, next), ...killNumbers(prev, next)];
}

function hitNumbers(prev: GameState, next: GameState): HitNumber[] {
  const seen = new Set(prev.detonations.map((det) => det.id));
  const numbers: HitNumber[] = [];
  for (const det of next.detonations) {
    if (seen.has(det.id) || det.owner !== 'player' || det.hitId === null) continue;
    if (det.hitId === 'player') continue;
    const hitId = det.hitId;
    const before = prev.ships.find((ship) => ship.id === hitId);
    if (!before) continue;
    const after = next.ships.find((ship) => ship.id === hitId);
    const amount = Math.round(before.hp - Math.max(0, after?.hp ?? 0));
    if (amount < 1) continue;
    const crit = next.messages.some((message) => message.id.startsWith(`crit-${det.id}-`));
    numbers.push({
      id: `hit-${det.id}`,
      kind: crit ? 'crit' : 'damage',
      x: det.x,
      y: det.y,
      amount,
      elite: before.elite === true,
    });
  }
  return numbers;
}

function killNumbers(prev: GameState, next: GameState): HitNumber[] {
  const alive = new Set(next.ships.map((ship) => ship.id));
  return prev.ships
    .filter((ship) => !alive.has(ship.id))
    .map((ship: Ship) => ({
      id: `kill-${ship.id}`,
      kind: 'kill' as const,
      x: ship.x,
      y: ship.y,
      amount: xpForKill(ship),
      elite: ship.elite === true,
    }));
}
