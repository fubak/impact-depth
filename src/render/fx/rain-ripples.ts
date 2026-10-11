/**
 * Rain ripples: a separate instanced layer of flat rings on the water, one per
 * raindrop impact. Presentation only.
 *
 * Own pool (`RainRipples`), so the streak layer in `rain.ts` is untouched. Slot
 * state lives in preallocated typed arrays and every frame reuses one Matrix4,
 * Vector3, Quaternion and Color, so nothing allocates per frame. The
 * `instanceColor` buffer is created in the constructor so the material compiles
 * once, before the first spawn.
 *
 * Pure helpers (`rippleRadius`, `rippleFade`, `RAIN_RIPPLE_CAPS`) are exported so
 * the growth and fade curves are testable without WebGL.
 */
import * as THREE from 'three';
import type { QualityName } from '../quality';

/** Live ripple budget per quality tier; low quality and reduced motion draw none. */
export const RAIN_RIPPLE_CAPS: Readonly<Record<QualityName, number>> = {
  high: 96,
  medium: 48,
  low: 0,
};
export const RIPPLE_LIFE_S = 0.9;
export const RIPPLE_MIN_RADIUS = 0.15;
/** Reached at strength 0.5. */
export const RIPPLE_MAX_RADIUS = 1.4;
/** Height above the sampled water surface. */
export const RIPPLE_LIFT_M = 0.08;

const POOL_CAPACITY = RAIN_RIPPLE_CAPS.high;
const MIN_STRENGTH = 0.1;
const MAX_STRENGTH = 0.5;

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

function lifeFraction(ageS: number): number {
  return clamp01(ageS / RIPPLE_LIFE_S);
}

/** Ease-out growth: lerp(MIN, MAX·2·clamp(strength,0.1,0.5), 1-(1-t)^2). */
export function rippleRadius(ageS: number, strength: number): number {
  const t = lifeFraction(ageS);
  const clamped = Number.isFinite(strength)
    ? Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, strength))
    : MIN_STRENGTH;
  const target = RIPPLE_MAX_RADIUS * 2 * clamped;
  const eased = 1 - (1 - t) * (1 - t);
  return RIPPLE_MIN_RADIUS + (target - RIPPLE_MIN_RADIUS) * eased;
}

/** (1 - t)^1.5; 1 at birth, 0 at or after the life. */
export function rippleFade(ageS: number): number {
  return (1 - lifeFraction(ageS)) ** 1.5;
}

export class RainRipples {
  readonly mesh: THREE.InstancedMesh;

  private readonly geometry: THREE.RingGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly ages = new Float32Array(POOL_CAPACITY);
  private readonly strengths = new Float32Array(POOL_CAPACITY);
  private readonly xs = new Float32Array(POOL_CAPACITY);
  private readonly zs = new Float32Array(POOL_CAPACITY);
  private readonly live = new Uint8Array(POOL_CAPACITY);
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly dark = new THREE.Color(0, 0, 0);
  private cap: number = RAIN_RIPPLE_CAPS.high;
  private reducedMotion = false;
  /**
   * True while the buffers may hold live or not-yet-cleared slots. Starts true so the first
   * update uploads the constructor's cleared buffers; spawn, quality trim and reset set it,
   * and an update that leaves nothing live clears it. Idle frames then skip the rewrite.
   */
  private dirty = true;

  constructor() {
    this.geometry = new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xdfefff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, POOL_CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'rain-ripples';
    this.mesh.visible = false;
    this.quaternion.identity();
    this.scale.set(0, 0, 0);
    this.position.set(0, 0, 0);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    for (let i = 0; i < POOL_CAPACITY; i++) {
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.dark);
    }
  }

  setQuality(quality: QualityName): void {
    this.cap = RAIN_RIPPLE_CAPS[quality];
    for (let i = this.cap; i < POOL_CAPACITY; i++) this.live[i] = 0;
    this.dirty = true;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) this.reset();
  }

  spawn(x: number, z: number, strength: number): void {
    if (this.reducedMotion || this.cap <= 0) return;
    let slot = -1;
    let oldest = 0;
    let oldestAge = -1;
    for (let i = 0; i < this.cap; i++) {
      if (!this.live[i]) {
        slot = i;
        break;
      }
      if (this.ages[i] > oldestAge) {
        oldestAge = this.ages[i];
        oldest = i;
      }
    }
    if (slot < 0) slot = oldest;
    this.live[slot] = 1;
    this.ages[slot] = 0;
    this.xs[slot] = x;
    this.zs[slot] = z;
    this.strengths[slot] = strength;
    this.dirty = true;
  }

  update(dt: number, paused: boolean, waterY: number): void {
    // Only a live slot or a not-yet-cleared buffer needs work. A clean pool has no live slots
    // (spawn always sets dirty), so idle frames return before any rewrite or upload.
    if (!this.dirty) return;
    if (!paused) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      for (let i = 0; i < POOL_CAPACITY; i++) {
        if (!this.live[i]) continue;
        this.ages[i] += step;
        if (this.ages[i] >= RIPPLE_LIFE_S) this.live[i] = 0;
      }
    }
    for (let i = 0; i < POOL_CAPACITY; i++) {
      if (this.live[i]) {
        this.writeLive(i, waterY);
      } else {
        this.writeDead(i);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const live = this.active;
    this.mesh.visible = live > 0;
    // Live ripples change age every frame; only a pool written with nothing live goes clean.
    this.dirty = live > 0;
  }

  get active(): number {
    let count = 0;
    for (let i = 0; i < POOL_CAPACITY; i++) count += this.live[i];
    return count;
  }

  reset(): void {
    this.live.fill(0);
    this.ages.fill(0);
    this.mesh.visible = false;
    this.dirty = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }

  private writeLive(i: number, waterY: number): void {
    const age = this.ages[i];
    const radius = rippleRadius(age, this.strengths[i]);
    const fade = rippleFade(age);
    this.position.set(this.xs[i], waterY + RIPPLE_LIFT_M, this.zs[i]);
    this.scale.set(radius, 1, radius);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(i, this.matrix);
    this.color.setRGB(fade, fade, fade);
    this.mesh.setColorAt(i, this.color);
  }

  private writeDead(i: number): void {
    this.position.set(0, 0, 0);
    this.scale.set(0, 0, 0);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.setColorAt(i, this.dark);
  }
}
