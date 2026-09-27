import type { CombatEvent } from '../../game/adapt/combat-events';
import type { FxBurst, FxPreset } from './combat-fx';
import { entityDepthY, simToWorldMeters, SURFACE_SPLASH_Y } from './coordinates';

/** Runners above this world Y leave a surface wake; deeper ones leave bubbles. */
export const SHALLOW_TRAIL_Y = -1.5;

/** Minimum sim-time gap between trail samples so the pool is not flooded every frame. */
export const TRAIL_INTERVAL_S = 0.1;

/** How long a preallocated hit light stays lit. Decay is presentation-only. */
export const HIT_LIGHT_PULSE_S = 0.45;

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
): Placed {
  const world = simToWorldMeters(simX, simY);
  return {
    preset,
    x: world.x,
    y: entityDepthY(simZ),
    z: world.z,
    intensity,
  };
}

function placeEvent(event: CombatEvent): Placed | null {
  switch (event.type) {
    case 'torpedoLaunch':
      return place(event.x, event.y, event.z, 'launch', 0.8);
    case 'torpedoHit':
      return place(event.x, event.y, event.z, 'torpedoHit', 1);
    case 'torpedoExpired':
      return null;
    case 'shipSunk':
      return place(
        event.x,
        event.y,
        event.kind === 'sub' ? 0.32 : 0.02,
        event.kind === 'sub' ? 'subBurst' : 'sink',
        1.2,
      );
    case 'chargeBlast':
      return place(event.x, event.y, event.z, 'chargeBlast', event.near ? 1.15 : 0.7);
    case 'playerHit':
      return place(event.x, event.y, 0, 'playerHit', 1);
    case 'countermeasure':
    case 'sonarPing':
    case 'pickup':
    case 'waveStart':
    case 'victory':
    case 'gameover':
      return null;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** Map one sim-unit combat event onto a world-metre burst. Events without a preset map to none. */
export function combatEventBursts(event: CombatEvent): FxBurst[] {
  const placed = placeEvent(event);
  if (!placed) return [];
  if (event.type !== 'shipSunk') return [placed];
  const boil = place(event.x, event.y, 0.02, 'surfaceBreak', event.kind === 'sub' ? 1.15 : 0.9);
  return [placed, boil];
}

const HIT_PEAK: Partial<Record<FxPreset, number>> = {
  torpedoHit: 6,
  sink: 8,
  subBurst: 7,
  surfaceBreak: 5,
  chargeBlast: 5,
  playerHit: 4,
};

/** World position for a preallocated hit light. Launches and cues without a blast return null. */
export function combatEventHitLight(event: CombatEvent): HitLightPulse | null {
  const placed = placeEvent(event);
  if (!placed) return null;
  const intensity = HIT_PEAK[placed.preset];
  if (intensity === undefined) return null;
  return { x: placed.x, y: placed.y, z: placed.z, intensity };
}
