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
  seed: number;
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

export type ParticleStyle = 'spray' | 'ring' | 'bubble' | 'mote';

/** Shared, lit particle look so every layer reads under the same sun as the sea. */
export interface ParticleLighting {
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  sunDir: THREE.Vector3;
}

const PARTICLE_VERTEX = /* glsl */ `
uniform float uBillboard;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
varying vec3 vWorld;
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
    vLife = instanceColor.r;
    vSeed = instanceColor.g;
  #else
    vLife = 0.0;
    vSeed = 0.0;
  #endif
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(vec3(instanceMatrix[0].x, instanceMatrix[0].y, instanceMatrix[0].z));
  vec3 world;
  if (uBillboard > 0.5) {
    // Camera-facing quad: view-space offset keeps soft sprites round from any angle.
    vec4 viewCenter = viewMatrix * center;
    viewCenter.xy += position.xy * scale;
    world = center.xyz;
    vWorld = world;
    gl_Position = projectionMatrix * viewCenter;
  } else {
    // Flat on the sea (rings): XZ plane through the instance centre.
    world = center.xyz + vec3(position.x, 0.0, position.y) * scale;
    vWorld = world;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uOpacity;
uniform int uStyle;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uSunDir;
varying vec2 vUv;
varying float vLife;
varying float vSeed;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float alpha;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);
  // Spray is lit by sun + sky; droplets forward-scatter, so backlit spray glows.
  float forward = pow(max(dot(-V, L), 0.0), 5.0);
  vec3 lit = uSkyColor * 0.55 + uSunColor * (0.45 + max(L.y, 0.0) * 0.6) + uSunColor * forward * 2.4;
  vec3 col = uTint * lit;
  float fadeIn = smoothstep(0.0, 0.08, vLife);
  float fadeOut = pow(1.0 - clamp(vLife, 0.0, 1.0), 1.4);
  if (uStyle == 0) {
    // Puffy spray: noisy soft disc that tears apart as it ages.
    float n = vnoise(p * 2.6 + vSeed * 17.0 + vLife * 2.0);
    float body = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.55 * (0.4 + vLife));
    alpha = body * (0.55 + 0.45 * n);
  } else if (uStyle == 1) {
    // Expanding foam ring with a torn inner edge.
    float n = vnoise(vec2(atan(p.y, p.x) * 3.0, vSeed * 9.0) + r * 4.0);
    float ring = exp(-pow((r - 0.72) / (0.12 + vLife * 0.1), 2.0));
    float core = exp(-r * r * 6.0) * (1.0 - vLife);
    alpha = (ring * (0.6 + 0.4 * n) + core * 0.7) * smoothstep(1.0, 0.92, r);
    col = mix(col, vec3(1.0) * (uSkyColor * 0.6 + uSunColor * 0.5), 0.4);
  } else if (uStyle == 2) {
    // Bubble: transparent body, bright rim, tiny specular dot.
    float rim = smoothstep(0.55, 0.92, r) * smoothstep(1.0, 0.92, r);
    float dotSpec = smoothstep(0.22, 0.0, length(p - vec2(-0.32, 0.36)));
    alpha = rim * 0.85 + dotSpec + 0.08 * step(r, 1.0);
    col = mix(uTint * (uSkyColor * 0.8 + 0.1), vec3(1.0), dotSpec);
  } else {
    // Suspended motes: tiny soft dots, catch a little god-ray light.
    alpha = smoothstep(1.0, 0.0, r) * 0.8;
    col = uTint * (uSkyColor * 0.7 + uSunColor * 0.25);
  }
  alpha *= uOpacity * fadeIn * fadeOut;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function styleIndex(style: ParticleStyle): number {
  return style === 'spray' ? 0 : style === 'ring' ? 1 : style === 'bubble' ? 2 : 3;
}

function createLayerMaterial(color: number, opacity: number, style: ParticleStyle): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uStyle: { value: styleIndex(style) },
      uBillboard: { value: style === 'ring' ? 0 : 1 },
      uSunColor: { value: new THREE.Color(1, 0.94, 0.82) },
      uSkyColor: { value: new THREE.Color(0.5, 0.7, 0.9) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
    },
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
}

class InstancedLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: Slot[];
  readonly capacity: number;
  cap: number;
  private readonly dummy = new THREE.Object3D();
  private readonly lifeColor = new THREE.Color();

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
      seed: 0,
    }));
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate instanceColor up front (life/seed channel) so the program never recompiles.
    for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, this.lifeColor.setRGB(0, 0, 0));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
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
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(written, this.dummy.matrix);
      // Per-instance life + stable seed drive fade and noise in the shader.
      this.lifeColor.setRGB(life, slot.seed, 0);
      this.mesh.setColorAt(written, this.lifeColor);
      written += 1;
    }
    this.mesh.count = written;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    disposeMaterial(this.mesh.material as THREE.Material);
  }
}

function spawnInto(
  layer: InstancedLayer,
  init: Omit<Slot, 'alive' | 'age' | 'seed'> & { age?: number; seed?: number },
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
  // Golden-ratio hash of the slot position: stable, no RNG draw (keeps seeded sequences intact).
  slot.seed = init.seed ?? (((init.x * 0.618 + init.z * 0.382) % 1) + 1) % 1;
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
    // Unit quads; size comes from the instance scale (see PARTICLE_VERTEX).
    this.spray = new InstancedLayer(
      new THREE.PlaneGeometry(1.1, 1.1),
      createLayerMaterial(0xf2fbff, 0.7, 'spray'),
      max.sprayCap,
      'surface-spray',
    );
    // Rings lie flat on the sea in the shader; no mesh rotation (that used to lift
    // every splash to y = z).
    this.splash = new InstancedLayer(
      new THREE.PlaneGeometry(1.6, 1.6),
      createLayerMaterial(0xe8f8ff, 0.75, 'ring'),
      max.splashCap,
      'surface-splash',
    );
    this.bubbles = new InstancedLayer(
      new THREE.PlaneGeometry(0.26, 0.26),
      createLayerMaterial(0xb8e8f0, 0.55, 'bubble'),
      max.bubbleCap,
      'underwater-bubbles',
    );
    this.particulate = new InstancedLayer(
      new THREE.PlaneGeometry(0.1, 0.1),
      createLayerMaterial(0x8ab8bc, 0.35, 'mote'),
      max.particulateCap,
      'underwater-particulate',
    );
    this.layers = [this.spray, this.splash, this.bubbles, this.particulate];
    for (const layer of this.layers) this.group.add(layer.mesh);
    this.applyQualityCaps();
  }

  setQuality(quality: QualityName): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.applyQualityCaps();
  }

  /** Light particles with the same sun/sky as the sea (warm spray at golden hour). */
  setLighting(lighting: ParticleLighting): void {
    for (const layer of this.layers) {
      const u = (layer.mesh.material as THREE.ShaderMaterial).uniforms;
      (u.uSunColor!.value as THREE.Color).copy(lighting.sunColor);
      (u.uSkyColor!.value as THREE.Color).copy(lighting.skyColor);
      (u.uSunDir!.value as THREE.Vector3).copy(lighting.sunDir);
    }
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
      // Bow spray: a moving hull throws water off both shoulders; more when the
      // sea is up and she is driving into it.
      if (wake.speed > 2.4) {
        const fx = Math.cos(wake.heading);
        const fz = Math.sin(wake.heading);
        const bow = stern * 0.92;
        const throwRate = Math.min(1, (wake.speed - 2.4) / 6) * (0.55 + (frame.seaState ?? 0.3));
        if (this.rng() < throwRate) {
          const side = this.rng() < 0.5 ? -1 : 1;
          const out = 0.9 + this.rng() * 1.4;
          spawnInto(this.spray, {
            x: wake.x + fx * bow - fz * side * 0.8,
            y: SURFACE_SPLASH_Y + 0.25,
            z: wake.z + fz * bow + fx * side * 0.8,
            vx: fx * wake.speed * 0.35 - fz * side * out,
            vy: 1.6 + this.rng() * 1.6 * storm,
            vz: fz * wake.speed * 0.35 + fx * side * out,
            ttl: 0.6 + this.rng() * 0.35,
            scale: 0.5 + Math.min(0.8, wake.speed * 0.06),
          });
        }
      }
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
