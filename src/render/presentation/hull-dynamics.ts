/**
 * Second-order hull motion (Plan 021). Presentation-only.
 *
 * The attitude smoother gives a *target* pose from the sea surface (GPU probes or
 * CPU Gerstner). Real hulls do not snap to that pose: they have mass and a
 * natural period in heave, pitch and roll, so they lag, overshoot and keep
 * rolling after a wave passes. Each axis here is a damped spring driven toward
 * the sea target, plus the way a hull moves *through* water:
 *
 *  - running trim: the bow lifts a little and the hull squats as speed builds;
 *  - turn heel: a displacement hull heels outward in a turn (yaw rate × speed);
 *  - acceleration pitch: surging forward pitches the bow up, braking dips it.
 *
 * Nothing here is read by GameState, AI, collision, sonar, replay or RNG.
 */

import type { AttitudeSample } from './vessel-attitude';

export interface HullDynamicsInput {
  readonly entityId: string;
  readonly dt: number;
  /** Sea-surface target (already submergence-attenuated). */
  readonly target: AttitudeSample;
  /** Presentation metres per second. */
  readonly speed: number;
  readonly heading: number;
  /** Half-length in metres (attitudeSpanForKind). */
  readonly span: number;
  /** Metres positive-down. Running effects fade out below the surface. */
  readonly depth: number;
}

export interface HullAxisTuning {
  /** Natural period in seconds. */
  period: number;
  /** Damping ratio (1 = critical). */
  damping: number;
}

export interface HullTuning {
  heave: HullAxisTuning;
  pitch: HullAxisTuning;
  roll: HullAxisTuning;
}

interface AxisState {
  x: number;
  v: number;
}

interface HullState {
  heave: AxisState;
  pitch: AxisState;
  roll: AxisState;
  heading: number;
  speed: number;
  yawRate: number;
  accel: number;
}

/** Bigger hulls move slower; roll is the longest, least-damped mode. */
export function hullTuningForSpan(span: number): HullTuning {
  const s = Math.max(2, Math.min(18, span));
  return {
    heave: { period: 1.6 + s * 0.09, damping: 0.42 },
    pitch: { period: 1.8 + s * 0.11, damping: 0.36 },
    roll: { period: 3.2 + s * 0.22, damping: 0.14 },
  };
}

const MAX_STEP = 1 / 120;
const LIMITS = { heave: 2.5, pitch: 0.42, roll: 0.5 } as const;

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function stepAxis(axis: AxisState, target: number, tuning: HullAxisTuning, dt: number, limit: number): void {
  const omega = (Math.PI * 2) / Math.max(0.2, tuning.period);
  // Semi-implicit Euler is stable for these stiffnesses at <= 1/120 s steps.
  const accel = omega * omega * (target - axis.x) - 2 * tuning.damping * omega * axis.v;
  axis.v += accel * dt;
  axis.x += axis.v * dt;
  if (Math.abs(axis.x) > limit) {
    axis.x = Math.sign(axis.x) * limit;
    axis.v *= -0.2;
  }
}

/** Running trim/heel offsets added to the sea target (pure, for tests). */
export function runningAttitude(
  speed: number,
  yawRate: number,
  accel: number,
  depth: number,
): AttitudeSample {
  const surface = Math.max(0, Math.min(1, 1 - Math.max(0, depth) / 3));
  const v = Math.max(0, finite(speed));
  return {
    // Dynamic sinkage (squat) grows with speed².
    heave: -Math.min(0.35, v * v * 0.004) * surface,
    // Bow rises with speed, more while accelerating.
    pitch: (Math.min(0.045, v * 0.0045) + Math.max(-0.04, Math.min(0.04, accel * 0.02))) * surface,
    // Outward heel in a turn (starboard-down positive, matching the footprint convention).
    roll: Math.max(-0.14, Math.min(0.14, finite(yawRate) * v * 0.06)) * surface,
  };
}

export class HullDynamics {
  private readonly states = new Map<string, HullState>();

  reset(): void {
    this.states.clear();
  }

  retain(living: ReadonlySet<string>): void {
    for (const id of this.states.keys()) if (!living.has(id)) this.states.delete(id);
  }

  update(input: HullDynamicsInput): AttitudeSample {
    const dt = Math.max(0, Math.min(0.25, finite(input.dt)));
    const target = {
      heave: finite(input.target.heave),
      pitch: finite(input.target.pitch),
      roll: finite(input.target.roll),
    };
    let state = this.states.get(input.entityId);
    if (!state) {
      state = {
        heave: { x: target.heave, v: 0 },
        pitch: { x: target.pitch, v: 0 },
        roll: { x: target.roll, v: 0 },
        heading: finite(input.heading),
        speed: finite(input.speed),
        yawRate: 0,
        accel: 0,
      };
      this.states.set(input.entityId, state);
      return { heave: state.heave.x, pitch: state.pitch.x, roll: state.roll.x };
    }
    if (dt <= 0) return { heave: state.heave.x, pitch: state.pitch.x, roll: state.roll.x };

    // Smoothed yaw rate / surge acceleration from the presentation snapshot.
    const k = 1 - Math.exp(-dt * 3);
    const yawRate = wrapAngle(finite(input.heading) - state.heading) / dt;
    const accel = (finite(input.speed) - state.speed) / dt;
    state.yawRate += (Math.max(-1.5, Math.min(1.5, yawRate)) - state.yawRate) * k;
    state.accel += (Math.max(-3, Math.min(3, accel)) - state.accel) * k;
    state.heading = finite(input.heading);
    state.speed = finite(input.speed);

    const running = runningAttitude(input.speed, state.yawRate, state.accel, input.depth);
    const tuning = hullTuningForSpan(input.span);
    const goal = {
      heave: target.heave + running.heave,
      pitch: target.pitch + running.pitch,
      roll: target.roll + running.roll,
    };
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(MAX_STEP, remaining);
      stepAxis(state.heave, goal.heave, tuning.heave, step, LIMITS.heave);
      stepAxis(state.pitch, goal.pitch, tuning.pitch, step, LIMITS.pitch);
      stepAxis(state.roll, goal.roll, tuning.roll, step, LIMITS.roll);
      remaining -= step;
    }
    return { heave: state.heave.x, pitch: state.pitch.x, roll: state.roll.x };
  }
}
