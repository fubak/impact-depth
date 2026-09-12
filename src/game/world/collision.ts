import { MAX_DEPTH, SEAMOUNT_CRUSH_DPS } from '../sim/constants';
import { clampDepth, clampSim, depthToMeters, metersToDepth } from '../sim/coords';
import type { GameState, Submarine } from '../sim/types';
import {
  KEEL_CLEARANCE_M,
  PLAYER_RADIUS_SIM,
  isNavigable,
  playerNavProfile,
  sampleLittoralBedSim,
} from './littoral';
import { getWorld } from './queries';

const GROUNDING_INTRUSION_M = 0.05;
const SWEEP_STEP_SIM = 0.12;

function highestBedUnderFootprint(
  world: ReturnType<typeof getWorld>,
  x: number,
  y: number,
): number {
  let highest = sampleLittoralBedSim(world, x, y);
  const steps = 8;
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * Math.PI * 2;
    const px = x + Math.cos(angle) * PLAYER_RADIUS_SIM;
    const py = y + Math.sin(angle) * PLAYER_RADIUS_SIM;
    const bed = sampleLittoralBedSim(world, px, py);
    if (bed > highest) highest = bed;
  }
  return highest;
}

function sweepClear(
  world: ReturnType<typeof getWorld>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  profile: ReturnType<typeof playerNavProfile>,
): boolean {
  const distance = Math.hypot(x1 - x0, y1 - y0);
  const samples = Math.max(1, Math.ceil(distance / SWEEP_STEP_SIM));
  for (let index = 1; index <= samples; index++) {
    const t = index / samples;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (!isNavigable(world, x, y, profile)) return false;
  }
  return true;
}

export function integrateV2Horizontal(
  world: ReturnType<typeof getWorld>,
  sub: Submarine,
  nx: number,
  ny: number,
): { x: number; y: number; speed: number } {
  const x = clampSim(nx);
  const y = clampSim(ny);
  const profile = playerNavProfile(sub.z);
  if (sweepClear(world, sub.x, sub.y, x, y, profile)) return { x, y, speed: sub.speed };
  return { x: sub.x, y: sub.y, speed: sub.speed * 0.55 };
}

function inFob(state: GameState, x: number, y: number): boolean {
  return Math.hypot(x - state.base.x, y - state.base.y) <= state.base.radius;
}

export function resolveV2WorldCollision(state: GameState, dt: number): GameState {
  const world = getWorld('littoral-v2', state.terrainSeed);
  const sub = state.submarine;
  const x = clampSim(sub.x);
  const y = clampSim(sub.y);
  const profile = playerNavProfile(sub.z);
  let px = x;
  let py = y;
  if (!isNavigable(world, x, y, profile)) {
    px = clampSim(sub.x);
    py = clampSim(sub.y);
  }
  const highestBed = highestBedUnderFootprint(world, px, py);
  const water = Math.max(0, -highestBed);
  const safeDepthM = Math.max(0, water - KEEL_CLEARANCE_M);
  const safeZ = clampDepth(Math.min(MAX_DEPTH, metersToDepth(safeDepthM)));
  const attemptedZ = sub.z;
  const keelM = depthToMeters(attemptedZ) + KEEL_CLEARANCE_M;
  const intrusion = keelM - water;
  const inward = sub.targetDepth > safeZ + 1e-4;
  const exempt = sub.invuln > 0 || inFob(state, px, py);
  const crush =
    dt > 0 && intrusion > GROUNDING_INTRUSION_M && inward && !exempt ? SEAMOUNT_CRUSH_DPS * dt : 0;
  const z = attemptedZ > safeZ ? safeZ : attemptedZ;
  const hp = Math.max(0, Math.min(sub.maxHp, sub.hp - crush));
  return { ...state, submarine: { ...sub, x: px, y: py, z, hp } };
}
