/** Bounded spray, impact splashes, and underwater particulate (Plan 018 Phase E).
 *
 * Presentation-only. Seeds its own RNG and never reads gameplay `rngState`.
 * Underwater submarines do not emit permanent surface wakes.
 */

import * as THREE from 'three';
import { SURFACE_SPLASH_Y } from '../presentation/coordinates';
import type { QualityName } from '../quality';
import { disposeMaterial } from './resources';
import { createSpectrumRng } from './spectrum';

/** Isolated from `DEFAULT_SPECTRUM_SEED` and gameplay RNG. */
export const SURFACE_EFFECTS_SEED = 0x0ca0571c;

/** Surface wakes stop once the body is this deep (metres, positive down). */
export const SURFACE_WAKE_DEPTH_METRES = 2.5;

export const SURFACE_EFFECTS_PROFILES = {
  high: { sprayCap: 96, splashCap: 24, bubbleCap: 80, particulateCap: 64 },
  medium: { sprayCap: 56, splashCap: 16, bubbleCap: 48, particulateCap: 36 },
  low: { sprayCap: 24, splashCap: 8, bubbleCap: 24, particulateCap: 16 },
} as const;

export type SurfaceEffectsProfile = (typeof SURFACE_EFFECTS_PROFILES)[QualityName];
export type SurfaceEffectLayer = 'spray' | 'splash' | 'bubble' | 'particulate';

export interface SurfaceWakeBody {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  /** Metres positive-down. Omit or 0 for surface ships. */
  readonly depth?: number;
  readonly stern?: number;
}

export interface SurfaceCrestSample {
  readonly x: number;
  readonly z: number;
  readonly energy: number;
}

export interface SubmergedEmitter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly speed: number;
}

export interface PresentationSplashEvent {
  readonly x: number;
  readonly y?: number;
  readonly z: number;
  readonly strength?: number;
  readonly kind?: 'impact' | 'splash' | 'burst';
}

export interface SurfaceEffectsFrame {
  readonly time: number;
  readonly dt: number;
  readonly paused?: boolean;
  readonly reducedMotion?: boolean;
  readonly followX: number;
  readonly followZ: number;
  readonly cameraY?: number;
  readonly seaState?: number;
  readonly crests?: readonly SurfaceCrestSample[];
  readonly wakes?: readonly SurfaceWakeBody[];
  readonly submerged?: readonly SubmergedEmitter[];
}

export interface SurfaceEffectsDiagnostics {
  readonly quality: QualityName;
  readonly missionGeneration: number;
  readonly historyTime: number;
  readonly paused: boolean;
  readonly reducedMotion: boolean;
  readonly sprayAlive: number;
  readonly splashAlive: number;
  readonly bubbleAlive: number;
  readonly particulateAlive: number;
  readonly sprayCap: number;
  readonly splashCap: number;
  readonly bubbleCap: number;
  readonly particulateCap: number;
  readonly ownedMeshes: number;
  readonly slotCapacity: number;
}

type Slot = {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  ttl: number;
  scale: number;
};

export function surfaceEffectsProfileFor(quality: QualityName): SurfaceEffectsProfile {
  switch (quality) {
    case 'high':
      return SURFACE_EFFECTS_PROFILES.high;
    case 'medium':
      return SURFACE_EFFECTS_PROFILES.medium;
    case 'low':
      return SURFACE_EFFECTS_PROFILES.low;
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

export function createPresentationRng(seed = SURFACE_EFFECTS_SEED): () => number {
  return createSpectrumRng(seed);
}

export function canEmitSurfaceWake(depthMetres: number, speed: number): boolean {
  return depthMetres < SURFACE_WAKE_DEPTH_METRES && speed > 0.45;
}

function createLayerMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
    side: THREE.DoubleSide,
  });
}

class InstancedLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  readonly capacity: number;
  cap: number;
  private readonly dummy = new THREE.Object3D();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    capacity: number,
    name: string,
  ) {
    this.capacity = capacity;
    this.cap = capacity;
    this.slots = Array.from({ length: capacity }, () => ({
      alive: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      ttl: 1,
      scale: 1,
    }));
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  get alive(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.alive) count += 1;
    return count;
  }

  acquire(oldest = true): Slot | null {
    let vacant: Slot | null = null;
    let oldestSlot: Slot | null = null;
    let living = 0;
    for (const slot of this.slots) {
      if (!slot.alive) {
        if (!vacant) vacant = slot;
        continue;
      }
      living += 1;
      if (!oldestSlot || slot.age > oldestSlot.age) oldestSlot = slot;
    }
    if (vacant && living < this.cap) return vacant;
    if (living < this.cap) return vacant;
    return oldest ? oldestSlot : null;
  }

  clear(): void {
    for (const slot of this.slots) slot.alive = false;
    this.mesh.count = 0;
  }

  trimToCap(): void {
    if (this.alive <= this.cap) return;
    const living = this.slots.filter((slot) => slot.alive).sort((a, b) => b.age - a.age);
    for (let i = this.cap; i < living.length; i++) living[i]!.alive = false;
  }

  step(dt: number, motion: (slot: Slot, dt: number) => void): void {
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      slot.age += dt;
      if (slot.age >= slot.ttl) {
        slot.alive = false;
        continue;
      }
      motion(slot, dt);
    }
  }

  commit(): void {
    let written = 0;
    for (const slot of this.slots) {
      if (!slot.alive || written >= this.cap) {
        if (slot.alive && written >= this.cap) slot.alive = false;
        continue;
      }
      const life = slot.age / slot.ttl;
      this.dummy.position.set(slot.x, slot.y, slot.z);
      this.dummy.scale.setScalar(slot.scale * (0.85 + life * 0.65));
      this.dummy.rotation.set(0, written * 0.37, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(written, this.dummy.matrix);
      written += 1;
    }
    this.mesh.count = written;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    disposeMaterial(this.mesh.material as THREE.Material);
  }
}

function spawnInto(
  layer: InstancedLayer,
  init: Omit<Slot, 'alive' | 'age'> & { age?: number },
): boolean {
  const slot = layer.acquire();
  if (!slot) return false;
  slot.alive = true;
  slot.x = init.x;
  slot.y = init.y;
  slot.z = init.z;
  slot.vx = init.vx;
  slot.vy = init.vy;
  slot.vz = init.vz;
  slot.ttl = init.ttl;
  slot.scale = init.scale;
  slot.age = init.age ?? 0;
  return true;
}

export class SurfaceEffects {
  readonly group = new THREE.Group();
  private quality: QualityName;
  private readonly rng: () => number;
  private readonly spray: InstancedLayer;
  private readonly splash: InstancedLayer;
  private readonly bubbles: InstancedLayer;
  private readonly particulate: InstancedLayer;
  private readonly layers: InstancedLayer[];
  private missionGeneration = 0;
  private historyTime = 0;
  private paused = false;
  private reducedMotion = false;
  private disposed = false;
  private lastAmbient = 0;

  constructor(opts?: { seed?: number; quality?: QualityName }) {
    this.quality = opts?.quality ?? 'high';
    this.rng = createPresentationRng(opts?.seed ?? SURFACE_EFFECTS_SEED);
    this.group.name = 'surface-effects';

    const max = SURFACE_EFFECTS_PROFILES.high;
    this.spray = new InstancedLayer(
      new THREE.PlaneGeometry(0.55, 0.85),
      createLayerMaterial(0xe8fbff, 0.42),
      max.sprayCap,
      'surface-spray',
    );
    this.splash = new InstancedLayer(
      new THREE.RingGeometry(0.15, 0.7, 12),
      createLayerMaterial(0xd8f4ff, 0.5),
      max.splashCap,
      'surface-splash',
    );
    this.bubbles = new InstancedLayer(
      new THREE.SphereGeometry(0.12, 6, 4),
      createLayerMaterial(0xb8e8f0, 0.38),
      max.bubbleCap,
      'underwater-bubbles',
    );
    this.particulate = new InstancedLayer(
      new THREE.PlaneGeometry(0.08, 0.08),
      createLayerMaterial(0x6a9aa0, 0.22),
      max.particulateCap,
      'underwater-particulate',
    );
    this.splash.mesh.rotation.x = -Math.PI / 2;
    this.layers = [this.spray, this.splash, this.bubbles, this.particulate];
    for (const layer of this.layers) this.group.add(layer.mesh);
    this.applyQualityCaps();
  }

  setQuality(quality: QualityName): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.applyQualityCaps();
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) this.clearLayers();
  }

  reset(missionGeneration = 0): void {
    this.missionGeneration = missionGeneration;
    this.historyTime = 0;
    this.lastAmbient = 0;
    this.clearLayers();
  }

  emitImpact(event: PresentationSplashEvent): void {
    if (this.disposed || this.reducedMotion) return;
    const strength = THREE.MathUtils.clamp(event.strength ?? 1, 0.15, 2.5);
    const y = event.y ?? SURFACE_SPLASH_Y;
    const surface = y > -0.4;
    if (surface) {
      spawnInto(this.splash, {
        x: event.x,
        y: SURFACE_SPLASH_Y,
        z: event.z,
        vx: 0,
        vy: 0,
        vz: 0,
        ttl: 0.7 + strength * 0.25,
        scale: 0.8 + strength * 0.9,
      });
      const sprays = event.kind === 'burst' ? 5 : 3;
      for (let i = 0; i < sprays; i++) {
        const a = this.rng() * Math.PI * 2;
        spawnInto(this.spray, {
          x: event.x + Math.cos(a) * 0.35,
          y: SURFACE_SPLASH_Y + 0.12,
          z: event.z + Math.sin(a) * 0.35,
          vx: Math.cos(a) * 1.4,
          vy: 1.8 + this.rng() * 1.1,
          vz: Math.sin(a) * 1.4,
          ttl: 0.55 + this.rng() * 0.25,
          scale: 0.45 + strength * 0.3,
        });
      }
    } else {
      for (let i = 0; i < 4; i++) {
        spawnInto(this.bubbles, {
          x: event.x + (this.rng() - 0.5) * 0.6,
          y,
          z: event.z + (this.rng() - 0.5) * 0.6,
          vx: (this.rng() - 0.5) * 0.2,
          vy: 0.45 + this.rng() * 0.35,
          vz: (this.rng() - 0.5) * 0.2,
          ttl: 1.4 + this.rng() * 0.6,
          scale: 0.45 + strength * 0.2,
        });
      }
    }
  }

  update(frame: SurfaceEffectsFrame): void {
    if (this.disposed) return;
    this.paused = Boolean(frame.paused);
    this.reducedMotion = frame.reducedMotion ?? this.reducedMotion;
    if (this.reducedMotion) {
      this.clearLayers();
      return;
    }
    if (this.paused) {
      for (const layer of this.layers) layer.commit();
      return;
    }

    const dt = Math.max(0, frame.dt);
    this.historyTime += dt;
    this.stepLayers(dt);
    this.emitAmbient(frame);
    for (const layer of this.layers) layer.commit();
  }

  getDiagnostics(): SurfaceEffectsDiagnostics {
    const profile = surfaceEffectsProfileFor(this.quality);
    return {
      quality: this.quality,
      missionGeneration: this.missionGeneration,
      historyTime: this.historyTime,
      paused: this.paused,
      reducedMotion: this.reducedMotion,
      sprayAlive: this.spray.alive,
      splashAlive: this.splash.alive,
      bubbleAlive: this.bubbles.alive,
      particulateAlive: this.particulate.alive,
      sprayCap: profile.sprayCap,
      splashCap: profile.splashCap,
      bubbleCap: profile.bubbleCap,
      particulateCap: profile.particulateCap,
      ownedMeshes: this.layers.length,
      slotCapacity:
        this.spray.capacity +
        this.splash.capacity +
        this.bubbles.capacity +
        this.particulate.capacity,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearLayers();
    for (const layer of this.layers) {
      this.group.remove(layer.mesh);
      layer.dispose();
    }
  }

  private applyQualityCaps(): void {
    const profile = surfaceEffectsProfileFor(this.quality);
    this.spray.cap = profile.sprayCap;
    this.splash.cap = profile.splashCap;
    this.bubbles.cap = profile.bubbleCap;
    this.particulate.cap = profile.particulateCap;
    for (const layer of this.layers) layer.trimToCap();
  }

  private clearLayers(): void {
    for (const layer of this.layers) layer.clear();
  }

  private stepLayers(dt: number): void {
    this.spray.step(dt, (slot, step) => {
      slot.x += slot.vx * step;
      slot.y += slot.vy * step;
      slot.z += slot.vz * step;
      slot.vy -= 4.2 * step;
    });
    this.splash.step(dt, (slot, step) => {
      slot.scale += 1.6 * step;
      slot.y = SURFACE_SPLASH_Y;
    });
    this.bubbles.step(dt, (slot, step) => {
      slot.x += slot.vx * step;
      slot.y += slot.vy * step;
      slot.z += slot.vz * step;
      if (slot.y > SURFACE_SPLASH_Y) slot.alive = false;
    });
    this.particulate.step(dt, (slot, step) => {
      slot.x += slot.vx * step;
      slot.y += slot.vy * step;
      slot.z += slot.vz * step;
    });
  }

  private emitAmbient(frame: SurfaceEffectsFrame): void {
    const storm = frame.seaState !== undefined && frame.seaState >= 0.6 ? 1.25 : 1;
    if (this.historyTime - this.lastAmbient < 0.08) return;
    this.lastAmbient = this.historyTime;

    for (const crest of frame.crests ?? []) {
      if (crest.energy < 0.28 || this.rng() > crest.energy * 0.85) continue;
      spawnInto(this.spray, {
        x: crest.x + (this.rng() - 0.5) * 0.8,
        y: SURFACE_SPLASH_Y + 0.1,
        z: crest.z + (this.rng() - 0.5) * 0.8,
        vx: (this.rng() - 0.5) * 1.2,
        vy: 1.4 + this.rng() * 1.2 * storm,
        vz: (this.rng() - 0.5) * 1.2,
        ttl: 0.45 + this.rng() * 0.25,
        scale: 0.35 + crest.energy * 0.4,
      });
    }

    for (const wake of frame.wakes ?? []) {
      const depth = wake.depth ?? 0;
      if (!canEmitSurfaceWake(depth, wake.speed)) continue;
      const stern = wake.stern ?? 6;
      const bx = wake.x - Math.cos(wake.heading) * stern;
      const bz = wake.z - Math.sin(wake.heading) * stern;
      spawnInto(this.spray, {
        x: bx + (this.rng() - 0.5) * 0.7,
        y: SURFACE_SPLASH_Y + 0.06,
        z: bz + (this.rng() - 0.5) * 0.7,
        vx: -Math.cos(wake.heading) * (0.8 + wake.speed * 0.12),
        vy: 0.9 + this.rng() * 0.6,
        vz: -Math.sin(wake.heading) * (0.8 + wake.speed * 0.12),
        ttl: 0.5 + this.rng() * 0.2,
        scale: 0.28 + Math.min(0.5, wake.speed * 0.04),
      });
    }

    for (const body of frame.submerged ?? []) {
      if (body.y > -0.6 || body.speed < 0.15) continue;
      if (this.rng() > 0.45) continue;
      spawnInto(this.bubbles, {
        x: body.x + (this.rng() - 0.5) * 0.8,
        y: body.y + 0.2,
        z: body.z + (this.rng() - 0.5) * 0.8,
        vx: (this.rng() - 0.5) * 0.15,
        vy: 0.35 + this.rng() * 0.25,
        vz: (this.rng() - 0.5) * 0.15,
        ttl: 1.6 + this.rng() * 0.7,
        scale: 0.35 + this.rng() * 0.2,
      });
    }

    const cameraY = frame.cameraY ?? 8;
    if (cameraY >= -0.35) return;
    const need = Math.min(
      surfaceEffectsProfileFor(this.quality).particulateCap,
      this.particulate.cap,
    );
    if (this.particulate.alive >= need) return;
    spawnInto(this.particulate, {
      x: frame.followX + (this.rng() - 0.5) * 18,
      y: cameraY + (this.rng() - 0.5) * 6,
      z: frame.followZ + (this.rng() - 0.5) * 18,
      vx: (this.rng() - 0.5) * 0.12,
      vy: (this.rng() - 0.4) * 0.08,
      vz: (this.rng() - 0.5) * 0.12,
      ttl: 2.8 + this.rng() * 1.4,
      scale: 0.35 + this.rng() * 0.3,
    });
  }
}
