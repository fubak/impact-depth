import { WORLD_SIZE } from './constants';
import type { NavigationProfile, WorldDefinition } from '../world/definition';
import { isNavigable } from '../world/littoral';
import type { Point, ShipKind } from './types';
import type { Terrain } from './world';
import { isLand } from './world';

export type ClearFn = (x: number, y: number) => boolean;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const PATH_STEP = 2;
const GRID_SIZE = Math.floor(WORLD_SIZE / PATH_STEP);
const key = (x: number, y: number) => x * GRID_SIZE + y;

export function shipClearRadius(kind: ShipKind): number {
  switch (kind) {
    case 'battleship':
      return 1.05;
    case 'cruiser':
      return 0.85;
    case 'merchant':
      return 0.9;
    case 'destroyer':
      return 0.65;
    case 'sub':
      return 0.75;
    case 'patrol':
      return 0.45;
  }
}

export function makeClear(terrain: Terrain, radius = 0): ClearFn {
  return (x, y) => {
    if (x < 1 || y < 1 || x >= WORLD_SIZE - 1 || y >= WORLD_SIZE - 1 || isLand(terrain, x, y))
      return false;
    if (radius <= 0.35) return true;
    const steps = radius > 0.8 ? 8 : 6;
    for (let index = 0; index < steps; index++) {
      const angle = (index / steps) * Math.PI * 2;
      if (isLand(terrain, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)) return false;
    }
    return true;
  };
}

/** Point query for v2: footprint box plus required water column. */
export function makeProfileClear(world: WorldDefinition, profile: NavigationProfile): ClearFn {
  return (x, y) => isNavigable(world, x, y, profile);
}

/**
 * Coarse A* cell query. `findPath` samples cell centers at PATH_STEP;
 * expand by one sim-unit so thin land inside the cell still blocks.
 */
export function makeCoarseProfileClear(
  world: WorldDefinition,
  profile: NavigationProfile,
): ClearFn {
  const pad = 1;
  return (x, y) => {
    if (x < 1 || y < 1 || x >= WORLD_SIZE - 1 || y >= WORLD_SIZE - 1) return false;
    const expanded: NavigationProfile = {
      radiusSim: profile.radiusSim + pad,
      requiredWaterMetres: profile.requiredWaterMetres,
    };
    return isNavigable(world, x, y, expanded);
  };
}

export function findWorldPath(
  world: WorldDefinition,
  start: Point,
  goal: Point,
  profile: NavigationProfile,
  maxNodes = 1600,
): Point[] {
  const coarse = makeCoarseProfileClear(world, profile);
  const path = findPath(start, goal, coarse, maxNodes);
  if (!path.length) return [];
  const fine = makeProfileClear(world, profile);
  let from = start;
  for (const waypoint of path) {
    if (!lineClear(from, waypoint, fine, 0.35)) return [];
    from = waypoint;
  }
  return path;
}

export function lineClear(start: Point, goal: Point, clear: ClearFn, step = 0.6): boolean {
  const distance = Math.hypot(goal.x - start.x, goal.y - start.y);
  const samples = Math.max(1, Math.ceil(distance / step));
  for (let index = 1; index <= samples; index++) {
    const t = index / samples;
    if (!clear(start.x + (goal.x - start.x) * t, start.y + (goal.y - start.y) * t)) return false;
  }
  return true;
}

function cellOpen(clear: ClearFn, x: number, y: number): boolean {
  return (
    x >= 0 &&
    y >= 0 &&
    x < GRID_SIZE &&
    y < GRID_SIZE &&
    clear(x * PATH_STEP + 1, y * PATH_STEP + 1)
  );
}

/** Bounded, deterministic coarse A*; an empty path means no route within budget. */
export function findPath(start: Point, goal: Point, clear: ClearFn, maxNodes = 1600): Point[] {
  if (lineClear(start, goal, clear)) return [goal];
  const toCell = (point: Point) => ({
    x: clamp(Math.floor(point.x / PATH_STEP), 0, GRID_SIZE - 1),
    y: clamp(Math.floor(point.y / PATH_STEP), 0, GRID_SIZE - 1),
  });
  let source = toCell(start);
  let target = toCell(goal);
  const nearestOpen = (cell: Point, limit: number) => {
    for (let radius = 0; radius <= limit; radius++) {
      for (let y = -radius; y <= radius; y++)
        for (let x = -radius; x <= radius; x++) {
          if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
          if (cellOpen(clear, cell.x + x, cell.y + y)) return { x: cell.x + x, y: cell.y + y };
        }
    }
    return null;
  };
  const validSource = nearestOpen(source, 4);
  const validTarget = nearestOpen(target, 6);
  if (!validSource || !validTarget) return [];
  source = validSource;
  target = validTarget;

  type Node = { x: number; y: number; cost: number; score: number };
  const open: Node[] = [
    { ...source, cost: 0, score: Math.hypot(target.x - source.x, target.y - source.y) },
  ];
  const costs = new Map<number, number>([[key(source.x, source.y), 0]]);
  const parents = new Map<number, number>();
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;
  let found: Node | null = null;

  for (let expanded = 0; open.length && expanded < maxNodes; expanded++) {
    let best = 0;
    for (let index = 1; index < open.length; index++) {
      if (open[index]!.score < open[best]!.score) best = index;
    }
    const current = open.splice(best, 1)[0]!;
    if (current.x === target.x && current.y === target.y) {
      found = current;
      break;
    }
    for (const [dx, dy] of directions) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (!cellOpen(clear, x, y)) continue;
      if (
        dx &&
        dy &&
        (!cellOpen(clear, current.x + dx, current.y) || !cellOpen(clear, current.x, current.y + dy))
      )
        continue;
      const cost = current.cost + (dx && dy ? Math.SQRT2 : 1);
      const cellKey = key(x, y);
      if (cost >= (costs.get(cellKey) ?? Infinity)) continue;
      costs.set(cellKey, cost);
      parents.set(cellKey, key(current.x, current.y));
      open.push({ x, y, cost, score: cost + Math.hypot(target.x - x, target.y - y) });
    }
  }
  if (!found) return [];
  const cells: Point[] = [{ x: found.x, y: found.y }];
  for (let currentKey = key(found.x, found.y); parents.has(currentKey);) {
    currentKey = parents.get(currentKey)!;
    cells.push({ x: Math.floor(currentKey / GRID_SIZE), y: currentKey % GRID_SIZE });
  }
  cells.reverse();
  const path = cells
    .slice(1)
    .filter((_, index) => index % 2 === 0)
    .map((cell) => ({ x: cell.x * PATH_STEP + 1, y: cell.y * PATH_STEP + 1 }));
  return [...path, goal];
}

/** Multi-ray steering used after A* to avoid coarse-cell and moving-obstacle clipping. */
export function steerAvoid(
  x: number,
  y: number,
  heading: number,
  lookAhead: number,
  clear: ClearFn,
): number {
  let bestHeading = heading;
  let bestScore = -Infinity;
  // Cap search to ±90° — the old ±153° + π*0.6 panic kick looked like reversing under AP.
  for (let index = 0; index < 11; index++) {
    const deflection = (index / 10 - 0.5) * Math.PI;
    const candidate = heading + deflection;
    let score = -Math.abs(deflection) * 0.55;
    for (const distance of [
      lookAhead * 0.45,
      lookAhead * 0.85,
      lookAhead * 1.25,
      lookAhead * 1.7,
    ]) {
      if (!clear(x + Math.cos(candidate) * distance, y + Math.sin(candidate) * distance)) {
        score -= distance < lookAhead ? 8 : 3;
        break;
      }
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestHeading = candidate;
    }
  }
  if (bestScore >= -6) return bestHeading;
  // Soft lateral peel instead of ~108° snap-turn.
  return heading + Math.sign(bestHeading - heading || 1) * (Math.PI * 0.35);
}

/**
 * When the forward step is on land, pick a nearby clear cell that stays as
 * aligned with `heading` as possible so hulls do not crab sideways.
 */
export function resolveClearStep(
  fromX: number,
  fromY: number,
  heading: number,
  blockedX: number,
  blockedY: number,
  clear: ClearFn,
  clampPos: (x: number, y: number) => { x: number; y: number },
): { x: number; y: number; heading: number } {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  for (let radius = 1; radius <= 10; radius++) {
    let pick: { x: number; y: number; dot: number } | undefined;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const next = clampPos(fromX + dx, fromY + dy);
        if (!clear(next.x, next.y)) continue;
        const vx = next.x - fromX;
        const vy = next.y - fromY;
        const len = Math.hypot(vx, vy) || 1;
        const dot = (vx * hx + vy * hy) / len;
        if (!pick || dot > pick.dot) pick = { x: next.x, y: next.y, dot };
      }
    }
    if (pick) {
      return {
        x: pick.x,
        y: pick.y,
        heading: Math.atan2(pick.y - fromY, pick.x - fromX),
      };
    }
  }
  return { x: blockedX, y: blockedY, heading };
}
