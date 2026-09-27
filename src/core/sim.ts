import { sampleAttitude, scaledWaves } from './waves';
import type {
  EngineOrder,
  LookDevSettings,
  SimState,
  SurfaceShipState,
  VesselState,
  ViewMode,
} from './types';

export const FIXED_DT = 1 / 60;
/** Cap wall-clock elapsed per frame so hitch recovery stays real-time, not slow-mo. */
export const MAX_FRAME_DT = 0.25;
/** Bound fixed-step catch-up (~200ms at 60 Hz) to avoid death spirals. */
export const MAX_CATCH_UP_STEPS = 12;
/** Distance from player beyond which convoy contacts recycle ahead. */
export const LAB_RADIUS = 220;
/** Base recycle distance ahead of the player along ship heading. */
export const RECYCLE_AHEAD = 155;

/** Deterministic formation offsets (along-track, lateral) when recycling. */
const FORMATION_OFFSET: Record<string, { along: number; lateral: number }> = {
  'dd-42': { along: 0, lateral: -14 },
  'ss-11': { along: 24, lateral: 10 },
  'ss-12': { along: 48, lateral: -6 },
};

/**
 * Fold elapsed time into the fixed-step accumulator.
 * Caps elapsed, runs at most MAX_CATCH_UP_STEPS, and drops excess whole steps.
 */
export function advanceAccumulator(
  accum: number,
  elapsed: number,
): { steps: number; accum: number; elapsedUsed: number } {
  const elapsedUsed = Math.min(Math.max(0, elapsed), MAX_FRAME_DT);
  let next = accum + elapsedUsed;
  let steps = 0;
  while (next >= FIXED_DT && steps < MAX_CATCH_UP_STEPS) {
    next -= FIXED_DT;
    steps += 1;
  }
  // Discard backlog beyond the catch-up budget; keep sub-step remainder.
  if (next >= FIXED_DT) {
    next %= FIXED_DT;
  }
  return { steps, accum: next, elapsedUsed };
}

const ENGINE_SPEEDS: Record<EngineOrder, number> = {
  stop: 0,
  slow: 2.2,
  half: 4.5,
  full: 7.2,
  flank: 9.5,
};

const DEPTH_SPEED_FACTOR = (depth: number): number => {
  if (depth < 2) return 1.05;
  if (depth < 18) return 0.92;
  return 0.72;
};

export function createInitialSim(): SimState {
  return {
    paused: false,
    time: 0,
    viewMode: 'chase',
    mission: 'SHADOW CONVOY · REMAIN UNDETECTED',
    vessel: {
      // Clearly submerged under transparent Caribbean water, above sandy floor
      x: 0,
      z: 18,
      depth: 8.5,
      heading: 0.08,
      speed: 3.4,
      targetSpeed: 4.5,
      engineOrder: 'half',
      battery: 92,
      noise: 0.22,
      heave: 0,
      pitch: 0,
      roll: 0,
    },
    ships: [
      {
        id: 'dd-42',
        kind: 'destroyer',
        name: 'DD ESCORT',
        // Screen ahead-port of merchants — faster than default player half (4.5)
        x: 48,
        z: 6,
        depth: 0,
        heading: 0.05,
        speed: 6.0,
        heave: 0,
        pitch: 0,
        roll: 0,
        sinkProgress: 0,
        listSide: 1,
        fire: 0,
        flooding: 0,
      },
      {
        id: 'ss-11',
        kind: 'merchant',
        name: 'MERCHANT A',
        x: 68,
        z: 20,
        depth: 0,
        heading: 0.02,
        speed: 5.1,
        heave: 0,
        pitch: 0,
        roll: 0,
        sinkProgress: 0,
        listSide: 1,
        fire: 0,
        flooding: 0,
      },
      {
        id: 'ss-12',
        kind: 'merchant',
        name: 'MERCHANT B',
        x: 88,
        z: 8,
        depth: 0,
        heading: -0.03,
        speed: 5.0,
        heave: 0,
        pitch: 0,
        roll: 0,
        sinkProgress: 0,
        listSide: 1,
        fire: 0,
        flooding: 0,
      },
    ],
  };
}

export interface ControlIntent {
  surge: number;
  yaw: number;
  depth: number;
}

export function createControlIntent(): ControlIntent {
  return { surge: 0, yaw: 0, depth: 0 };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function engineFromSpeed(speed: number): EngineOrder {
  if (speed < 0.4) return 'stop';
  if (speed < 3) return 'slow';
  if (speed < 5.5) return 'half';
  if (speed < 8) return 'full';
  return 'flank';
}

function updateVessel(
  vessel: VesselState,
  intent: ControlIntent,
  dt: number,
  settings: LookDevSettings,
  time: number,
): VesselState {
  const next = { ...vessel };

  next.heading = normalizeAngle(next.heading + intent.yaw * 0.85 * dt);
  next.targetSpeed = clamp(next.targetSpeed + intent.surge * 6 * dt, 0, 9.5);
  next.depth = clamp(next.depth + intent.depth * 8 * dt, 0, 55);

  const depthFactor = DEPTH_SPEED_FACTOR(next.depth);
  const maxAllowed = ENGINE_SPEEDS.flank * depthFactor;
  const desired = Math.min(next.targetSpeed, maxAllowed);
  next.speed += (desired - next.speed) * Math.min(1, 1.8 * dt);
  if (Math.abs(next.speed) < 0.02) next.speed = 0;

  next.engineOrder = engineFromSpeed(next.speed);

  const forwardX = Math.cos(next.heading);
  const forwardZ = Math.sin(next.heading);
  next.x += forwardX * next.speed * dt;
  next.z += forwardZ * next.speed * dt;

  // Battery & noise (presentation sim)
  const submerged = next.depth > 1.5;
  if (submerged) {
    const drain = (0.8 + next.speed * next.speed * 0.035) * (1 + settings.ocean.seaState * 0.15);
    next.battery = clamp(next.battery - drain * dt, 0, 100);
  } else {
    next.battery = clamp(next.battery + 9 * dt, 0, 100);
  }

  const speedNoise = (next.speed / 9.5) * 0.55;
  const depthQuiet = next.depth > 12 ? 0.7 : 1;
  next.noise = clamp(0.08 + speedNoise * depthQuiet, 0.05, 1);

  const waves = scaledWaves(
    settings.ocean.waveHeight,
    settings.ocean.choppiness,
    settings.ocean.seaState,
  );
  const surfaceBlend = clamp(1 - next.depth / 8, 0, 1);
  const attitude = sampleAttitude(next.x, next.z, time, waves, next.heading, 6);
  next.heave = attitude.heave * surfaceBlend * 0.35;
  next.pitch = attitude.pitch * surfaceBlend * 0.55;
  next.roll = attitude.roll * surfaceBlend * 0.45;

  return next;
}

function updateShip(
  ship: SurfaceShipState,
  dt: number,
  time: number,
  settings: LookDevSettings,
  player: VesselState,
): SurfaceShipState {
  let next = { ...ship };
  const forwardX = Math.cos(next.heading);
  const forwardZ = Math.sin(next.heading);
  next.x += forwardX * next.speed * dt;
  next.z += forwardZ * next.speed * dt;

  // Soft convoy lane drift
  next.heading = normalizeAngle(next.heading + Math.sin(time * 0.05 + next.x * 0.01) * 0.02 * dt);

  next = recycleShipIfFar(next, player);

  const waves = scaledWaves(
    settings.ocean.waveHeight,
    settings.ocean.choppiness,
    settings.ocean.seaState,
  );
  const span = ship.kind === 'destroyer' ? 8 : 10;
  const attitude = sampleAttitude(next.x, next.z, time, waves, next.heading, span);
  next.heave = attitude.heave;
  next.pitch = attitude.pitch * 0.85;
  next.roll = attitude.roll * 0.7;
  return next;
}

/** Place a contact ahead of the player in formation when it leaves the lab radius. */
export function recycleShipIfFar(
  ship: SurfaceShipState,
  player: Pick<VesselState, 'x' | 'z'>,
): SurfaceShipState {
  const dist = Math.hypot(ship.x - player.x, ship.z - player.z);
  if (dist <= LAB_RADIUS) return ship;

  const form = FORMATION_OFFSET[ship.id] ?? { along: 30, lateral: 0 };
  const fx = Math.cos(ship.heading);
  const fz = Math.sin(ship.heading);
  const lx = -fz;
  const lz = fx;
  const along = RECYCLE_AHEAD + form.along;
  return {
    ...ship,
    x: player.x + fx * along + lx * form.lateral,
    z: player.z + fz * along + lz * form.lateral,
  };
}

export function stepSim(
  state: SimState,
  intent: ControlIntent,
  settings: LookDevSettings,
  dt: number,
): SimState {
  if (state.paused) return state;

  const time = state.time + dt;
  const vessel = updateVessel(state.vessel, intent, dt, settings, time);
  return {
    ...state,
    time,
    vessel,
    ships: state.ships.map((s) => updateShip(s, dt, time, settings, vessel)),
  };
}

export function setViewMode(state: SimState, mode: ViewMode): SimState {
  return { ...state, viewMode: mode };
}

export function togglePause(state: SimState): SimState {
  return { ...state, paused: !state.paused };
}

export function headingDegrees(heading: number): number {
  const deg = ((-heading * 180) / Math.PI + 90 + 360) % 360;
  return Math.round(deg);
}

export function formatDepth(meters: number): string {
  return `${meters.toFixed(1)} m`;
}

export function formatSpeed(knotsApprox: number): string {
  // Treat world units/s ≈ knots for demo readability
  return `${knotsApprox.toFixed(1)} kn`;
}

export function engineOrderLabel(order: EngineOrder): string {
  switch (order) {
    case 'stop':
      return 'ALL STOP';
    case 'slow':
      return 'SLOW AHEAD';
    case 'half':
      return 'HALF AHEAD';
    case 'full':
      return 'FULL AHEAD';
    case 'flank':
      return 'FLANK';
  }
}
