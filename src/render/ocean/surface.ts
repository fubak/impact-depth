/** Shared displaced-world sampling for water, GPU probes and caustic projection. */

import * as THREE from 'three';
import type { CoastalField } from './coastal';
import { SPECTRUM_SAMPLE_GLSL } from './spectrum';

/** Cascade UV when SPECTRUM_SAMPLE_GLSL is not already in the program. */
export const CASCADE_UV_GLSL = /* glsl */ `
vec2 cascadeUv(vec2 worldXZ, float tileLength) {
  return worldXZ / max(tileLength, 1.0);
}
`;

/**
 * Shared surface bodies. Callers must already declare cascade uniforms and
 * `cascadeUv` (via SPECTRUM_SAMPLE_GLSL or CASCADE_UV_GLSL) plus coastal/bed/wave uniforms.
 * Do not concatenate full SURFACE_GLSL after SPECTRUM_SAMPLE_GLSL — that redefines symbols.
 */
export const SURFACE_FUNCTIONS_GLSL = /* glsl */ `
vec4 coastAt(vec2 p) {
  return uCoastalEnabled > 0.5
    ? texture2D(uCoastal, clamp((p - uCoastalOrigin) / max(uCoastalExtent, 1.0), 0.0, 1.0))
    : vec4(0.0, uSwellDirection, 1.0);
}

vec3 oceanDisplacement(vec2 p) {
  float bed = texture2D(uBedTex, clamp((p - uBedOrigin) / max(uBedExtent, 1.0), 0.0, 1.0)).r;
  float depth = max(0.0, -bed);
  vec4 coast = coastAt(p);
  // Soften delay/exposure so low-res coastal cells do not paint blocky green plates.
  float exposure = smoothstep(0.12, 0.88, coast.w);
  vec2 travelDir = length(coast.yz) > 0.12 ? normalize(coast.yz) : uSwellDirection;
  vec2 delayed = p - travelDir * coast.x * 0.35;
  vec3 swell = texture2D(uDisplacement0, cascadeUv(delayed, uCascadeLength.x)).xyz;
  vec3 wind = texture2D(uDisplacement1, cascadeUv(p, uCascadeLength.y)).xyz;
  vec3 chop = texture2D(uDisplacement2, cascadeUv(p, uCascadeLength.z)).xyz;
  float shallow = smoothstep(0.15, 2.0, depth);
  float coverage = 1.0 - smoothstep(-uWetBand, uWetBand * 0.2, bed);
  return (swell * 1.0 + (wind * 0.72 + chop * 0.42) * shallow) *
    (0.55 + uWaveHeight * 0.55) * mix(0.92, 1.0, exposure) * coverage;
}

vec3 oceanNormal(vec2 p) {
  float e = 0.45;
  vec3 dx = vec3(2.0 * e, 0.0, 0.0) + oceanDisplacement(p + vec2(e, 0.0)) - oceanDisplacement(p - vec2(e, 0.0));
  vec3 dz = vec3(0.0, 0.0, 2.0 * e) + oceanDisplacement(p + vec2(0.0, e)) - oceanDisplacement(p - vec2(0.0, e));
  return normalize(cross(dz, dx));
}

float oceanFoam(vec2 p) {
  vec4 coast = coastAt(p);
  vec2 travelDir = length(coast.yz) > 0.12 ? normalize(coast.yz) : uSwellDirection;
  vec2 delayed = p - travelDir * coast.x * 0.35;
  // Chop/wind dominate; swell jacobian plates are the honeycomb lattice.
  float swell = texture2D(uSlope0, cascadeUv(delayed, uCascadeLength.x)).b;
  float wind = texture2D(uSlope1, cascadeUv(p, uCascadeLength.y)).b;
  float chop = texture2D(uSlope2, cascadeUv(p, uCascadeLength.z)).b;
  float raw = swell * 0.05 + wind * 0.28 + chop * 0.67;
  float n0 = fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  float n1 = fract(sin(dot(p * 0.41, vec2(269.5, 183.3))) * 43758.5453);
  return clamp(raw * mix(0.10, 1.0, n0 * n1), 0.0, 1.0);
}

vec2 oceanInverseDisplacement(vec2 p) {
  vec2 original = p;
  for (int i = 0; i < 3; i++) {
    vec3 disp = oceanDisplacement(original);
    original = p - disp.xz;
  }
  return original;
}
`;

/** Standalone program chunk (uniforms + cascadeUv + bodies). */
/**
 * Standalone program chunk (coastal/bed uniforms + spectrum sample + bodies).
 * Never concatenate after another SPECTRUM_SAMPLE_GLSL include — use SURFACE_FUNCTIONS_GLSL.
 */
export const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uCoastal;
uniform float uCoastalEnabled;
uniform vec2 uCoastalOrigin;
uniform float uCoastalExtent;
uniform vec2 uSwellDirection;
uniform sampler2D uBedTex;
uniform vec2 uBedOrigin;
uniform float uBedExtent;
uniform float uWetBand;
uniform float uWaveHeight;
uniform float uSpectral;
${SPECTRUM_SAMPLE_GLSL}
${SURFACE_FUNCTIONS_GLSL}
`;
export const SURFACE_UNIFORM_NAMES = [
  'uDisplacement0',
  'uDisplacement1',
  'uDisplacement2',
  'uSlope0',
  'uSlope1',
  'uSlope2',
  'uCascadeLength',
  'uCascadeSize',
  'uCoastal',
  'uCoastalEnabled',
  'uCoastalOrigin',
  'uCoastalExtent',
  'uSwellDirection',
  'uBedTex',
  'uBedOrigin',
  'uBedExtent',
  'uWetBand',
  'uWaveHeight',
  'uSpectral',
  'uTime',
  'uSunDir',
] as const;

export interface SurfaceUniforms {
  // Spectral cascades
  uDisplacement0: { value: THREE.Texture };
  uDisplacement1: { value: THREE.Texture };
  uDisplacement2: { value: THREE.Texture };
  uSlope0: { value: THREE.Texture };
  uSlope1: { value: THREE.Texture };
  uSlope2: { value: THREE.Texture };
  uCascadeLength: { value: THREE.Vector3 };
  uCascadeSize: { value: THREE.Vector3 };

  // Coastal field
  uCoastal: { value: THREE.Texture };
  uCoastalEnabled: { value: number };
  uCoastalOrigin: { value: THREE.Vector2 };
  uCoastalExtent: { value: number };
  uSwellDirection: { value: THREE.Vector2 };

  // Terrain
  uBedTex: { value: THREE.Texture };
  uBedOrigin: { value: THREE.Vector2 };
  uBedExtent: { value: number };
  uWetBand: { value: number };

  // Wave parameters
  uWaveHeight: { value: number };
  uSpectral: { value: number };
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
}

export function createCoastalTexture(field: CoastalField): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    field.data,
    field.resolution,
    field.resolution,
    THREE.RGBAFormat,
    THREE.FloatType,
  );

  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;

  return texture;
}

/** Documented sampled-vs-rendered height agreement for Plan 021 probes. */
export const SURFACE_HEIGHT_TOLERANCE_M = 0.25;
export const SURFACE_INVERSE_STEPS = 3;

export interface SurfaceDisplacement {
  x: number;
  y: number;
  z: number;
}

export interface SurfaceEvalContext {
  sampleCascade: (index: 0 | 1 | 2, worldX: number, worldZ: number) => SurfaceDisplacement;
  lengths: readonly [number, number, number];
  bed: number;
  coastalDelay: number;
  coastalExposure: number;
  coastalDirection?: readonly [number, number];
  swellDirection: readonly [number, number];
  waveHeight: number;
  wetBand: number;
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (Math.abs(span) < 1e-8) return x >= edge1 ? 1 : 0;
  const t = saturate((x - edge0) / span);
  return t * t * (3 - 2 * t);
}

/** CPU twin of `oceanDisplacement` so probes and tests share the visible surface. */
export function oceanDisplacementAt(
  worldX: number,
  worldZ: number,
  ctx: SurfaceEvalContext,
): SurfaceDisplacement {
  const depth = Math.max(0, -ctx.bed);
  const exposure = smoothstep(0.12, 0.88, ctx.coastalExposure);
  const dir = ctx.coastalDirection ?? ctx.swellDirection;
  const delayedX = worldX - dir[0] * ctx.coastalDelay * 0.35;
  const delayedZ = worldZ - dir[1] * ctx.coastalDelay * 0.35;
  const swell = ctx.sampleCascade(0, delayedX, delayedZ);
  const wind = ctx.sampleCascade(1, worldX, worldZ);
  const chop = ctx.sampleCascade(2, worldX, worldZ);
  const shallow = smoothstep(0.15, 2.0, depth);
  const coverage = 1 - smoothstep(-ctx.wetBand, ctx.wetBand * 0.2, ctx.bed);
  const gain = (0.55 + ctx.waveHeight * 0.55) * (0.92 + 0.08 * exposure) * coverage;
  return {
    x: (swell.x + (wind.x * 0.72 + chop.x * 0.42) * shallow) * gain,
    y: (swell.y + (wind.y * 0.72 + chop.y * 0.42) * shallow) * gain,
    z: (swell.z + (wind.z * 0.72 + chop.z * 0.42) * shallow) * gain,
  };
}

export function oceanInverseDisplacementAt(
  worldX: number,
  worldZ: number,
  ctx: SurfaceEvalContext,
): { x: number; z: number } {
  let sourceX = worldX;
  let sourceZ = worldZ;
  for (let i = 0; i < SURFACE_INVERSE_STEPS; i++) {
    const disp = oceanDisplacementAt(sourceX, sourceZ, ctx);
    sourceX = worldX - disp.x;
    sourceZ = worldZ - disp.z;
  }
  return { x: sourceX, z: sourceZ };
}

export function updateCoastalUniforms(
  uniforms: SurfaceUniforms,
  field: CoastalField | null,
  texture: THREE.Texture | null,
): void {
  if (field && texture) {
    uniforms.uCoastal.value = texture;
    uniforms.uCoastalEnabled.value = 1;
    uniforms.uCoastalOrigin.value.set(field.originX, field.originZ);
    uniforms.uCoastalExtent.value = field.extent;
    uniforms.uSwellDirection.value.set(field.directionX, field.directionZ);
  } else {
    uniforms.uCoastalEnabled.value = 0;
    uniforms.uSwellDirection.value.set(Math.cos(0.48), Math.sin(0.48)); // Default swell direction
  }
}
