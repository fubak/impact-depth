import type { GameCommand } from '../commands/types';
import { clampDepth, clampSim } from './coords';
import type { GameState, SpeedOrder } from './types';
import { SEAMOUNT_CRUSH_DPS } from './constants';
import { getTerrain, isCrushedBySeamount, isLand, snapToNavigable } from './world';

type System = (state: GameState, commands: GameCommand[], dt: number) => GameState;
export const SYSTEM_ORDER = [
  'applyCommands',
  'autopilot',
  'submarine',
  'worldCollision',
  'sonar',
  'enemies',
  'ordnance',
  'damage',
  'pickupsWaves',
  'cleanupEvents',
] as const;
const speedFraction: Record<SpeedOrder, number> = {
  stop: 0,
  oneThird: 0.33,
  twoThirds: 0.66,
  flank: 1,
};
const depthTarget = { surface: 0.05, periscope: 0.28, attack: 0.5, deep: 0.82 };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export const systems: Record<(typeof SYSTEM_ORDER)[number], System> = {
  applyCommands(state, commands) {
    let next = state;
    for (const command of commands) {
      if (command.type === 'helm') {
        next = {
          ...next,
          submarine: {
            ...next.submarine,
            heading: next.submarine.heading + (command.yaw * 0.85) / 60,
            targetSpeed: clamp(
              next.submarine.targetSpeed + command.surge * 0.1,
              0,
              next.submarine.maxSpeed,
            ),
            targetDepth: clampDepth(next.submarine.targetDepth + command.depth * 0.015),
          },
        };
      } else if (command.type === 'setDepthOrder')
        next = {
          ...next,
          submarine: { ...next.submarine, targetDepth: depthTarget[command.order] },
        };
      else if (command.type === 'setSpeedOrder')
        next = {
          ...next,
          submarine: {
            ...next.submarine,
            speedOrder: command.order,
            targetSpeed: next.submarine.maxSpeed * speedFraction[command.order],
          },
        };
      else if (command.type === 'setPhase') next = { ...next, phase: command.phase };
      else if (command.type === 'setWeapon') next = { ...next, weaponMode: command.weapon };
      else if (command.type === 'setViewMode') next = { ...next, viewMode: command.viewMode };
      else if (command.type === 'setAutopilot')
        next = {
          ...next,
          autopilot: { ...next.autopilot, enabled: true, waypoint: command.waypoint },
        };
      else if (command.type === 'cancelAutopilot')
        next = { ...next, autopilot: { ...next.autopilot, enabled: false, waypoint: null } };
      else if (command.type === 'selectTarget') next = { ...next, selectedTargetId: command.id };
      else if (command.type === 'toggleSilentRunning')
        next = {
          ...next,
          submarine: { ...next.submarine, silentRunning: !next.submarine.silentRunning },
        };
      else if (
        command.type === 'fireWeapon' &&
        next.submarine.torpedoes > 0 &&
        next.submarine.reloadMk14 <= 0
      ) {
        const target = next.ships.find((ship) => ship.id === next.selectedTargetId);
        const heading = target
          ? Math.atan2(target.y - next.submarine.y, target.x - next.submarine.x)
          : next.submarine.heading;
        next = {
          ...next,
          submarine: {
            ...next.submarine,
            torpedoes: next.submarine.torpedoes - 1,
            reloadMk14: next.submarine.reloadMk14Max,
          },
          torpedoes: [
            ...next.torpedoes,
            {
              id: `mk14-${next.tick}`,
              owner: 'player',
              x: next.submarine.x,
              y: next.submarine.y,
              z: next.submarine.z,
              heading,
              speed: 9.5,
              life: 8,
              armDelay: 0.4,
              damage: 48,
              targetId: target?.id ?? null,
            },
          ],
          stats: { ...next.stats, torpedoesFired: next.stats.torpedoesFired + 1 },
          messages: [...next.messages, { id: `fire-${next.tick}`, text: 'MK-14 AWAY', ttl: 2 }],
        };
      }
    }
    return next;
  },
  autopilot(state) {
    const waypoint = state.autopilot.waypoint;
    if (!state.autopilot.enabled || !waypoint) return state;
    const dx = waypoint.x - state.submarine.x;
    const dy = waypoint.y - state.submarine.y;
    if (Math.hypot(dx, dy) < 0.5)
      return { ...state, autopilot: { ...state.autopilot, enabled: false, waypoint: null } };
    const desired = Math.atan2(dy, dx);
    let delta = desired - state.submarine.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return {
      ...state,
      submarine: {
        ...state.submarine,
        heading: state.submarine.heading + clamp(delta, -0.9 / 60, 0.9 / 60),
      },
    };
  },
  submarine(state, _commands, dt) {
    const sub = { ...state.submarine };
    const depthFactor = sub.z < 0.2 ? 1.05 : sub.z > 0.7 ? 0.72 : 0.9;
    const wanted = Math.min(
      sub.targetSpeed,
      sub.maxSpeed * depthFactor,
      sub.silentRunning ? sub.maxSpeed * 0.28 : Infinity,
    );
    sub.speed += (wanted - sub.speed) * Math.min(1, 1.8 * dt);
    sub.z = clampDepth(sub.z + (sub.targetDepth - sub.z) * Math.min(1, 1.8 * dt));
    sub.x += Math.cos(sub.heading) * sub.speed * dt;
    sub.y += Math.sin(sub.heading) * sub.speed * dt;
    sub.battery = clamp(
      sub.battery - (0.8 + sub.speed * sub.speed * (sub.silentRunning ? 1.1 : 4.2)) * dt,
      0,
      sub.maxBattery,
    );
    sub.noise = clamp(
      0.08 + (sub.speed / Math.max(0.01, sub.maxSpeed)) * 0.55,
      0.05,
      sub.silentRunning ? 0.18 : 1,
    );
    return { ...state, submarine: sub };
  },
  worldCollision(state, _commands, dt) {
    const sub = state.submarine;
    const terrain = getTerrain(state.terrainSeed);
    const point = isLand(terrain, sub.x, sub.y)
      ? snapToNavigable(terrain, sub.x, sub.y, sub.z)
      : { x: clampSim(sub.x), y: clampSim(sub.y) };
    const hp = clamp(
      sub.hp -
        (isCrushedBySeamount(terrain, point.x, point.y, sub.z) ? SEAMOUNT_CRUSH_DPS * dt : 0),
      0,
      sub.maxHp,
    );
    return { ...state, submarine: { ...sub, ...point, z: clampDepth(sub.z), hp } };
  },
  sonar(state) {
    return {
      ...state,
      sonarContacts: state.ships
        .filter((ship) => !ship.sinking)
        .map((ship) => ({ id: ship.id, x: ship.x, y: ship.y, strength: 1, age: 0 })),
    };
  },
  enemies(state, _commands, dt) {
    return {
      ...state,
      ships: state.ships.map((ship) => ({
        ...ship,
        x: clampSim(ship.x + Math.cos(ship.heading) * ship.speed * dt),
        y: clampSim(ship.y + Math.sin(ship.heading) * ship.speed * dt),
      })),
    };
  },
  ordnance(state, _commands, dt) {
    const ships = state.ships.map((ship) => ({ ...ship }));
    const torpedoes = state.torpedoes.flatMap((torpedo) => {
      const next = {
        ...torpedo,
        x: torpedo.x + Math.cos(torpedo.heading) * torpedo.speed * dt,
        y: torpedo.y + Math.sin(torpedo.heading) * torpedo.speed * dt,
        life: torpedo.life - dt,
        armDelay: torpedo.armDelay - dt,
      };
      const target = next.targetId ? ships.find((ship) => ship.id === next.targetId) : undefined;
      if (
        next.armDelay <= 0 &&
        target &&
        !target.sinking &&
        Math.hypot(next.x - target.x, next.y - target.y) <= 3
      ) {
        target.hp -= next.damage;
        if (target.hp <= 0) target.sinking = 0.05;
        return [];
      }
      return next.life > 0 ? [next] : [];
    });
    const reload = Math.max(0, state.submarine.reloadMk14 - dt);
    return { ...state, ships, torpedoes, submarine: { ...state.submarine, reloadMk14: reload } };
  },
  damage(state, _commands, dt) {
    let sunk = 0;
    const ships = state.ships.flatMap((ship) => {
      if (ship.sinking === undefined) return [ship];
      const sinking = ship.sinking - dt;
      if (sinking > 0) return [{ ...ship, sinking }];
      sunk++;
      return [];
    });
    if (!sunk) return ships === state.ships ? state : { ...state, ships };
    return {
      ...state,
      phase: 'victory',
      ships,
      selectedTargetId: null,
      stats: {
        ...state.stats,
        shipsSunk: state.stats.shipsSunk + sunk,
        score: state.stats.score + sunk * 150,
        damageDealt: state.stats.damageDealt + sunk * 48,
      },
      messages: [
        ...state.messages,
        { id: `sunk-${state.tick}`, text: 'FREIGHTER SUNK · PATROL COMPLETE', ttl: 6 },
      ],
    };
  },
  pickupsWaves: (state) => state,
  cleanupEvents: (state) => ({
    ...state,
    messages: state.messages
      .filter((message) => message.ttl > 0)
      .map((message) => ({ ...message, ttl: message.ttl - 1 / 60 })),
  }),
};
