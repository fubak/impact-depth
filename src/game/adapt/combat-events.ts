import { blastDamage } from '../sim/blast';
import { BLAST_VERTICAL, PICKUP_RADIUS } from '../sim/constants';
import type { Countermeasure, DepthCharge, GameState, Ship, ShipKind, Torpedo } from '../sim/types';

/** Presentation cues derived from one fixed step. Positions are sim units. */
export type CombatEvent =
  | {
      type: 'torpedoLaunch';
      owner: Torpedo['owner'];
      id: string;
      x: number;
      y: number;
      z: number;
      heading: number;
    }
  | { type: 'torpedoHit'; id: string; targetId: string; x: number; y: number; z: number }
  | { type: 'torpedoExpired'; id: string; x: number; y: number; z: number }
  | { type: 'shipSunk'; id: string; kind: ShipKind; x: number; y: number }
  | { type: 'chargeBlast'; x: number; y: number; z: number; near: boolean }
  | { type: 'playerHit'; damage: number; x: number; y: number }
  | { type: 'countermeasure'; kind: Countermeasure['kind']; x: number; y: number }
  | { type: 'sonarPing' }
  | { type: 'pickup'; x: number; y: number }
  | { type: 'waveStart'; wave: number }
  | { type: 'victory' }
  | { type: 'gameover' };

/** A vanished torpedo hits the nearest hull that lost HP inside this radius. */
const HIT_RADIUS = 3;

type WithId = { id: string };

function byId<T extends WithId>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function horizontal(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Cues for one fixed step. Positions stay in sim units. */
export function deriveCombatEvents(prev: GameState, next: GameState): CombatEvent[] {
  return [
    ...launches(prev, next),
    ...torpedoFates(prev, next),
    ...sinks(prev, next),
    ...blasts(prev, next),
    ...playerDamage(prev, next),
    ...deployedCountermeasures(prev, next),
    ...pings(prev, next),
    ...collectedPickups(prev, next),
    ...waves(prev, next),
    ...terminalPhases(prev, next),
  ];
}

/** Concatenate per-step cues. Endpoint diffs drop events that cancel inside the window. */
export function collectOverSteps(states: readonly GameState[]): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (let index = 1; index < states.length; index += 1) {
    const before = states[index - 1];
    const after = states[index];
    if (before && after) events.push(...deriveCombatEvents(before, after));
  }
  return events;
}

function launches(prev: GameState, next: GameState): CombatEvent[] {
  const seen = byId(prev.torpedoes);
  return next.torpedoes
    .filter((torpedo) => !seen.has(torpedo.id))
    .map((torpedo) => ({
      type: 'torpedoLaunch' as const,
      owner: torpedo.owner,
      id: torpedo.id,
      x: torpedo.x,
      y: torpedo.y,
      z: torpedo.z,
      heading: torpedo.heading,
    }));
}

function damagedShips(prev: GameState, next: GameState): Ship[] {
  const before = byId(prev.ships);
  return next.ships.filter((ship) => {
    const prior = before.get(ship.id);
    return prior !== undefined && ship.hp < prior.hp;
  });
}

interface HitPair {
  torpedo: Torpedo;
  ship: Ship;
  distance: number;
}

function torpedoFates(prev: GameState, next: GameState): CombatEvent[] {
  const alive = byId(next.torpedoes);
  const gone = prev.torpedoes.filter((torpedo) => !alive.has(torpedo.id));
  const claimed = claimHits(gone, damagedShips(prev, next));
  const hits: CombatEvent[] = [...claimed.entries()].map(([torpedo, ship]) => ({
    type: 'torpedoHit' as const,
    id: torpedo.id,
    targetId: ship.id,
    x: torpedo.x,
    y: torpedo.y,
    z: torpedo.z,
  }));
  const expired: CombatEvent[] = gone
    .filter((torpedo) => !claimed.has(torpedo))
    .map((torpedo) => ({
      type: 'torpedoExpired' as const,
      id: torpedo.id,
      x: torpedo.x,
      y: torpedo.y,
      z: torpedo.z,
    }));
  return [...hits, ...expired];
}

/** Greedy one-to-one match so a spread cannot stamp both fish onto the nearer hull. */
function claimHits(gone: readonly Torpedo[], ships: readonly Ship[]): Map<Torpedo, Ship> {
  const pairs: HitPair[] = [];
  for (const torpedo of gone) {
    for (const ship of ships) {
      const distance = horizontal(torpedo.x, torpedo.y, ship.x, ship.y);
      if (distance <= HIT_RADIUS) pairs.push({ torpedo, ship, distance });
    }
  }
  pairs.sort(
    (left, right) =>
      left.distance - right.distance ||
      left.torpedo.id.localeCompare(right.torpedo.id) ||
      left.ship.id.localeCompare(right.ship.id),
  );
  const claimed = new Map<Torpedo, Ship>();
  const usedShips = new Set<string>();
  for (const pair of pairs) {
    if (claimed.has(pair.torpedo) || usedShips.has(pair.ship.id)) continue;
    claimed.set(pair.torpedo, pair.ship);
    usedShips.add(pair.ship.id);
  }
  return claimed;
}

function sinks(prev: GameState, next: GameState): CombatEvent[] {
  const alive = byId(next.ships);
  return prev.ships
    .filter((ship) => !alive.has(ship.id))
    .map((ship) => ({
      type: 'shipSunk' as const,
      id: ship.id,
      kind: ship.kind,
      x: ship.x,
      y: ship.y,
    }));
}

function blasts(prev: GameState, next: GameState): CombatEvent[] {
  const alive = byId(next.depthCharges);
  return prev.depthCharges
    .filter((charge) => !alive.has(charge.id))
    .map((charge) => ({
      type: 'chargeBlast' as const,
      x: charge.x,
      y: charge.y,
      z: charge.z,
      near: blastNearSub(charge, next),
    }));
}

function blastNearSub(charge: DepthCharge, next: GameState): boolean {
  const sub = next.submarine;
  return (
    blastDamage({
      damage: charge.damage,
      horizontal: horizontal(charge.x, charge.y, sub.x, sub.y),
      radius: charge.radius,
      depthDelta: Math.abs(charge.targetDepth - sub.z),
      vertical: BLAST_VERTICAL[charge.kind],
    }) > 0
  );
}

function playerDamage(prev: GameState, next: GameState): CombatEvent[] {
  const damage = prev.submarine.hp - next.submarine.hp;
  if (damage <= 0) return [];
  return [{ type: 'playerHit', damage, x: next.submarine.x, y: next.submarine.y }];
}

function deployedCountermeasures(prev: GameState, next: GameState): CombatEvent[] {
  const seen = byId(prev.countermeasures);
  return next.countermeasures
    .filter((item) => !seen.has(item.id))
    .map((item) => ({ type: 'countermeasure' as const, kind: item.kind, x: item.x, y: item.y }));
}

function pings(prev: GameState, next: GameState): CombatEvent[] {
  return next.sonarPing > prev.sonarPing ? [{ type: 'sonarPing' }] : [];
}

function collectedPickups(prev: GameState, next: GameState): CombatEvent[] {
  const taken = next.stats.powerupsTaken - prev.stats.powerupsTaken;
  if (taken <= 0) return [];
  const still = byId(next.powerups);
  const sub = next.submarine;
  return prev.powerups
    .filter((pickup) => !still.has(pickup.id))
    .map((pickup) => ({
      pickup,
      distance: horizontal(pickup.x, pickup.y, sub.x, sub.y),
    }))
    .filter((item) => item.distance <= PICKUP_RADIUS)
    .sort(
      (left, right) =>
        left.distance - right.distance || left.pickup.id.localeCompare(right.pickup.id),
    )
    .slice(0, taken)
    .map((item) => ({ type: 'pickup' as const, x: item.pickup.x, y: item.pickup.y }));
}

function waves(prev: GameState, next: GameState): CombatEvent[] {
  return next.stats.wave > prev.stats.wave ? [{ type: 'waveStart', wave: next.stats.wave }] : [];
}

function terminalPhases(prev: GameState, next: GameState): CombatEvent[] {
  const events: CombatEvent[] = [];
  if (prev.phase !== 'victory' && next.phase === 'victory') events.push({ type: 'victory' });
  if (prev.phase !== 'gameover' && next.phase === 'gameover') events.push({ type: 'gameover' });
  return events;
}
