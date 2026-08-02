import { findPath, lineClear, makeClear, steerAvoid } from './pathfinding';
import { getTerrain } from './world';
import type { Autopilot, GameState, Point, Ship } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const combatKinds = new Set(['destroyer', 'patrol', 'cruiser', 'battleship', 'sub']);

function nearestThreat(state: GameState): Ship | null {
  return state.ships
    .filter((ship) => ship.sinking === undefined && combatKinds.has(ship.kind))
    .sort((a, b) => Math.hypot(a.x - state.submarine.x, a.y - state.submarine.y) - Math.hypot(b.x - state.submarine.x, b.y - state.submarine.y))[0] ?? null;
}

function targetFor(state: GameState): Ship | null {
  const preferred = state.autopilot.targetId ?? state.selectedTargetId;
  return state.ships.find((ship) => ship.id === preferred && ship.sinking === undefined)
    ?? state.ships.find((ship) => ship.sinking === undefined && ship.kind === 'merchant')
    ?? state.ships.find((ship) => ship.sinking === undefined)
    ?? null;
}

function steer(state: GameState, autopilot: Autopilot, goal: Point, dt: number): GameState {
  const sub = state.submarine;
  const clear = makeClear(getTerrain(state.terrainSeed), 0.2);
  const repathTimer = autopilot.repathTimer - dt;
  let path = autopilot.path;
  if (repathTimer <= 0 && (!path.length || !lineClear({ x: sub.x, y: sub.y }, path[0]!, clear, 0.75))) {
    path = findPath({ x: sub.x, y: sub.y }, goal, clear, 700);
  }
  while (path.length && Math.hypot(path[0]!.x - sub.x, path[0]!.y - sub.y) < 0.95) path = path.slice(1);
  const nextGoal = path[0] ?? goal;
  const desired = steerAvoid(sub.x, sub.y, Math.atan2(nextGoal.y - sub.y, nextGoal.x - sub.x), 2.4, clear);
  return {
    ...state,
    submarine: { ...sub, heading: sub.heading + clamp(normalize(desired - sub.heading), -1.65 * dt, 1.65 * dt), waypoint: goal },
    autopilot: { ...autopilot, path, repathTimer: repathTimer <= 0 ? 1 : repathTimer },
  };
}

function setOrders(state: GameState, targetDepth: number, speed: number, silent: boolean): GameState {
  const sub = state.submarine;
  return { ...state, submarine: { ...sub, targetDepth, targetSpeed: speed, silentRunning: silent, scopeUp: false, snorkel: false } };
}

export function updateAutopilot(state: GameState, dt: number): GameState {
  const autopilot = state.autopilot;
  if (!autopilot.enabled) return state;
  if (autopilot.tactic === 'manual') return { ...state, autopilot: { ...autopilot, enabled: false, waypoint: null } };
  const threat = nearestThreat(state);
  const target = targetFor(state);
  let next = state;
  let ap: Autopilot = { ...autopilot, phaseTimer: autopilot.phaseTimer + dt, shotTimer: Math.max(0, autopilot.shotTimer - dt) };
  const sub = next.submarine;

  if (sub.hp < 28 || sub.sysFlood > 0.45) ap = { ...ap, tactic: 'exfil', phase: 'breakaway', phaseTimer: 0 };
  if (ap.tactic === 'evade' || ap.phase === 'breakaway') {
    const away = threat ? Math.atan2(sub.y - threat.y, sub.x - threat.x) : sub.heading;
    next = setOrders({ ...next, autopilot: ap }, 0.8, sub.maxSpeed * 0.28, true);
    next = steer(next, next.autopilot, { x: sub.x + Math.cos(away) * 14, y: sub.y + Math.sin(away) * 14 }, dt);
    if (ap.tactic === 'evade' && ap.phaseTimer > 12 && (!threat || Math.hypot(threat.x - sub.x, threat.y - sub.y) > 16)) next = { ...next, autopilot: { ...next.autopilot, enabled: false, tactic: 'manual', phase: 'idle', waypoint: null } };
    else if (ap.tactic !== 'evade' && ap.tactic !== 'exfil' && ap.phaseTimer > 8) next = { ...next, autopilot: { ...next.autopilot, phase: 'approach', phaseTimer: 0 } };
    return next;
  }
  if (ap.tactic === 'exfil') {
    const distance = Math.hypot(sub.x - state.base.x, sub.y - state.base.y);
    if (distance < state.base.radius * 0.9) return setOrders({ ...next, autopilot: { ...ap, phase: 'dock', path: [] } }, 0.2, 0, false);
    next = setOrders({ ...next, autopilot: ap }, threat && threat.alert > 0.4 ? 0.72 : 0.45, sub.maxSpeed * (threat ? 0.28 : 0.7), !!threat);
    return steer(next, next.autopilot, state.base, dt);
  }
  if (!target) return setOrders({ ...next, autopilot: ap }, 0.55, 0.2, true);

  const distance = Math.hypot(target.x - sub.x, target.y - sub.y);
  const beam = target.heading + (target.id.length % 2 ? Math.PI / 2 : -Math.PI / 2);
  let goal: Point;
  if (ap.tactic === 'ambush') {
    goal = { x: target.x + Math.cos(beam) * 5.5, y: target.y + Math.sin(beam) * 5.5 };
    if (distance < 7.5) ap = { ...ap, phase: 'setup' };
    next = setOrders({ ...next, selectedTargetId: target.id, autopilot: ap }, ap.phase === 'setup' ? 0.28 : 0.65, sub.maxSpeed * 0.22, true);
  } else if (ap.tactic === 'stalk') {
    const behind = target.heading + Math.PI;
    goal = { x: target.x + Math.cos(behind) * 10, y: target.y + Math.sin(behind) * 10 };
    next = setOrders({ ...next, selectedTargetId: target.id, autopilot: ap }, distance < 8 ? 0.55 : 0.48, sub.maxSpeed * 0.2, true);
  } else {
    const lead = Math.max(2, target.speed * 2.5);
    goal = { x: target.x + Math.cos(target.heading) * lead, y: target.y + Math.sin(target.heading) * lead };
    next = setOrders({ ...next, selectedTargetId: target.id, autopilot: ap }, distance < 8 ? 0.32 : 0.5, sub.maxSpeed * (distance > 12 ? 0.85 : 0.5), distance > 12);
  }
  return steer(next, next.autopilot, goal, dt);
}
