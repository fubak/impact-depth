import type { GameCommand } from '../commands/types';
import { clampDepth, clampSim } from './coords';
import { seedPowerups, seedWave } from './create';
import type {
  Countermeasure,
  GameState,
  Powerup,
  Ship,
  ShipKind,
  SpeedOrder,
  ThreatKind,
  Torpedo,
} from './types';
import {
  BUBBLE_LIFE, BUBBLE_RADIUS, DOCK_HOLD, DOCK_SPEED_MAX, FIRE_MAX_DEPTH, FIRE_MIN_DEPTH,
  FOXER_LIFE, FOXER_RADIUS, MAX_TIER, PICKUP_LIFE, PICKUP_MAX, PICKUP_RADIUS,
  PICKUP_RESPAWN, SEAMOUNT_CRUSH_DPS, VICTORY_TARGET,
} from './constants';
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
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const shipScore: Record<ShipKind, number> = {
  battleship: 700,
  sub: 550,
  cruiser: 400,
  destroyer: 300,
  patrol: 150,
  merchant: 150,
};
const scoreFor = (ship: Ship) => shipScore[ship.kind];
const shipRadius = (ship: Ship) => {
  switch (ship.kind) {
    case 'sub':
      return 1.55;
    case 'battleship':
      return 1.25;
    default:
      return 0.95;
  }
};
const inFob = (state: GameState, x = state.submarine.x, y = state.submarine.y) =>
  Math.hypot(x - state.base.x, y - state.base.y) <= state.base.radius;
const turnToward = (heading: number, target: number, rate: number, dt: number) =>
  heading + clamp(normalizeAngle(target - heading), -rate * dt, rate * dt);

function makeTorpedo(state: GameState, kind: 'mk14' | 'mk18', targetId: string | null, offset = 0): Torpedo {
  const target = targetId ? state.ships.find((ship) => ship.id === targetId) : undefined;
  const sub = state.submarine;
  return {
    id: `${kind}-${state.tick}-${offset}`, owner: 'player', kind, sourceId: 'player',
    x: sub.x, y: sub.y, z: sub.z,
    heading: (target ? Math.atan2(target.y - sub.y, target.x - sub.x) : sub.heading) + offset,
    speed: kind === 'mk14' ? 9.5 : 8.2, life: kind === 'mk14' ? 8 : 10,
    armDelay: kind === 'mk14' ? 0.4 : 0.6,
    damage: (kind === 'mk14' ? 48 : 58) * (1 + sub.weaponTier * 0.18) * (0.7 + sub.sysTubes * 0.3),
    targetId, turnRate: kind === 'mk14' ? 2.2 : 2.8,
  };
}

function makeThreat(state: GameState, kind: ThreatKind, sourceId: string, targetId?: string) {
  const source = state.ships.find((ship) => ship.id === sourceId);
  if (!source || inFob(state)) return null;
  const target = targetId === 'player' || !targetId ? state.submarine : undefined;
  if (!target) return null;
  const heading = Math.atan2(target.y - source.y, target.x - source.x);
  if (kind === 'torpedo') {
    return { torpedo: { id: `enemy-${state.tick}`, owner: 'enemy' as const, kind: 'enemy' as const, sourceId, x: source.x, y: source.y, z: 0.5, heading, speed: 7.5, life: 9, armDelay: 0, damage: 42, targetId: 'player', turnRate: 2.4 } };
  }
  const threatStats = {
    depthCharge: { fuse: 1.5, damage: 45, radius: 2.2 },
    hedgehog: { fuse: 0.95, damage: 27, radius: 0.85 },
    shell: { fuse: 0.35, damage: 22, radius: 0.8 },
    bomb: { fuse: 1.1, damage: 28, radius: 1.8 },
  };
  const values = threatStats[kind];
  return { charge: { id: `${kind}-${state.tick}`, kind, sourceId, x: source.x, y: source.y, z: 0.05, vz: kind === 'shell' ? 0 : 1.6, fuse: values.fuse, damage: values.damage, radius: values.radius, targetDepth: target.z } };
}

function applyPlayerDamage(sub: GameState['submarine'], damage: number) {
  const actual = damage * (1 - Math.min(0.28, sub.hullTier * 0.08));
  return {
    ...sub,
    hp: clamp(sub.hp - actual, 0, sub.maxHp),
    sysSonar: clamp(sub.sysSonar - actual / 700, 0, 1),
    sysPropulsion: clamp(sub.sysPropulsion - actual / 550, 0.2, 1),
    sysTubes: clamp(sub.sysTubes - actual / 650, 0, 1),
    sysFlood: clamp(sub.sysFlood + actual / 500, 0, 1),
    crewStress: clamp(sub.crewStress + actual / 150, 0, 1),
  };
}

function applyPickup(sub: GameState['submarine'], pickup: Powerup): GameState['submarine'] {
  switch (pickup.kind) {
    case 'health': return { ...sub, hp: clamp(sub.hp + 35, 0, sub.maxHp) };
    case 'ammo': return { ...sub, torpedoes: sub.maxTorpedoes, seekers: Math.min(sub.maxSeekers, sub.seekers + 2) };
    case 'hull': {
      if (sub.hullTier >= MAX_TIER) return sub;
      const maxHp = sub.maxHp + 20;
      return { ...sub, hullTier: sub.hullTier + 1, maxHp, hp: clamp(sub.hp + 20, 0, maxHp) };
    }
    case 'weapon': return { ...sub, weaponTier: Math.min(MAX_TIER, sub.weaponTier + 1) };
    case 'speed': return sub.speedTier >= MAX_TIER ? sub : { ...sub, speedTier: sub.speedTier + 1, maxSpeed: sub.maxSpeed + 0.18 };
    case 'counter': return { ...sub, cmCharges: sub.maxCmCharges, decoys: 3 };
  }
}

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
      else if (command.type === 'deployBubble' && next.submarine.cmCharges > 0 && next.submarine.cmCooldown <= 0) {
        const cm: Countermeasure = { id: `bubble-${next.tick}`, kind: 'bubble', x: next.submarine.x, y: next.submarine.y, z: next.submarine.z, life: BUBBLE_LIFE, radius: BUBBLE_RADIUS };
        next = { ...next, submarine: { ...next.submarine, cmCharges: next.submarine.cmCharges - 1, cmCooldown: 6 }, countermeasures: [...next.countermeasures, cm] };
      } else if (command.type === 'spawnThreat') {
        const threat = makeThreat(next, command.threat, command.sourceId, command.targetId);
        if (threat) next = { ...next, torpedoes: threat.torpedo ? [...next.torpedoes, threat.torpedo] : next.torpedoes, depthCharges: threat.charge ? [...next.depthCharges, threat.charge] : next.depthCharges };
      } else if (command.type === 'fireWeapon') {
        const sub = next.submarine;
        const target = next.ships.find((ship) => ship.id === next.selectedTargetId)
          ?? next.ships.find((ship) => Math.hypot(ship.x - sub.x, ship.y - sub.y) <= 6);
        const canFire = sub.z >= FIRE_MIN_DEPTH && sub.z <= FIRE_MAX_DEPTH && sub.sysTubes >= 0.35;
        if (!canFire) continue;
        if (next.weaponMode === 'decoy' && sub.decoys > 0) {
          const cm: Countermeasure = { id: `foxer-${next.tick}`, kind: 'foxer', x: sub.x, y: sub.y, z: sub.z, life: FOXER_LIFE, radius: FOXER_RADIUS };
          next = { ...next, submarine: { ...sub, decoys: sub.decoys - 1 }, countermeasures: [...next.countermeasures, cm] };
        } else if (next.weaponMode === 'seeker' && sub.seekers > 0 && sub.reloadMk18 <= 0) {
          next = { ...next, submarine: { ...sub, seekers: sub.seekers - 1, reloadMk18: Math.max(1.4, sub.reloadMk18Max - sub.weaponTier * 0.22), noise: clamp(sub.noise + 0.35, 0, 1) }, torpedoes: [...next.torpedoes, makeTorpedo(next, 'mk18', target?.id ?? null)], stats: { ...next.stats, torpedoesFired: next.stats.torpedoesFired + 1 } };
        } else if (next.weaponMode === 'torpedo' && sub.torpedoes > 0 && sub.reloadMk14 <= 0) {
          const count = next.torpedoSpread ? Math.min(3, sub.torpedoes) : 1;
          const offsets = count === 3 ? [-0.12, 0, 0.12] : count === 2 ? [-0.08, 0.08] : [0];
          next = { ...next, submarine: { ...sub, torpedoes: sub.torpedoes - count, reloadMk14: Math.max(1.4, (count > 1 ? 3.8 : sub.reloadMk14Max) - sub.weaponTier * 0.22), noise: clamp(sub.noise + 0.35, 0, 1) }, torpedoes: [...next.torpedoes, ...offsets.map((offset) => makeTorpedo(next, 'mk14', target?.id ?? null, offset))], stats: { ...next.stats, torpedoesFired: next.stats.torpedoesFired + count } };
        }
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
      sub.battery <= 0 && !sub.snorkel && sub.z > 0.12 ? 0.35 : Infinity,
      sub.maxSpeed * (0.45 + sub.sysPropulsion * 0.55),
    );
    sub.speed += (wanted - sub.speed) * Math.min(1, 1.8 * dt);
    sub.z = clampDepth(sub.z + (sub.targetDepth - sub.z) * Math.min(1, 1.8 * dt));
    sub.x += Math.cos(sub.heading) * sub.speed * dt;
    sub.y += Math.sin(sub.heading) * sub.speed * dt;
    if (sub.scopeUp && sub.z > 0.4) sub.scopeUp = false;
    if (sub.snorkel && (sub.z < 0.12 || sub.z > 0.42)) sub.snorkel = false;
    const drain = 0.8 + sub.speed * sub.speed * (sub.silentRunning ? 1.1 : 4.2) + (sub.scopeUp ? 0.35 : 0);
    const charge = sub.z < 0.12 ? 9 : sub.snorkel ? 4.5 : 0;
    sub.battery = clamp(sub.battery + (charge - drain) * dt, 0, sub.maxBattery);
    sub.sysFlood = clamp(sub.sysFlood - (sub.sysFlood < 0.5 && sub.battery > 10 ? 0.08 * dt : 0), 0, 1);
    sub.hp = clamp(sub.hp - 4.5 * sub.sysFlood * dt, 0, sub.maxHp);
    sub.crewStress = clamp(sub.crewStress - 0.02 * dt, 0, 1);
    sub.reloadMk14 = Math.max(0, sub.reloadMk14 - dt);
    sub.reloadMk18 = Math.max(0, sub.reloadMk18 - dt);
    sub.cmCooldown = Math.max(0, sub.cmCooldown - dt);
    sub.noise = clamp(
      0.08 + (sub.speed / Math.max(0.01, sub.maxSpeed)) * 0.55 + (sub.snorkel ? 0.2 : 0) + (1 - sub.sysSonar) * 0.1,
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
        (!inFob(state, point.x, point.y) && isCrushedBySeamount(terrain, point.x, point.y, sub.z) ? SEAMOUNT_CRUSH_DPS * dt : 0),
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
    let submarine = { ...state.submarine };
    const torpedoes = state.torpedoes.flatMap((torpedo) => {
      let next = {
        ...torpedo,
        x: torpedo.x + Math.cos(torpedo.heading) * torpedo.speed * dt,
        y: torpedo.y + Math.sin(torpedo.heading) * torpedo.speed * dt,
        life: torpedo.life - dt,
        armDelay: torpedo.armDelay - dt,
      };
      if (next.kind === 'mk18' && next.targetId) {
        const target = ships.find((ship) => ship.id === next.targetId);
        if (target) next = { ...next, heading: turnToward(next.heading, Math.atan2(target.y - next.y, target.x - next.x), next.turnRate, dt) };
      }
      const target = next.targetId ? ships.find((ship) => ship.id === next.targetId) : undefined;
      if (
        next.armDelay <= 0 &&
        target &&
        !target.sinking &&
        Math.hypot(next.x - target.x, next.y - target.y) <= shipRadius(target)
      ) {
        target.hp -= next.damage;
        if (target.hp <= 0) target.sinking = 0.05;
        return [];
      }
      if (next.owner === 'enemy' && next.armDelay <= 0 && Math.hypot(next.x - submarine.x, next.y - submarine.y) <= 0.95 && Math.abs(next.z - submarine.z) < 0.4 && !inFob(state)) {
        submarine = applyPlayerDamage(submarine, next.damage);
        return [];
      }
      return next.life > 0 ? [next] : [];
    });
    const depthCharges = state.depthCharges.flatMap((charge) => {
      const next = { ...charge, z: clampDepth(charge.z + charge.vz * dt), fuse: charge.fuse - dt };
      if (next.fuse > 0) return [next];
      const distance = Math.hypot(next.x - submarine.x, next.y - submarine.y);
      if (!inFob(state) && distance <= next.radius && Math.abs(next.targetDepth - submarine.z) <= next.radius) {
        const bubble = state.countermeasures.some((cm) => cm.kind === 'bubble' && Math.hypot(cm.x - submarine.x, cm.y - submarine.y) <= cm.radius);
        submarine = applyPlayerDamage(submarine, next.damage * (1 - distance / next.radius) * (bubble ? 0.75 : 1));
      }
      return [];
    });
    return { ...state, ships, torpedoes, depthCharges, submarine };
  },
  damage(state, _commands, dt) {
    let sunk = 0;
    let sunkScore = 0;
    let sunkDamage = 0;
    const ships = state.ships.flatMap((ship) => {
      if (ship.sinking === undefined) return [ship];
      const sinking = ship.sinking - dt;
      if (sinking > 0) return [{ ...ship, sinking }];
      sunk++;
      sunkScore += scoreFor(ship);
      sunkDamage += ship.maxHp;
      return [];
    });
    if (!sunk) return ships === state.ships ? state : { ...state, ships };
    const shipsSunk = state.stats.shipsSunk + sunk;
    const waveCleared = ships.length === 0;
    const victory = waveCleared && shipsSunk >= VICTORY_TARGET;
    return {
      ...state,
      ships,
      selectedTargetId: null,
      stats: {
        ...state.stats,
        shipsSunk,
        score: state.stats.score + sunkScore + (victory ? 1000 : 0),
        damageDealt: state.stats.damageDealt + sunkDamage,
      },
      messages: [
        ...state.messages,
        { id: `sunk-${state.tick}`, text: victory ? 'SECTOR CLEARED' : 'SHIP SUNK', ttl: 6 },
      ],
      ...(victory ? { phase: 'victory' as const } : {}),
    };
  },
  pickupsWaves(state, _commands, dt) {
    const nearBase = inFob(state);
    const docked = nearBase && state.submarine.speed < DOCK_SPEED_MAX;
    const dockHold = docked ? state.dockHold + dt : 0;
    let sub = { ...state.submarine, docked: dockHold >= DOCK_HOLD };
    let stats = state.stats;
    if (sub.docked) {
      const oldHp = sub.hp;
      sub = {
        ...sub, hp: clamp(sub.hp + 12 * dt, 0, sub.maxHp), battery: clamp(sub.battery + 18 * dt, 0, sub.maxBattery),
        torpedoes: Math.min(sub.maxTorpedoes, sub.torpedoes + 0.35 * dt), seekers: Math.min(sub.maxSeekers, sub.seekers + 0.2 * dt),
        sysSonar: clamp(sub.sysSonar + 0.3 * dt, 0, 1), sysPropulsion: clamp(sub.sysPropulsion + 0.3 * dt, 0, 1),
        sysTubes: clamp(sub.sysTubes + 0.3 * dt, 0, 1), sysFlood: clamp(sub.sysFlood - 0.4 * dt, 0, 1),
      };
      stats = { ...stats, repairs: stats.repairs + Math.max(0, sub.hp - oldHp) };
    }
    const collected = state.powerups.filter((pickup) => Math.hypot(pickup.x - sub.x, pickup.y - sub.y) <= PICKUP_RADIUS);
    for (const pickup of collected) sub = applyPickup(sub, pickup);
    const remaining = state.powerups.filter((pickup) => !collected.includes(pickup) && pickup.life - dt > 0).map((pickup) => ({ ...pickup, life: pickup.life - dt }));
    const pickupRespawn = state.pickupRespawn - dt;
    const powerups = pickupRespawn <= 0 && remaining.length < PICKUP_MAX
      ? [...remaining, ...seedPowerups(state.seed + state.tick, 1).map((pickup) => ({ ...pickup, id: `pickup-${state.tick}`, life: PICKUP_LIFE }))]
      : remaining;
    const waveCleared = state.ships.length === 0 && state.stats.shipsSunk < VICTORY_TARGET;
    const nextStats = {
      ...stats,
      wave: waveCleared ? stats.wave + 1 : stats.wave,
      powerupsTaken: stats.powerupsTaken + collected.length,
    };
    const nextPowerups = waveCleared
      ? [...powerups, ...seedPowerups(state.seed + stats.wave * 101, 3)].slice(0, PICKUP_MAX)
      : powerups;
    return {
      ...state, submarine: sub, stats: nextStats, powerups: nextPowerups,
      dockHold, pickupRespawn: pickupRespawn <= 0 ? PICKUP_RESPAWN : pickupRespawn,
      ships: waveCleared ? seedWave(state.seed, stats.wave + 1) : state.ships,
    };
  },
  cleanupEvents: (state, _commands, dt) => ({
    ...state,
    phase: state.submarine.hp <= 0 ? 'gameover' : state.phase,
    countermeasures: state.countermeasures.filter((cm) => cm.life - dt > 0).map((cm) => ({ ...cm, life: cm.life - dt })),
    messages: state.messages.filter((message) => message.ttl > 0).map((message) => ({ ...message, ttl: message.ttl - dt })),
  }),
};
