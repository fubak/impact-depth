import { blastDamage } from './blast';
import { clampDepth } from './coords';
import {
  BLAST_VERTICAL,
  FOXER_SEDUCE_ODDS,
  FOXER_SEDUCE_RANGE,
} from './constants';
import { nextRandom } from './rng';
import { applyShellHit, applyTorpedoHit, hullHalfLength } from './ship-damage';
import { shipMachineryNoise } from './sonar';
import type {
  DepthCharge,
  Detonation,
  GameMessage,
  GameState,
  Point,
  Shell,
  Ship,
  ShipKind,
  Submarine,
  ThreatKind,
  Torpedo,
} from './types';
import { getTerrain, isLand, SEAMOUNT_CRUSH_DEPTH, terrainHeight } from './world';
import { getWorld, worldHeight, worldIsLand } from '../world/queries';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
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
const inFob = (state: GameState, x = state.submarine.x, y = state.submarine.y) =>
  Math.hypot(x - state.base.x, y - state.base.y) <= state.base.radius;

/* ------------------------------------------------------------------ *
 * Ballistics + release numbers (Plan 026 Phase 1).
 * ------------------------------------------------------------------ */

/** Tubes aim at most 60° off the bow. The HUD lead is still the desired bearing. */
export const TUBE_ARC_RAD = Math.PI / 3;
/** Fish leave the tube ahead of the bow, not from the hull centre. */
export const TORPEDO_BOW_OFFSET = 0.9;
/** Torpedo motors spool up to `runSpeed` at this rate (u/s²). */
export const TORPEDO_ACCEL = 7;
/** Passive seeker half-cone (radians) for Mk-18 and enemy fish. */
export const SEEKER_CONE = 0.6;
/** Mk-18 hear-anything range (sim units). */
export const MK18_SEEKER_RANGE = 11;
/** Enemy fish acquisition range = BASE + NOISE * boat noise. */
export const ENEMY_ACQUIRE_BASE = 5;
export const ENEMY_ACQUIRE_NOISE = 12;
/** Minimum run-out before a torpedo can arm (avoids deck hits / instant spawns). */
export const TORPEDO_ARM_RUN = 0.95;

/** Sink rate by kind. ~24 m per unit, so a 0.12 DC sinks ≈2.9 m/s — dodgeable. */
export const CHARGE_SINK: Record<DepthCharge['kind'], number> = {
  depthCharge: 0.12,
  hedgehog: 0.22,
  shell: 0.12,
  bomb: 0.14,
};
/** Safety fuses: real detonation comes from the pistol depth or the seabed. */
const CHARGE_SAFETY: Record<DepthCharge['kind'], number> = {
  depthCharge: 40,
  hedgehog: 25,
  shell: 40,
  bomb: 20,
};
/** Water drag on thrown charges (per second). */
export const CHARGE_WATER_DRAG = 3;
/** K-gun lateral throw speed. */
export const KGUN_THROW_SPEED = 3;
/** Hedgehog contact window — passes close by and it goes off. */
export const HEDGEHOG_CONTACT_RADIUS = 0.45;
export const HEDGEHOG_CONTACT_DEPTH = 0.06;
export const HEDGEHOG_DAMAGE = 34;
/** Escort DC run cooldown. */
export const DC_PATTERN_COOLDOWN = 9;
/** Hedgehog ahead-throw: ellipse centred this far ahead of the escort. */
export const HEDGEHOG_LEAD = 3;

export const SHELL_SPEED = 9;
export const SHELL_GRAVITY = 4;
const SHELL_MUZZLE_ALT = 0.05;
export const DECK_GUN_RANGE = 10;
export const DECK_GUN_RELOAD = 1.6;
export const DECK_GUN_DAMAGE = 22;
/** A shell splash hurts a boat on or near the surface; deeper it is a waste. */
export const SHELL_SURFACED_DEPTH = 0.14;
export const SHELL_SHALLOW_DEPTH = 0.3;
export const SHELL_SHALLOW_FACTOR = 0.35;

/* ------------------------------------------------------------------ *
 * Depth + bearing helpers
 * ------------------------------------------------------------------ */

/** Enemy boats ride the thermocline. Surface ships stay in the trough. */
export function hullDepth(kind: ShipKind): number {
  return kind === 'sub' ? 0.32 : 0.02;
}

/** Close on the target's depth. A straight Mk-14 still does not turn. */
export function chaseDepth(current: number, target: number, dt: number): number {
  const step = Math.max(-0.55 * dt, Math.min(0.55 * dt, target - current));
  return Math.max(0.02, Math.min(0.92, current + step));
}

export function launchHeading(boatHeading: number, desiredHeading: number): number {
  const delta = Math.atan2(
    Math.sin(desiredHeading - boatHeading),
    Math.cos(desiredHeading - boatHeading),
  );
  const clamped = Math.max(-TUBE_ARC_RAD, Math.min(TUBE_ARC_RAD, delta));
  return Math.atan2(Math.sin(boatHeading + clamped), Math.cos(boatHeading + clamped));
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

/** Arcade-readable hull radii so discrete torpedo steps can still register hits. */
const shipRadius = (ship: Ship) => hullHalfLength(ship);

/** Normalized water depth below a point — same scale `hullDepthLimit` uses. */
export function waterDepthAt(state: GameState, x: number, y: number): number {
  const height =
    state.worldVersion === 'littoral-v2'
      ? worldHeight(getWorld('littoral-v2', state.terrainSeed), x, y)
      : terrainHeight(getTerrain(state.terrainSeed), x, y);
  return clampDepth(1 - height + 0.2);
}

export function ordnanceHitsLand(state: GameState, x: number, y: number): boolean {
  return state.worldVersion === 'littoral-v2'
    ? worldIsLand(getWorld('littoral-v2', state.terrainSeed), x, y)
    : isLand(getTerrain(state.terrainSeed), x, y);
}

/**
 * A fish's floor matches the hull model: the world already lets a boat ride to
 * SEAMOUNT_CRUSH_DEPTH over shelves, so a torpedo chasing it may too.
 * Charges ground on the real bed — `waterDepthAt` — not this.
 */
function torpedoFloor(state: GameState, x: number, y: number): number {
  return Math.max(SEAMOUNT_CRUSH_DEPTH + 0.03, waterDepthAt(state, x, y));
}

/* ------------------------------------------------------------------ *
 * Launch
 * ------------------------------------------------------------------ */

export function makeTorpedo(
  state: GameState,
  kind: 'mk14' | 'mk18',
  targetId: string | null,
  offset = 0,
  aimPoint: Point | null = null,
): Torpedo {
  const target = targetId ? state.ships.find((ship) => ship.id === targetId) : undefined;
  const sub = state.submarine;
  const runSpeed = kind === 'mk14' ? 9.5 : 8.2;
  let heading = sub.heading + offset;
  if (target) {
    // Lead the contact so straight runners remain usable past point-blank range.
    const range = Math.hypot(target.x - sub.x, target.y - sub.y);
    const eta = range / Math.max(0.1, runSpeed);
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
    x: sub.x + Math.cos(sub.heading) * TORPEDO_BOW_OFFSET,
    y: sub.y + Math.sin(sub.heading) * TORPEDO_BOW_OFFSET,
    z: sub.z,
    heading,
    // Leaves the tube at boat speed plus a shove; the motor spools up in flight.
    speed: Math.min(runSpeed, sub.speed + 2),
    runSpeed,
    lockId: null,
    life: kind === 'mk14' ? 8 : 10,
    // Time arm is a fallback; run-out distance is authoritative in ordnance().
    armDelay: kind === 'mk14' ? 0.08 : 0.1,
    damage: (kind === 'mk14' ? 48 : 58) * (1 + sub.weaponTier * 0.18) * (0.7 + sub.sysTubes * 0.3),
    targetId,
    turnRate: kind === 'mk14' ? 2.2 : 2.8,
    run: 0,
  };
}

export function makeThreat(
  state: GameState,
  kind: ThreatKind,
  sourceId: string,
  targetId?: string,
  sequence = 0,
): { torpedo?: Torpedo; charge?: DepthCharge; shell?: Shell } | null {
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
        x: source.x + Math.cos(source.heading) * TORPEDO_BOW_OFFSET,
        y: source.y + Math.sin(source.heading) * TORPEDO_BOW_OFFSET,
        z: 0.5,
        heading,
        speed: Math.min(7.5, source.speed + 2),
        runSpeed: 7.5,
        // The fish still has to hear the boat before it turns on.
        lockId: null,
        life: 9,
        armDelay: 0.05,
        damage: 42,
        targetId: 'player',
        turnRate: state.submarine.noise < 0.22 || state.submarine.silentRunning ? 1.1 : 2.4,
        run: 0,
      },
    };
  }
  if (kind === 'shell') {
    // spawnThreat shells are a debug path: drop a straight shell on the boat.
    const aim = enemyShellAim(state, source);
    return { shell: makeShell(state, 'enemy', sourceId, source.x, source.y, aim.x, aim.y, 0.4, state.rngState).shell };
  }
  const threatStats = {
    depthCharge: { damage: 45, radius: 2.2 },
    hedgehog: { damage: HEDGEHOG_DAMAGE, radius: HEDGEHOG_CONTACT_RADIUS },
    shell: { damage: 22, radius: 0.8 },
    bomb: { damage: 28, radius: 1.8 },
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
      vx: 0,
      vy: 0,
      vz: CHARGE_SINK[kind],
      fuse: CHARGE_SAFETY[kind],
      damage: values.damage,
      radius: values.radius,
      targetDepth: kind === 'bomb' ? 0.12 : clampDepth(target.z),
    },
  };
}

/**
 * Escort depth-charge run: three stern rolls behind the ship plus two K-gun
 * throws that carry lateral velocity. The pistol is the ship's *estimate* of
 * boat depth — a firm contact sets it dead on, a fleeting one guesses wrong.
 */
export function depthChargePattern(
  state: GameState,
  ship: Ship,
  rngState: number,
): { charges: DepthCharge[]; rngState: number } {
  const sub = state.submarine;
  const estimateRoll = nextRandom(rngState);
  rngState = estimateRoll.state;
  const error = 0.18 * (1 - Math.min(1, ship.holdContact / 6));
  const estimate = clamp(sub.z + (estimateRoll.value < 0.5 ? -error : error), 0.08, 0.9);
  const charges: DepthCharge[] = [];
  const push = (x: number, y: number, vx: number, vy: number) => {
    const pistolRoll = nextRandom(rngState);
    rngState = pistolRoll.state;
    charges.push({
      id: `dc-${ship.id}-${state.tick}-${charges.length}`,
      kind: 'depthCharge',
      sourceId: ship.id,
      x,
      y,
      z: 0.04,
      vx,
      vy,
      vz: CHARGE_SINK.depthCharge,
      fuse: CHARGE_SAFETY.depthCharge,
      damage: 45,
      radius: 2.2,
      targetDepth: clamp(estimate + (pistolRoll.value * 2 - 1) * 0.06, 0.08, 0.9),
    });
  };
  for (const astern of [-0.3, -0.9, -1.5]) {
    push(ship.x + Math.cos(ship.heading) * astern, ship.y + Math.sin(ship.heading) * astern, 0, 0);
  }
  for (const side of [-1, 1]) {
    const lx = -Math.sin(ship.heading) * side;
    const ly = Math.cos(ship.heading) * side;
    push(ship.x + lx * 0.3, ship.y + ly * 0.3, lx * KGUN_THROW_SPEED, ly * KGUN_THROW_SPEED);
  }
  return { charges, rngState };
}

/** Hedgehogs fire ahead of the escort onto the track the boat is on. */
export function hedgehogEllipse(
  state: GameState,
  ship: Ship,
  aimX?: number,
  aimY?: number,
): DepthCharge[] {
  const cx = aimX ?? ship.x + Math.cos(ship.heading) * HEDGEHOG_LEAD;
  const cy = aimY ?? ship.y + Math.sin(ship.heading) * HEDGEHOG_LEAD;
  const cos = Math.cos(ship.heading);
  const sin = Math.sin(ship.heading);
  return Array.from({ length: 8 }, (_, index) => {
    const a = (index / 8) * Math.PI * 2;
    return {
      id: `hog-${ship.id}-${state.tick}-${index}`,
      kind: 'hedgehog' as const,
      sourceId: ship.id,
      x: cx + Math.cos(a) * 0.7 * cos - Math.sin(a) * 0.45 * sin,
      y: cy + Math.cos(a) * 0.7 * sin + Math.sin(a) * 0.45 * cos,
      z: 0.05,
      vx: 0,
      vy: 0,
      vz: CHARGE_SINK.hedgehog,
      fuse: CHARGE_SAFETY.hedgehog,
      damage: HEDGEHOG_DAMAGE,
      radius: HEDGEHOG_CONTACT_RADIUS,
      targetDepth: state.submarine.z,
    };
  });
}

/** A bomber leads the boat and drops a shallow-set charge with forward speed. */
export function aircraftBomb(state: GameState, plane: GameState['aircraft'][number]): DepthCharge {
  const sub = state.submarine;
  const targetDepth = 0.12;
  const eta = Math.max(0.2, (targetDepth - 0.05) / CHARGE_SINK.bomb);
  const aimX = sub.x + Math.cos(sub.heading) * sub.speed * eta;
  const aimY = sub.y + Math.sin(sub.heading) * sub.speed * eta;
  return {
    id: `bomb-${plane.id}-${state.tick}`,
    kind: 'bomb',
    sourceId: plane.id,
    x: plane.x,
    y: plane.y,
    z: 0.05,
    vx: (aimX - plane.x) / eta,
    vy: (aimY - plane.y) / eta,
    vz: CHARGE_SINK.bomb,
    fuse: CHARGE_SAFETY.bomb,
    damage: 28,
    radius: 1.8,
    targetDepth,
  };
}

/**
 * Ballistic shell: lofted so it splashes on the aim point after `range / 9`
 * seconds of flight. Dispersion widens with range and shrinks with a firm fix.
 */
export function makeShell(
  state: GameState,
  owner: 'player' | 'enemy',
  sourceId: string,
  originX: number,
  originY: number,
  aimX: number,
  aimY: number,
  dispersionScale: number,
  rngState: number,
): { shell: Shell; rngState: number } {
  const dir = nextRandom(rngState);
  const mag = nextRandom(dir.state);
  const range = Math.hypot(aimX - originX, aimY - originY);
  const spread = (0.25 + 0.04 * range) * dispersionScale;
  const tx = aimX + Math.cos(dir.value * Math.PI * 2) * mag.value * spread;
  const ty = aimY + Math.sin(dir.value * Math.PI * 2) * mag.value * spread;
  const eta = Math.max(0.05, Math.hypot(tx - originX, ty - originY) / SHELL_SPEED);
  const bearing = Math.atan2(ty - originY, tx - originX);
  return {
    rngState: mag.state,
    shell: {
      id: `shell-${sourceId}-${state.tick}`,
      owner,
      sourceId,
      x: originX,
      y: originY,
      alt: SHELL_MUZZLE_ALT,
      vx: Math.cos(bearing) * SHELL_SPEED,
      vy: Math.sin(bearing) * SHELL_SPEED,
      valt: (SHELL_GRAVITY * eta) / 2 - SHELL_MUZZLE_ALT / eta,
      damage: DECK_GUN_DAMAGE,
      radius: 0.8,
    },
  };
}

/** Enemy gunnery aims where the boat will be — lead by the shell's flight time. */
export function enemyShellAim(state: GameState, source: Ship): Point {
  const sub = state.submarine;
  const eta = Math.hypot(sub.x - source.x, sub.y - source.y) / SHELL_SPEED;
  return {
    x: sub.x + Math.cos(sub.heading) * sub.speed * eta,
    y: sub.y + Math.sin(sub.heading) * sub.speed * eta,
  };
}

/** Dispersion scale: a firm contact halves the fall-of-shot spread. */
export function shellDispersionScale(source: Ship): number {
  return 0.55 + (1 - Math.min(1, source.holdContact / 6)) * 0.45;
}

/* ------------------------------------------------------------------ *
 * Detonation + damage application
 * ------------------------------------------------------------------ */

const SURFACE_DETONATION_DEPTH = 0.15;

interface OrdnanceCtx {
  state: GameState;
  ships: Ship[];
  submarine: Submarine;
  detonations: Detonation[];
  messages: GameMessage[];
  damageDealt: number;
}

interface Munition {
  id: string;
  kind: Detonation['kind'];
  owner: Detonation['owner'];
  damage: number;
}

/** Charges carry a sourceId, not an owner — the player never drops them. */
const chargeMunition = (charge: DepthCharge): Munition => ({
  id: charge.id,
  kind: charge.kind,
  owner: 'enemy',
  damage: charge.damage,
});

/** Torpedo kinds are launch modes; a detonation is just 'torpedo'. */
const torpedoMunition = (torpedo: Torpedo): Munition => ({
  id: torpedo.id,
  kind: 'torpedo',
  owner: torpedo.owner,
  damage: torpedo.damage,
});

function detonate(
  ctx: OrdnanceCtx,
  munition: Munition,
  x: number,
  y: number,
  z: number,
  hitId: string | null,
): void {
  ctx.detonations.push({
    id: munition.id,
    kind: munition.kind,
    owner: munition.owner,
    x,
    y,
    z,
    yield: munition.damage,
    hitId,
    surface: z <= SURFACE_DETONATION_DEPTH,
  });
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

function applyPlayerDamage(sub: Submarine, damage: number): Submarine {
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

/**
 * A blast that lands on the boat also shoves it: the bow swings away from the
 * bang (≤0.05 rad) and the shock takes up to 15% off the speed, both scaled
 * by the damage that actually landed.
 */
function applyOrdnanceHit(sub: Submarine, damage: number, fromX: number, fromY: number): Submarine {
  const hurt = applyPlayerDamage(sub, damage);
  if (hurt === sub || damage <= 0) return hurt;
  const scale = Math.min(1, damage / 45);
  const away = Math.atan2(sub.y - fromY, sub.x - fromX);
  return {
    ...hurt,
    heading: hurt.heading + clamp(normalizeAngle(away - hurt.heading), -0.05, 0.05) * scale,
    speed: hurt.speed * (1 - 0.15 * scale),
  };
}

/* ------------------------------------------------------------------ *
 * Per-munition integration
 * ------------------------------------------------------------------ */

const inCone = (heading: number, fromX: number, fromY: number, toX: number, toY: number) =>
  Math.abs(normalizeAngle(Math.atan2(toY - fromY, toX - fromX) - heading)) <= SEEKER_CONE;

/** Mk-18 keeps the fire-control track when it is audible; else loudest in cone. */
function mk18Lock(torpedo: Torpedo, ships: Ship[]): Ship | null {
  const audible = ships.filter(
    (ship) =>
      ship.sinking === undefined &&
      Math.hypot(ship.x - torpedo.x, ship.y - torpedo.y) <= MK18_SEEKER_RANGE &&
      inCone(torpedo.heading, torpedo.x, torpedo.y, ship.x, ship.y),
  );
  if (audible.length === 0) return null;
  const preferred = audible.find((ship) => ship.id === torpedo.targetId);
  if (preferred) return preferred;
  return audible.reduce((best, ship) => {
    const score = (s: Ship) =>
      shipMachineryNoise(s) / Math.max(0.1, Math.hypot(s.x - torpedo.x, s.y - torpedo.y));
    return score(ship) > score(best) ? ship : best;
  });
}

/** Enemy fish need the boat inside cone *and* hearing before the seeker lights. */
function enemyAcquires(torpedo: Torpedo, sub: Submarine): boolean {
  const distance = Math.hypot(sub.x - torpedo.x, sub.y - torpedo.y);
  return (
    distance <= ENEMY_ACQUIRE_BASE + ENEMY_ACQUIRE_NOISE * sub.noise &&
    inCone(torpedo.heading, torpedo.x, torpedo.y, sub.x, sub.y)
  );
}

/** Lead the lock by half the time of flight so a crossing target stays inside the cone. */
function leadPoint(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  targetHeading: number,
  targetSpeed: number,
  projectileSpeed: number,
): Point {
  const eta = Math.hypot(toX - fromX, toY - fromY) / Math.max(0.1, projectileSpeed);
  return {
    x: toX + Math.cos(targetHeading) * targetSpeed * eta * 0.5,
    y: toY + Math.sin(targetHeading) * targetSpeed * eta * 0.5,
  };
}

function stepTorpedo(ctx: OrdnanceCtx, torpedo: Torpedo, dt: number): Torpedo[] {
  const { state } = ctx;
  const speed = Math.min(torpedo.runSpeed, torpedo.speed + TORPEDO_ACCEL * dt);
  const step = speed * dt;
  const prevX = torpedo.x;
  const prevY = torpedo.y;
  let next: Torpedo = {
    ...torpedo,
    speed,
    x: torpedo.x + Math.cos(torpedo.heading) * step,
    y: torpedo.y + Math.sin(torpedo.heading) * step,
    life: torpedo.life - dt,
    armDelay: torpedo.armDelay - dt,
    run: torpedo.run + step,
  };

  // Enemy AI fish still target 'player', but the seeker has to hear the boat first.
  const huntingPlayer = next.owner === 'enemy' && next.targetId === 'player';
  let lockId = next.lockId;
  if (next.kind === 'mk18' && !huntingPlayer) lockId = mk18Lock(next, ctx.ships)?.id ?? null;
  else if (huntingPlayer && !lockId && enemyAcquires(next, ctx.submarine)) lockId = 'player';

  const seducer =
    huntingPlayer && seduceRoll(state.seed, next.id) < FOXER_SEDUCE_ODDS
      ? state.countermeasures.find(
          (cm) =>
            cm.kind === 'foxer' &&
            Math.hypot(cm.x - next.x, cm.y - next.y) <= FOXER_SEDUCE_RANGE,
        )
      : undefined;
  if (seducer) {
    next = {
      ...next,
      lockId,
      heading: turnToward(
        next.heading,
        Math.atan2(seducer.y - next.y, seducer.x - next.x),
        next.turnRate,
        dt,
      ),
    };
  } else if (huntingPlayer && lockId === 'player') {
    const sub = ctx.submarine;
    const aim = leadPoint(next.x, next.y, sub.x, sub.y, sub.heading, sub.speed, next.speed);
    next = {
      ...next,
      lockId,
      heading: turnToward(
        next.heading,
        Math.atan2(aim.y - next.y, aim.x - next.x),
        next.turnRate,
        dt,
      ),
      z: chaseDepth(next.z, sub.z, dt),
    };
  } else if (next.kind === 'mk18' && lockId) {
    const lock = ctx.ships.find((ship) => ship.id === lockId);
    if (lock) {
      const aim = leadPoint(next.x, next.y, lock.x, lock.y, lock.heading, lock.speed, next.speed);
      next = {
        ...next,
        lockId,
        heading: turnToward(
          next.heading,
          Math.atan2(aim.y - next.y, aim.x - next.x),
          next.turnRate,
          dt,
        ),
        z: chaseDepth(next.z, hullDepth(lock.kind), dt),
      };
    } else {
      next = { ...next, lockId: null };
    }
  } else if (next.owner === 'player' && next.targetId) {
    // A straight runner still rides its fire-control depth.
    const guide = ctx.ships.find((ship) => ship.id === next.targetId);
    next = guide ? { ...next, lockId, z: chaseDepth(next.z, hullDepth(guide.kind), dt) } : next;
  } else {
    next = { ...next, lockId };
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
    if (Math.hypot(next.x - foxer.x, next.y - foxer.y) < 0.7) {
      detonate(ctx, torpedoMunition(next), next.x, next.y, next.z, null);
      return [];
    }
  }

  // Grounding: an island eats the fish; the seabed only below the hull floor.
  if (
    ordnanceHitsLand(state, next.x, next.y) ||
    next.z >= torpedoFloor(state, next.x, next.y)
  ) {
    detonate(ctx, torpedoMunition(next), next.x, next.y, next.z, null);
    return [];
  }

  const armed = next.armDelay <= 0 || next.run >= TORPEDO_ARM_RUN;
  if (armed && next.owner === 'player') {
    const hits = ctx.ships.filter(
      (ship) =>
        !ship.sinking &&
        Math.abs(next.z - hullDepth(ship.kind)) <= 0.2 &&
        distPointSegment(ship.x, ship.y, prevX, prevY, next.x, next.y) <= shipRadius(ship),
    );
    const preferred = next.targetId
      ? hits.find((ship) => ship.id === next.targetId)
      : undefined;
    const victim = preferred ?? hits[0];
    if (victim) {
      const outcome = applyTorpedoHit(victim, next.x, next.y, next.damage);
      const applied = Math.min(outcome.applied, Math.max(0, victim.hp));
      // Consorts see the hit and scatter.
      Object.assign(victim, outcome.ship, {
        lastHitX: next.x,
        lastHitY: next.y,
        lastHitTime: state.time,
      });
      ctx.damageDealt += applied;
      raiseHitAlarm(ctx.ships, victim);
      ctx.messages.push({
        id: `hit-${next.id}-${state.tick}`,
        text: `HIT ${outcome.location.toUpperCase()} · ${victim.name}${outcome.lethal ? ' · BREAKING UP' : ''}`,
        ttl: 2.8,
      });
      if (outcome.lethal) {
        ctx.messages.push({
          id: `mortal-${next.id}-${state.tick}`,
          text: `MORTALLY HIT · ${victim.name}`,
          ttl: 4,
        });
      }
      detonate(ctx, torpedoMunition(next), victim.x, victim.y, next.z, victim.id);
      return [];
    }
  }
  const sub = ctx.submarine;
  if (
    armed &&
    next.owner === 'enemy' &&
    Math.hypot(next.x - sub.x, next.y - sub.y) <= 0.95 &&
    Math.abs(next.z - sub.z) < 0.4 &&
    !inFob(state)
  ) {
    ctx.submarine = applyOrdnanceHit(sub, next.damage, next.x, next.y);
    detonate(ctx, torpedoMunition(next), next.x, next.y, next.z, 'player');
    return [];
  }
  return next.life > 0 ? [next] : [];
}

function stepCharge(ctx: OrdnanceCtx, charge: DepthCharge, dt: number): DepthCharge[] {
  const { state } = ctx;
  const drag = Math.max(0, 1 - CHARGE_WATER_DRAG * dt);
  const next: DepthCharge = {
    ...charge,
    x: charge.x + charge.vx * dt,
    y: charge.y + charge.vy * dt,
    vx: charge.vx * drag,
    vy: charge.vy * drag,
    z: clampDepth(charge.z + charge.vz * dt),
    fuse: charge.fuse - dt,
  };
  const sub = ctx.submarine;
  const horizontal = Math.hypot(next.x - sub.x, next.y - sub.y);
  const bubbleScreen = state.countermeasures.some(
    (cm) => cm.kind === 'bubble' && Math.hypot(cm.x - sub.x, cm.y - sub.y) <= cm.radius,
  );
  if (next.kind === 'hedgehog') {
    // Contact fuse only — a near miss just keeps sinking.
    if (
      horizontal <= HEDGEHOG_CONTACT_RADIUS &&
      Math.abs(next.z - sub.z) <= HEDGEHOG_CONTACT_DEPTH
    ) {
      const hurts = !inFob(state) && sub.invuln <= 0;
      if (hurts) ctx.submarine = applyOrdnanceHit(sub, next.damage, next.x, next.y);
      detonate(ctx, chargeMunition(next), next.x, next.y, next.z, hurts ? 'player' : null);
      return [];
    }
    // Silent to the seabed; only a safety fuse or the floor removes it.
    if (next.fuse <= 0 || next.z >= waterDepthAt(state, next.x, next.y)) return [];
    return [next];
  }
  const atPistol = next.z >= next.targetDepth;
  const onBottom =
    next.z >= waterDepthAt(state, next.x, next.y) || ordnanceHitsLand(state, next.x, next.y);
  if (atPistol || onBottom || next.fuse <= 0) {
    const blast = blastDamage({
      damage: next.damage,
      horizontal,
      radius: next.radius,
      // The charge went off where it actually is — not where it was aimed.
      depthDelta: Math.abs(next.z - sub.z),
      vertical: BLAST_VERTICAL[next.kind],
    });
    const hurts = !inFob(state) && blast > 0;
    if (hurts) {
      ctx.submarine = applyOrdnanceHit(sub, blast * (bubbleScreen ? 0.75 : 1), next.x, next.y);
    }
    detonate(ctx, chargeMunition(next), next.x, next.y, next.z, hurts ? 'player' : null);
    return [];
  }
  return [next];
}

function stepShell(ctx: OrdnanceCtx, shell: Shell, dt: number): Shell[] {
  const { state } = ctx;
  const next: Shell = {
    ...shell,
    x: shell.x + shell.vx * dt,
    y: shell.y + shell.vy * dt,
    alt: shell.alt + shell.valt * dt,
    valt: shell.valt - SHELL_GRAVITY * dt,
  };
  if (next.alt > 0) return [next];
  // Splash: the round lands in the water column at the aim point. Friendly fire
  // is real only in the direction the gun was pointed — enemy shells hurt the
  // boat, player shells hurt ships, never both.
  let hitId: string | null = null;
  if (next.owner === 'enemy') {
    const sub = ctx.submarine;
    const subDistance = Math.hypot(next.x - sub.x, next.y - sub.y);
    const depthFactor =
      sub.z < SHELL_SURFACED_DEPTH ? 1 : sub.z < SHELL_SHALLOW_DEPTH ? SHELL_SHALLOW_FACTOR : 0;
    if (!inFob(state) && subDistance < next.radius && depthFactor > 0) {
      const blast = next.damage * (1 - subDistance / next.radius) * depthFactor;
      if (blast > 0) {
        ctx.submarine = applyOrdnanceHit(sub, blast, next.x, next.y);
        hitId = 'player';
      }
    }
  } else {
    let best: { ship: Ship; damage: number } | null = null;
    for (const ship of ctx.ships) {
      if (ship.sinking !== undefined) continue;
      const distance = Math.hypot(ship.x - next.x, ship.y - next.y);
      if (distance >= next.radius) continue;
      const damage = next.damage * (1 - distance / next.radius);
      if (!best || damage > best.damage) best = { ship, damage };
    }
    if (best) {
      const roll = seduceRoll(state.seed, `shellfire-${next.id}`);
      const outcome = applyShellHit(best.ship, best.damage, roll);
      Object.assign(best.ship, outcome.ship, {
        lastHitX: next.x,
        lastHitY: next.y,
        lastHitTime: state.time,
      });
      ctx.damageDealt += outcome.applied;
      if (outcome.lethal) {
        ctx.messages.push({
          id: `mortal-${next.id}-${state.tick}`,
          text: `MORTALLY HIT · ${best.ship.name}`,
          ttl: 4,
        });
      }
      hitId = best.ship.id;
    }
  }
  detonate(ctx, { ...next, kind: 'shell' }, next.x, next.y, 0, hitId);
  return [];
}

/** One fixed step of every munition in the water. */
export function advanceOrdnance(state: GameState, dt: number): GameState {
  const ctx: OrdnanceCtx = {
    state,
    ships: state.ships.map((ship) => ({ ...ship })),
    submarine: { ...state.submarine },
    detonations: [...state.detonations],
    messages: [...state.messages],
    damageDealt: 0,
  };
  const torpedoes = state.torpedoes.flatMap((torpedo) => stepTorpedo(ctx, torpedo, dt));
  const depthCharges = state.depthCharges.flatMap((charge) => stepCharge(ctx, charge, dt));
  const shells = state.shells.flatMap((shell) => stepShell(ctx, shell, dt));
  return {
    ...state,
    ships: ctx.ships,
    torpedoes,
    depthCharges,
    shells,
    detonations: ctx.detonations,
    submarine: ctx.submarine,
    messages: ctx.messages,
    stats:
      ctx.damageDealt > 0
        ? { ...state.stats, damageDealt: state.stats.damageDealt + ctx.damageDealt }
        : state.stats,
  };
}
