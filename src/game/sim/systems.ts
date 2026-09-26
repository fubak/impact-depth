import type { GameCommand } from '../commands/types';
import { clampDepth, clampSim } from './coords';
import { seedPowerups, seedWave } from './create';
import type {
  Countermeasure,
  GameState,
  Point,
  Powerup,
  Ship,
  ShipKind,
  SpeedOrder,
  ThreatKind,
  Torpedo,
} from './types';
import {
  BUBBLE_LIFE,
  BUBBLE_RADIUS,
  DEPTH_TARGET,
  DOCK_HOLD,
  DOCK_SPEED_MAX,
  FIRE_MAX_DEPTH,
  FIRE_MIN_DEPTH,
  FOXER_LIFE,
  FOXER_RADIUS,
  MAX_TIER,
  PICKUP_LIFE,
  PICKUP_MAX,
  PICKUP_RADIUS,
  PICKUP_RESPAWN,
  SEAMOUNT_CRUSH_DPS,
  VICTORY_TARGET,
  ACTIVE_COOLDOWN,
  ACTIVE_PING_DURATION,
  ALERT_SPREAD_RADIUS,
  BLAST_VERTICAL,
  BUBBLE_HOLD_DRAIN,
  DC_ENGAGE_RANGE,
  DEEP_SAFE_DEPTH,
  FOXER_SEDUCE_ODDS,
  FOXER_SEDUCE_RANGE,
  WAVE_BREATHER,
  ESCORT_LOUD_SWEEP_RADIUS,
  ESCORT_QUIET_SWEEP_CAP,
  ESCORT_QUIET_SWEEP_RADIUS,
  ESCORT_SCREEN_OFFSET,
  ESCORT_SWEEP_PERIOD,
} from './constants';
import { nextRandom } from './rng';
import { getTerrain, hullDepthLimit, isCrushedBySeamount, isLand, snapToNavigable } from './world';
import { updateAutopilot } from './autopilot';
import { makeClear, resolveClearStep, steerAvoid, shipClearRadius } from './pathfinding';
import { updateSonar } from './sonar';
import { hasContact } from './contact';
import { separateShips } from './ship-separation';
import { integrateV2Horizontal, resolveV2WorldCollision } from '../world/collision';
import { getWorld } from '../world/queries';
import { emergencySurface } from './action-feel';
import { integrateSubmarineDepth } from './submarine-motion';
import { blastDamage } from './blast';

type System = (state: GameState, commands: GameCommand[], dt: number) => GameState;
export const SYSTEM_ORDER = [
  'applyCommands',
  'autopilot',
  'submarine',
  'worldCollision',
  'sonar',
  'enemies',
  'aircraft',
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
const depthTarget = DEPTH_TARGET;
const shipTurnRate: Record<ShipKind, number> = {
  patrol: 1.05,
  destroyer: 0.82,
  merchant: 0.4,
  cruiser: 0.55,
  battleship: 0.32,
  sub: 0.7,
};
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
/** Arcade-readable hull radii so discrete torpedo steps can still register hits. */
const shipRadius = (ship: Ship) => {
  switch (ship.kind) {
    case 'sub':
      return 1.35;
    case 'battleship':
      return 2.1;
    case 'cruiser':
      return 1.75;
    case 'merchant':
      return 1.85;
    case 'destroyer':
      return 1.45;
    case 'patrol':
      return 1.15;
    default:
      return 1.25;
  }
};
/** Minimum run-out before a torpedo can arm (avoids deck hits / instant spawns). */
const TORPEDO_ARM_RUN = 0.95;
const inFob = (state: GameState, x = state.submarine.x, y = state.submarine.y) =>
  Math.hypot(x - state.base.x, y - state.base.y) <= state.base.radius;
const turnToward = (heading: number, target: number, rate: number, dt: number) =>
  heading + clamp(normalizeAngle(target - heading), -rate * dt, rate * dt);
const distPointSegment = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) => {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-8) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
};
/** Heading from `ship` toward its convoy screen slot. The slot weaves across the bow. */
const formationSlotHeading = (ship: Ship, anchor: Ship, time: number): number => {
  const along = ship.formationAlong ?? 0;
  const lateral =
    (ship.formationLateral ?? 0) +
    Math.sin(time * 0.22 + ship.patrolIndex * 1.3) * ESCORT_SCREEN_OFFSET;
  const cos = Math.cos(anchor.heading);
  const sin = Math.sin(anchor.heading);
  const slotX = anchor.x + cos * along - sin * lateral;
  const slotY = anchor.y + sin * along + cos * lateral;
  return Math.atan2(slotY - ship.y, slotX - ship.x);
};

const ESCORT_SWEEP_KINDS: ReadonlySet<Ship['kind']> = new Set([
  'destroyer',
  'patrol',
  'cruiser',
  'battleship',
]);

/**
 * Active sweep radius. Deep + silent + not flank is invisible to the sweep.
 * Other silent boats use a short radius that grows after the opening minute.
 */
export function escortSweepRadius(
  sub: GameState['submarine'],
  _time: number,
  jitter: number,
  pinging: boolean,
  suspicion = 0,
): number {
  const quiet = sub.silentRunning && sub.speedOrder !== 'flank';
  if (quiet && sub.z >= DEEP_SAFE_DEPTH) return 0;
  if (quiet) {
    // Suspicion is encounter-local. Mission time no longer grows the sweep without a cap.
    const fromHunt = suspicion * ESCORT_QUIET_SWEEP_CAP;
    return Math.min(ESCORT_QUIET_SWEEP_CAP, ESCORT_QUIET_SWEEP_RADIUS + fromHunt) * jitter;
  }
  // A flank or noisy boat is loud only while it is pinging. Otherwise escorts
  // still need to close inside ordinary hearing, so a stalk is not a beacon.
  return (pinging ? ESCORT_LOUD_SWEEP_RADIUS : 8) * jitter;
}

/** Stable [0,1) roll from the mission seed and a torpedo id. */
export function seduceRoll(seed: number, id: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x45d9f3b);
  }
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 4294967296;
}

/** A merchant or escort that has a fix wakes every warship inside the alarm radius. */
function spreadAlert(ships: Ship[], state: GameState): Ship[] {
  const sources = ships.filter(
    (ship) =>
      ship.sinking === undefined &&
      ship.alert > 0.25 &&
      (ship.kind === 'merchant' || ESCORT_SWEEP_KINDS.has(ship.kind)),
  );
  if (sources.length === 0) return ships;
  return ships.map((ship) => {
    if (ship.sinking !== undefined || !HUNTER_KINDS.has(ship.kind)) return ship;
    // A hull that can already hear the boat keeps its own solution.
    if (hasContact(ship, state)) return ship;
    let alert = ship.alert;
    for (const source of sources) {
      if (source.id === ship.id) continue;
      if (Math.hypot(ship.x - source.x, ship.y - source.y) > ALERT_SPREAD_RADIUS) continue;
      // Under the 0.25 pursuit line: a warning, not a firing solution.
      alert = Math.max(alert, Math.min(source.alert, 0.24));
    }
    if (alert === ship.alert) return ship;
    return { ...ship, alert };
  });
}

/** Tubes can aim at most 60° off the bow. The HUD lead is still the desired bearing. */
export function launchHeading(boatHeading: number, desiredHeading: number): number {
  const delta = Math.atan2(
    Math.sin(desiredHeading - boatHeading),
    Math.cos(desiredHeading - boatHeading),
  );
  const clamped = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, delta));
  return Math.atan2(Math.sin(boatHeading + clamped), Math.cos(boatHeading + clamped));
}

function makeTorpedo(
  state: GameState,
  kind: 'mk14' | 'mk18',
  targetId: string | null,
  offset = 0,
  aimPoint: Point | null = null,
): Torpedo {
  const target = targetId ? state.ships.find((ship) => ship.id === targetId) : undefined;
  const sub = state.submarine;
  const speed = kind === 'mk14' ? 9.5 : 8.2;
  let heading = sub.heading + offset;
  if (target) {
    // Lead the contact so straight runners remain usable past point-blank range.
    const range = Math.hypot(target.x - sub.x, target.y - sub.y);
    const eta = range / Math.max(0.1, speed);
    const leadX = target.x + Math.cos(target.heading) * target.speed * eta;
    const leadY = target.y + Math.sin(target.heading) * target.speed * eta;
    heading = Math.atan2(leadY - sub.y, leadX - sub.x) + offset;
  } else if (aimPoint) {
    heading = Math.atan2(aimPoint.y - sub.y, aimPoint.x - sub.x) + offset;
  }
  heading = launchHeading(sub.heading, heading);
  return {
    id: `${kind}-${state.tick}-${offset}`,
    owner: 'player',
    kind,
    sourceId: 'player',
    x: sub.x,
    y: sub.y,
    z: sub.z,
    heading,
    speed,
    life: kind === 'mk14' ? 8 : 10,
    // Time arm is a fallback; run-out distance is authoritative in ordnance().
    armDelay: kind === 'mk14' ? 0.08 : 0.1,
    damage: (kind === 'mk14' ? 48 : 58) * (1 + sub.weaponTier * 0.18) * (0.7 + sub.sysTubes * 0.3),
    targetId,
    turnRate: kind === 'mk14' ? 2.2 : 2.8,
    run: 0,
  };
}

function makeThreat(
  state: GameState,
  kind: ThreatKind,
  sourceId: string,
  targetId?: string,
  sequence = 0,
) {
  const source = state.ships.find((ship) => ship.id === sourceId);
  if (!source || inFob(state)) return null;
  const target = targetId === 'player' || !targetId ? state.submarine : undefined;
  if (!target) return null;
  const heading = Math.atan2(target.y - source.y, target.x - source.x);
  if (kind === 'torpedo') {
    return {
      torpedo: {
        id: `enemy-${sourceId}-${state.tick}-${sequence}`,
        owner: 'enemy' as const,
        kind: 'enemy' as const,
        sourceId,
        x: source.x,
        y: source.y,
        z: 0.5,
        heading,
        speed: 7.5,
        life: 9,
        armDelay: 0.05,
        damage: 42,
        targetId: 'player',
        turnRate: state.submarine.noise < 0.22 || state.submarine.silentRunning ? 1.1 : 2.4,
        run: 0,
      },
    };
  }
  const threatStats = {
    depthCharge: { fuse: 1.5, damage: 45, radius: 2.2 },
    hedgehog: { fuse: 0.95, damage: 12, radius: 0.85 },
    shell: { fuse: 0.35, damage: 22, radius: 0.8 },
    bomb: { fuse: 1.1, damage: 28, radius: 1.8 },
  };
  const values = threatStats[kind];
  return {
    charge: {
      id: `${kind}-${sourceId}-${state.tick}-${sequence}`,
      kind,
      sourceId,
      x: source.x,
      y: source.y,
      z: 0.05,
      vz: kind === 'shell' ? 0 : 1.6,
      fuse: values.fuse,
      damage: values.damage,
      radius: values.radius,
      targetDepth: target.z,
    },
  };
}

const HIT_ALARM_RADIUS = 30;
const HUNTER_KINDS: ReadonlySet<Ship['kind']> = new Set([
  'destroyer',
  'patrol',
  'cruiser',
  'battleship',
  'sub',
]);

/** A torpedo hit blows the shooter's cover: the victim and nearby warships start hunting. */
function raiseHitAlarm(ships: Ship[], victim: Ship): void {
  victim.alert = 1;
  victim.holdContact = 8;
  for (const other of ships) {
    if (other === victim || other.sinking !== undefined || !HUNTER_KINDS.has(other.kind)) continue;
    if (Math.hypot(other.x - victim.x, other.y - victim.y) > HIT_ALARM_RADIUS) continue;
    other.alert = Math.max(other.alert, 0.8);
    other.holdContact = Math.max(other.holdContact, 6);
  }
}

function applyPlayerDamage(sub: GameState['submarine'], damage: number) {
  if (sub.invuln > 0) return sub;
  const actual = damage * (1 - Math.min(0.28, sub.hullTier * 0.08));
  return {
    ...sub,
    hp: clamp(sub.hp - actual, 0, sub.maxHp),
    sysSonar: clamp(sub.sysSonar - actual / 700, 0, 1),
    sysPropulsion: clamp(sub.sysPropulsion - actual / 550, 0.2, 1),
    sysTubes: clamp(sub.sysTubes - actual / 650, 0, 1),
    sysFlood: clamp(sub.sysFlood + actual / 500, 0, 1),
    crewStress: clamp(sub.crewStress + actual / 150, 0, 1),
    lastDamage: 'weapon' as const,
  };
}

function applyPickup(sub: GameState['submarine'], pickup: Powerup): GameState['submarine'] {
  switch (pickup.kind) {
    case 'health':
      return { ...sub, hp: clamp(sub.hp + 35, 0, sub.maxHp) };
    case 'ammo':
      return {
        ...sub,
        torpedoes: sub.maxTorpedoes,
        seekers: Math.min(sub.maxSeekers, sub.seekers + 2),
      };
    case 'hull': {
      if (sub.hullTier >= MAX_TIER) return sub;
      const maxHp = sub.maxHp + 20;
      return { ...sub, hullTier: sub.hullTier + 1, maxHp, hp: clamp(sub.hp + 20, 0, maxHp) };
    }
    case 'weapon':
      return { ...sub, weaponTier: Math.min(MAX_TIER, sub.weaponTier + 1) };
    case 'speed':
      return sub.speedTier >= MAX_TIER
        ? sub
        : { ...sub, speedTier: sub.speedTier + 1, maxSpeed: sub.maxSpeed + 0.18 };
    case 'counter':
      return { ...sub, cmCharges: sub.maxCmCharges, decoys: 3 };
  }
}

export const systems: Record<(typeof SYSTEM_ORDER)[number], System> = {
  applyCommands(state, commands) {
    let next = state;
    for (const command of commands) {
      if (command.type === 'helm') {
        // Sticky speed orders (0/I/O/P) own targetSpeed. WASD only steers and nudges depth
        // so holding W cannot fight Flank / 1/3 / Stop.
        next = {
          ...next,
          submarine: {
            ...next.submarine,
            heading: next.submarine.heading + (command.yaw * 0.85) / 60,
            targetDepth: clampDepth(next.submarine.targetDepth + command.depth * 0.015),
          },
        };
      } else if (command.type === 'setDepthOrder')
        next = {
          ...next,
          autopilot:
            next.autopilot.enabled && next.autopilot.tactic !== 'manual'
              ? {
                  ...next.autopilot,
                  enabled: false,
                  tactic: 'manual',
                  phase: 'idle',
                  waypoint: null,
                  path: [],
                }
              : next.autopilot,
          submarine: { ...next.submarine, targetDepth: depthTarget[command.order] },
          messages: [
            ...next.messages,
            { id: `depth-${next.tick}`, text: `DEPTH ${command.order.toUpperCase()}`, ttl: 1.6 },
          ],
        };
      else if (command.type === 'setSpeedOrder')
        next = {
          ...next,
          autopilot:
            next.autopilot.enabled && next.autopilot.tactic !== 'manual'
              ? {
                  ...next.autopilot,
                  enabled: false,
                  tactic: 'manual',
                  phase: 'idle',
                  waypoint: null,
                  path: [],
                }
              : next.autopilot,
          submarine: {
            ...next.submarine,
            speedOrder: command.order,
            targetSpeed: next.submarine.maxSpeed * speedFraction[command.order],
          },
          messages: [
            ...next.messages,
            {
              id: `speed-${next.tick}`,
              text: `SPEED ${command.order === 'oneThird' ? '1/3' : command.order === 'twoThirds' ? '2/3' : command.order.toUpperCase()}`,
              ttl: 1.6,
            },
          ],
        };
      else if (command.type === 'setPhase') next = { ...next, phase: command.phase };
      else if (command.type === 'setWeapon') next = { ...next, weaponMode: command.weapon };
      else if (command.type === 'setViewMode') next = { ...next, viewMode: command.viewMode };
      else if (command.type === 'setAutopilot')
        next = {
          ...next,
          selectedTargetId: command.waypoint
            ? next.selectedTargetId
            : (command.targetId ?? next.selectedTargetId),
          autopilot: command.waypoint
            ? {
                ...next.autopilot,
                enabled: true,
                tactic: 'manual',
                waypoint: command.waypoint,
                path: [],
                repathTimer: 0,
              }
            : {
                ...next.autopilot,
                enabled: command.tactic !== 'manual',
                tactic: command.tactic ?? 'manual',
                targetId: command.targetId ?? next.selectedTargetId,
                phase: 'approach',
                phaseTimer: 0,
                emergency: false,
                // Grace prevents the select tick from instantly firing + breakaway-fleeing.
                shotTimer:
                  command.tactic &&
                  command.tactic !== 'manual' &&
                  command.tactic !== 'evade' &&
                  command.tactic !== 'exfil'
                    ? 3.2
                    : 0,
                waypoint: null,
                path: [],
                repathTimer: 0,
              },
        };
      else if (command.type === 'cancelAutopilot')
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
      else if (command.type === 'selectTarget')
        next = { ...next, selectedTargetId: command.id, aimPoint: null };
      else if (command.type === 'setAimPoint')
        next = {
          ...next,
          aimPoint: command.point,
          selectedTargetId: command.point ? null : next.selectedTargetId,
        };
      else if (command.type === 'sonarPulse') {
        if (next.sonarPing <= 0 && next.sonarCooldown <= 0) {
          next = {
            ...next,
            sonarPing: ACTIVE_PING_DURATION,
            sonarCooldown: ACTIVE_COOLDOWN,
            submarine: { ...next.submarine, noise: clamp(next.submarine.noise + 0.62, 0, 1) },
            ships: next.ships.map((ship) => {
              const distance = Math.hypot(ship.x - next.submarine.x, ship.y - next.submarine.y);
              return distance <= 30
                ? { ...ship, alert: clamp(ship.alert + 0.35 * (1 - distance / 30), 0, 1) }
                : ship;
            }),
          };
        }
      } else if (command.type === 'emergencySurface') next = emergencySurface(next);
      else if (command.type === 'toggleSilentRunning')
        next = {
          ...next,
          submarine: { ...next.submarine, silentRunning: !next.submarine.silentRunning },
        };
      else if (
        command.type === 'deployBubble' &&
        next.submarine.cmCharges > 0 &&
        next.submarine.cmCooldown <= 0
      ) {
        const cm: Countermeasure = {
          id: `bubble-${next.tick}`,
          kind: 'bubble',
          x: next.submarine.x,
          y: next.submarine.y,
          z: next.submarine.z,
          life: BUBBLE_LIFE,
          radius: BUBBLE_RADIUS,
        };
        next = {
          ...next,
          submarine: { ...next.submarine, cmCharges: next.submarine.cmCharges - 1, cmCooldown: 6 },
          countermeasures: [...next.countermeasures, cm],
        };
      } else if (command.type === 'spawnThreat') {
        const threat = makeThreat(next, command.threat, command.sourceId, command.targetId);
        if (threat)
          next = {
            ...next,
            torpedoes: threat.torpedo ? [...next.torpedoes, threat.torpedo] : next.torpedoes,
            depthCharges: threat.charge ? [...next.depthCharges, threat.charge] : next.depthCharges,
          };
      } else if (command.type === 'fireWeapon') {
        const sub = next.submarine;
        const usePointAim = next.aimPoint != null && next.selectedTargetId == null;
        const canFire = sub.z >= FIRE_MIN_DEPTH && sub.z <= FIRE_MAX_DEPTH && sub.sysTubes >= 0.35;
        if (!canFire) {
          const text =
            sub.sysTubes < 0.35
              ? 'TUBES DAMAGED'
              : sub.z < FIRE_MIN_DEPTH
                ? 'TUBES LOCKED — DIVE'
                : 'TUBES LOCKED — TOO DEEP';
          next = {
            ...next,
            messages: [...next.messages, { id: `fire-lock-${next.tick}`, text, ttl: 2.4 }],
          };
          continue;
        }
        if (usePointAim && next.weaponMode === 'seeker') {
          next = {
            ...next,
            messages: [
              ...next.messages,
              { id: `fire-need-target-${next.tick}`, text: 'PICK TARGET', ttl: 2 },
            ],
          };
          continue;
        }
        const target = usePointAim
          ? undefined
          : (next.ships.find((ship) => ship.id === next.selectedTargetId) ??
            next.ships.find((ship) => Math.hypot(ship.x - sub.x, ship.y - sub.y) <= 6));
        // Prefer selected target; otherwise lock the nearest ship in engagement range.
        const engage = usePointAim
          ? undefined
          : (target ??
            [...next.ships]
              .filter((ship) => ship.hp > 0 && !ship.sinking)
              .sort(
                (a, b) =>
                  Math.hypot(a.x - sub.x, a.y - sub.y) - Math.hypot(b.x - sub.x, b.y - sub.y),
              )[0]);
        const fireTarget =
          !usePointAim && engage && Math.hypot(engage.x - sub.x, engage.y - sub.y) <= 22
            ? engage
            : target;
        if (fireTarget && next.selectedTargetId !== fireTarget.id) {
          next = { ...next, selectedTargetId: fireTarget.id, aimPoint: null };
        }
        const aim = fireTarget ?? target;
        const pointAim = usePointAim ? next.aimPoint : null;
        const deckRange =
          fireTarget && sub.z < 0.14
            ? Math.hypot(fireTarget.x - sub.x, fireTarget.y - sub.y)
            : Infinity;
        if (
          next.weaponMode === 'torpedo' &&
          fireTarget &&
          sub.z < 0.14 &&
          deckRange < 8.5 &&
          sub.sysTubes >= 0.2
        ) {
          const hp = Math.max(0, fireTarget.hp - 22);
          next = {
            ...next,
            submarine: { ...sub, noise: clamp(sub.noise + 0.42, 0, 1) },
            ships: next.ships.map((ship) =>
              ship.id === fireTarget.id
                ? {
                    ...ship,
                    hp,
                    sinking: hp <= 0 ? Math.max(ship.sinking ?? 0, 0.2) : ship.sinking,
                  }
                : ship,
            ),
            stats: {
              ...next.stats,
              damageDealt: next.stats.damageDealt + 22,
              shipsSunk: next.stats.shipsSunk + (hp <= 0 && fireTarget.hp > 0 ? 1 : 0),
            },
            messages: [
              ...next.messages,
              { id: `deck-${next.tick}`, text: `DECK GUN → ${fireTarget.name}`, ttl: 1.8 },
            ],
          };
        } else if (next.weaponMode === 'decoy' && sub.decoys > 0) {
          const cm: Countermeasure = {
            id: `foxer-${next.tick}`,
            kind: 'foxer',
            x: sub.x,
            y: sub.y,
            z: sub.z,
            life: FOXER_LIFE,
            radius: FOXER_RADIUS,
          };
          next = {
            ...next,
            submarine: { ...sub, decoys: sub.decoys - 1 },
            countermeasures: [...next.countermeasures, cm],
            messages: [...next.messages, { id: `foxer-${next.tick}`, text: 'FOXER AWAY', ttl: 2 }],
          };
        } else if (next.weaponMode === 'seeker' && sub.seekers > 0 && sub.reloadMk18 <= 0) {
          next = {
            ...next,
            submarine: {
              ...sub,
              seekers: sub.seekers - 1,
              reloadMk18: Math.max(1.4, sub.reloadMk18Max - sub.weaponTier * 0.22),
              noise: clamp(sub.noise + 0.35, 0, 1),
            },
            torpedoes: [...next.torpedoes, makeTorpedo(next, 'mk18', aim?.id ?? null, 0, pointAim)],
            stats: { ...next.stats, torpedoesFired: next.stats.torpedoesFired + 1 },
            messages: [
              ...next.messages,
              { id: `mk18-${next.tick}`, text: aim ? `MK-18 → ${aim.name}` : 'MK-18 AWAY', ttl: 2 },
            ],
          };
        } else if (next.weaponMode === 'torpedo' && sub.torpedoes > 0 && sub.reloadMk14 <= 0) {
          const count = next.torpedoSpread ? Math.min(3, sub.torpedoes) : 1;
          const offsets = count === 3 ? [-0.12, 0, 0.12] : count === 2 ? [-0.08, 0.08] : [0];
          next = {
            ...next,
            submarine: {
              ...sub,
              torpedoes: sub.torpedoes - count,
              reloadMk14: Math.max(
                1.4,
                (count > 1 ? 3.8 : sub.reloadMk14Max) - sub.weaponTier * 0.22,
              ),
              noise: clamp(sub.noise + 0.35, 0, 1),
            },
            torpedoes: [
              ...next.torpedoes,
              ...offsets.map((offset) =>
                makeTorpedo(next, 'mk14', aim?.id ?? null, offset, pointAim),
              ),
            ],
            stats: { ...next.stats, torpedoesFired: next.stats.torpedoesFired + count },
            messages: [
              ...next.messages,
              {
                id: `mk14-${next.tick}`,
                text:
                  count > 1
                    ? `MK-14 SPREAD ×${count}${aim ? ` → ${aim.name}` : ''}`
                    : aim
                      ? `MK-14 → ${aim.name}`
                      : 'MK-14 AWAY',
                ttl: 2,
              },
            ],
          };
        } else {
          const text =
            next.weaponMode === 'decoy'
              ? 'NO FOXERS'
              : next.weaponMode === 'seeker'
                ? sub.seekers <= 0
                  ? 'NO MK-18'
                  : 'MK-18 RELOADING'
                : sub.torpedoes <= 0
                  ? 'NO MK-14'
                  : 'MK-14 RELOADING';
          next = {
            ...next,
            messages: [...next.messages, { id: `fire-empty-${next.tick}`, text, ttl: 2 }],
          };
        }
      }
    }
    return next;
  },
  autopilot(state, _commands, dt) {
    const waypoint = state.autopilot.waypoint;
    if (state.autopilot.enabled && state.autopilot.tactic !== 'manual') {
      let next = updateAutopilot(state, dt);
      // No weapons on zero-dt command ticks (tactic select) or during shot grace.
      if (dt <= 0) return next;
      const target = next.ships.find(
        (ship) => ship.id === next.selectedTargetId && ship.sinking === undefined,
      );
      const distance = target
        ? Math.hypot(target.x - next.submarine.x, target.y - next.submarine.y)
        : Infinity;
      const ready =
        target &&
        next.autopilot.shotTimer <= 0 &&
        next.autopilot.phaseTimer >= 1.25 &&
        (next.autopilot.tactic === 'ambush'
          ? next.autopilot.phase === 'setup' || next.autopilot.phase === 'attack'
          : next.autopilot.phase === 'setup' ||
            next.autopilot.phase === 'attack' ||
            next.autopilot.phase === 'approach') &&
        next.submarine.z >= FIRE_MIN_DEPTH &&
        next.submarine.z <= FIRE_MAX_DEPTH;
      const inWindow =
        (next.autopilot.tactic === 'ambush' && distance > 3.2 && distance < 10) ||
        (next.autopilot.tactic === 'stalk' && distance > 4 && distance < 10) ||
        (next.autopilot.tactic === 'intercept' && distance < 9);
      if (ready && inWindow) {
        const firing =
          next.autopilot.tactic === 'intercept' && next.submarine.seekers > 0
            ? 'seeker'
            : 'torpedo';
        next = systems.applyCommands(
          { ...next, weaponMode: firing, torpedoSpread: next.autopilot.tactic === 'ambush' },
          [{ type: 'fireWeapon' }],
          0,
        );
        if (next.torpedoes.length > state.torpedoes.length) {
          next = {
            ...next,
            autopilot: {
              ...next.autopilot,
              shotTimer: next.autopilot.tactic === 'stalk' ? 8 : 5,
              phase: 'breakaway',
              phaseTimer: 0,
              emergency: false,
            },
          };
        }
      }
      return next;
    }
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
    const diving = Math.abs(sub.targetDepth - sub.z) > 0.04;
    sub.speed += (wanted * (diving ? 0.82 : 1) - sub.speed) * Math.min(1, 1.8 * dt);
    sub.z = integrateSubmarineDepth(sub.z, sub.targetDepth, dt);
    const nx = sub.x + Math.cos(sub.heading) * sub.speed * dt;
    const ny = sub.y + Math.sin(sub.heading) * sub.speed * dt;
    if (state.worldVersion === 'littoral-v2') {
      const moved = integrateV2Horizontal(getWorld('littoral-v2', state.terrainSeed), sub, nx, ny);
      sub.x = moved.x;
      sub.y = moved.y;
      sub.speed = moved.speed;
    } else {
      const terrain = getTerrain(state.terrainSeed);
      const clear = makeClear(terrain, 0.35);
      if (clear(nx, ny)) {
        sub.x = nx;
        sub.y = ny;
      } else {
        // Soft bounce: keep depth integration, kill forward push into land.
        const safe = snapToNavigable(terrain, sub.x, sub.y, sub.z);
        sub.x = safe.x;
        sub.y = safe.y;
        sub.speed *= 0.55;
      }
    }
    if (sub.scopeUp && sub.z > 0.4) sub.scopeUp = false;
    if (sub.snorkel && (sub.z < 0.12 || sub.z > 0.42)) sub.snorkel = false;
    // Battery lasts minutes in transit, not seconds: drain scales with ordered speed ratio.
    const speedRatio = sub.speed / Math.max(0.01, sub.maxSpeed);
    const drain =
      0.05 +
      speedRatio * speedRatio * (sub.silentRunning ? 0.22 : 0.55) +
      (sub.scopeUp ? 0.04 : 0) +
      (sub.z > 0.12 && !sub.snorkel ? 0.03 : 0);
    const charge = sub.z < 0.12 ? 2.8 : sub.snorkel ? 1.6 : 0;
    sub.battery = clamp(sub.battery + (charge - drain) * dt, 0, sub.maxBattery);
    sub.sysFlood = clamp(
      sub.sysFlood - (sub.sysFlood < 0.5 && sub.battery > 10 ? 0.08 * dt : 0),
      0,
      1,
    );
    sub.hp = clamp(sub.hp - 4.5 * sub.sysFlood * dt, 0, sub.maxHp);
    sub.crewStress = clamp(sub.crewStress - 0.02 * dt, 0, 1);
    sub.reloadMk14 = Math.max(0, sub.reloadMk14 - dt);
    sub.reloadMk18 = Math.max(0, sub.reloadMk18 - dt);
    sub.cmCooldown = Math.max(0, sub.cmCooldown - dt);
    sub.invuln = Math.max(0, sub.invuln - dt);
    sub.displayHeading = sub.heading;
    sub.noise = clamp(
      0.08 +
        (sub.speed / Math.max(0.01, sub.maxSpeed)) * 0.55 +
        (sub.snorkel ? 0.2 : 0) +
        (1 - sub.sysSonar) * 0.1,
      0.05,
      sub.silentRunning ? 0.18 : 1,
    );
    return { ...state, submarine: sub };
  },
  worldCollision(state, _commands, dt) {
    if (state.worldVersion === 'littoral-v2') return resolveV2WorldCollision(state, dt);
    const sub = state.submarine;
    const terrain = getTerrain(state.terrainSeed);
    const clear = makeClear(terrain, 0.35);
    let x = clampSim(sub.x);
    let y = clampSim(sub.y);
    // Match surface-ship land clamp so the boat cannot ghost through cays.
    if (!clear(x, y) || isLand(terrain, x, y)) {
      const safe = snapToNavigable(terrain, x, y, sub.z);
      x = safe.x;
      y = safe.y;
    }
    // Lift the hull before the crush test. Autopilot may still be ordering Deep;
    // a hull already above the ceiling takes no rock damage this step.
    const limit = hullDepthLimit(terrain, x, y);
    const z = Math.min(clampDepth(sub.z), limit);
    const crush =
      sub.invuln <= 0 && !inFob(state, x, y) && isCrushedBySeamount(terrain, x, y, z)
        ? SEAMOUNT_CRUSH_DPS * dt
        : 0;
    const hp = clamp(sub.hp - crush, 0, sub.maxHp);
    const targetDepth = Math.min(sub.targetDepth, limit);
    return {
      ...state,
      submarine: {
        ...sub,
        x,
        y,
        z,
        targetDepth,
        hp,
        lastDamage: crush > 0 ? 'ground' : sub.lastDamage,
      },
    };
  },
  sonar: (state, _commands, dt) => updateSonar(state, dt),
  enemies(state, _commands, dt) {
    const terrain = getTerrain(state.terrainSeed);
    const sub = state.submarine;
    const torpedoes = [...state.torpedoes];
    const depthCharges = [...state.depthCharges];
    let rngState = state.rngState;
    let sweepJitter = 1;
    const sweepPulse =
      Math.floor(state.time / ESCORT_SWEEP_PERIOD) !==
      Math.floor((state.time - dt) / ESCORT_SWEEP_PERIOD);
    if (sweepPulse) {
      const roll = nextRandom(rngState);
      rngState = roll.state;
      sweepJitter = 0.9 + roll.value * 0.2;
    }
    const ships = state.ships.map((ship) => {
      if (ship.sinking !== undefined) return ship;
      const distance = Math.hypot(ship.x - sub.x, ship.y - sub.y);
      const suspicionIn = ship.suspicion ?? 0;
      const sweepRadius = escortSweepRadius(
        sub,
        state.time,
        sweepJitter,
        state.sonarPing > 0,
        suspicionIn,
      );
      const hunting =
        ESCORT_SWEEP_KINDS.has(ship.kind) && sweepRadius > 0 && distance <= sweepRadius;
      const suspicion = ESCORT_SWEEP_KINDS.has(ship.kind)
        ? clamp(suspicionIn + (hunting ? dt * 0.25 : -dt * 0.08), 0, 1)
        : suspicionIn;
      const detected = hasContact(ship, state);
      const bubbleScreen = state.countermeasures.some(
        (cm) => cm.kind === 'bubble' && Math.hypot(cm.x - sub.x, cm.y - sub.y) <= cm.radius,
      );
      const swept =
        sweepPulse &&
        sweepRadius > 0 &&
        ESCORT_SWEEP_KINDS.has(ship.kind) &&
        distance <= sweepRadius;
      const contactDrain = 0.45 * (bubbleScreen ? BUBBLE_HOLD_DRAIN : 1);
      let holdContact = detected
        ? Math.min(8, ship.holdContact + dt)
        : Math.max(0, ship.holdContact - dt * contactDrain);
      let lastKnownX = detected ? sub.x : ship.lastKnownX;
      let lastKnownY = detected ? sub.y : ship.lastKnownY;
      let alert = clamp(
        ship.alert +
          (detected ? dt * 0.3 : -dt * 0.06) -
          (state.countermeasures.some(
            (cm) => cm.kind === 'foxer' && Math.hypot(ship.x - cm.x, ship.y - cm.y) <= 20,
          )
            ? dt * 0.15
            : 0),
        0,
        1,
      );
      if (swept) {
        alert = Math.max(alert, 0.4);
        holdContact = Math.max(holdContact, 1);
        lastKnownX = sub.x;
        lastKnownY = sub.y;
      }
      const clear = makeClear(terrain, shipClearRadius(ship.kind));
      const anchor = ship.formationAnchorId
        ? state.ships.find(
            (other) => other.id === ship.formationAnchorId && other.sinking === undefined,
          )
        : undefined;
      let path = ship.path;
      let pursuit: number;
      if (alert > 0.25 && holdContact > 0 && lastKnownX !== undefined && lastKnownY !== undefined) {
        pursuit = Math.atan2(lastKnownY - ship.y, lastKnownX - ship.x);
      } else if (anchor) {
        pursuit = formationSlotHeading(ship, anchor, state.time);
      } else if (path.length > 0) {
        let goal = path[0]!;
        if (Math.hypot(ship.x - goal.x, ship.y - goal.y) < 1.35) {
          path = [...path.slice(1), goal];
          goal = path[0]!;
        }
        pursuit = Math.atan2(goal.y - ship.y, goal.x - ship.x);
      } else {
        pursuit = ship.heading + Math.sin((state.time + ship.patrolIndex) * 0.15) * 0.12;
      }
      const lookAhead = Math.max(2.8, ship.speed * 1.8);
      let heading = turnToward(
        ship.heading,
        steerAvoid(ship.x, ship.y, pursuit, lookAhead, clear),
        shipTurnRate[ship.kind] * (alert > 0.25 ? 1 : 0.72),
        dt,
      );
      // Cruise on patrol; full class speed only when alerted / pursuing.
      const moveSpeed = alert > 0.25 && holdContact > 0 ? ship.speed : ship.speed * 0.62;
      let x = clampSim(ship.x + Math.cos(heading) * moveSpeed * dt);
      let y = clampSim(ship.y + Math.sin(heading) * moveSpeed * dt);
      // Hard land clamp — soft steering alone still overshoots into islands.
      if (!clear(x, y)) {
        const stepped = resolveClearStep(ship.x, ship.y, heading, x, y, clear, (px, py) => ({
          x: clampSim(px),
          y: clampSim(py),
        }));
        if (clear(stepped.x, stepped.y)) {
          x = stepped.x;
          y = stepped.y;
          heading = stepped.heading;
        } else {
          const safe = snapToNavigable(terrain, x, y, 0.05);
          x = safe.x;
          y = safe.y;
        }
      }
      const next = {
        ...ship,
        heading,
        x,
        y,
        alert,
        holdContact,
        lastKnownX,
        lastKnownY,
        path,
        suspicion,
        weaponCooldown: Math.max(0, ship.weaponCooldown - dt),
      };
      if (next.weaponCooldown > 0 || !detected || inFob(state) || state.submarine.invuln > 0)
        return next;
      const shallow = sub.z < 0.18;
      if (ship.kind === 'sub' && distance >= 2.5 && distance <= 14 && alert > 0.45) {
        const threat = makeThreat(state, 'torpedo', ship.id);
        if (threat?.torpedo) torpedoes.push(threat.torpedo);
        return { ...next, weaponCooldown: 7 + ((state.seed + state.tick + ship.patrolIndex) % 4) };
      }
      if (
        ship.kind === 'battleship' &&
        !shallow &&
        sub.z > 0.12 &&
        distance <= DC_ENGAGE_RANGE &&
        alert > 0.38
      ) {
        const threat = makeThreat(state, 'depthCharge', ship.id);
        if (threat?.charge) depthCharges.push(threat.charge);
        return { ...next, weaponCooldown: 2.6 };
      }
      if (
        (ship.kind === 'destroyer' || ship.kind === 'patrol' || ship.kind === 'cruiser') &&
        sub.z > 0.12 &&
        distance < 7 &&
        alert > 0.38 &&
        holdContact > 0.35
      ) {
        for (let index = 0; index < 6; index++) {
          const threat = makeThreat(state, 'hedgehog', ship.id, 'player', index);
          if (threat?.charge)
            depthCharges.push({
              ...threat.charge,
              x: threat.charge.x + Math.cos((index * Math.PI) / 3) * 0.8,
              y: threat.charge.y + Math.sin((index * Math.PI) / 3) * 0.45,
            });
        }
        return { ...next, weaponCooldown: 3.8 + ((state.seed + ship.patrolIndex) % 2) * 0.4 };
      }
      if (shallow && distance < (ship.kind === 'battleship' ? 10 : 7) && ship.kind !== 'merchant') {
        const threat = makeThreat(state, 'shell', ship.id);
        if (threat?.charge) depthCharges.push(threat.charge);
        return { ...next, weaponCooldown: 2.8 };
      }
      return next;
    });
    const spread = spreadAlert(ships, state);
    return { ...state, rngState, ships: separateShips(spread), torpedoes, depthCharges };
  },
  aircraft(state, _commands, dt) {
    let cooldown = state.aircraftCooldown - dt;
    let aircraft = state.aircraft
      .map((plane) => ({
        ...plane,
        x: plane.x + Math.cos(plane.heading) * 7.5 * dt,
        y: plane.y + Math.sin(plane.heading) * 7.5 * dt,
        life: plane.life - dt,
      }))
      .filter((plane) => plane.life > 0);
    const depthSignature = state.submarine.z < 0.12 ? 0.95 : state.submarine.z < 0.3 ? 0.55 : 0.1;
    const depthCharges = [...state.depthCharges];
    if (aircraft.length === 0 && cooldown <= 0) {
      aircraft = [
        {
          id: `aircraft-${state.tick}`,
          x: state.submarine.x - 12,
          y: state.submarine.y - 12,
          heading: Math.atan2(12, 12),
          life: 28,
          cooldown: 0,
          active: true,
        },
      ];
      cooldown = 55 + ((state.seed + state.tick) % 41);
    }
    for (const plane of aircraft) {
      const distance = Math.hypot(plane.x - state.submarine.x, plane.y - state.submarine.y);
      if (distance < 6 && depthSignature > 0.35 && state.submarine.noise > 0.15) {
        depthCharges.push({
          id: `bomb-${plane.id}-${state.tick}`,
          kind: 'bomb',
          sourceId: plane.id,
          x: plane.x,
          y: plane.y,
          z: 0.05,
          vz: 1.6,
          fuse: 1.1,
          damage: 28,
          radius: 1.8,
          targetDepth: state.submarine.z,
        });
        return {
          ...state,
          aircraft: [],
          aircraftCooldown: cooldown,
          depthCharges,
          ships: state.ships.map((ship) => ({ ...ship, alert: clamp(ship.alert + 0.3, 0, 1) })),
        };
      }
    }
    return { ...state, aircraft, aircraftCooldown: cooldown, depthCharges };
  },
  ordnance(state, _commands, dt) {
    const ships = state.ships.map((ship) => ({ ...ship }));
    let submarine = { ...state.submarine };
    const messages = [...state.messages];
    let damageDealt = 0;
    const torpedoes = state.torpedoes.flatMap((torpedo) => {
      const prevX = torpedo.x;
      const prevY = torpedo.y;
      const step = torpedo.speed * dt;
      let next = {
        ...torpedo,
        x: torpedo.x + Math.cos(torpedo.heading) * step,
        y: torpedo.y + Math.sin(torpedo.heading) * step,
        life: torpedo.life - dt,
        armDelay: torpedo.armDelay - dt,
        run: (torpedo.run ?? 0) + step,
      };
      if (next.kind === 'mk18' && next.targetId) {
        const guide = ships.find((ship) => ship.id === next.targetId);
        if (guide)
          next = {
            ...next,
            heading: turnToward(
              next.heading,
              Math.atan2(guide.y - next.y, guide.x - next.x),
              next.turnRate,
              dt,
            ),
          };
      }
      // Enemy AI fish are kind 'enemy', not mk18, but they share the same homing and foxer odds.
      const mk18Player = next.owner === 'enemy' && next.targetId === 'player';
      const seducer =
        mk18Player && seduceRoll(state.seed, next.id) < FOXER_SEDUCE_ODDS
          ? state.countermeasures.find(
              (cm) =>
                cm.kind === 'foxer' &&
                Math.hypot(cm.x - next.x, cm.y - next.y) <= FOXER_SEDUCE_RANGE,
            )
          : undefined;
      if (seducer) {
        next = {
          ...next,
          heading: turnToward(
            next.heading,
            Math.atan2(seducer.y - next.y, seducer.x - next.x),
            next.turnRate,
            dt,
          ),
        };
      } else if (mk18Player) {
        next = {
          ...next,
          heading: turnToward(
            next.heading,
            Math.atan2(submarine.y - next.y, submarine.x - next.x),
            next.turnRate,
            dt,
          ),
        };
      }
      const foxer =
        next.owner === 'enemy' &&
        state.countermeasures.find(
          (cm) => cm.kind === 'foxer' && Math.hypot(cm.x - next.x, cm.y - next.y) <= cm.radius,
        );
      if (foxer) {
        next = {
          ...next,
          heading: turnToward(
            next.heading,
            Math.atan2(foxer.y - next.y, foxer.x - next.x),
            next.turnRate,
            dt,
          ),
        };
        if (Math.hypot(next.x - foxer.x, next.y - foxer.y) < 0.7) return [];
      }
      const armed = next.armDelay <= 0 || next.run >= TORPEDO_ARM_RUN;
      if (armed && next.owner === 'player') {
        const hits = ships.filter(
          (ship) =>
            !ship.sinking &&
            distPointSegment(ship.x, ship.y, prevX, prevY, next.x, next.y) <= shipRadius(ship),
        );
        const preferred = next.targetId
          ? hits.find((ship) => ship.id === next.targetId)
          : undefined;
        const victim = preferred ?? hits[0];
        if (victim) {
          const applied = Math.min(next.damage, Math.max(0, victim.hp));
          victim.hp -= next.damage;
          damageDealt += applied;
          if (victim.hp <= 0) victim.sinking = 0.05;
          raiseHitAlarm(ships, victim);
          messages.push({
            id: `hit-${next.id}-${state.tick}`,
            text: victim.hp <= 0 ? `HIT · ${victim.name} BREAKING UP` : `HIT · ${victim.name}`,
            ttl: 2.8,
          });
          return [];
        }
      }
      if (
        armed &&
        next.owner === 'enemy' &&
        Math.hypot(next.x - submarine.x, next.y - submarine.y) <= 0.95 &&
        Math.abs(next.z - submarine.z) < 0.4 &&
        !inFob(state)
      ) {
        submarine = applyPlayerDamage(submarine, next.damage);
        return [];
      }
      return next.life > 0 ? [next] : [];
    });
    const depthCharges = state.depthCharges.flatMap((charge) => {
      const next = { ...charge, z: clampDepth(charge.z + charge.vz * dt), fuse: charge.fuse - dt };
      if (next.fuse > 0) return [next];
      const distance = Math.hypot(next.x - submarine.x, next.y - submarine.y);
      const blast = blastDamage({
        damage: next.damage,
        horizontal: distance,
        radius: next.radius,
        depthDelta: Math.abs(next.targetDepth - submarine.z),
        vertical: BLAST_VERTICAL[next.kind],
      });
      if (!inFob(state) && blast > 0) {
        const bubble = state.countermeasures.some(
          (cm) =>
            cm.kind === 'bubble' && Math.hypot(cm.x - submarine.x, cm.y - submarine.y) <= cm.radius,
        );
        submarine = applyPlayerDamage(submarine, blast * (bubble ? 0.75 : 1));
      }
      return [];
    });
    return {
      ...state,
      ships,
      torpedoes,
      depthCharges,
      submarine,
      messages,
      stats:
        damageDealt > 0
          ? { ...state.stats, damageDealt: state.stats.damageDealt + damageDealt }
          : state.stats,
    };
  },
  damage(state, _commands, dt) {
    let sunk = 0;
    let sunkScore = 0;
    const ships = state.ships.flatMap((ship) => {
      if (ship.sinking === undefined) return [ship];
      const sinking = ship.sinking - dt;
      if (sinking > 0) return [{ ...ship, sinking }];
      sunk++;
      sunkScore += scoreFor(ship);
      return [];
    });
    if (!sunk) return ships === state.ships ? state : { ...state, ships };
    const shipsSunk = state.stats.shipsSunk + sunk;
    const waveCleared = ships.length === 0;
    const victory = waveCleared && shipsSunk >= VICTORY_TARGET;
    // Each kill salvages a Mk-14 so a long fight keeps its teeth without docking.
    const submarine = {
      ...state.submarine,
      torpedoes: Math.min(state.submarine.maxTorpedoes, state.submarine.torpedoes + sunk),
    };
    return {
      ...state,
      ships,
      submarine,
      selectedTargetId: null,
      aimPoint: null,
      stats: {
        ...state.stats,
        shipsSunk,
        score: state.stats.score + sunkScore + (victory ? 1000 : 0),
        // damageDealt is applied in ordnance on hit — do not double-count on sink.
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
      const restockTick = Math.floor(state.time / 2) !== Math.floor((state.time + dt) / 2);
      sub = {
        ...sub,
        hp: clamp(sub.hp + 12 * dt, 0, sub.maxHp),
        battery: clamp(sub.battery + 18 * dt, 0, sub.maxBattery),
        torpedoes: Math.min(sub.maxTorpedoes, sub.torpedoes + 0.35 * dt),
        seekers: Math.min(sub.maxSeekers, sub.seekers + 0.2 * dt),
        sysSonar: clamp(sub.sysSonar + 0.3 * dt, 0, 1),
        sysPropulsion: clamp(sub.sysPropulsion + 0.3 * dt, 0, 1),
        sysTubes: clamp(sub.sysTubes + 0.3 * dt, 0, 1),
        sysFlood: clamp(sub.sysFlood - 0.4 * dt, 0, 1),
        cmCharges: restockTick ? Math.min(sub.maxCmCharges, sub.cmCharges + 1) : sub.cmCharges,
        decoys: restockTick ? Math.min(3, sub.decoys + 1) : sub.decoys,
      };
      stats = { ...stats, repairs: stats.repairs + Math.max(0, sub.hp - oldHp) };
    }
    const collected = state.powerups.filter(
      (pickup) => Math.hypot(pickup.x - sub.x, pickup.y - sub.y) <= PICKUP_RADIUS,
    );
    for (const pickup of collected) sub = applyPickup(sub, pickup);
    const remaining = state.powerups
      .filter((pickup) => !collected.includes(pickup) && pickup.life - dt > 0)
      .map((pickup) => ({ ...pickup, life: pickup.life - dt }));
    const pickupRespawn = state.pickupRespawn - dt;
    const powerups =
      pickupRespawn <= 0 && remaining.length < PICKUP_MAX
        ? [
            ...remaining,
            ...seedPowerups(state.seed + state.tick, 1, state.worldVersion).map((pickup) => ({
              ...pickup,
              id: `pickup-${state.tick}`,
              life: PICKUP_LIFE,
            })),
          ]
        : remaining;
    const boardEmpty =
      state.scenario !== 'convoy-strike' &&
      state.phase === 'playing' &&
      state.ships.length === 0 &&
      state.stats.shipsSunk < VICTORY_TARGET;
    const inbound = state.messages.find((message) => /^WAVE \d+ INBOUND$/.test(message.text));
    const spawnWave = boardEmpty && inbound !== undefined && inbound.ttl <= dt;
    const holding = boardEmpty && !spawnWave;
    const gatedPowerups = holding ? remaining : powerups;
    const gatedRespawn = holding
      ? Math.max(pickupRespawn, dt)
      : pickupRespawn <= 0
        ? PICKUP_RESPAWN
        : pickupRespawn;
    const nextWave = stats.wave + 1;
    const messages = !boardEmpty
      ? state.messages
      : spawnWave
        ? state.messages.filter((message) => message !== inbound)
        : inbound
          ? state.messages
          : [
              ...state.messages,
              {
                id: `wave-inbound-${nextWave}`,
                text: `WAVE ${nextWave} INBOUND`,
                ttl: WAVE_BREATHER,
              },
            ];
    const nextPowerups = spawnWave
      ? [
          ...gatedPowerups,
          ...seedPowerups(state.seed + stats.wave * 101, 3, state.worldVersion),
        ].slice(0, PICKUP_MAX)
      : gatedPowerups;
    return {
      ...state,
      submarine: sub,
      stats: {
        ...stats,
        wave: spawnWave ? nextWave : stats.wave,
        powerupsTaken: stats.powerupsTaken + collected.length,
      },
      powerups: nextPowerups,
      messages,
      dockHold,
      pickupRespawn: gatedRespawn,
      ships: spawnWave
        ? seedWave(state.seed, nextWave, undefined, state.worldVersion)
        : state.ships,
    };
  },
  cleanupEvents: (state, _commands, dt) => ({
    ...state,
    phase:
      state.submarine.hp <= 0
        ? 'gameover'
        : state.scenario === 'convoy-strike' &&
            state.phase === 'playing' &&
            state.strikeExit != null &&
            !state.ships.some((ship) => ship.id === 'strike-merchant') &&
            state.stats.shipsSunk > 0 &&
            Math.hypot(
              state.submarine.x - state.strikeExit.x,
              state.submarine.y - state.strikeExit.y,
            ) <= 4
          ? 'victory'
          : state.phase,
    countermeasures: state.countermeasures
      .filter((cm) => cm.life - dt > 0)
      .map((cm) => ({ ...cm, life: cm.life - dt })),
    messages: state.messages
      .filter((message) => message.ttl > 0)
      .map((message) => ({ ...message, ttl: message.ttl - dt })),
  }),
};
