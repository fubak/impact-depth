/** Refracted-ray caustic projection for submerged receivers (Plan 018 Phase E).
 *
 * Wide and detail targets store concentration from the surface-to-bed ray mapping,
 * not unrelated noise. Presentation-only — never writes gameplay state.
 */

import * as THREE from 'three';
import type { QualityName } from '../quality';
import { createDummyBedDataTexture } from '../environment/bed-data-texture';
import {
  createFloatTarget,
  disposeMaterial,
  disposeTarget,
  disposeTexture,
  resizeTarget,
  SimulationPass,
  simulationMaterial,
  withRendererPass,
} from './resources';
import { PASS_VERTEX_GLSL, SPECTRUM_SAMPLE_GLSL } from './spectrum';
import { SURFACE_GLSL } from './surface';

export const WATER_IOR = 1.333;
export const CAUSTIC_HOOK_CACHE_KEY = 'silent-depths-caustics-v1';

export type CausticReceiverRole = 'seabed' | 'rock' | 'hull' | 'weapon';

export const CAUSTICS_PROFILES = {
  high: { wide: 256, detail: 256, interval: 2, wideExtent: 220, detailExtent: 72 },
  medium: { wide: 160, detail: 160, interval: 3, wideExtent: 180, detailExtent: 56 },
  low: { wide: 96, detail: 96, interval: 4, wideExtent: 140, detailExtent: 40 },
} as const;

export type CausticsProfile = (typeof CAUSTICS_PROFILES)[QualityName];

export interface CausticSurfaceMaps {
  readonly displacements: readonly THREE.Texture[];
  readonly slopes: readonly THREE.Texture[];
  readonly lengths: readonly number[];
  readonly sizes?: readonly number[];
}

export interface CausticBedBind {
  readonly texture: THREE.Texture;
  readonly origin: THREE.Vector2;
  readonly extent: number;
}

export interface CausticFrame {
  readonly time: number;
  readonly dt: number;
  readonly paused?: boolean;
  readonly followX: number;
  readonly followZ: number;
  readonly sunDir: { x: number; y: number; z: number };
  readonly waveHeight: number;
  readonly seaState?: number;
  readonly night?: boolean;
  readonly storm?: number;
  readonly surfaceCover?: number;
  readonly wetBand?: number;
  readonly maps?: CausticSurfaceMaps | null;
  readonly bed?: CausticBedBind | null;
  readonly coastal?: THREE.Texture | null;
  readonly swellDirection?: { x: number; z: number };
}

export interface CausticReceiverUniforms {
  uCausticWide: { value: THREE.Texture };
  uCausticDetail: { value: THREE.Texture };
  uCausticWideOrigin: { value: THREE.Vector2 };
  uCausticWideExtent: { value: number };
  uCausticDetailOrigin: { value: THREE.Vector2 };
  uCausticDetailExtent: { value: number };
  uCausticStrength: { value: number };
  uCausticEnabled: { value: number };
  uCausticRoleGain: { value: number };
}

export interface CausticDiagnostics {
  readonly ready: boolean;
  readonly quality: QualityName;
  readonly wideWidth: number;
  readonly wideHeight: number;
  readonly detailWidth: number;
  readonly detailHeight: number;
  readonly passCount: number;
  readonly historyTime: number;
  readonly strength: number;
  readonly followX: number;
  readonly followZ: number;
  readonly missionGeneration: number;
  readonly estimatedBytes: number;
}

export interface CausticAttenuationInput {
  readonly depthMetres: number;
  readonly surfaceCover: number;
  readonly storm: number;
  readonly night: number;
}

type HookBag = {
  previousCompile?: THREE.Material['onBeforeCompile'];
  previousCacheKey?: () => string;
  role: CausticReceiverRole;
};

const ROLE_GAIN: Record<CausticReceiverRole, number> = {
  seabed: 1,
  rock: 0.85,
  hull: 0.55,
  weapon: 0.4,
};

const ETA = 1 / WATER_IOR;

export function causticsProfileFor(quality: QualityName): CausticsProfile {
  switch (quality) {
    case 'high':
      return CAUSTICS_PROFILES.high;
    case 'medium':
      return CAUSTICS_PROFILES.medium;
    case 'low':
      return CAUSTICS_PROFILES.low;
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

export function receiverRoleGain(role: CausticReceiverRole): number {
  switch (role) {
    case 'seabed':
    case 'rock':
    case 'hull':
    case 'weapon':
      return ROLE_GAIN[role];
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/** Snap follow so orbiting cameras do not shimmer the projected field. */
export function quantizeFollowRegion(
  followX: number,
  followZ: number,
  cellMetres: number,
): { x: number; z: number } {
  const cell = Math.max(0.25, cellMetres);
  return {
    x: Math.round(followX / cell) * cell,
    z: Math.round(followZ / cell) * cell,
  };
}

export function causticAttenuation(input: CausticAttenuationInput): number {
  const depth = Math.max(0, input.depthMetres);
  const beer = Math.exp(-depth * 0.055);
  const cover = 1 - THREE.MathUtils.clamp(input.surfaceCover, 0, 1) * 0.72;
  const storm = 1 - THREE.MathUtils.clamp(input.storm, 0, 1) * 0.55;
  const night = 1 - THREE.MathUtils.clamp(input.night, 0, 1);
  return THREE.MathUtils.clamp(beer * cover * storm * night, 0, 1);
}

/** Match GLSL `refract` so CPU tests share the projection contract. */
export function refractGlsl(
  incident: THREE.Vector3,
  normal: THREE.Vector3,
  eta: number,
): THREE.Vector3 | null {
  const I = incident.clone().normalize();
  const N = normal.clone().normalize();
  const dotNI = N.dot(I);
  const k = 1 - eta * eta * (1 - dotNI * dotNI);
  if (k < 0) return null;
  return I.multiplyScalar(eta).sub(N.multiplyScalar(eta * dotNI + Math.sqrt(k)));
}

export function projectSunRayToBed(input: {
  surface: THREE.Vector3;
  normal: THREE.Vector3;
  sunDir: THREE.Vector3;
  bedY: number;
  ior?: number;
}): THREE.Vector2 | null {
  const eta = 1 / (input.ior ?? WATER_IOR);
  const incident = input.sunDir.clone().normalize().negate();
  const refracted = refractGlsl(incident, input.normal, eta);
  if (!refracted || refracted.y >= -1e-5) return null;
  const t = (input.bedY - input.surface.y) / refracted.y;
  if (t < 0) return null;
  return new THREE.Vector2(
    input.surface.x + refracted.x * t,
    input.surface.z + refracted.z * t,
  );
}

/** Concentration from source/projected area. Zero when rays miss or TIR. */
export function rayAreaConcentration(
  sourceArea: number,
  projectedArea: number,
  max = 12,
): number {
  if (sourceArea <= 0 || projectedArea <= 1e-8) return 0;
  return Math.min(max, sourceArea / projectedArea);
}

export function followCellMetres(quality: QualityName, kind: 'wide' | 'detail'): number {
  const profile = causticsProfileFor(quality);
  const extent = kind === 'wide' ? profile.wideExtent : profile.detailExtent;
  const res = kind === 'wide' ? profile.wide : profile.detail;
  return Math.max(0.5, extent / Math.max(8, res / 8));
}

function createZeroWaveTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array([0, 0, 0, 1]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function configureCausticTarget(target: THREE.WebGLRenderTarget): void {
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.wrapS = THREE.ClampToEdgeWrapping;
  target.texture.wrapT = THREE.ClampToEdgeWrapping;
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
}

export const CAUSTIC_PROJECT_GLSL = /* glsl */ `
uniform vec2 uOrigin;
uniform float uExtent;
uniform float uSize;
uniform vec3 uSunDir;
uniform float uGain;
uniform float uCover;
uniform float uStorm;
uniform float uNight;
uniform float uIor;
uniform sampler2D uBedTex;
uniform vec2 uBedOrigin;
uniform float uBedExtent;
uniform float uWetBand;
uniform float uWaveHeight;
uniform float uCoastalEnabled;
uniform vec2 uCoastalOrigin;
uniform float uCoastalExtent;
uniform vec2 uSwellDirection;
uniform sampler2D uCoastal;
${SPECTRUM_SAMPLE_GLSL}
${SURFACE_GLSL}
vec2 projectRay(vec2 p) {
  vec3 disp = oceanDisplacement(p);
  vec3 P = vec3(p.x + disp.x, disp.y, p.y + disp.z);
  vec3 N = oceanNormal(p);
  vec3 I = -normalize(uSunDir);
  vec3 R = refract(I, N, uIor);
  if (dot(R, R) < 1e-6) return P.xz;
  float bed = texture2D(uBedTex, clamp((p - uBedOrigin) / max(uBedExtent, 1.0), 0.0, 1.0)).r;
  if (R.y >= -1e-5) return P.xz;
  float t = (bed - P.y) / R.y;
  if (t < 0.0) return P.xz;
  return (P + R * t).xz;
}
float concentration(vec2 p, float e) {
  vec2 h = projectRay(p);
  vec2 hx = projectRay(p + vec2(e, 0.0));
  vec2 hz = projectRay(p + vec2(0.0, e));
  vec2 dx = hx - h;
  vec2 dz = hz - h;
  float area = abs(dx.x * dz.y - dx.y * dz.x);
  return clamp((e * e) / max(area, 1e-5), 0.0, 12.0);
}
void main() {
  vec2 uv = gl_FragCoord.xy / max(uSize, 1.0);
  vec2 world = uOrigin + (uv - 0.5) * uExtent;
  vec2 guess = world;
  for (int i = 0; i < 3; i++) guess += world - projectRay(guess);
  float e = uExtent / 96.0;
  float energy = concentration(guess, e);
  float bed = texture2D(uBedTex, clamp((world - uBedOrigin) / max(uBedExtent, 1.0), 0.0, 1.0)).r;
  float column = max(0.0, -bed);
  float beer = exp(-column * 0.055);
  float sunH = smoothstep(0.04, 0.22, normalize(uSunDir).y);
  float edge = smoothstep(0.0, 0.08, uv.x) * smoothstep(0.0, 0.08, uv.y)
    * smoothstep(0.0, 0.08, 1.0 - uv.x) * smoothstep(0.0, 0.08, 1.0 - uv.y);
  float atten = beer * (1.0 - clamp(uCover, 0.0, 1.0) * 0.72)
    * (1.0 - clamp(uStorm, 0.0, 1.0) * 0.55) * (1.0 - clamp(uNight, 0.0, 1.0)) * sunH;
  float coverMask = 1.0 - smoothstep(-uWetBand, uWetBand, bed);
  gl_FragColor = vec4(vec3(energy * atten * coverMask * uGain * edge), 1.0);
}
`;

export const CAUSTIC_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uCausticWide;
uniform sampler2D uCausticDetail;
uniform vec2 uCausticWideOrigin;
uniform float uCausticWideExtent;
uniform vec2 uCausticDetailOrigin;
uniform float uCausticDetailExtent;
uniform float uCausticStrength;
uniform float uCausticEnabled;
uniform float uCausticRoleGain;
vec2 causticUv(vec2 world, vec2 origin, float extent) {
  return clamp((world - origin) / max(extent, 1.0) + 0.5, 0.0, 1.0);
}
vec3 sampleProjectedCaustics(vec3 world) {
  if (uCausticEnabled < 0.5) return vec3(0.0);
  float wide = texture2D(uCausticWide, causticUv(world.xz, uCausticWideOrigin, uCausticWideExtent)).r;
  float detail = texture2D(uCausticDetail, causticUv(world.xz, uCausticDetailOrigin, uCausticDetailExtent)).r;
  float energy = wide * 0.62 + detail * 0.55;
  return vec3(0.72, 0.92, 1.0) * energy * uCausticStrength * uCausticRoleGain;
}
`;

function injectCausticShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vCausticWorld;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         vec4 causticWorld = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
         causticWorld = instanceMatrix * causticWorld;
         #endif
         vCausticWorld = (modelMatrix * causticWorld).xyz;
       }`,
    );
  if (!shader.fragmentShader.includes('#include <common>')) return;
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vCausticWorld;\n${CAUSTIC_SAMPLE_GLSL}`,
    )
    .replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
       reflectedLight.directDiffuse += diffuseColor.rgb * sampleProjectedCaustics(vCausticWorld);`,
    );
}

export function createCausticReceiverUniforms(
  wide: THREE.Texture,
  detail: THREE.Texture,
): CausticReceiverUniforms {
  return {
    uCausticWide: { value: wide },
    uCausticDetail: { value: detail },
    uCausticWideOrigin: { value: new THREE.Vector2() },
    uCausticWideExtent: { value: CAUSTICS_PROFILES.high.wideExtent },
    uCausticDetailOrigin: { value: new THREE.Vector2() },
    uCausticDetailExtent: { value: CAUSTICS_PROFILES.high.detailExtent },
    uCausticStrength: { value: 0 },
    uCausticEnabled: { value: 0 },
    uCausticRoleGain: { value: 1 },
  };
}

export function applyCausticReceiverUniforms(
  uniforms: THREE.ShaderMaterial['uniforms'],
  caustics: Pick<UnderwaterCaustics, 'receiverUniforms'> | null,
): void {
  if (!caustics) {
    if (uniforms.uCausticEnabled) uniforms.uCausticEnabled.value = 0;
    return;
  }
  const src = caustics.receiverUniforms;
  for (const key of Object.keys(src) as (keyof CausticReceiverUniforms)[]) {
    if (uniforms[key]) uniforms[key].value = src[key].value;
    else uniforms[key] = src[key];
  }
}

function isStandardLike(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  return (
    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
  );
}

/** Compose caustic lighting onto an existing PBR material without replacing hooks. */
export function attachCausticLighting(
  material: THREE.Material,
  uniforms: CausticReceiverUniforms,
  role: CausticReceiverRole = 'seabed',
): void {
  if (!isStandardLike(material)) return;
  const existing = material.userData.silentDepthsCaustics as HookBag | undefined;
  if (existing) {
    existing.role = role;
    return;
  }
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey
    ? material.customProgramCacheKey.bind(material)
    : () => '';
  const bag: HookBag = { previousCompile, previousCacheKey, role };
  material.userData.silentDepthsCaustics = bag;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    Object.assign(shader.uniforms, {
      uCausticWide: uniforms.uCausticWide,
      uCausticDetail: uniforms.uCausticDetail,
      uCausticWideOrigin: uniforms.uCausticWideOrigin,
      uCausticWideExtent: uniforms.uCausticWideExtent,
      uCausticDetailOrigin: uniforms.uCausticDetailOrigin,
      uCausticDetailExtent: uniforms.uCausticDetailExtent,
      uCausticStrength: uniforms.uCausticStrength,
      uCausticEnabled: uniforms.uCausticEnabled,
      uCausticRoleGain: { value: receiverRoleGain(bag.role) },
    });
    injectCausticShader(shader);
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${CAUSTIC_HOOK_CACHE_KEY}`;
  material.needsUpdate = true;
}

export function detachCausticLighting(material: THREE.Material): void {
  const bag = material.userData.silentDepthsCaustics as HookBag | undefined;
  if (!bag) return;
  material.onBeforeCompile = bag.previousCompile ?? (() => undefined);
  material.customProgramCacheKey = bag.previousCacheKey ?? (() => '');
  delete material.userData.silentDepthsCaustics;
  material.needsUpdate = true;
}

export function attachCausticLightingToObject(
  object: THREE.Object3D,
  uniforms: CausticReceiverUniforms,
  role: CausticReceiverRole = 'seabed',
): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) attachCausticLighting(material, uniforms, role);
  });
}

export function detachCausticLightingFromObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) detachCausticLighting(material);
  });
}

/**
 * Owns quality-scaled wide/detail caustic targets. Call `update` after ocean
 * histories and before the main scene; never sample a target while rendering it.
 */
export class UnderwaterCaustics {
  readonly wide: THREE.WebGLRenderTarget;
  readonly detail: THREE.WebGLRenderTarget;
  readonly receiverUniforms: CausticReceiverUniforms;
  private readonly pass = new SimulationPass();
  private readonly material: THREE.ShaderMaterial;
  private readonly dummyWave: THREE.DataTexture;
  private readonly dummyBed: THREE.DataTexture;
  private readonly dummyCoastal: THREE.DataTexture;
  private quality: QualityName;
  private disposed = false;
  private dirty = true;
  private passCount = 0;
  private historyTime = 0;
  private frame = 0;
  private missionGeneration = 0;
  private strength = 0;
  private followX = 0;
  private followZ = 0;
  private enabled = true;

  constructor(quality: QualityName = 'high') {
    this.quality = quality;
    const profile = causticsProfileFor(quality);
    this.wide = createFloatTarget({
      width: profile.wide,
      height: profile.wide,
      wrap: THREE.ClampToEdgeWrapping,
    });
    this.detail = createFloatTarget({
      width: profile.detail,
      height: profile.detail,
      wrap: THREE.ClampToEdgeWrapping,
    });
    configureCausticTarget(this.wide);
    configureCausticTarget(this.detail);
    this.dummyWave = createZeroWaveTexture();
    this.dummyBed = createDummyBedDataTexture();
    this.dummyCoastal = createZeroWaveTexture();
    this.receiverUniforms = createCausticReceiverUniforms(this.wide.texture, this.detail.texture);
    this.receiverUniforms.uCausticWideExtent.value = profile.wideExtent;
    this.receiverUniforms.uCausticDetailExtent.value = profile.detailExtent;
    this.material = simulationMaterial(
      {
        uOrigin: { value: new THREE.Vector2() },
        uExtent: { value: profile.wideExtent },
        uSize: { value: profile.wide },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2) },
        uGain: { value: 1 },
        uCover: { value: 0 },
        uStorm: { value: 0 },
        uNight: { value: 0 },
        uIor: { value: ETA },
        uBedTex: { value: this.dummyBed },
        uBedOrigin: { value: new THREE.Vector2(-320, -320) },
        uBedExtent: { value: 640 },
        uWetBand: { value: 1.2 },
        uWaveHeight: { value: 0.55 },
        uCoastalEnabled: { value: 0 },
        uCoastalOrigin: { value: new THREE.Vector2(-320, -320) },
        uCoastalExtent: { value: 640 },
        uSwellDirection: { value: new THREE.Vector2(1, 0) },
        uCoastal: { value: this.dummyCoastal },
        uDisplacement0: { value: this.dummyWave },
        uDisplacement1: { value: this.dummyWave },
        uDisplacement2: { value: this.dummyWave },
        uSlope0: { value: this.dummyWave },
        uSlope1: { value: this.dummyWave },
        uSlope2: { value: this.dummyWave },
        uCascadeLength: { value: new THREE.Vector3(1792, 211, 27.3) },
        uCascadeSize: { value: new THREE.Vector3(128, 128, 128) },
      },
      CAUSTIC_PROJECT_GLSL,
      PASS_VERTEX_GLSL,
    );
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.receiverUniforms.uCausticEnabled.value = enabled ? 1 : 0;
  }

  setQuality(quality: QualityName): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.applyProfileSize();
    this.dirty = true;
  }

  /** Quality-driven target resize. Viewport DPR does not own these maps. */
  resize(_width?: number, _height?: number, _dpr?: number): void {
    this.applyProfileSize();
    this.dirty = true;
  }

  reset(missionGeneration = 0): void {
    this.missionGeneration = missionGeneration;
    this.frame = 0;
    this.historyTime = 0;
    this.passCount = 0;
    this.dirty = true;
    this.strength = 0;
    this.receiverUniforms.uCausticStrength.value = 0;
  }

  attachToMaterial(material: THREE.Material, role: CausticReceiverRole = 'seabed'): void {
    attachCausticLighting(material, this.receiverUniforms, role);
  }

  attachToObject(object: THREE.Object3D, role: CausticReceiverRole = 'seabed'): void {
    attachCausticLightingToObject(object, this.receiverUniforms, role);
  }

  /**
   * Advance due passes. Pause freezes history and skips GPU work. Missing maps
   * keep the module inert so Gerstner default stays unchanged.
   */
  update(renderer: THREE.WebGLRenderer | null, frame: CausticFrame): void {
    if (this.disposed) return;
    const storm =
      frame.storm ?? (frame.seaState !== undefined && frame.seaState >= 0.6 ? 1 : frame.seaState ?? 0);
    const night = frame.night === true || frame.sunDir.y < 0.06 ? 1 : 0;
    const cover = frame.surfaceCover ?? 0;
    this.strength = this.enabled
      ? causticAttenuation({ depthMetres: 0, surfaceCover: cover, storm, night })
      : 0;
    this.receiverUniforms.uCausticStrength.value = this.strength;
    this.receiverUniforms.uCausticEnabled.value = this.enabled && frame.maps ? 1 : 0;

    const wideCell = followCellMetres(this.quality, 'wide');
    const detailCell = followCellMetres(this.quality, 'detail');
    const wideFollow = quantizeFollowRegion(frame.followX, frame.followZ, wideCell);
    const detailFollow = quantizeFollowRegion(frame.followX, frame.followZ, detailCell);
    this.followX = detailFollow.x;
    this.followZ = detailFollow.z;
    const profile = causticsProfileFor(this.quality);
    this.receiverUniforms.uCausticWideOrigin.value.set(wideFollow.x, wideFollow.z);
    this.receiverUniforms.uCausticDetailOrigin.value.set(detailFollow.x, detailFollow.z);
    this.receiverUniforms.uCausticWideExtent.value = profile.wideExtent;
    this.receiverUniforms.uCausticDetailExtent.value = profile.detailExtent;

    this.bindSurface(frame);
    this.material.uniforms.uSunDir.value.set(frame.sunDir.x, frame.sunDir.y, frame.sunDir.z);
    this.material.uniforms.uWaveHeight.value = frame.waveHeight;
    this.material.uniforms.uCover.value = cover;
    this.material.uniforms.uStorm.value = storm;
    this.material.uniforms.uNight.value = night;
    this.material.uniforms.uGain.value = this.strength;
    if (frame.wetBand !== undefined) this.material.uniforms.uWetBand.value = frame.wetBand;

    if (frame.paused || !this.enabled) return;
    this.historyTime += Math.max(0, frame.dt);
    if (!renderer || !frame.maps) return;
    const due = this.dirty || this.frame % profile.interval === 0;
    this.frame += 1;
    if (!due) return;

    withRendererPass(renderer, () => {
      this.renderTarget(renderer, this.wide, wideFollow.x, wideFollow.z, profile.wideExtent);
      this.renderTarget(renderer, this.detail, detailFollow.x, detailFollow.z, profile.detailExtent);
    });
    this.passCount += 1;
    this.dirty = false;
  }

  getDiagnostics(): CausticDiagnostics {
    const wideBytes = this.wide.width * this.wide.height * 8;
    const detailBytes = this.detail.width * this.detail.height * 8;
    return {
      ready: !this.disposed,
      quality: this.quality,
      wideWidth: this.wide.width,
      wideHeight: this.wide.height,
      detailWidth: this.detail.width,
      detailHeight: this.detail.height,
      passCount: this.passCount,
      historyTime: this.historyTime,
      strength: this.strength,
      followX: this.followX,
      followZ: this.followZ,
      missionGeneration: this.missionGeneration,
      estimatedBytes: wideBytes + detailBytes,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.receiverUniforms.uCausticEnabled.value = 0;
    disposeMaterial(this.material);
    disposeTarget(this.wide);
    disposeTarget(this.detail);
    disposeTexture(this.dummyWave);
    disposeTexture(this.dummyBed);
    disposeTexture(this.dummyCoastal);
    this.pass.dispose();
  }

  private applyProfileSize(): void {
    const profile = causticsProfileFor(this.quality);
    resizeTarget(this.wide, profile.wide, profile.wide);
    resizeTarget(this.detail, profile.detail, profile.detail);
    configureCausticTarget(this.wide);
    configureCausticTarget(this.detail);
    this.receiverUniforms.uCausticWideExtent.value = profile.wideExtent;
    this.receiverUniforms.uCausticDetailExtent.value = profile.detailExtent;
  }

  private bindSurface(frame: CausticFrame): void {
    const u = this.material.uniforms;
    const maps = frame.maps;
    if (!maps || maps.displacements.length === 0) {
      u.uDisplacement0.value = this.dummyWave;
      u.uDisplacement1.value = this.dummyWave;
      u.uDisplacement2.value = this.dummyWave;
      u.uSlope0.value = this.dummyWave;
      u.uSlope1.value = this.dummyWave;
      u.uSlope2.value = this.dummyWave;
    } else {
      u.uDisplacement0.value = maps.displacements[0] ?? this.dummyWave;
      u.uDisplacement1.value = maps.displacements[1] ?? this.dummyWave;
      u.uDisplacement2.value = maps.displacements[2] ?? this.dummyWave;
      u.uSlope0.value = maps.slopes[0] ?? this.dummyWave;
      u.uSlope1.value = maps.slopes[1] ?? this.dummyWave;
      u.uSlope2.value = maps.slopes[2] ?? this.dummyWave;
      (u.uCascadeLength.value as THREE.Vector3).set(
        maps.lengths[0] ?? 1,
        maps.lengths[1] ?? maps.lengths[0] ?? 1,
        maps.lengths[2] ?? maps.lengths[0] ?? 1,
      );
      if (maps.sizes) {
        (u.uCascadeSize.value as THREE.Vector3).set(
          maps.sizes[0] ?? 1,
          maps.sizes[1] ?? maps.sizes[0] ?? 1,
          maps.sizes[2] ?? maps.sizes[0] ?? 1,
        );
      }
    }
    if (frame.bed) {
      u.uBedTex.value = frame.bed.texture;
      (u.uBedOrigin.value as THREE.Vector2).copy(frame.bed.origin);
      u.uBedExtent.value = frame.bed.extent;
    } else {
      u.uBedTex.value = this.dummyBed;
    }
    if (frame.coastal) {
      u.uCoastal.value = frame.coastal;
      u.uCoastalEnabled.value = 1;
    } else {
      u.uCoastal.value = this.dummyCoastal;
      u.uCoastalEnabled.value = 0;
    }
    if (frame.swellDirection) {
      (u.uSwellDirection.value as THREE.Vector2).set(frame.swellDirection.x, frame.swellDirection.z);
    }
  }

  private renderTarget(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    x: number,
    z: number,
    extent: number,
  ): void {
    (this.material.uniforms.uOrigin.value as THREE.Vector2).set(x, z);
    this.material.uniforms.uExtent.value = extent;
    this.material.uniforms.uSize.value = target.width;
    this.pass.run(renderer, this.material, target);
  }
}
