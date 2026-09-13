/**
 * Presentation-only vessel waterline attitude.
 *
 * GPU surface probes never enter GameState, AI, collision, damage, sonar, RNG,
 * or replay. Stale probes hold the last GPU pose instead of snapping to CPU
 * Gerstner; only a long gap falls back to look-dev (`adaptToLookDevSim`).
 *
 * Fitted hulls keep their model waterline offset (`fitPresentationHull` sits
 * the keel at y=0). GPU probes drive pitch/roll only. Vertical heave stays on
 * the CPU look-dev sample so a bad FFT texel cannot throw the fleet off the
 * waterline.
 */

export type FootprintSite = 'center' | 'bow' | 'stern' | 'port' | 'starboard';

export const FOOTPRINT_SITES: readonly FootprintSite[] = [
  'center',
  'bow',
  'stern',
  'port',
  'starboard',
];

/** Seconds a probe may lag the presentation clock before we drop it. */
export const ATTITUDE_MAX_LATENCY = 0.6;
/** Hold the last GPU pose instead of snapping to CPU Gerstner while readback is late. */
export const ATTITUDE_HOLD_SECONDS = 1.25;
/** Seconds of held-velocity extrapolation while a readback is in flight. */
export const ATTITUDE_MAX_EXTRAPOLATION = 0.08;
/** Exponential damping rate (1/s). `1 - exp(-k*dt)` is frame-rate independent. */
export const ATTITUDE_DAMPING = 5;
/** Clamp spectral probe heave so a bad texel cannot throw the hull. */
export const ATTITUDE_MAX_HEAVE = 2.5;
/** Depth (m) at which surface attitude is fully attenuated. */
export const ATTITUDE_SUBMERGE_METRES = 9;

export interface AttitudeSample {
  heave: number;
  pitch: number;
  roll: number;
}

export interface FootprintSample {
  site: FootprintSite;
  height: number;
  x: number;
  z: number;
}

export interface FootprintHeights {
  center: number;
  bow: number;
  stern: number;
  port: number;
  starboard: number;
  /** Half-length used for bow/stern (metres). Beam uses `span * 0.6`. */
  span: number;
}

export type AttitudeSource = 'probe' | 'fallback';

export interface VesselAttitudeResult extends AttitudeSample {
  readonly source: AttitudeSource;
  /** `waterlineOffset + attenuated heave`. Never written back to GameState. */
  readonly presentationY: number;
}

export interface VesselAttitudeInput {
  readonly entityId: string;
  readonly heading: number;
  readonly depth: number;
  /** Fitted model waterline / keel offset. Preserved; probes do not overwrite. */
  readonly waterlineOffset: number;
  readonly fallback: AttitudeSample;
  readonly footprint: Partial<Record<FootprintSite, FootprintSample>> | null;
  readonly probeTime: number | null;
  readonly now: number;
  readonly dt: number;
}

interface SmootherState {
  pose: AttitudeSample;
  velocity: AttitudeSample;
  lastTime: number;
  lastGoodProbeTime: number | null;
  source: AttitudeSource;
}

const ZERO_POSE: AttitudeSample = { heave: 0, pitch: 0, roll: 0 };

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function sanitizeAttitude(sample: AttitudeSample): AttitudeSample {
  return {
    heave: clamp(finiteOr(sample.heave, 0), -ATTITUDE_MAX_HEAVE, ATTITUDE_MAX_HEAVE),
    pitch: clamp(finiteOr(sample.pitch, 0), -0.45, 0.45),
    roll: clamp(finiteOr(sample.roll, 0), -0.5, 0.5),
  };
}

/** 1 at the surface, 0 once `depth >= ATTITUDE_SUBMERGE_METRES`. */
export function submergenceAttenuation(depthMetres: number): number {
  return clamp(1 - depthMetres / ATTITUDE_SUBMERGE_METRES, 0, 1);
}

export function dampToward(current: number, target: number, dt: number, rate = ATTITUDE_DAMPING): number {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return current + (target - current) * k;
}

export function dampAttitude(
  current: AttitudeSample,
  target: AttitudeSample,
  dt: number,
  rate = ATTITUDE_DAMPING,
): AttitudeSample {
  return {
    heave: dampToward(current.heave, target.heave, dt, rate),
    pitch: dampToward(current.pitch, target.pitch, dt, rate),
    roll: dampToward(current.roll, target.roll, dt, rate),
  };
}

export function scaleAttitude(sample: AttitudeSample, gain: number): AttitudeSample {
  return {
    heave: sample.heave * gain,
    pitch: sample.pitch * gain,
    roll: sample.roll * gain,
  };
}

export function addAttitudes(a: AttitudeSample, b: AttitudeSample): AttitudeSample {
  return { heave: a.heave + b.heave, pitch: a.pitch + b.pitch, roll: a.roll + b.roll };
}

/**
 * Heave / pitch / roll from a five-point footprint. Matches the look-dev
 * `sampleAttitude` convention: bow-up is positive pitch, starboard-down is
 * positive roll.
 */
export function attitudeFromFootprint(footprint: FootprintHeights): AttitudeSample {
  const span = Math.max(0.5, footprint.span);
  return {
    heave: clamp(footprint.center, -ATTITUDE_MAX_HEAVE, ATTITUDE_MAX_HEAVE),
    pitch: Math.atan2(footprint.bow - footprint.stern, span * 2),
    roll: Math.atan2(footprint.starboard - footprint.port, span * 1.2),
  };
}

export function footprintFromSamples(
  samples: Partial<Record<FootprintSite, FootprintSample>>,
  span: number,
): FootprintHeights | null {
  const center = samples.center;
  const bow = samples.bow;
  const stern = samples.stern;
  const port = samples.port;
  const starboard = samples.starboard;
  if (!center || !bow || !stern || !port || !starboard) return null;
  if (
    !Number.isFinite(center.height) ||
    !Number.isFinite(bow.height) ||
    !Number.isFinite(stern.height) ||
    !Number.isFinite(port.height) ||
    !Number.isFinite(starboard.height)
  ) {
    return null;
  }
  return {
    center: center.height,
    bow: bow.height,
    stern: stern.height,
    port: port.height,
    starboard: starboard.height,
    span,
  };
}

export function groupFootprint(
  samples: readonly { entityId: string; site: string; height: number; x: number; z: number }[],
  entityId: string,
): Partial<Record<FootprintSite, FootprintSample>> {
  const grouped: Partial<Record<FootprintSite, FootprintSample>> = {};
  for (const sample of samples) {
    if (sample.entityId !== entityId) continue;
    if (!isFootprintSite(sample.site)) continue;
    grouped[sample.site] = {
      site: sample.site,
      height: sample.height,
      x: sample.x,
      z: sample.z,
    };
  }
  return grouped;
}

export function isFootprintSite(value: string): value is FootprintSite {
  return (
    value === 'center' ||
    value === 'bow' ||
    value === 'stern' ||
    value === 'port' ||
    value === 'starboard'
  );
}

/** Fitted keel/waterline offset plus attenuated surface heave. */
export function presentationHeave(heave: number, waterlineOffset: number, depthMetres: number): number {
  return waterlineOffset + heave * submergenceAttenuation(depthMetres);
}

export function probeFreshness(
  probeTime: number | null,
  now: number,
  maxLatency = ATTITUDE_MAX_LATENCY,
): { age: number; usable: boolean; extrapolate: number } {
  if (probeTime === null || !Number.isFinite(probeTime)) {
    return { age: Number.POSITIVE_INFINITY, usable: false, extrapolate: 0 };
  }
  const age = now - probeTime;
  if (age < 0) return { age: 0, usable: true, extrapolate: 0 };
  if (age > maxLatency) return { age, usable: false, extrapolate: 0 };
  return { age, usable: true, extrapolate: Math.min(age, ATTITUDE_MAX_EXTRAPOLATION) };
}

function extrapolatePose(pose: AttitudeSample, velocity: AttitudeSample, dt: number): AttitudeSample {
  const t = clamp(dt, 0, ATTITUDE_MAX_EXTRAPOLATION);
  return {
    heave: pose.heave + velocity.heave * t,
    pitch: pose.pitch + velocity.pitch * t,
    roll: pose.roll + velocity.roll * t,
  };
}

function poseVelocity(from: AttitudeSample, to: AttitudeSample, dt: number): AttitudeSample {
  if (dt <= 1e-4) return ZERO_POSE;
  return {
    heave: (to.heave - from.heave) / dt,
    pitch: (to.pitch - from.pitch) / dt,
    roll: (to.roll - from.roll) / dt,
  };
}

/**
 * Per-entity smoother. Presentation-only: callers must not write the result
 * into GameState.
 */
export class VesselAttitudeSmoother {
  private readonly states = new Map<string, SmootherState>();

  reset(): void {
    this.states.clear();
  }

  forget(entityId: string): void {
    this.states.delete(entityId);
  }

  retain(livingIds: ReadonlySet<string>): void {
    for (const id of this.states.keys()) {
      if (!livingIds.has(id)) this.states.delete(id);
    }
  }

  update(input: VesselAttitudeInput): VesselAttitudeResult {
    const blend = submergenceAttenuation(finiteOr(input.depth, 0));
    const fallback = sanitizeAttitude(scaleAttitude(input.fallback, 1));
    const heights = input.footprint ? footprintFromSamples(input.footprint, footprintSpanFrom(input)) : null;
    const freshness = probeFreshness(input.probeTime, input.now);
    const rawProbe = heights ? sanitizeAttitude(scaleAttitude(attitudeFromFootprint(heights), blend)) : null;
    const useProbe = Boolean(rawProbe && freshness.usable);

    const prev = this.states.get(input.entityId);
    const dt = Number.isFinite(input.dt) ? Math.max(0, input.dt) : 1 / 60;
    let target: AttitudeSample;
    let source: AttitudeSource;
    let lastGoodProbeTime = prev?.lastGoodProbeTime ?? null;
    if (useProbe && rawProbe) {
      target = { heave: fallback.heave, pitch: rawProbe.pitch, roll: rawProbe.roll };
      source = 'probe';
      lastGoodProbeTime = input.now;
    } else if (
      prev?.source === 'probe' &&
      lastGoodProbeTime !== null &&
      input.now - lastGoodProbeTime < ATTITUDE_HOLD_SECONDS
    ) {
      target = { heave: fallback.heave, pitch: prev.pose.pitch, roll: prev.pose.roll };
      source = 'probe';
    } else {
      target = fallback;
      source = 'fallback';
    }

    let current: AttitudeSample;
    if (!prev) {
      current = target;
    } else if (useProbe && freshness.extrapolate > 0 && source === 'probe') {
      const held = extrapolatePose(prev.pose, prev.velocity, freshness.extrapolate);
      current = dampAttitude(held, target, dt);
    } else {
      current = dampAttitude(prev.pose, target, dt);
    }

    current = sanitizeAttitude(current);
    const velocity = prev ? poseVelocity(prev.pose, current, Math.max(dt, 1 / 120)) : ZERO_POSE;
    this.states.set(input.entityId, {
      pose: current,
      velocity,
      lastTime: input.now,
      lastGoodProbeTime,
      source,
    });

    const waterline = finiteOr(input.waterlineOffset, 0);
    return {
      heave: current.heave,
      pitch: current.pitch,
      roll: current.roll,
      source,
      // Heave is already submergence-attenuated (probe) or pre-damped (look-dev
      // fallback). Only add the fitted waterline offset here.
      presentationY: waterline + current.heave,
    };
  }
}

function footprintSpanFrom(input: VesselAttitudeInput): number {
  const bow = input.footprint?.bow;
  const stern = input.footprint?.stern;
  if (bow && stern) {
    const span = Math.hypot(bow.x - stern.x, bow.z - stern.z) * 0.5;
    if (span > 0.25) return span;
  }
  return 8;
}

/** Build the five-point sample locations for a hull (presentation metres). */
export function footprintPoints(
  x: number,
  z: number,
  heading: number,
  span: number,
): Record<FootprintSite, { x: number; z: number }> {
  const forwardX = Math.cos(heading);
  const forwardZ = Math.sin(heading);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const beam = span * 0.6;
  return {
    center: { x, z },
    bow: { x: x + forwardX * span, z: z + forwardZ * span },
    stern: { x: x - forwardX * span, z: z - forwardZ * span },
    port: { x: x + rightX * beam, z: z + rightZ * beam },
    starboard: { x: x - rightX * beam, z: z - rightZ * beam },
  };
}

export function attitudeSpanForKind(kind: string): number {
  if (kind === 'battleship') return 14;
  if (kind === 'cruiser' || kind === 'merchant' || kind === 'freighter') return 11;
  if (kind === 'patrol') return 5;
  if (kind === 'sub' || kind === 'uboat' || kind === 'sub_nautilus') return 7;
  return 8;
}
