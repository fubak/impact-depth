/**
 * Persistent world-space wake foam (Plan 021).
 *
 * A ping-ponged half-float field, world-locked around the follow point. Each
 * presentation frame it (1) advects/decays/diffuses the previous field, then
 * (2) additively stamps every moving surface hull: bow-wave lips that hug the
 * hull, Kelvin arms at ±19.47°, and a turbulent centre-line behind the stern.
 * The ocean shader samples it for foam, aerated colour and normal breakup.
 *
 * Presentation-only: never reads or writes GameState / gameplay RNG.
 *   R = surface foam density, G = aerated/turbulent water, B = fresh-stamp energy.
 */

import * as THREE from 'three';
import type { QualityName } from '../quality';
import { createFloatTarget, disposeTarget, SimulationPass, withRendererPass } from './resources';

export interface WakeFoamBody {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  /** Metres per second (presentation units). */
  readonly speed: number;
  /** Hull length in metres. */
  readonly length: number;
  /** Hull beam in metres. */
  readonly beam: number;
  /** Metres positive-down; deep bodies do not foam the surface. */
  readonly depth?: number;
}

export interface WakeFoamSplash {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly strength: number;
}

export interface WakeFoamFrame {
  readonly dt: number;
  readonly time: number;
  readonly paused?: boolean;
  readonly followX: number;
  readonly followZ: number;
  readonly bodies: readonly WakeFoamBody[];
}

/** Metres covered by the field. Big enough that a full-speed wake trails ~20 s. */
export const WAKE_FOAM_EXTENT_M = 300;
export const WAKE_FOAM_MAX_BODIES = 12;
/** Bodies deeper than this leave no surface foam (matches surface-effects wake rule). */
export const WAKE_FOAM_DEPTH_LIMIT_M = 2.5;
/** Kelvin half-angle (deep-water, any speed): asin(1/3). */
export const KELVIN_HALF_ANGLE = Math.asin(1 / 3);

export function wakeFoamResolution(quality: QualityName): number {
  if (quality === 'high') return 768;
  if (quality === 'medium') return 512;
  return 320;
}

/** Snap the field origin to whole texels so the foam never swims as the follow point moves. */
export function snapWakeOrigin(
  followX: number,
  followZ: number,
  extent: number,
  resolution: number,
): { x: number; z: number } {
  const texel = extent / Math.max(1, resolution);
  return {
    x: Math.round((followX - extent / 2) / texel) * texel,
    z: Math.round((followZ - extent / 2) / texel) * texel,
  };
}

/** 0 below the planing threshold, ~1 at flank. Pure so tests can pin it. */
export function wakeIntensity(speed: number, depth = 0): number {
  if (!Number.isFinite(speed) || depth >= WAKE_FOAM_DEPTH_LIMIT_M) return 0;
  const surface = 1 - Math.max(0, depth) / WAKE_FOAM_DEPTH_LIMIT_M;
  const s = Math.max(0, Math.min(1, (speed - 0.45) / 7.5));
  return Math.sqrt(s) * surface;
}

const DECAY_FRAGMENT = /* glsl */ `
uniform sampler2D uPrevious;
uniform vec2 uShift;
uniform vec2 uTexel;
uniform float uDt;
uniform float uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 src = uv + uShift;
  vec4 c = texture2D(uPrevious, src);
  // Gentle diffusion: foam spreads and softens as it ages.
  vec4 n = texture2D(uPrevious, src + vec2(uTexel.x, 0.0))
         + texture2D(uPrevious, src - vec2(uTexel.x, 0.0))
         + texture2D(uPrevious, src + vec2(0.0, uTexel.y))
         + texture2D(uPrevious, src - vec2(0.0, uTexel.y));
  float spread = clamp(uDt * 1.6, 0.0, 0.45);
  c = mix(c, n * 0.25, spread);
  // Outside the previous window there is no history.
  float inside = step(0.0, src.x) * step(src.x, 1.0) * step(0.0, src.y) * step(src.y, 1.0);
  // Foam lingers; aeration fades faster; fresh energy is a short pulse.
  vec3 tau = vec3(9.0, 5.5, 0.6);
  // Break-up: older foam erodes into lace instead of fading uniformly.
  float lace = hash(floor(gl_FragCoord.xy * 0.5) + floor(uTime * 0.5));
  vec3 decay = exp(-uDt / tau) - vec3(uDt * 0.05 * lace, 0.0, 0.0);
  gl_FragColor = vec4(clamp(c.rgb * decay, 0.0, 1.5) * inside, 1.0);
}
`;

const STAMP_VERTEX = /* glsl */ `
attribute vec4 aBody;   // x, z, heading, intensity
attribute vec2 aSize;   // length, beam
uniform vec2 uOrigin;
uniform float uExtent;
varying vec2 vLocal;    // metres: x forward from hull centre, y starboard
varying vec2 vWorld;
varying float vIntensity;
varying vec2 vSize;
void main() {
  float len = aSize.x;
  float beam = aSize.y;
  // Quad spans bow+2m to well behind the stern; lateral span covers the Kelvin arms.
  float aft = len * 2.4 + 10.0;
  float fwd = len * 0.5 + 2.5;
  float halfWidth = beam * 0.6 + (fwd + aft) * 0.36 + 2.0;
  vec2 local = vec2(mix(-aft, fwd, position.x * 0.5 + 0.5), position.y * halfWidth);
  float c = cos(aBody.z);
  float s = sin(aBody.z);
  // Sim heading: forward = (cos h, sin h); starboard (right) = (-sin h, cos h).
  vec2 world = aBody.xy + vec2(c, s) * local.x + vec2(-s, c) * local.y;
  vLocal = local;
  vWorld = world;
  vIntensity = aBody.w;
  vSize = aSize;
  vec2 uv = (world - uOrigin) / uExtent;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const STAMP_FRAGMENT = /* glsl */ `
uniform float uDt;
uniform float uTime;
varying vec2 vLocal;
varying vec2 vWorld;
varying float vIntensity;
varying vec2 vSize;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.07 + 13.1; a *= 0.5; }
  return v;
}
void main() {
  float len = vSize.x;
  float halfBeam = vSize.y * 0.5;
  float u = vLocal.x;           // + forward
  float v = abs(vLocal.y);      // lateral distance from keel line
  float bow = len * 0.5;
  float stern = -len * 0.5;
  float churn = fbm(vWorld * 0.55 + vec2(uTime * 0.7, -uTime * 0.45));
  float lace = fbm(vWorld * 1.6 - uTime * 0.3);

  // Hull outline (pointed bow, full stern) and the lip of water pushed up against it.
  float along = clamp((u - stern) / max(len, 0.1), 0.0, 1.0);
  float hullHalf = halfBeam * mix(0.85, 1.0, smoothstep(0.0, 0.3, along)) * (1.0 - smoothstep(0.7, 1.0, along) * 0.85);
  float inHull = step(stern, u) * step(u, bow);
  // Strongest at the shoulders, torn by noise so the hull never gets a solid white outline.
  float lip = exp(-pow((v - hullHalf - 0.5) / 0.9, 2.0)) * inHull * smoothstep(0.35, 1.0, along);
  lip *= smoothstep(0.3, 0.7, lace) * 0.8;
  // Bow cushion: the bow wave peels off the stem.
  float bowCushion = exp(-pow((u - bow) / 1.1, 2.0)) * exp(-pow(v / (halfBeam + 0.6), 2.0)) * smoothstep(0.25, 0.6, lace);

  // Kelvin arms from the bow shoulders, fading with distance aft.
  float behind = max(0.0, bow - u);
  float armOffset = halfBeam * 0.8 + behind * 0.3535;  // tan(19.47°)
  float armWidth = 0.45 + behind * 0.03;
  float arm = exp(-pow((v - armOffset) / armWidth, 2.0)) * step(u, bow);
  arm *= exp(-behind / (len * 1.6 + 6.0)) * smoothstep(0.2, 0.75, lace);
  // Secondary transverse ripples inside the V read as faint cusp lines.
  float cusp = exp(-pow((v - armOffset * 0.72) / (armWidth * 0.8), 2.0)) * step(u, bow) * 0.35;
  cusp *= exp(-behind / (len + 4.0)) * smoothstep(0.45, 0.8, lace);

  // Propeller / stern turbulence: wide churned centre-line.
  float aftOfStern = max(0.0, stern + 0.5 - u);
  float trailWidth = halfBeam * 0.75 + aftOfStern * 0.04;
  float trail = exp(-pow(vLocal.y / trailWidth, 2.0)) * step(u, stern + 0.5);
  trail *= smoothstep(0.15, 0.65, churn) * (1.0 - exp(-aftOfStern * 0.8 - 0.4));

  float foam = (lip * 0.6 + bowCushion * 0.8 + arm * 0.95 + cusp + trail * 0.8);
  float aerated = trail * 1.6 + bowCushion * 0.8 + lip * 0.5 + arm * 0.2;
  float fresh = bowCushion * 0.6 + lip * 0.5 + trail * 0.5;
  // Frame-rate independent deposition.
  float rate = vIntensity * clamp(uDt * 7.0, 0.0, 0.6);
  gl_FragColor = vec4(foam * rate, aerated * rate, fresh * rate, 1.0);
}
`;

const SPLASH_FRAGMENT = /* glsl */ `
uniform vec3 uSplash; // x, z, radius
uniform float uStrength;
uniform float uTime;
varying vec2 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float d = length(vWorld - uSplash.xy) / max(uSplash.z, 0.1);
  float ring = exp(-pow((d - 0.75) / 0.25, 2.0)) + exp(-d * d * 3.0) * 0.8;
  float n = hash(floor(vWorld * 2.0) + floor(uTime * 3.0));
  float foam = ring * uStrength * mix(0.6, 1.0, n);
  gl_FragColor = vec4(foam, foam * 1.3, foam, 1.0);
}
`;

const SPLASH_VERTEX = /* glsl */ `
uniform vec2 uOrigin;
uniform float uExtent;
uniform vec3 uSplash;
varying vec2 vWorld;
void main() {
  vec2 world = uSplash.xy + position.xy * uSplash.z * 1.4;
  vWorld = world;
  vec2 uv = (world - uOrigin) / uExtent;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
`;

function additiveMaterial(params: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...params,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

export class WakeFoamField {
  readonly extent: number;
  private resolution: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private index = 0;
  private readonly origin = new THREE.Vector2(Number.NaN, Number.NaN);
  /** Origin the *current* texture was written with (what the ocean must sample with). */
  private readonly boundOrigin = new THREE.Vector2(0, 0);
  private readonly pass = new SimulationPass();
  private readonly decay: THREE.ShaderMaterial;
  private readonly stampScene = new THREE.Scene();
  private readonly stampCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly stampGeometry: THREE.InstancedBufferGeometry;
  private readonly bodyAttr: THREE.InstancedBufferAttribute;
  private readonly sizeAttr: THREE.InstancedBufferAttribute;
  private readonly stampMaterial: THREE.ShaderMaterial;
  private readonly stampMesh: THREE.Mesh;
  private readonly splashMaterial: THREE.ShaderMaterial;
  private readonly splashMesh: THREE.Mesh;
  private readonly pendingSplashes: WakeFoamSplash[] = [];
  private needsClear = true;
  private disposed = false;
  private stamped = 0;

  constructor(quality: QualityName = 'high', extent = WAKE_FOAM_EXTENT_M) {
    this.extent = extent;
    this.resolution = wakeFoamResolution(quality);
    this.targets = [this.createTarget(), this.createTarget()];
    this.decay = new THREE.ShaderMaterial({
      uniforms: {
        uPrevious: { value: this.targets[0].texture },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: new THREE.Vector2(1 / this.resolution, 1 / this.resolution) },
        uDt: { value: 1 / 60 },
        uTime: { value: 0 },
      },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: DECAY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.stampGeometry = new THREE.InstancedBufferGeometry();
    this.stampGeometry.index = quad.index;
    this.stampGeometry.setAttribute('position', quad.getAttribute('position'));
    this.bodyAttr = new THREE.InstancedBufferAttribute(new Float32Array(WAKE_FOAM_MAX_BODIES * 4), 4);
    this.sizeAttr = new THREE.InstancedBufferAttribute(new Float32Array(WAKE_FOAM_MAX_BODIES * 2), 2);
    this.bodyAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.stampGeometry.setAttribute('aBody', this.bodyAttr);
    this.stampGeometry.setAttribute('aSize', this.sizeAttr);
    this.stampGeometry.instanceCount = 0;
    this.stampMaterial = additiveMaterial({
      uniforms: {
        uOrigin: { value: new THREE.Vector2() },
        uExtent: { value: extent },
        uDt: { value: 1 / 60 },
        uTime: { value: 0 },
      },
      vertexShader: STAMP_VERTEX,
      fragmentShader: STAMP_FRAGMENT,
    });
    this.stampMesh = new THREE.Mesh(this.stampGeometry, this.stampMaterial);
    this.stampMesh.frustumCulled = false;
    this.stampScene.add(this.stampMesh);

    this.splashMaterial = additiveMaterial({
      uniforms: {
        uOrigin: { value: new THREE.Vector2() },
        uExtent: { value: extent },
        uSplash: { value: new THREE.Vector3() },
        uStrength: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: SPLASH_VERTEX,
      fragmentShader: SPLASH_FRAGMENT,
    });
    this.splashMesh = new THREE.Mesh(quad, this.splashMaterial);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.visible = false;
    this.stampScene.add(this.splashMesh);
  }

  get texture(): THREE.Texture {
    return this.targets[this.index].texture;
  }

  /** World xz of the bound texture's uv (0, 0). */
  get textureOrigin(): THREE.Vector2 {
    return this.boundOrigin;
  }

  get stampedBodies(): number {
    return this.stamped;
  }

  setQuality(quality: QualityName): void {
    const next = wakeFoamResolution(quality);
    if (next === this.resolution || this.disposed) return;
    this.resolution = next;
    const old = this.targets;
    this.targets = [this.createTarget(), this.createTarget()];
    disposeTarget(old[0]);
    disposeTarget(old[1]);
    this.index = 0;
    this.origin.set(Number.NaN, Number.NaN);
    (this.decay.uniforms.uTexel!.value as THREE.Vector2).set(1 / next, 1 / next);
    this.needsClear = true;
  }

  /** Queue a circular foam burst (torpedo hit, sinking, depth charge). */
  splash(event: WakeFoamSplash): void {
    if (this.pendingSplashes.length >= 16) this.pendingSplashes.shift();
    this.pendingSplashes.push(event);
  }

  reset(): void {
    this.pendingSplashes.length = 0;
    this.origin.set(Number.NaN, Number.NaN);
    this.needsClear = true;
  }

  update(renderer: THREE.WebGLRenderer, frame: WakeFoamFrame): void {
    if (this.disposed) return;
    const snapped = snapWakeOrigin(frame.followX, frame.followZ, this.extent, this.resolution);
    const first = !Number.isFinite(this.origin.x);
    const shiftX = first ? 0 : (snapped.x - this.origin.x) / this.extent;
    const shiftZ = first ? 0 : (snapped.z - this.origin.y) / this.extent;
    const dt = frame.paused ? 0 : Math.max(0, Math.min(0.1, frame.dt));
    if (dt === 0 && shiftX === 0 && shiftZ === 0 && !this.needsClear && this.pendingSplashes.length === 0) {
      return;
    }
    this.origin.set(snapped.x, snapped.z);

    let count = 0;
    for (const body of frame.bodies) {
      if (count >= WAKE_FOAM_MAX_BODIES) break;
      const intensity = wakeIntensity(body.speed, body.depth ?? 0);
      if (intensity <= 0.001) continue;
      this.bodyAttr.setXYZW(count, body.x, body.z, body.heading, intensity);
      this.sizeAttr.setXY(count, Math.max(2, body.length), Math.max(0.8, body.beam));
      count += 1;
    }
    this.stamped = count;
    this.stampGeometry.instanceCount = count;
    this.bodyAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;

    withRendererPass(renderer, () => {
      renderer.autoClear = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.shadowMap.autoUpdate = false;
      const read = this.targets[this.index];
      const write = this.targets[1 - this.index];
      if (this.needsClear) {
        renderer.setClearColor(0x000000, 0);
        for (const target of this.targets) {
          renderer.setRenderTarget(target);
          renderer.clear(true, false, false);
        }
        this.needsClear = false;
      }
      const u = this.decay.uniforms;
      u.uPrevious!.value = read.texture;
      (u.uShift!.value as THREE.Vector2).set(shiftX, shiftZ);
      u.uDt!.value = dt;
      u.uTime!.value = frame.time;
      this.pass.run(renderer, this.decay, write);

      if (dt > 0 || this.pendingSplashes.length > 0) {
        renderer.setRenderTarget(write);
        const su = this.stampMaterial.uniforms;
        (su.uOrigin!.value as THREE.Vector2).set(snapped.x, snapped.z);
        su.uDt!.value = dt;
        su.uTime!.value = frame.time;
        this.stampMesh.visible = count > 0 && dt > 0;
        this.splashMesh.visible = false;
        if (this.stampMesh.visible) renderer.render(this.stampScene, this.stampCamera);
        if (this.pendingSplashes.length > 0) {
          this.stampMesh.visible = false;
          this.splashMesh.visible = true;
          const pu = this.splashMaterial.uniforms;
          (pu.uOrigin!.value as THREE.Vector2).set(snapped.x, snapped.z);
          pu.uTime!.value = frame.time;
          for (const splash of this.pendingSplashes) {
            (pu.uSplash!.value as THREE.Vector3).set(splash.x, splash.z, splash.radius);
            pu.uStrength!.value = splash.strength;
            renderer.render(this.stampScene, this.stampCamera);
          }
          this.pendingSplashes.length = 0;
          this.splashMesh.visible = false;
          this.stampMesh.visible = true;
        }
      }
      this.index = 1 - this.index;
      this.boundOrigin.set(snapped.x, snapped.z);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeTarget(this.targets[0]);
    disposeTarget(this.targets[1]);
    this.decay.dispose();
    this.stampMaterial.dispose();
    this.splashMaterial.dispose();
    this.stampGeometry.dispose();
    this.pass.dispose();
  }

  private createTarget(): THREE.WebGLRenderTarget {
    const target = createFloatTarget({
      width: this.resolution,
      height: this.resolution,
      wrap: THREE.ClampToEdgeWrapping,
    });
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    return target;
  }
}
