import type { GameCommand } from '../commands/types';
import { clampDepth, clampSim } from './coords';
import { seedPowerups, seedWave } from './create';
import type {
  Countermeasure,
  GameMessage,
  GameState,
  Powerup,
  Ship,
  ShipKind,
  SpeedOrder,
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
  BUBBLE_HOLD_DRAIN,
  DEEP_SAFE_DEPTH,
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
import { updateSonar, shipMaxSpeed } from './sonar';
import { canHearPing, hasContact } from './contact';
import { DOCTRINE_KINDS, escortIntent, merchantIntent } from './escort-doctrine';
import { releaseCallouts } from './defense-callout';
import { separateShips } from './ship-separation';
import { integrateV2Horizontal, resolveV2WorldCollision } from '../world/collision';
import { getWorld } from '../world/queries';
import { emergencySurface } from './action-feel';
import { advanceShipDamage } from './ship-damage';
import {
  advanceBank,
  advanceDepth,
  approachSpeed,
  helmYawDelta,
  rudderAuthority,
  hullStressDamage,
} from './vessel-dynamics';
import {
  advanceOrdnance,
  aircraftBomb,
  DC_PATTERN_COOLDOWN,
  DECK_GUN_RANGE,
  DECK_GUN_RELOAD,
  depthChargePattern,
  enemyShellAim,
  hedgehogEllipse,
  makeShell,
  makeThreat,
  makeTorpedo,
  shellDispersionScale,
} from './ordnance-physics';
export {
  chaseDepth,
  hullDepth,
  launchHeading,
  seduceRoll,
  TUBE_ARC_RAD,
} from './ordnance-physics';

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
const inFob = (state: GameState, x = state.submarine.x, y = state.submarine.y) =>
  Math.hypot(x - state.base.x, y - state.base.y) <= state.base.radius;
const turnToward = (heading: number, target: number, rate: number, dt: number) =>
  heading + clamp(normalizeAngle(target - heading), -rate * dt, rate * dt);
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

/** Signed bow-relative bearing, wrapped to [-π, π]. */
export function bowRelativeBearing(
  boatHeading: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const desired = Math.atan2(toY - fromY, toX - fromX);
  return Math.atan2(Math.sin(desired - boatHeading), Math.cos(desired - boatHeading));
}

const HUNTER_KINDS: ReadonlySet<Ship['kind']> = new Set([
  'destroyer',
  'patrol',
  'cruiser',
  'battleship',
  'sub',
]);

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
  applyCommands(state, commands, dt) {
    let next = state;
    for (const command of commands) {
      if (command.type === 'helm') {
        // Sticky speed orders (0/I/O/P) own targetSpeed. WASD only steers and nudges depth
        // so holding W cannot fight Flank / 1/3 / Stop. The rudder needs flow —
        // a stopped boat barely answers the helm.
        const yawDelta = helmYawDelta(next.submarine, command.yaw);
        next = {
          ...next,
          submarine: {
            ...next.submarine,
            heading: next.submarine.heading + yawDelta,
            yawRate: dt > 0 ? yawDelta / dt : next.submarine.yawRate,
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
            shells: threat.shell ? [...next.shells, threat.shell] : next.shells,
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
        // A sinking hull is no longer a firing solution — fall through to the
        // nearest live contact rather than aiming at the dying wreck.
        const target = usePointAim
          ? undefined
          : (next.ships.find(
              (ship) => ship.id === next.selectedTargetId && ship.sinking === undefined,
            ) ??
            next.ships.find(
              (ship) =>
                ship.sinking === undefined && Math.hypot(ship.x - sub.x, ship.y - sub.y) <= 6,
            ));
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
          // Deck gun fires a real shell now — the hit lands when the round splashes.
          const fired = makeShell(
            next,
            'player',
            'player',
            sub.x,
            sub.y,
            fireTarget.x,
            fireTarget.y,
            0.5,
            next.rngState,
          );
          next = {
            ...next,
            rngState: fired.rngState,
            submarine: { ...sub, noise: clamp(sub.noise + 0.42, 0, 1) },
            shells: [...next.shells, fired.shell],
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
      // Steering assistance stays on. Only this flag may spend ammunition.
      if (ready && inWindow && next.assistanceAutoFire) {
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
    const turn = clamp(delta, -0.9 / 60, 0.9 / 60) * rudderAuthority(state.submarine);
    return {
      ...state,
      submarine: {
        ...state.submarine,
        heading: state.submarine.heading + turn,
        yawRate: dt > 0 ? turn / dt : state.submarine.yawRate,
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
    sub.speed = approachSpeed(sub.speed, wanted * (diving ? 0.82 : 1), dt);
    const depth = advanceDepth(sub, dt);
    sub.z = depth.z;
    sub.depthRate = depth.depthRate;
    sub.blowTimer = depth.blowTimer;
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
    // Bank follows this step's realized yaw; turn sites rewrite yawRate each step.
    sub.bank = advanceBank(sub, dt);
    sub.yawRate = 0;
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
    // Absolute-depth hull stress — the boat groans past the deep limit no
    // matter what the local terrain says.
    const stress = sub.invuln <= 0 && !inFob(state, x, y) ? hullStressDamage(z, dt) : 0;
    const hp = clamp(sub.hp - crush - stress, 0, sub.maxHp);
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
        lastDamage: crush > 0 || stress > 0 ? 'ground' : sub.lastDamage,
      },
    };
  },
  sonar: (state, _commands, dt) => updateSonar(state, dt),
  enemies(state, _commands, dt) {
    const terrain = getTerrain(state.terrainSeed);
    const sub = state.submarine;
    const torpedoes = [...state.torpedoes];
    const depthCharges = [...state.depthCharges];
    const shells = [...state.shells];
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
    // Doctrine slots are claimed from the *current* state, not the map in
    // progress — that is what keeps the attack-run cap honest.
    const attackRunners = state.ships.filter(
      (other) =>
        DOCTRINE_KINDS.has(other.kind) &&
        other.doctrine === 'attackRun' &&
        other.sinking === undefined,
    ).length;
    // Ships that commit to a run in this same pass also claim a slot, so two
    // escorts cannot pounce simultaneously on a fresh fix.
    let claimedRuns = 0;
    const chargesBefore = depthCharges.length;
    const torpedoesBefore = torpedoes.length;
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
      // A ping intercept is bearing-only: it raises the alarm net far beyond
      // passive range but never sets the datum the doctrine hunts.
      if (canHearPing(ship, state)) alert = Math.max(alert, 0.4);
      const clear = makeClear(terrain, shipClearRadius(ship.kind));
      const anchor = ship.formationAnchorId
        ? state.ships.find(
            (other) => other.id === ship.formationAnchorId && other.sinking === undefined,
          )
        : undefined;
      let path = ship.path;
      let basePursuit: number;
      if (anchor) {
        basePursuit = formationSlotHeading(ship, anchor, state.time);
      } else if (path.length > 0) {
        let goal = path[0]!;
        if (Math.hypot(ship.x - goal.x, ship.y - goal.y) < 1.35) {
          path = [...path.slice(1), goal];
          goal = path[0]!;
        }
        basePursuit = Math.atan2(goal.y - ship.y, goal.x - ship.x);
      } else {
        basePursuit = ship.heading + Math.sin((state.time + ship.patrolIndex) * 0.15) * 0.12;
      }
      const chase =
        alert > 0.25 && holdContact > 0 && lastKnownX !== undefined && lastKnownY !== undefined
          ? Math.atan2(lastKnownY - ship.y, lastKnownX - ship.x)
          : null;
      // Battle doctrine: escorts hunt a predicted datum track, merchants
      // zig-zag or scatter. Both may override heading, speed, and weapons.
      let doctrineFields: Partial<Ship> = {};
      let doctrineSuspicion: number | undefined;
      let intentHeading: number | null = null;
      let intentSpeedFrac: number | null = null;
      let drop: 'pattern' | 'hedgehog' | null = null;
      let aimX: number | undefined;
      let aimY: number | undefined;
      if (DOCTRINE_KINDS.has(ship.kind)) {
        const fix = detected || swept ? { x: sub.x, y: sub.y } : null;
        const intent = escortIntent(
          { ...ship, alert, holdContact },
          fix,
          state,
          dt,
          attackRunners + claimedRuns,
        );
        const updated = intent.ship;
        if (updated.doctrine === 'attackRun' && ship.doctrine !== 'attackRun') claimedRuns += 1;
        doctrineFields = {
          doctrine: updated.doctrine,
          datumX: updated.datumX,
          datumY: updated.datumY,
          datumVx: updated.datumVx,
          datumVy: updated.datumVy,
          doctrineTimer: updated.doctrineTimer,
          lastFixTime: updated.lastFixTime,
        };
        // Search give-up resets suspicion inside the doctrine step.
        doctrineSuspicion = updated.suspicion;
        intentHeading = intent.heading;
        intentSpeedFrac = intent.speedFrac;
        drop = intent.action;
        aimX = intent.aimX;
        aimY = intent.aimY;
      } else if (ship.kind === 'merchant') {
        const intent = merchantIntent(ship, basePursuit, state, dt);
        doctrineFields = {
          scatterTimer: intent.ship.scatterTimer,
          scatterX: intent.ship.scatterX,
          scatterY: intent.ship.scatterY,
        };
        intentHeading = intent.heading;
        intentSpeedFrac = intent.speedFrac;
      }
      const pursuit =
        intentHeading ?? (ship.kind === 'merchant' ? basePursuit : chase ?? basePursuit);
      const lookAhead = Math.max(2.8, ship.speed * 1.8);
      let heading = turnToward(
        ship.heading,
        steerAvoid(ship.x, ship.y, pursuit, lookAhead, clear),
        shipTurnRate[ship.kind] * (alert > 0.25 ? 1 : 0.72),
        dt,
      );
      // Cruise on patrol; full class speed only when alerted / pursuing.
      // Doctrine may order an explicit fraction of class max. Flooding and a
      // wrecked stern shave real speed off the order.
      const mobility = ship.speedFactor * (1 - 0.6 * ship.flooding);
      const moveSpeed =
        (intentSpeedFrac !== null
          ? shipMaxSpeed[ship.kind] * intentSpeedFrac
          : alert > 0.25 && holdContact > 0
            ? ship.speed
            : ship.speed * 0.62) * mobility;
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
        suspicion: doctrineSuspicion ?? suspicion,
        weaponCooldown: Math.max(0, ship.weaponCooldown - dt),
        ...doctrineFields,
      };
      if (next.weaponCooldown > 0 || inFob(state) || state.submarine.invuln > 0)
        return next;
      // Doctrine-driven ordnance works the predicted datum — no live fix needed
      // at release, the run already committed to it.
      if (drop === 'hedgehog') {
        depthCharges.push(...hedgehogEllipse(state, next, aimX, aimY));
        return { ...next, weaponCooldown: DC_PATTERN_COOLDOWN };
      }
      if (drop === 'pattern' && sub.z > 0.12) {
        const pattern = depthChargePattern(state, next, rngState);
        rngState = pattern.rngState;
        depthCharges.push(...pattern.charges);
        return { ...next, weaponCooldown: DC_PATTERN_COOLDOWN };
      }
      if (!detected) return next;
      const shallow = sub.z < 0.18;
      if (ship.kind === 'sub' && distance >= 2.5 && distance <= 14 && alert > 0.45) {
        const threat = makeThreat(state, 'torpedo', ship.id);
        if (threat?.torpedo) torpedoes.push(threat.torpedo);
        return { ...next, weaponCooldown: 7 + ((state.seed + state.tick + ship.patrolIndex) % 4) };
      }
      if (shallow && distance < (ship.kind === 'battleship' ? DECK_GUN_RANGE : 7) && ship.kind !== 'merchant') {
        // Battleships only shoot now; every warship's deck gun fires a live shell.
        const aim = enemyShellAim(state, ship);
        const fired = makeShell(
          state,
          'enemy',
          ship.id,
          ship.x,
          ship.y,
          aim.x,
          aim.y,
          shellDispersionScale(ship),
          rngState,
        );
        rngState = fired.rngState;
        shells.push(fired.shell);
        return { ...next, weaponCooldown: DECK_GUN_RELOAD };
      }
      return next;
    });
    const spread = spreadAlert(ships, state);
    const released = releaseCallouts(
      state,
      depthCharges.slice(chargesBefore),
      torpedoes.slice(torpedoesBefore),
    );
    return {
      ...state,
      rngState,
      ships: separateShips(spread),
      torpedoes,
      depthCharges,
      shells,
      messages: released.length > 0 ? [...state.messages, ...released] : state.messages,
    };
  },
  aircraft(state, _commands, dt) {
    let cooldown = state.aircraftCooldown - dt;
    const sub = state.submarine;
    const seesBoat = sub.z <= 0.3;
    const cues: { x: number; y: number }[] = [];
    const AIRCRAFT_SPEED = 7.5;
    const ORBIT_RADIUS = 3;
    let aircraft: GameState['aircraft'] = state.aircraft
      .map((plane) => {
        // The datum tracks the boat only while the plane can still see it;
        // once the boat goes deep the plane orbits the last fix.
        let datumX = plane.datumX;
        let datumY = plane.datumY;
        if (seesBoat) {
          datumX = sub.x;
          datumY = sub.y;
        }
        let heading = plane.heading;
        let cueTimer = (plane.cueTimer ?? 5) - dt;
        if (!seesBoat && datumX !== undefined && datumY !== undefined) {
          const angle = Math.atan2(plane.y - datumY, plane.x - datumX);
          const sweep = (AIRCRAFT_SPEED * dt) / ORBIT_RADIUS;
          const aimX = datumX + Math.cos(angle + sweep) * ORBIT_RADIUS;
          const aimY = datumY + Math.sin(angle + sweep) * ORBIT_RADIUS;
          heading = Math.atan2(aimY - plane.y, aimX - plane.x);
          // Every few seconds the circling plane cues the escorts to its datum.
          if (cueTimer <= 0) {
            cueTimer = 5;
            cues.push({ x: datumX, y: datumY });
          }
        }
        return {
          ...plane,
          x: plane.x + Math.cos(heading) * AIRCRAFT_SPEED * dt,
          y: plane.y + Math.sin(heading) * AIRCRAFT_SPEED * dt,
          heading,
          datumX,
          datumY,
          cueTimer,
          life: plane.life - dt,
        };
      })
      .filter((plane) => plane.life > 0);
    const depthSignature = sub.z < 0.12 ? 0.95 : sub.z < 0.3 ? 0.55 : 0.1;
    const depthCharges = [...state.depthCharges];
    if (aircraft.length === 0 && cooldown <= 0) {
      aircraft = [
        {
          id: `aircraft-${state.tick}`,
          x: sub.x - 12,
          y: sub.y - 12,
          heading: Math.atan2(12, 12),
          life: 28,
          cooldown: 0,
          active: true,
          cueTimer: 5,
        },
      ];
      cooldown = 55 + ((state.seed + state.tick) % 41);
    }
    let bombed = false;
    for (const plane of aircraft) {
      const distance = Math.hypot(plane.x - sub.x, plane.y - sub.y);
      if (distance < 6 && depthSignature > 0.35 && sub.noise > 0.15) {
        depthCharges.push(aircraftBomb(state, plane));
        bombed = true;
        break;
      }
    }
    let ships = state.ships;
    if (cues.length > 0) {
      ships = ships.map((ship) => {
        const cue = cues.find(
          (point) => Math.hypot(ship.x - point.x, ship.y - point.y) <= 30,
        );
        if (!cue) return ship;
        return {
          ...ship,
          lastKnownX: cue.x,
          lastKnownY: cue.y,
          alert: Math.max(ship.alert, 0.3),
        };
      });
    }
    if (bombed) {
      const released = releaseCallouts(state, depthCharges.slice(state.depthCharges.length), []);
      return {
        ...state,
        aircraft: [],
        aircraftCooldown: cooldown,
        depthCharges,
        ships: ships.map((ship) => ({ ...ship, alert: clamp(ship.alert + 0.3, 0, 1) })),
        messages: released.length > 0 ? [...state.messages, ...released] : state.messages,
      };
    }
    return { ...state, aircraft, aircraftCooldown: cooldown, depthCharges, ships };
  },
  ordnance(state, _commands, dt) {
    return advanceOrdnance(state, dt);
  },
  damage(state, _commands, dt) {
    let sunk = 0;
    let sunkScore = 0;
    const mortal: GameMessage[] = [];
    const ships = state.ships.flatMap((ship) => {
      const outcome = advanceShipDamage(ship, dt);
      if (outcome.ship === null) {
        sunk++;
        sunkScore += scoreFor(ship);
        return [];
      }
      if (outcome.becameSinking) {
        mortal.push({
          id: `mortal-flood-${ship.id}-${state.tick}`,
          text: `MORTALLY HIT · ${ship.name}`,
          ttl: 4,
        });
      }
      return [outcome.ship];
    });
    if (!sunk) {
      if (mortal.length === 0 && ships.every((ship, index) => ship === state.ships[index]))
        return state;
      return { ...state, ships, messages: [...state.messages, ...mortal] };
    }
    const shipsSunk = state.stats.shipsSunk + sunk;
    const waveCleared = ships.length === 0;
    const victory = waveCleared && shipsSunk >= VICTORY_TARGET;
    // Only drop the firing solution when the locked ship went down — a screening
    // escort eating a fish meant for the merchant must not clear the TDC.
    const targetGone =
      state.selectedTargetId !== null &&
      !ships.some((ship) => ship.id === state.selectedTargetId);
    // Each kill salvages a Mk-14 so a long fight keeps its teeth without docking.
    const submarine = {
      ...state.submarine,
      torpedoes: Math.min(state.submarine.maxTorpedoes, state.submarine.torpedoes + sunk),
    };
    return {
      ...state,
      ships,
      submarine,
      selectedTargetId: targetGone ? null : state.selectedTargetId,
      aimPoint: targetGone ? null : state.aimPoint,
      stats: {
        ...state.stats,
        shipsSunk,
        score: state.stats.score + sunkScore + (victory ? 1000 : 0),
        // damageDealt is applied in ordnance on hit — do not double-count on sink.
      },
      messages: [
        ...state.messages,
        ...mortal,
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
