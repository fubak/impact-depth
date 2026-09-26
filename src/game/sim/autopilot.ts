import { findPath, lineClear, makeClear, steerAvoid } from './pathfinding';
import { getTerrain, hullDepthLimit } from './world';
import type { Autopilot, GameState, Point, Ship } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const combatKinds = new Set(['destroyer', 'patrol', 'cruiser', 'battleship', 'sub']);

/** First-shot grace so selecting a tactic never instantly fires + flees. */
export const TACTIC_SHOT_GRACE = 3.2;

function nearestThreat(state: GameState): Ship | null {
  return (
    state.ships
      .filter((ship) => ship.sinking === undefined && combatKinds.has(ship.kind))
      .sort(
        (a, b) =>
          Math.hypot(a.x - state.submarine.x, a.y - state.submarine.y) -
          Math.hypot(b.x - state.submarine.x, b.y - state.submarine.y),
      )[0] ?? null
  );
}

function targetFor(state: GameState): Ship | null {
  const preferred = state.autopilot.targetId ?? state.selectedTargetId;
  return (
    state.ships.find((ship) => ship.id === preferred && ship.sinking === undefined) ??
    state.ships.find((ship) => ship.sinking === undefined && ship.kind === 'merchant') ??
    state.ships.find((ship) => ship.sinking === undefined) ??
    null
  );
}

function pointAt(origin: Point, heading: number, range: number): Point {
  return { x: origin.x + Math.cos(heading) * range, y: origin.y + Math.sin(heading) * range };
}

function nearerBeamBearing(sub: Point, target: Ship): number {
  const left = target.heading + Math.PI / 2;
  const right = target.heading - Math.PI / 2;
  const leftPt = pointAt(target, left, 1);
  const rightPt = pointAt(target, right, 1);
  return Math.hypot(leftPt.x - sub.x, leftPt.y - sub.y) <=
    Math.hypot(rightPt.x - sub.x, rightPt.y - sub.y)
    ? left
    : right;
}

/**
 * Ambush geometry:
 * - Far: sprint toward a near-beam point on the hull (closes range).
 * - Pocket: face the contact for the shot (fish leave the bow).
 */
function ambushGoal(sub: Point, target: Ship): Point {
  const distance = Math.hypot(target.x - sub.x, target.y - sub.y);
  const beam = nearerBeamBearing(sub, target);
  if (distance > 9) return pointAt(target, beam, Math.min(3.2, distance * 0.18));
  // Inside the fire pocket: aim at a short lead so the boat faces the kill.
  const lead = Math.max(1.2, target.speed * 1.4);
  return pointAt(target, target.heading, lead);
}

/** Stalk: close on the stern quarter, then trail / face for the shot. */
function stalkGoal(sub: Point, target: Ship): Point {
  const distance = Math.hypot(target.x - sub.x, target.y - sub.y);
  const stern = target.heading + Math.PI;
  const beam = nearerBeamBearing(sub, target);
  const quarter = normalize(stern * 0.7 + beam * 0.3);
  if (distance > 11) return pointAt(target, quarter, Math.min(5, distance * 0.25));
  if (distance > 5) return pointAt(target, quarter, Math.min(8.5, Math.max(5, distance)));
  return pointAt(target, target.heading, Math.max(1.2, target.speed * 1.2));
}

/** Intercept: aim at a short lead point; fall back to closing on the hull if lead is behind. */
function interceptGoal(sub: Point, target: Ship): Point {
  const range = Math.hypot(target.x - sub.x, target.y - sub.y);
  const eta = clamp(range / Math.max(0.8, target.speed + 1.5), 0.4, 7);
  const lead = pointAt(target, target.heading, Math.max(2, target.speed * eta));
  const leadRange = Math.hypot(lead.x - sub.x, lead.y - sub.y);
  if (leadRange > range + 2.5) return pointAt(target, target.heading, Math.min(3.5, range * 0.25));
  return lead;
}

function steer(state: GameState, autopilot: Autopilot, goal: Point, dt: number): GameState {
  const sub = state.submarine;
  const clear = makeClear(getTerrain(state.terrainSeed), 0.2);
  const repathTimer = autopilot.repathTimer - dt;
  let path = autopilot.path;
  if (
    repathTimer <= 0 &&
    (!path.length || !lineClear({ x: sub.x, y: sub.y }, path[0]!, clear, 0.75))
  ) {
    path = findPath({ x: sub.x, y: sub.y }, goal, clear, 1400);
  }
  while (path.length && Math.hypot(path[0]!.x - sub.x, path[0]!.y - sub.y) < 0.95)
    path = path.slice(1);
  const nextGoal = path[0] ?? goal;
  const desired = steerAvoid(
    sub.x,
    sub.y,
    Math.atan2(nextGoal.y - sub.y, nextGoal.x - sub.x),
    2.4,
    clear,
  );
  const error = normalize(desired - sub.heading);
  const turnRate = 2.9;
  return {
    ...state,
    submarine: {
      ...sub,
      heading: sub.heading + clamp(error, -turnRate * dt, turnRate * dt),
      waypoint: goal,
    },
    autopilot: { ...autopilot, path, repathTimer: repathTimer <= 0 ? 1 : repathTimer },
  };
}

function setOrders(
  state: GameState,
  targetDepth: number,
  speed: number,
  silent: boolean,
): GameState {
  let depth = targetDepth;
  let next = state;
  if (state.worldVersion !== 'littoral-v2') {
    const limit = hullDepthLimit(
      getTerrain(state.terrainSeed),
      state.submarine.x,
      state.submarine.y,
    );
    if (limit < depth) {
      depth = limit;
      if (!state.messages.some((message) => message.text === 'BOTTOM' && message.ttl > 0)) {
        next = withMessage(state, 'BOTTOM', 1.2);
      }
    }
  }
  const sub = next.submarine;
  const fraction = speed / Math.max(0.01, sub.maxSpeed);
  const speedOrder =
    fraction <= 0.05
      ? 'stop'
      : fraction < 0.4
        ? 'oneThird'
        : fraction < 0.75
          ? 'twoThirds'
          : 'flank';
  return {
    ...next,
    submarine: {
      ...sub,
      targetDepth: depth,
      targetSpeed: speed,
      speedOrder,
      silentRunning: silent,
      scopeUp: false,
      snorkel: false,
    },
  };
}

function withMessage(state: GameState, text: string, ttl = 2.8): GameState {
  return {
    ...state,
    messages: [...state.messages, { id: `ap-${state.tick}-${text}`, text, ttl }],
  };
}

export function updateAutopilot(state: GameState, dt: number): GameState {
  const autopilot = state.autopilot;
  if (!autopilot.enabled) return state;
  if (autopilot.tactic === 'manual')
    return { ...state, autopilot: { ...autopilot, enabled: false, waypoint: null } };
  const threat = nearestThreat(state);
  let target = targetFor(state);
  let next = state;
  let ap: Autopilot = {
    ...autopilot,
    phaseTimer: autopilot.phaseTimer + dt,
    shotTimer: Math.max(0, autopilot.shotTimer - dt),
  };
  const sub = next.submarine;

  // Preferred contact gone (sunk): engagement tactics wait for new orders.
  // Evade/exfil keep running (threat/base) and only clear the dead lock.
  const preferred = ap.targetId ?? state.selectedTargetId;
  if (
    preferred &&
    !state.ships.some((ship) => ship.id === preferred && ship.sinking === undefined)
  ) {
    if (ap.tactic === 'evade' || ap.tactic === 'exfil') {
      ap = { ...ap, targetId: null };
      next = { ...next, selectedTargetId: null };
      target = targetFor({ ...next, autopilot: ap });
    } else {
      return withMessage(
        {
          ...setOrders(
            {
              ...next,
              autopilot: {
                ...ap,
                enabled: false,
                tactic: 'manual',
                phase: 'idle',
                waypoint: null,
                path: [],
                targetId: null,
              },
              selectedTargetId: null,
            },
            0.45,
            0.35,
            true,
          ),
        },
        'CONTACT DESTROYED · HELM MANUAL',
        3.2,
      );
    }
  }

  if ((sub.hp < 28 || sub.sysFlood > 0.45) && !ap.emergency) {
    ap = { ...ap, emergency: true, tactic: 'exfil', phase: 'breakaway', phaseTimer: 0 };
  }

  if (ap.tactic === 'evade' || ap.phase === 'breakaway') {
    const focus = target ?? threat;
    let goal: Point;
    if (focus) {
      const away = Math.atan2(sub.y - focus.y, sub.x - focus.x);
      const lateral = away + Math.PI / 2;
      goal = {
        x: sub.x + Math.cos(away) * 6 + Math.cos(lateral) * 3.5,
        y: sub.y + Math.sin(away) * 6 + Math.sin(lateral) * 3.5,
      };
    } else {
      goal = { x: sub.x + Math.cos(sub.heading) * 8, y: sub.y + Math.sin(sub.heading) * 8 };
    }
    next = setOrders({ ...next, autopilot: ap }, 0.72, sub.maxSpeed * 0.55, true);
    next = steer(next, next.autopilot, goal, dt);
    const breakawayLimit = ap.tactic === 'evade' ? 12 : 3.5;
    if (
      ap.tactic === 'evade' &&
      ap.phaseTimer > breakawayLimit &&
      (!threat || Math.hypot(threat.x - sub.x, threat.y - sub.y) > 16)
    ) {
      next = {
        ...next,
        autopilot: {
          ...next.autopilot,
          enabled: false,
          tactic: 'manual',
          phase: 'idle',
          waypoint: null,
          path: [],
        },
      };
    } else if (ap.tactic !== 'evade' && ap.phaseTimer > breakawayLimit) {
      next = {
        ...next,
        autopilot: {
          ...next.autopilot,
          phase: 'approach',
          phaseTimer: 0,
          path: [],
          repathTimer: 0,
        },
      };
    }
    return next;
  }

  if (ap.tactic === 'exfil') {
    const distance = Math.hypot(sub.x - state.base.x, sub.y - state.base.y);
    if (ap.phase === 'dock' && sub.hp >= 28 && sub.sysFlood <= 0.45) {
      return setOrders(
        {
          ...next,
          autopilot: { ...ap, emergency: false, enabled: false, tactic: 'manual', phase: 'idle' },
        },
        0.2,
        0,
        false,
      );
    }
    if (distance < state.base.radius * 0.9) {
      return setOrders({ ...next, autopilot: { ...ap, phase: 'dock', path: [] } }, 0.2, 0, false);
    }
    if (
      distance > state.base.radius &&
      state.time > 170 &&
      !next.messages.some((message) => message.text === 'CANNOT REACH BASE')
    ) {
      next = withMessage(next, 'CANNOT REACH BASE', 20);
    }
    next = setOrders(
      { ...next, autopilot: ap },
      threat && threat.alert > 0.4 ? 0.72 : 0.45,
      sub.maxSpeed * (threat ? 0.5 : 0.85),
      !!threat,
    );
    return steer(next, next.autopilot, state.base, dt);
  }

  target = targetFor({ ...next, autopilot: ap });
  if (!target) {
    return withMessage(
      {
        ...setOrders(
          {
            ...next,
            autopilot: {
              ...ap,
              enabled: false,
              tactic: 'manual',
              phase: 'idle',
              waypoint: null,
              path: [],
              targetId: null,
            },
          },
          0.45,
          0.35,
          true,
        ),
        selectedTargetId: null,
      },
      'NO CONTACT · HELM MANUAL',
      2.8,
    );
  }

  const distance = Math.hypot(target.x - sub.x, target.y - sub.y);
  let goal: Point;
  if (ap.tactic === 'ambush') {
    goal = ambushGoal(sub, target);
    if (distance < 9) ap = { ...ap, phase: 'setup' };
    else if (ap.phase !== 'approach' && ap.phase !== 'setup') ap = { ...ap, phase: 'approach' };
    const silent = ap.phase === 'setup' || distance < 7.5;
    const speed =
      distance > 14 ? sub.maxSpeed * 0.95 : distance > 9 ? sub.maxSpeed * 0.7 : sub.maxSpeed * 0.4;
    next = setOrders(
      { ...next, selectedTargetId: target.id, autopilot: { ...ap, targetId: target.id } },
      ap.phase === 'setup' ? 0.28 : 0.5,
      speed,
      silent,
    );
  } else if (ap.tactic === 'stalk') {
    goal = stalkGoal(sub, target);
    if (distance < 11) ap = { ...ap, phase: 'setup' };
    else if (ap.phase !== 'approach' && ap.phase !== 'setup') ap = { ...ap, phase: 'approach' };
    const silent = distance < 11;
    const speed = distance > 16 ? sub.maxSpeed * 0.85 : sub.maxSpeed * 0.45;
    next = setOrders(
      { ...next, selectedTargetId: target.id, autopilot: { ...ap, targetId: target.id } },
      distance < 8 ? 0.55 : 0.42,
      speed,
      silent,
    );
  } else {
    goal = interceptGoal(sub, target);
    if (distance < 9) ap = { ...ap, phase: 'setup' };
    else if (ap.phase !== 'approach' && ap.phase !== 'setup') ap = { ...ap, phase: 'approach' };
    const silent = distance < 8;
    const speed = distance > 12 ? sub.maxSpeed * 0.95 : sub.maxSpeed * 0.7;
    next = setOrders(
      { ...next, selectedTargetId: target.id, autopilot: { ...ap, targetId: target.id } },
      distance < 8 ? 0.32 : 0.45,
      speed,
      silent,
    );
  }
  return steer(next, next.autopilot, goal, dt);
}
