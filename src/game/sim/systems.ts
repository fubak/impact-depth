import type { GameCommand } from '../commands/types';
import { clampDepth, clampSim } from './coords';
import type { GameState, SpeedOrder } from './types';

type System = (state: GameState, commands: GameCommand[], dt: number) => GameState;
export const SYSTEM_ORDER = ['applyCommands', 'autopilot', 'submarine', 'worldCollision', 'sonar', 'enemies', 'ordnance', 'damage', 'pickupsWaves', 'cleanupEvents'] as const;
const speedFraction: Record<SpeedOrder, number> = { stop: 0, oneThird: 0.33, twoThirds: 0.66, flank: 1 };
const depthTarget = { surface: 0.05, periscope: 0.28, attack: 0.5, deep: 0.82 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export const systems: Record<(typeof SYSTEM_ORDER)[number], System> = {
  applyCommands(state, commands) {
    let next = state;
    for (const command of commands) {
      if (command.type === 'helm') {
        next = { ...next, submarine: { ...next.submarine, heading: next.submarine.heading + command.yaw * 0.85 / 60, targetSpeed: clamp(next.submarine.targetSpeed + command.surge * 0.1, 0, next.submarine.maxSpeed), targetDepth: clampDepth(next.submarine.targetDepth + command.depth * 0.015) } };
      } else if (command.type === 'setDepthOrder') next = { ...next, submarine: { ...next.submarine, targetDepth: depthTarget[command.order] } };
      else if (command.type === 'setSpeedOrder') next = { ...next, submarine: { ...next.submarine, speedOrder: command.order, targetSpeed: next.submarine.maxSpeed * speedFraction[command.order] } };
      else if (command.type === 'setPhase') next = { ...next, phase: command.phase };
      else if (command.type === 'setWeapon') next = { ...next, weaponMode: command.weapon };
      else if (command.type === 'setViewMode') next = { ...next, viewMode: command.viewMode };
      else if (command.type === 'setAutopilot') next = { ...next, autopilot: { ...next.autopilot, enabled: true, waypoint: command.waypoint } };
      else if (command.type === 'cancelAutopilot') next = { ...next, autopilot: { ...next.autopilot, enabled: false, waypoint: null } };
    }
    return next;
  },
  autopilot: (state) => state,
  submarine(state, _commands, dt) {
    const sub = { ...state.submarine };
    const depthFactor = sub.z < 0.2 ? 1.05 : sub.z > 0.7 ? 0.72 : 0.9;
    const wanted = Math.min(sub.targetSpeed, sub.maxSpeed * depthFactor, sub.silentRunning ? sub.maxSpeed * 0.28 : Infinity);
    sub.speed += (wanted - sub.speed) * Math.min(1, 1.8 * dt);
    sub.z = clampDepth(sub.z + (sub.targetDepth - sub.z) * Math.min(1, 1.8 * dt));
    sub.x += Math.cos(sub.heading) * sub.speed * dt;
    sub.y += Math.sin(sub.heading) * sub.speed * dt;
    sub.battery = clamp(sub.battery - (0.8 + sub.speed * sub.speed * (sub.silentRunning ? 1.1 : 4.2)) * dt, 0, sub.maxBattery);
    sub.noise = clamp(0.08 + (sub.speed / Math.max(0.01, sub.maxSpeed)) * 0.55, 0.05, sub.silentRunning ? 0.18 : 1);
    return { ...state, submarine: sub };
  },
  worldCollision(state) {
    const sub = state.submarine;
    return { ...state, submarine: { ...sub, x: clampSim(sub.x), y: clampSim(sub.y), z: clampDepth(sub.z) } };
  },
  sonar: (state) => state,
  enemies(state, _commands, dt) {
    return { ...state, ships: state.ships.map((ship) => ({ ...ship, x: clampSim(ship.x + Math.cos(ship.heading) * ship.speed * dt), y: clampSim(ship.y + Math.sin(ship.heading) * ship.speed * dt) })) };
  },
  ordnance: (state) => state,
  damage: (state) => state,
  pickupsWaves: (state) => state,
  cleanupEvents: (state) => ({ ...state, messages: state.messages.filter((message) => message.ttl > 0).map((message) => ({ ...message, ttl: message.ttl - 1 / 60 })) }),
};
