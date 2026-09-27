import type { CombatEvent } from '../../game/adapt/combat-events';
import type { FxBurst, FxPreset } from './combat-fx';
import { entityDepthY, simToWorldMeters, SURFACE_SPLASH_Y } from './coordinates';

/** Runners above this world Y leave a surface wake; deeper ones leave bubbles. */
export const SHALLOW_TRAIL_Y = -1.5;

/** Minimum sim-time gap between trail samples so the pool is not flooded every frame. */
export const TRAIL_INTERVAL_S = 0.1;

/** How long a preallocated hit light stays lit. Decay is presentation-only. */
export const HIT_LIGHT_PULSE_S = 0.45;

/** Detonations shallower than this (world metres) punch a plume above the dome. */
export const PLUME_DEPTH_M = 40;
/** Plume height at the shallowest useful depth. */
export const PLUME_HEIGHT_M = 35;

const SURFACE_WAKE_MARKS = 3;
const BUBBLE_TRAIL_MARKS = 4;
const TRAIL_SPACING_M = 1.35;

export type TrailMark = {
  kind: 'wake' | 'bubbles';
  x: number;
  y: number;
  z: number;
  key: string;
};

export type HitLightPulse = {
  x: number;
  y: number;
  z: number;
  intensity: number;
  /** Underwater blasts flash cyan-white over a shorter range. */
  underwater: boolean;
};

/**
 * Pooled-mesh cues that sit beside the particle bursts: gas bubbles, surface
 * domes, plume columns, foam shock rings and oil slicks.
 */
export type MeshFxCue =
  | { type: 'gasBubbles'; x: number; y: number; z: number; yieldPower: number }
  | { type: 'dome'; x: number; z: number; radius: number }
  | { type: 'plume'; x: number; z: number; height: number; radius: number }
  | { type: 'ring'; x: number; z: number; radius: number }
  | { type: 'slick'; x: number; z: number }
  | { type: 'surfaceFoam'; x: number; z: number; strength: number };

export type CombatFxContext = {
  /** Seabed Y (world metres) under the event — gates the silt cloud. */
  bedY?: number;
};

type Placed = FxBurst;

/** Samples behind a torpedo: a surface wake line when shallow, a denser bubble trail when deep. */
export function torpedoTrailMarks(spec: {
  id: string;
  x: number;
  y: number;
  z: number;
  heading: number;
}): TrailMark[] {
  const shallow = spec.y > SHALLOW_TRAIL_Y;
  const count = shallow ? SURFACE_WAKE_MARKS : BUBBLE_TRAIL_MARKS;
  const kind: TrailMark['kind'] = shallow ? 'wake' : 'bubbles';
  const y = shallow ? Math.max(SURFACE_SPLASH_Y, spec.y) : spec.y;
  const marks: TrailMark[] = [];
  for (let i = 1; i <= count; i += 1) {
    const dist = i * TRAIL_SPACING_M;
    marks.push({
      kind,
      x: spec.x - Math.cos(spec.heading) * dist,
      y,
      z: spec.z - Math.sin(spec.heading) * dist,
      key: `torpedo:${spec.id}:${i}`,
    });
  }
  return marks;
}

function place(
  simX: number,
  simY: number,
  simZ: number,
  preset: FxPreset,
  intensity: number,
  bedY?: number,
): Placed {
  const world = simToWorldMeters(simX, simY);
  return {
    preset,
    x: world.x,
    y: entityDepthY(simZ),
    z: world.z,
    intensity,
    bedY,
  };
}

/** The surface torpedo blast is the showcase explosion; everything else is scaled down. */
function detonationPreset(
  event: Extract<CombatEvent, { type: 'detonation' }>,
): {
  preset: FxPreset;
  intensity: number;
} {
  const yieldScale = Math.min(1.5, Math.max(0.5, event.yield / 50));
  switch (event.kind) {
    case 'torpedo':
      return event.surface
        ? { preset: 'torpedoHit', intensity: yieldScale }
        : { preset: 'chargeBlast', intensity: yieldScale };
    case 'depthCharge':
    case 'bomb':
      return {
        preset: 'chargeBlast',
        intensity: (event.hitId === 'player' ? 1.15 : 0.7) * yieldScale,
      };
    case 'hedgehog':
      return { preset: 'chargeBlast', intensity: 0.75 * yieldScale };
    case 'shell':
      return { preset: 'shellSplash', intensity: 0.8 * yieldScale };
    default:
      return { preset: 'chargeBlast', intensity: 0.8 * yieldScale };
  }
}

function placeEvent(event: CombatEvent, bedY?: number): Placed[] {
  switch (event.type) {
    case 'torpedoLaunch': {
      const bursts = [place(event.x, event.y, event.z, 'launch', 0.8, bedY)];
      // A shallow launch boils the surface; a deep one only bubbles.
      if (entityDepthY(event.z) > -4) {
        bursts.push(place(event.x, event.y, 0, 'shellSplash', 0.5, bedY));
      }
      return bursts;
    }
    case 'shellLaunch': {
      // Muzzle flash + powder smoke at deck height on the firing hull.
      const world = simToWorldMeters(event.x, event.y);
      return [
        {
          preset: 'gunMuzzle',
          x: world.x,
          y: SURFACE_SPLASH_Y + 3,
          z: world.z,
          intensity: 1,
          bedY,
        },
      ];
    }
    case 'torpedoHit':
      // Audio/camera cue only — the detonation event owns the visual burst.
      return [];
    case 'torpedoExpired':
      return [];
    case 'shipSunk': {
      const bursts: Placed[] = [
        place(
          event.x,
          event.y,
          event.kind === 'sub' ? 0.32 : 0.02,
          event.kind === 'sub' ? 'subSink' : 'sink',
          1.2,
          bedY,
        ),
        place(event.x, event.y, 0.02, 'surfaceBreak', event.kind === 'sub' ? 1.15 : 0.9, bedY),
      ];
      return bursts;
    }
    case 'chargeBlast':
      return [];
    case 'detonation': {
      const { preset, intensity } = detonationPreset(event);
      return [place(event.x, event.y, event.z, preset, intensity, bedY)];
    }
    case 'playerHit':
      return [place(event.x, event.y, 0, 'playerHit', 1, bedY)];
    case 'countermeasure':
    case 'sonarPing':
    case 'pickup':
    case 'waveStart':
    case 'victory':
    case 'gameover':
      return [];
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** Map one sim-unit combat event onto world-metre bursts. Events without a preset map to none. */
export function combatEventBursts(event: CombatEvent, ctx?: CombatFxContext): FxBurst[] {
  return placeEvent(event, ctx?.bedY);
}

/**
 * The dome above an underwater detonation, plus a plume when it is shallow
 * enough to punch through. Deep blasts (≥PLUME_DEPTH_M) get the dome only.
 */
export function underwaterSurfaceCues(
  event: Extract<CombatEvent, { type: 'detonation' }>,
): MeshFxCue[] {
  const world = simToWorldMeters(event.x, event.y);
  const depthM = -entityDepthY(event.z);
  const cues: MeshFxCue[] = [
    { type: 'dome', x: world.x, z: world.z, radius: 6 + event.yield * 0.12 },
    { type: 'surfaceFoam', x: world.x, z: world.z, strength: 1.2 + event.yield * 0.012 },
  ];
  const plumeHeight = PLUME_HEIGHT_M * Math.max(0, 1 - depthM / PLUME_DEPTH_M);
  if (plumeHeight > 1) {
    cues.push({ type: 'plume', x: world.x, z: world.z, height: plumeHeight, radius: 3.2 });
  }
  return cues;
}

/** Pooled mesh effects per event — bubbles under water, rings and slicks on it. */
export function combatEventMeshFx(event: CombatEvent): MeshFxCue[] {
  switch (event.type) {
    case 'detonation': {
      const world = simToWorldMeters(event.x, event.y);
      const cues: MeshFxCue[] = [];
      if (event.surface) {
        cues.push({ type: 'ring', x: world.x, z: world.z, radius: 18 + event.yield * 0.3 });
        cues.push({ type: 'surfaceFoam', x: world.x, z: world.z, strength: 1.4 });
      } else {
        cues.push({
          type: 'gasBubbles',
          x: world.x,
          y: entityDepthY(event.z),
          z: world.z,
          yieldPower: event.yield,
        });
        cues.push(...underwaterSurfaceCues(event));
      }
      return cues;
    }
    case 'shipSunk': {
      const world = simToWorldMeters(event.x, event.y);
      return [
        { type: 'slick', x: world.x, z: world.z },
        { type: 'ring', x: world.x, z: world.z, radius: 14 },
        { type: 'surfaceFoam', x: world.x, z: world.z, strength: 1.3 },
      ];
    }
    case 'torpedoLaunch': {
      if (entityDepthY(event.z) <= -4) return [];
      const world = simToWorldMeters(event.x, event.y);
      return [{ type: 'surfaceFoam', x: world.x, z: world.z, strength: 0.7 }];
    }
    default:
      return [];
  }
}

const HIT_PEAK: Partial<Record<FxPreset, number>> = {
  torpedoHit: 7,
  sink: 8,
  subBurst: 7,
  subSink: 8,
  surfaceBreak: 5,
  chargeBlast: 5,
  shellSplash: 3.5,
  gunMuzzle: 3,
  playerHit: 4,
};

/** World position for a preallocated hit light. Launches and cues without a blast return null. */
export function combatEventHitLight(event: CombatEvent): HitLightPulse | null {
  const placed = placeEvent(event);
  if (placed.length === 0) return null;
  const intensity = HIT_PEAK[placed[0]!.preset];
  if (intensity === undefined) return null;
  const underwater =
    event.type === 'detonation' ? !event.surface : placed[0]!.y < -1;
  return { x: placed[0]!.x, y: placed[0]!.y, z: placed[0]!.z, intensity, underwater };
}
