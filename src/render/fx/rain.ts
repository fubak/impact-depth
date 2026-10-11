/**
 * Rain: one camera-anchored LineSegments draw call of wind-slanted streaks,
 * plus ring ripples on the water routed to an existing emitter.
 *
 * Presentation only. Streaks fall on a closed-form schedule (phase + time *
 * speed, wrapped), so nothing is simulated per streak and nothing allocates
 * per frame: positions live in one preallocated Float32Array and the draw
 * range is trimmed to the active count. Own RNG; never touches gameplay state.
 *
 * The pure helpers (counts, rates, wrapping, segment maths) are exported so
 * density scaling is testable without WebGL.
 */
import * as THREE from 'three';
import { excludeFromWaterCapture } from '../ocean/optics';
import { createSpectrumRng } from '../ocean/spectrum';
import type { QualityName } from '../quality';

/** Streak budget at full rain per quality tier; low quality draws none. */
export const RAIN_STREAK_CAPS: Readonly<Record<QualityName, number>> = {
  high: 1800,
  medium: 900,
  low: 0,
};
/** Surface ripples per second at full rain per quality tier. */
export const RAIN_RIPPLE_RATE: Readonly<Record<QualityName, number>> = {
  high: 10,
  medium: 5,
  low: 0,
};
/** Below this intensity the layer is off entirely. */
export const RAIN_MIN_INTENSITY = 0.02;

/** Width of the camera-anchored volume (metres) and how high streaks start. */
const VOLUME_SIZE = 60;
const VOLUME_HEIGHT = 40;
const RIPPLE_RADIUS = 22;
const MAX_RIPPLES_PER_FRAME = 3;
const MAX_SLANT_SPEED = 9;
const SLANT_PER_WIND = 0.5;
/** Unit wind heading in the XZ plane; the sim has no wind direction yet. */
const WIND_DIR_X = 0.8;
const WIND_DIR_Z = 0.6;
const STREAK_LENGTH = 1.3;
const BASE_OPACITY = 0.3;
const FLASH_OPACITY = 0.4;
const RAIN_SEED = 0x7a1d5eed;
const SURFACE_Y = 0.3;

const MAX_STREAKS = RAIN_STREAK_CAPS.high;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

function gated(rain: number, quality: QualityName, reducedMotion: boolean): number {
  if (reducedMotion || quality === 'low') return 0;
  const level = clamp01(rain);
  return level < RAIN_MIN_INTENSITY ? 0 : level;
}

/** Active streak count: zero when dry, on low quality or under reduced motion. */
export function rainStreakCount(
  rain: number,
  quality: QualityName,
  reducedMotion: boolean,
): number {
  return Math.round(RAIN_STREAK_CAPS[quality] * gated(rain, quality, reducedMotion));
}

/** Ripples per second under the same gates. */
export function rainRippleRate(rain: number, quality: QualityName, reducedMotion: boolean): number {
  return RAIN_RIPPLE_RATE[quality] * gated(rain, quality, reducedMotion);
}

/** Wrap an offset into [-size/2, size/2) so a fixed streak pattern tiles around the camera. */
export function wrapAround(value: number, size: number): number {
  return value - size * Math.floor(value / size + 0.5);
}

export interface StreakParams {
  /** Volume height; streaks fall from here to the water and wrap. */
  readonly height: number;
  /** Fall speed, m/s. */
  readonly fall: number;
  /** Horizontal drift from wind, m/s. */
  readonly slantX: number;
  readonly slantZ: number;
  /** Streak length, metres. */
  readonly length: number;
}

/**
 * Write one streak (head xyz, tail xyz) at `out[o..o+5]`. The head is the
 * leading, lower end; the tail trails up-wind along the velocity.
 */
export function rainStreakSegment(
  out: Float32Array,
  o: number,
  x: number,
  phase: number,
  z: number,
  time: number,
  p: StreakParams,
): void {
  const travelled = phase * p.height + time * p.fall;
  const y = p.height - (travelled - p.height * Math.floor(travelled / p.height));
  const speed = Math.hypot(p.slantX, p.fall, p.slantZ) || 1;
  const k = p.length / speed;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = x - p.slantX * k;
  out[o + 4] = y + p.fall * k;
  out[o + 5] = z - p.slantZ * k;
}

export interface RainFrame {
  readonly dt: number;
  readonly paused: boolean;
  /** Rain intensity 0..1. */
  readonly rain: number;
  /** 10 m wind, m/s; leans the streaks. */
  readonly windMs: number;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly cameraZ: number;
  /** Streak colour; read, never retained. */
  readonly tint: THREE.Color;
  /** Lightning flash 0..1 brightens the streaks. */
  readonly flash: number;
}

/** Receives a ring ripple on the water; the scene routes it to surface effects. */
export type RippleEmitter = (x: number, z: number, strength: number) => void;

export class RainLayer {
  readonly object: THREE.LineSegments;
  private readonly positions = new Float32Array(MAX_STREAKS * 6);
  private readonly baseX = new Float32Array(MAX_STREAKS);
  private readonly baseZ = new Float32Array(MAX_STREAKS);
  private readonly phase = new Float32Array(MAX_STREAKS);
  private readonly fallScale = new Float32Array(MAX_STREAKS);
  private readonly params = { height: VOLUME_HEIGHT, fall: 0, slantX: 0, slantZ: 0, length: 0 };
  private readonly material: THREE.LineBasicMaterial;
  private readonly attribute: THREE.BufferAttribute;
  private readonly rng = createSpectrumRng(RAIN_SEED);
  private quality: QualityName = 'high';
  private reducedMotion = false;
  private time = 0;
  private rippleDebt = 0;
  private active = 0;

  constructor() {
    for (let i = 0; i < MAX_STREAKS; i++) {
      this.baseX[i] = (this.rng() - 0.5) * VOLUME_SIZE;
      this.baseZ[i] = (this.rng() - 0.5) * VOLUME_SIZE;
      this.phase[i] = this.rng();
      this.fallScale[i] = 0.85 + this.rng() * 0.3;
    }
    const geometry = new THREE.BufferGeometry();
    this.attribute = new THREE.BufferAttribute(this.positions, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      color: 0xbfd0dc,
      transparent: true,
      opacity: BASE_OPACITY,
      depthWrite: false,
    });
    this.object = new THREE.LineSegments(geometry, this.material);
    this.object.name = 'rain-streaks';
    this.object.frustumCulled = false;
    this.object.renderOrder = 7;
    this.object.visible = false;
    excludeFromWaterCapture(this.object);
  }

  /** Streaks drawn last frame (0 when dry, low quality, reduced motion or underwater). */
  get activeStreaks(): number {
    return this.active;
  }

  setQuality(quality: QualityName): void {
    this.quality = quality;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  reset(): void {
    this.time = 0;
    this.rippleDebt = 0;
    this.active = 0;
    this.object.visible = false;
    this.object.geometry.setDrawRange(0, 0);
  }

  update(frame: RainFrame, emitRipple?: RippleEmitter): void {
    const underwater = frame.cameraY < SURFACE_Y;
    const count = underwater ? 0 : rainStreakCount(frame.rain, this.quality, this.reducedMotion);
    this.active = count;
    this.object.visible = count > 0;
    if (count === 0) {
      this.rippleDebt = 0;
      this.object.geometry.setDrawRange(0, 0);
      return;
    }
    if (!frame.paused) this.time += Math.max(0, frame.dt);
    this.writeStreaks(count, frame);
    this.material.color.copy(frame.tint);
    this.material.opacity = Math.min(1, BASE_OPACITY + FLASH_OPACITY * clamp01(frame.flash));
    this.object.geometry.setDrawRange(0, count * 2);
    this.attribute.needsUpdate = true;
    if (emitRipple && !frame.paused) this.emitRipples(frame, emitRipple);
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }

  private writeStreaks(count: number, frame: RainFrame): void {
    const slant = Math.min(MAX_SLANT_SPEED, Math.max(0, frame.windMs) * SLANT_PER_WIND);
    const p = this.params;
    p.fall = 14 + 6 * clamp01(frame.rain);
    p.slantX = WIND_DIR_X * slant;
    p.slantZ = WIND_DIR_Z * slant;
    p.length = STREAK_LENGTH;
    const base = p.fall;
    for (let i = 0; i < count; i++) {
      p.fall = base * this.fallScale[i]!;
      const x = frame.cameraX + wrapAround(this.baseX[i]! - frame.cameraX, VOLUME_SIZE);
      const z = frame.cameraZ + wrapAround(this.baseZ[i]! - frame.cameraZ, VOLUME_SIZE);
      rainStreakSegment(this.positions, i * 6, x, this.phase[i]!, z, this.time, p);
    }
  }

  private emitRipples(frame: RainFrame, emit: RippleEmitter): void {
    this.rippleDebt +=
      rainRippleRate(frame.rain, this.quality, this.reducedMotion) * Math.max(0, frame.dt);
    let spawned = 0;
    while (this.rippleDebt >= 1 && spawned < MAX_RIPPLES_PER_FRAME) {
      this.rippleDebt -= 1;
      spawned += 1;
      const angle = this.rng() * Math.PI * 2;
      const radius = Math.sqrt(this.rng()) * RIPPLE_RADIUS;
      emit(
        frame.cameraX + Math.cos(angle) * radius,
        frame.cameraZ + Math.sin(angle) * radius,
        0.15 + this.rng() * 0.1,
      );
    }
    // A long frame must not bank a burst for the next one.
    this.rippleDebt = Math.min(this.rippleDebt, 1);
  }
}
