import * as THREE from 'three';
import type { OceanSettings } from '../core/types';
import { ISLAND_SPECS } from '../core/terrain';
import { BASE_WAVES, waveAngularFrequency, waveNumber } from '../core/waves';
import { METERS_PER_UNIT, WORLD_SIZE } from '../game/sim/constants';
import {
  createDummyBedDataTexture,
  createPackedBedDataTexture,
} from './environment/bed-data-texture';
import { SHORE_WET_BAND_METRES, type PackedHeightField } from './environment/terrain-texture';
import { SPECTRUM_SAMPLE_GLSL } from './ocean/spectrum';
import { SURFACE_FUNCTIONS_GLSL } from './ocean/surface';
import type { WaterOptics } from './ocean/optics';
import type { QualityProfile } from './quality';
import { WaterRipplePass } from './water-ripples';

export interface SpectralMapBind {
  displacements: readonly THREE.Texture[];
  slopes: readonly THREE.Texture[];
  lengths: readonly number[];
  sizes: readonly number[];
}

export interface OpticsBindSource {
  readonly reflection: { readonly texture: THREE.Texture };
  readonly refraction: {
    readonly texture: THREE.Texture;
    readonly depthTexture?: THREE.Texture | null;
  };
  readonly reflectionMatrix: THREE.Matrix4;
  readonly refractionMatrix: THREE.Matrix4;
  readonly inverseProjection: THREE.Matrix4;
  readonly cameraWorld: THREE.Matrix4;
}

/** Fail closed: disabled optics keep dummy textures so Gerstner shading is unchanged. */
export function applyOpticsUniforms(
  uniforms: THREE.ShaderMaterial['uniforms'],
  dummyColor: THREE.Texture,
  dummyDepth: THREE.Texture,
  optics: OpticsBindSource | null,
): void {
  if (!optics) {
    uniforms.uOpticsEnabled!.value = 0;
    uniforms.uReflection!.value = dummyColor;
    uniforms.uRefraction!.value = dummyColor;
    uniforms.uRefractionDepth!.value = dummyDepth;
    (uniforms.uReflectionMatrix!.value as THREE.Matrix4).identity();
    (uniforms.uRefractionMatrix!.value as THREE.Matrix4).identity();
    (uniforms.uInverseProjection!.value as THREE.Matrix4).identity();
    (uniforms.uCameraWorld!.value as THREE.Matrix4).identity();
    return;
  }
  uniforms.uOpticsEnabled!.value = 1;
  uniforms.uReflection!.value = optics.reflection.texture;
  uniforms.uRefraction!.value = optics.refraction.texture;
  uniforms.uRefractionDepth!.value = optics.refraction.depthTexture ?? dummyDepth;
  (uniforms.uReflectionMatrix!.value as THREE.Matrix4).copy(optics.reflectionMatrix);
  (uniforms.uRefractionMatrix!.value as THREE.Matrix4).copy(optics.refractionMatrix);
  (uniforms.uInverseProjection!.value as THREE.Matrix4).copy(optics.inverseProjection);
  (uniforms.uCameraWorld!.value as THREE.Matrix4).copy(optics.cameraWorld);
}

export function applySpectralMapUniforms(
  uniforms: THREE.ShaderMaterial['uniforms'],
  dummy: THREE.Texture,
  maps: SpectralMapBind | null,
): void {
  if (!maps || maps.displacements.length === 0) {
    uniforms.uSpectral!.value = 0;
    uniforms.uDisplacement0!.value = dummy;
    uniforms.uDisplacement1!.value = dummy;
    uniforms.uDisplacement2!.value = dummy;
    uniforms.uSlope0!.value = dummy;
    uniforms.uSlope1!.value = dummy;
    uniforms.uSlope2!.value = dummy;
    return;
  }
  uniforms.uSpectral!.value = 1;
  uniforms.uDisplacement0!.value = maps.displacements[0] ?? dummy;
  uniforms.uDisplacement1!.value = maps.displacements[1] ?? dummy;
  uniforms.uDisplacement2!.value = maps.displacements[2] ?? dummy;
  uniforms.uSlope0!.value = maps.slopes[0] ?? dummy;
  uniforms.uSlope1!.value = maps.slopes[1] ?? dummy;
  uniforms.uSlope2!.value = maps.slopes[2] ?? dummy;
  (uniforms.uCascadeLength!.value as THREE.Vector3).set(
    maps.lengths[0] ?? 1,
    maps.lengths[1] ?? maps.lengths[0] ?? 1,
    maps.lengths[2] ?? maps.lengths[0] ?? 1,
  );
  (uniforms.uCascadeSize!.value as THREE.Vector3).set(
    maps.sizes[0] ?? 1,
    maps.sizes[1] ?? maps.sizes[0] ?? 1,
    maps.sizes[2] ?? maps.sizes[0] ?? 1,
  );
}

function createDummyOpticsColor(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createDummyOpticsDepth(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array([1, 1, 1, 1]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

function createDummyWaveTexture(): THREE.DataTexture {
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

/** Pack island disc uniforms for the shoreline depth field (max 3). */
export function islandShoreUniforms(
  specs: readonly { cx: number; cz: number; radius: number; peak: number }[] = ISLAND_SPECS,
): { a: THREE.Vector4; b: THREE.Vector4; c: THREE.Vector4 } {
  const pack = (i: number): THREE.Vector4 => {
    const s = specs[i];
    if (!s) return new THREE.Vector4(0, 0, 0, 0);
    return new THREE.Vector4(s.cx, s.cz, Math.max(s.radius, 1), Math.max(s.peak, 1));
  };
  return { a: pack(0), b: pack(1), c: pack(2) };
}

const commonGlsl = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

vec3 permute3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

const mat2 ROT = mat2(0.86, 0.50, -0.50, 0.86) * 1.93;

float sfbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * snoise(p);
    p = ROT * p;
    a *= 0.5;
  }
  return v * 0.5 + 0.5;
}

float sridge(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    float n = 1.0 - abs(snoise(p));
    v += a * n * n;
    p = ROT * p;
    a *= 0.5;
  }
  return v;
}

float fade01(float t) {
  return t * t * (3.0 - 2.0 * t);
}

/** LEGACY MISMATCH vs packed CPU bed: island-disc GLSL field. Used only when uBedEnabled is 0. */
float terrainHeight(vec2 p) {
  float basin = fbm(p * 0.014);
  float ridges = fbm(p * 0.045 + 20.0);
  float banks = fbm(p * 0.09 - 4.0);
  float micro = fbm(p * 0.22);
  float depth = 14.0 + basin * 6.5 + ridges * 3.8 + banks * 2.2 + micro * 0.55;
  depth -= fbm(p * 0.007 - 3.0) * 3.2;

  // Soft shelf rings around each cay.
  vec4 islands[3];
  islands[0] = uIslandA;
  islands[1] = uIslandB;
  islands[2] = uIslandC;
  for (int i = 0; i < 3; i++) {
    vec4 isl = islands[i];
    if (isl.z < 0.5) continue;
    float d = length(p - isl.xy) / isl.z;
    if (d > 1.05 && d < 2.2) {
      float t = fade01((2.2 - d) / 1.15);
      float shallow = 3.0 + (d - 1.05) * 5.2;
      depth = mix(depth, shallow, t);
    }
  }

  depth = clamp(depth, 3.2, 28.0);
  float h = -depth;

  // Land mass: rise above sea level inside each island radius.
  for (int i = 0; i < 3; i++) {
    vec4 isl = islands[i];
    if (isl.z < 0.5) continue;
    float d = length(p - isl.xy) / isl.z;
    float rim = 1.35;
    if (d >= rim) continue;
    float ang = atan(p.y - isl.y, p.x - isl.x);
    float ridge = fbm((p - isl.xy) * 0.045) * 0.22 + cos(ang * 2.0) * 0.04;
    float landH;
    if (d > 1.04) {
      float t = fade01((rim - d) / (rim - 1.04));
      landH = mix(h, 0.12 + ridge * 0.1, t);
    } else if (d > 0.7) {
      float t = fade01((1.04 - d) / 0.34);
      landH = mix(0.15 + ridge * 0.12, 1.45 + ridge * 0.35, t);
    } else if (d > 0.36) {
      float t = fade01((0.7 - d) / 0.34);
      float foot = 1.45 + ridge * 0.35;
      float shoulder = 2.1 + ridge * 1.4 + isl.w * 0.22 * t;
      landH = mix(foot, shoulder, t * t);
    } else {
      float t = 1.0 - d / 0.36;
      float shoulder = 2.1 + ridge * 1.4 + isl.w * 0.06;
      float peak = isl.w * 0.28 + pow(t, 1.6) * isl.w * 0.55 + ridge * 1.1;
      landH = mix(shoulder, peak, fade01(t));
    }
    h = max(h, landH);
  }
  return h;
}

float samplePackedBed(vec2 worldXZ) {
  vec2 uv = (worldXZ - uBedOrigin) / max(uBedExtent, 1.0);
  return texture2D(uBedTex, uv).r;
}

float bedHeight(vec2 p) {
  if (uBedEnabled > 0.5) return samplePackedBed(p);
  return terrainHeight(p);
}

float waterCoverage(float bed) {
  return 1.0 - smoothstep(-uWetBand, uWetBand * 0.2, bed);
}

float waterDepth(vec2 p) {
  return max(0.0, -bedHeight(p));
}
`;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uWaveHeight;
uniform float uChoppiness;
uniform float uSeaState;
uniform vec4 uWaveAmp;
uniform vec4 uWaveLen;
uniform vec4 uWaveDir;
uniform vec4 uWaveSteep;
uniform vec4 uWavePhase;
uniform vec4 uIslandA;
uniform vec4 uIslandB;
uniform vec4 uIslandC;
uniform sampler2D uBedTex;
uniform vec2 uBedOrigin;
uniform float uBedExtent;
uniform float uBedEnabled;
uniform float uWetBand;
uniform float uSpectral;

// Coastal field uniforms
uniform sampler2D uCoastal;
uniform float uCoastalEnabled;
uniform vec2 uCoastalOrigin;
uniform float uCoastalExtent;
uniform vec2 uSwellDirection;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFoam;
varying float vDepth;
varying float vCrest;
varying float vCoverage;
varying vec2 vFlat;
varying vec2 vUv;

${commonGlsl}
${SPECTRUM_SAMPLE_GLSL}
${SURFACE_FUNCTIONS_GLSL}

vec3 gerstner(
  vec3 pos,
  float amp,
  float wavelength,
  float dirAngle,
  float steepness,
  float phase,
  float heightScale,
  float chopScale,
  float depth,
  inout vec3 tangent,
  inout vec3 binormal
) {
  float shoal = smoothstep(0.0, 6.0, depth);
  float a = amp * heightScale * mix(0.22, 1.0, shoal);
  float k = 6.28318530718 / max(wavelength, 0.001);
  float dsafe = max(depth, 0.4);
  // Shallow-water dispersion: waves slow & bunch near shore.
  float omega = sqrt(9.81 * k * tanh(k * dsafe));
  vec2 d = vec2(cos(dirAngle), sin(dirAngle));
  float Q = (steepness * chopScale) / max(k * a * 4.0, 0.0001);
  float theta = k * dot(d, pos.xz) - omega * uTime + phase;
  float s = sin(theta);
  float c = cos(theta);

  pos.x += Q * a * d.x * c;
  pos.z += Q * a * d.y * c;
  pos.y += a * s;

  tangent += vec3(
    -d.x * d.x * Q * a * k * s,
    d.x * a * k * c,
    -d.x * d.y * Q * a * k * s
  );
  binormal += vec3(
    -d.x * d.y * Q * a * k * s,
    d.y * a * k * c,
    -d.y * d.y * Q * a * k * s
  );

  return pos;
}

void main() {
  vec4 world0 = modelMatrix * vec4(position, 1.0);
  vec2 flatXZ = world0.xz;
  vFlat = flatXZ;
  vUv = uv;
  float bed = bedHeight(flatXZ);
  float depth = max(0.0, -bed);
  float coverage = waterCoverage(bed);
  vDepth = depth;
  vCoverage = coverage;

  vec3 restPos = position;
  vec3 pos = restPos;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  float heightScale = uWaveHeight * (0.45 + uSeaState * 0.9);
  float chopScale = uChoppiness * (0.55 + uSeaState * 0.55);
  vec3 spectralDisp = vec3(0.0);

  if (uSpectral > 0.5) {
    spectralDisp = oceanDisplacement(flatXZ);
    pos = restPos + spectralDisp;
    vec3 normal = oceanNormal(flatXZ);
    tangent = cross(vec3(0.0, 1.0, 0.0), normal);
    binormal = cross(normal, tangent);
    if (length(tangent) < 0.1) {
      tangent = vec3(1.0, 0.0, 0.0);
      binormal = vec3(0.0, 0.0, 1.0);
    } else {
      tangent = normalize(tangent);
      binormal = normalize(binormal);
    }
  } else {
    pos = gerstner(pos, uWaveAmp.x, uWaveLen.x, uWaveDir.x, uWaveSteep.x, uWavePhase.x, heightScale, chopScale, depth, tangent, binormal);
    pos = gerstner(pos, uWaveAmp.y, uWaveLen.y, uWaveDir.y, uWaveSteep.y, uWavePhase.y, heightScale, chopScale, depth, tangent, binormal);
    pos = gerstner(pos, uWaveAmp.z, uWaveLen.z, uWaveDir.z, uWaveSteep.z, uWavePhase.z, heightScale, chopScale, depth, tangent, binormal);
    pos = gerstner(pos, uWaveAmp.w, uWaveLen.w, uWaveDir.w, uWaveSteep.w, uWavePhase.w, heightScale, chopScale, depth, tangent, binormal);
  }

  pos = mix(restPos, pos, coverage);
  tangent = mix(vec3(1.0, 0.0, 0.0), tangent, coverage);
  binormal = mix(vec3(0.0, 0.0, 1.0), binormal, coverage);

  vec3 objectNormal = normalize(cross(binormal, tangent));
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;

  float crest = uSpectral > 0.5
    ? spectralDisp.y / max(0.35 + heightScale, 0.001)
    : pos.y / max(heightScale * 0.85, 0.001);
  float crestBand = smoothstep(0.55, 0.9, crest) * (1.0 - smoothstep(0.9, 1.2, crest));
  float breakNoise = sin(vWorldPos.x * 1.4 + uTime * 1.8) * sin(vWorldPos.z * 1.1 - uTime * 1.3);
  float cascadeFoam = uSpectral > 0.5 ? oceanFoam(flatXZ) : 0.0;
  vFoam = max(crestBand * (0.25 + 0.75 * step(0.2, breakNoise)), cascadeFoam * 0.22);
  vCrest = clamp(crest * 0.5 + 0.5, 0.0, 1.0);

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uSandColor;
uniform float uFoamAmount;
uniform float uShoreFoam;
uniform float uShoreWidth;
uniform float uFoamSpeed;
uniform float uCaustics;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform float uClarity;
uniform float uAbsorption;
uniform float uTime;
uniform sampler2D uNormalMap;
uniform sampler2D uNormalDisturbance;
uniform vec2 uResolution;
uniform float uRippleStrength;
uniform int uOverlays;
uniform vec4 uIslandA;
uniform vec4 uIslandB;
uniform vec4 uIslandC;
uniform sampler2D uBedTex;
uniform vec2 uBedOrigin;
uniform float uBedExtent;
uniform float uBedEnabled;
uniform float uWetBand;
uniform float uSpectral;
uniform float uOpticsEnabled;
uniform sampler2D uReflection;
uniform sampler2D uRefraction;
uniform sampler2D uRefractionDepth;
uniform mat4 uReflectionMatrix;
uniform mat4 uRefractionMatrix;
uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFoam;
varying float vDepth;
varying float vCrest;
varying float vCoverage;
varying vec2 vFlat;
varying vec2 vUv;

${commonGlsl}

float foamField(vec2 p, float t) {
  vec2 w = p * 0.07;
  vec2 q = w + 0.6 * vec2(sfbm(w + t * 0.10), sfbm(w + 4.0 - t * 0.08));
  float f = sfbm(q * 1.7 + vec2(0.0, t * 0.25));
  f = pow(f, 1.4);
  f += 0.35 * sfbm(q * 4.0 - t * 0.4);
  return f;
}

float caustic(vec2 p, float t) {
  vec2 q = p * 0.16;
  q += 0.25 * vec2(sfbm(q + t * 0.15), sfbm(q - t * 0.12));
  float a = sridge(q + vec2(0.0, t * 0.20));
  float b = sridge(q * 1.7 - vec2(t * 0.16, 0.0));
  return pow(a * b, 2.2);
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float depth = vDepth;

  // CheapWater-style multi-layer scrolling normals (3 layers @ 120°).
  vec3 detail = vec3(0.0);
  float overlays = float(max(uOverlays, 1));
  for (int i = 0; i < 6; i++) {
    if (i >= uOverlays) break;
    float dir = float(i) / overlays * 6.2831853;
    float c = cos(dir);
    float s = sin(dir);
    mat2 rot = mat2(c, -s, s, c);
    vec2 flow = vec2(uTime * (0.035 + float(i) * 0.012), dir * 0.11);
    vec2 uvA = rot * (vWorldPos.xz * 0.055) + flow;
    vec2 uvB = rot * (vWorldPos.xz * 0.14) + flow * 1.7;
    vec3 snA = texture2D(uNormalMap, uvA).rgb * 2.0 - 1.0;
    vec3 snB = texture2D(uNormalMap, uvB).rgb * 2.0 - 1.0;
    snA.xy = rot * snA.xy;
    snB.xy = rot * snB.xy;
    detail += snA * 0.7 + snB * 0.45;
  }

  // Screen-space interactive ripples (same camera as main pass).
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  vec3 ripple = texture2D(uNormalDisturbance, screenUv).rgb * 2.0 - 1.0;
  detail += ripple * uRippleStrength;

  vec3 up = normalize(N);
  vec3 tangent = normalize(cross(up, abs(up.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 bitangent = cross(up, tangent);
  N = normalize(
    tangent * detail.x * 0.85 +
    bitangent * detail.y * 0.85 +
    up * max(0.35, 1.0 + detail.z * 0.55)
  );

  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndotv, 3.6);
  float overhead = ndotv;

  // Beer-Lambert absorption from true water-column depth.
  float absorbCoeff = mix(0.045, 0.14, clamp(uAbsorption, 0.0, 1.0));
  float absorb = 1.0 - exp(-depth * absorbCoeff);
  vec3 turquoise = vec3(0.12, 0.78, 0.82);
  vec3 shallow = mix(uShallowColor * 1.05, turquoise, smoothstep(0.0, 5.0, depth) * 0.55);
  vec3 deep = mix(uDeepColor * 1.05, uDeepColor * 0.72, smoothstep(6.0, 18.0, depth));
  vec3 water = mix(shallow, deep, absorb);

  // Sand bleed-through in clear shallows.
  float clarity = clamp(uClarity, 0.0, 1.0);
  float seeFloor = exp(-depth * mix(0.55, 0.22, clarity));
  water = mix(water, mix(water, uSandColor * 0.92, 0.55), seeFloor * 0.85);

  // Shallow caustic veins.
  float caus = caustic(vFlat, uTime) * seeFloor * uCaustics;
  water += vec3(0.9, 1.0, 0.95) * caus * 0.75;

  // Reflective sky / metalness-like film (CheapWater look).
  vec3 skyReflect = mix(uSkyColor * 0.85, vec3(0.78, 0.92, 1.0), fresnel);
  water = mix(water, skyReflect, 0.18 + fresnel * 0.55);

  if (uOpticsEnabled > 0.5) {
    vec3 body = water;
    vec4 reflectClip = uReflectionMatrix * vec4(vWorldPos, 1.0);
    vec2 reflectUv = reflectClip.xy / max(reflectClip.w, 1e-4);
    reflectUv += N.xz * 0.045;
    vec4 refractClip = uRefractionMatrix * vec4(vWorldPos, 1.0);
    vec2 refractUv = refractClip.xy / max(refractClip.w, 1e-4);
    refractUv += N.xz * 0.03;
    float reflectEdge = smoothstep(0.0, 0.05, reflectUv.x) * smoothstep(0.0, 0.05, reflectUv.y)
      * smoothstep(0.0, 0.05, 1.0 - reflectUv.x) * smoothstep(0.0, 0.05, 1.0 - reflectUv.y);
    float refractEdge = smoothstep(0.0, 0.05, refractUv.x) * smoothstep(0.0, 0.05, refractUv.y)
      * smoothstep(0.0, 0.05, 1.0 - refractUv.x) * smoothstep(0.0, 0.05, 1.0 - refractUv.y);
    vec3 reflected = mix(skyReflect, texture2D(uReflection, clamp(reflectUv, 0.0, 1.0)).rgb, reflectEdge);
    float sceneDepth = texture2D(uRefractionDepth, clamp(refractUv, 0.0, 1.0)).r;
    float depthValid = step(sceneDepth, 0.999) * refractEdge;
    vec3 refracted = mix(body, texture2D(uRefraction, clamp(refractUv, 0.0, 1.0)).rgb, depthValid);
    vec4 ndc = vec4(clamp(refractUv, 0.0, 1.0) * 2.0 - 1.0, sceneDepth * 2.0 - 1.0, 1.0);
    vec4 viewPos = uInverseProjection * ndc;
    viewPos /= max(viewPos.w, 1e-4);
    vec4 sceneWorld = uCameraWorld * viewPos;
    float column = max(0.0, vWorldPos.y - sceneWorld.y);
    float opticsAbsorb = 1.0 - exp(-column * absorbCoeff);
    refracted = mix(refracted, body, opticsAbsorb * 0.72);
    water = mix(refracted, reflected, fresnel);
  }

  vec3 L = normalize(uSunDir);
  float ndotl = max(dot(N, L), 0.0);
  water += uSunColor * ndotl * 0.07;
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 160.0);
  water += uSunColor * spec * (0.55 + fresnel * 1.05);
  float glitter = pow(max(dot(reflect(-L, normalize(vWorldNormal + N * 0.35)), V), 0.0), 36.0);
  water += uSunColor * glitter * 0.14;

  // ---- Shore foam (ragged lip + wash) + crest whitecaps + wake foam ----
  float foamT = uTime * uFoamSpeed;
  float fField = foamField(vFlat, foamT);
  float alongShore = sfbm(vFlat * 0.025 + 17.0) * 6.2831853;
  float swell = 0.5 + 0.5 * sin(uTime * 0.9 + alongShore);
  swell = mix(swell, 0.5 + 0.5 * sin(uTime * 0.55 + alongShore * 1.7 + 2.0), 0.5);
  float jitter = (sfbm(vFlat * 0.14 + vec2(0.0, uTime * 0.06)) - 0.5) * uShoreWidth * 1.1;
  float dN = depth + jitter;

  float edge = uShoreWidth * (0.30 + 0.70 * swell);
  float lip = smoothstep(edge + 1.4, edge - 0.2, dN) * smoothstep(edge - 2.8, edge - 0.2, dN);
  lip *= smoothstep(0.40, 0.80, fField);

  float washMask = 1.0 - smoothstep(0.0, uShoreWidth * 1.9, dN);
  float wash = washMask * smoothstep(0.28, 0.74, fField) * (0.35 + 0.65 * swell);

  float capMask = sfbm(vFlat * 0.5 - vec2(uTime * 0.3, 0.0));
  float caps = smoothstep(0.70, 0.93, vCrest) * smoothstep(3.0, 9.0, depth);
  caps *= smoothstep(0.45, 0.85, fField) * smoothstep(0.45, 0.75, capMask);

  float shoreFoam = clamp((lip * 1.15 + wash * 0.7 + caps * 0.85) * uShoreFoam, 0.0, 1.0);
  float crestFoam = vFoam * uFoamAmount * (0.45 + 0.55 * sin(vWorldPos.x * 2.2 + uTime * 2.5));
  crestFoam += length(ripple.xy) * 0.12 * uRippleStrength;
  float foamMask = clamp(max(shoreFoam, crestFoam), 0.0, 1.0) * vCoverage;
  vec3 foamCol = vec3(0.92, 0.96, 0.97) * (0.9 + 0.2 * fField);
  water = mix(water, foamCol, foamMask * 0.9);

  float alphaDown = mix(0.34, 0.24, clarity);
  float alphaGraze = mix(0.88, 0.74, clarity * 0.4);
  float alpha = mix(alphaGraze, alphaDown, overhead);
  alpha = mix(alpha, mix(0.32, 0.9, absorb), 0.5);
  alpha = max(alpha, fresnel * 0.85);
  alpha = max(alpha, foamMask * 0.85);
  // Punch the sheet so submerged hulls stay readable from tactical cameras.
  float under = smoothstep(1.4, -2.0, cameraPosition.y);
  vec3 volume = mix(uDeepColor * 0.28, vec3(0.01, 0.14, 0.18), 0.65);
  water = mix(water, volume, under * 0.88);
  water *= mix(1.0, 0.42, under);
  water += vec3(0.05, 0.22, 0.2) * caus * under * 1.4;
  if (uSpectral > 0.5) {
    foamMask = clamp(foamMask + abs(vCrest - 0.5) * 0.18 * uFoamAmount, 0.0, 1.0);
    water = mix(water, foamCol, foamMask * 0.28 * (1.0 - under));
  }
  alpha = mix(alpha, mix(0.78, 0.94, absorb), under);
  float lookDown = smoothstep(0.15, 0.85, overhead);
  alpha *= mix(1.0, 0.72, lookDown * (1.0 - under));
  if (vCoverage < 0.02) discard;
  alpha *= vCoverage;
  alpha = clamp(alpha, 0.05, 0.94);

  float dist = length(cameraPosition - vWorldPos);
  float fogFactor = 1.0 - exp(-uFogDensity * dist * 0.35);
  water = mix(water, uFogColor, clamp(fogFactor, 0.0, 0.22));

  gl_FragColor = vec4(water, alpha);
}
`;

function hexToVec3(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly ripples: WaterRipplePass;
  private geometry: THREE.PlaneGeometry;
  private readonly size: number;
  private segments: number;
  private wakeTimer = 0;
  private readonly dummyBed: THREE.DataTexture;
  private readonly dummyWave: THREE.DataTexture;
  private readonly dummyOpticsColor: THREE.DataTexture;
  private readonly dummyOpticsDepth: THREE.DataTexture;
  private bedTexture: THREE.DataTexture;
  private foamScale = 1;
  private causticsScale = 1;

  constructor(size = 720, segments = 200) {
    this.size = size;
    this.segments = segments;
    this.geometry = this.createGeometry(segments);
    this.ripples = new WaterRipplePass();
    this.dummyBed = createDummyBedDataTexture();
    this.dummyWave = createDummyWaveTexture();
    this.dummyOpticsColor = createDummyOpticsColor();
    this.dummyOpticsDepth = createDummyOpticsDepth();
    this.bedTexture = this.dummyBed;

    const amps = BASE_WAVES.map((w) => w.amplitude);
    const lens = BASE_WAVES.map((w) => w.wavelength);
    const dirs = BASE_WAVES.map((w) => w.direction);
    const steeps = BASE_WAVES.map((w) => w.steepness);
    const phases = BASE_WAVES.map((w) => w.phase);
    const islands = islandShoreUniforms();

    const normalMap = new THREE.TextureLoader().load('/assets/textures/water-normal.png');
    normalMap.wrapS = THREE.RepeatWrapping;
    normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.colorSpace = THREE.NoColorSpace;
    normalMap.flipY = false;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uWaveHeight: { value: 0.55 },
        uChoppiness: { value: 0.45 },
        uSeaState: { value: 0.32 },
        uWaveAmp: { value: new THREE.Vector4(...amps) },
        uWaveLen: { value: new THREE.Vector4(...lens) },
        uWaveDir: { value: new THREE.Vector4(...dirs) },
        uWaveSteep: { value: new THREE.Vector4(...steeps) },
        uWavePhase: { value: new THREE.Vector4(...phases) },
        uIslandA: { value: islands.a },
        uIslandB: { value: islands.b },
        uIslandC: { value: islands.c },
        uBedTex: { value: this.dummyBed },
        uBedOrigin: {
          value: new THREE.Vector2(
            -(WORLD_SIZE * METERS_PER_UNIT) / 2,
            -(WORLD_SIZE * METERS_PER_UNIT) / 2,
          ),
        },
        uBedExtent: { value: WORLD_SIZE * METERS_PER_UNIT },
        uBedEnabled: { value: 0 },
        uWetBand: { value: SHORE_WET_BAND_METRES },
        uSpectral: { value: 0 },
        uDisplacement0: { value: this.dummyWave },
        uDisplacement1: { value: this.dummyWave },
        uDisplacement2: { value: this.dummyWave },
        uSlope0: { value: this.dummyWave },
        uSlope1: { value: this.dummyWave },
        uSlope2: { value: this.dummyWave },
        uCascadeLength: { value: new THREE.Vector3(1792, 211, 27.3) },
        uCascadeSize: { value: new THREE.Vector3(128, 128, 128) },
        uCoastal: { value: this.dummyWave },
        uCoastalEnabled: { value: 0 },
        uCoastalOrigin: { value: new THREE.Vector2(0, 0) },
        uCoastalExtent: { value: 2048 },
        uSwellDirection: { value: new THREE.Vector2(Math.cos(0.48), Math.sin(0.48)) },
        uDeepColor: { value: hexToVec3('#0b88c4') },
        uShallowColor: { value: hexToVec3('#42dde0') },
        uSandColor: { value: hexToVec3('#d9c39a') },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
        uSunColor: { value: new THREE.Vector3(1.0, 0.94, 0.81) },
        uSkyColor: { value: new THREE.Vector3(0.24, 0.62, 0.89) },
        uFoamAmount: { value: 0.14 },
        uShoreFoam: { value: 0.85 },
        uShoreWidth: { value: 7.0 },
        uFoamSpeed: { value: 0.7 },
        uCaustics: { value: 0.9 },
        uFogDensity: { value: 0.0007 },
        uFogColor: { value: new THREE.Vector3(0.84, 0.93, 1.0) },
        uClarity: { value: 0.72 },
        uAbsorption: { value: 0.36 },
        uNormalMap: { value: normalMap },
        uNormalDisturbance: { value: this.ripples.texture },
        uResolution: { value: this.ripples.resolutionUniform },
        uRippleStrength: { value: 3.6 },
        uOverlays: { value: 3 },
        uOpticsEnabled: { value: 0 },
        uReflection: { value: this.dummyOpticsColor },
        uRefraction: { value: this.dummyOpticsColor },
        uRefractionDepth: { value: this.dummyOpticsDepth },
        uReflectionMatrix: { value: new THREE.Matrix4() },
        uRefractionMatrix: { value: new THREE.Matrix4() },
        uInverseProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
  }

  setSegments(segments: number): void {
    if (segments === this.segments) return;
    const old = this.geometry;
    this.segments = segments;
    this.geometry = this.createGeometry(segments);
    this.mesh.geometry = this.geometry;
    old.dispose();
  }

  setQuality(profile: QualityProfile): void {
    this.setSegments(profile.waterSegments);
    this.foamScale = profile.foamScale;
    this.causticsScale = profile.causticsScale;
    this.material.uniforms.uCaustics.value = 0.9 * this.causticsScale;
  }

  resize(width: number, height: number, dpr = 1): void {
    this.ripples.resize(width, height, dpr);
  }

  /** Render ripple normals with the main camera, then bind for the ocean pass. */
  preRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.ripples.render(renderer, camera);
    this.material.uniforms.uNormalDisturbance.value = this.ripples.texture;
  }

  update(
    time: number,
    ocean: OceanSettings,
    fogDensity: number,
    fogColor: THREE.Color,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    skyColor: THREE.Color,
    dt = 1 / 60,
    sandColorHex = '#d9c39a',
  ): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uWaveHeight.value = ocean.waveHeight;
    u.uChoppiness.value = ocean.choppiness;
    u.uSeaState.value = ocean.seaState;
    u.uDeepColor.value.copy(hexToVec3(ocean.deepColor));
    u.uShallowColor.value.copy(hexToVec3(ocean.shallowColor));
    u.uSandColor.value.copy(hexToVec3(sandColorHex));
    u.uFoamAmount.value = ocean.foamAmount * this.foamScale;
    // Map look-dev foam slider into shore foam without losing the shoreline stack.
    u.uShoreFoam.value = (0.45 + ocean.foamAmount * 2.8) * this.foamScale;
    this.setReadability(ocean.clarity, ocean.absorption);
    u.uFogDensity.value = fogDensity;
    u.uFogColor.value.set(fogColor.r, fogColor.g, fogColor.b);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.set(sunColor.r, sunColor.g, sunColor.b);
    u.uSkyColor.value.set(skyColor.r, skyColor.g, skyColor.b);
    this.ripples.update(dt);
    this.wakeTimer += dt;
  }

  /** Emit wake ripples for the player + contacts (throttled). */
  emitMotionRipples(
    bodies: Array<{ x: number; z: number; heading: number; speed: number; stern?: number }>,
  ): void {
    if (this.wakeTimer < 0.08) return;
    this.wakeTimer = 0;
    for (const body of bodies) {
      this.ripples.emitWake(body.x, body.z, body.heading, body.speed, body.stern ?? 6);
    }
  }

  setReadability(clarity: number, absorption: number): void {
    this.material.uniforms.uClarity.value = clarity;
    this.material.uniforms.uAbsorption.value = absorption;
  }

  follow(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  bindSpectralMaps(maps: SpectralMapBind | null): void {
    applySpectralMapUniforms(this.material.uniforms, this.dummyWave, maps);
  }

  bindOptics(optics: WaterOptics | OpticsBindSource | null): void {
    applyOpticsUniforms(
      this.material.uniforms,
      this.dummyOpticsColor,
      this.dummyOpticsDepth,
      optics,
    );
  }

  bedBind(): { texture: THREE.Texture; origin: THREE.Vector2; extent: number } | null {
    if ((this.material.uniforms.uBedEnabled.value as number) < 0.5) return null;
    return {
      texture: this.material.uniforms.uBedTex.value as THREE.Texture,
      origin: this.material.uniforms.uBedOrigin.value as THREE.Vector2,
      extent: this.material.uniforms.uBedExtent.value as number,
    };
  }

  coastalTexture(): THREE.Texture | null {
    if ((this.material.uniforms.uCoastalEnabled.value as number) < 0.5) return null;
    const texture = this.material.uniforms.uCoastal.value as THREE.Texture;
    return texture === this.dummyWave ? null : texture;
  }

  swellDirection(): { x: number; z: number } {
    const dir = this.material.uniforms.uSwellDirection.value as THREE.Vector2;
    return { x: dir.x, z: dir.y };
  }

  coastalOrigin(): { x: number; z: number; extent: number } {
    const origin = this.material.uniforms.uCoastalOrigin.value as THREE.Vector2;
    return {
      x: origin.x,
      z: origin.y,
      extent: this.material.uniforms.uCoastalExtent.value as number,
    };
  }

  bindCoastalField(field: { data: Float32Array; resolution: number; originX: number; originZ: number; extent: number; directionX: number; directionZ: number } | null): void {
    if (field) {
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

      // Dispose old coastal texture if it exists
      const oldTexture = this.material.uniforms.uCoastal.value;
      if (oldTexture !== this.dummyWave) {
        oldTexture.dispose();
      }

      this.material.uniforms.uCoastal.value = texture;
      this.material.uniforms.uCoastalEnabled.value = 1;
      this.material.uniforms.uCoastalOrigin.value.set(field.originX, field.originZ);
      this.material.uniforms.uCoastalExtent.value = field.extent;
      this.material.uniforms.uSwellDirection.value.set(field.directionX, field.directionZ);
    } else {
      this.material.uniforms.uCoastalEnabled.value = 0;
    }
  }

  bindHeightField(field: PackedHeightField): void {
    const next = createPackedBedDataTexture(field);
    const prev = this.bedTexture;
    this.bedTexture = next;
    this.material.uniforms.uBedTex.value = next;
    this.material.uniforms.uBedOrigin.value.set(field.spec.originX, field.spec.originZ);
    this.material.uniforms.uBedExtent.value = field.spec.extent;
    this.material.uniforms.uBedEnabled.value = 1;
    this.material.uniforms.uWetBand.value = SHORE_WET_BAND_METRES;
    if (prev && prev !== this.dummyBed) prev.dispose();
  }

  dispose(): void {
    this.geometry.dispose();
    const map = this.material.uniforms.uNormalMap.value as THREE.Texture | undefined;
    map?.dispose();
    if (this.bedTexture !== this.dummyBed) this.bedTexture.dispose();
    this.dummyBed.dispose();
    this.dummyWave.dispose();
    this.dummyOpticsColor.dispose();
    this.dummyOpticsDepth.dispose();
    this.material.dispose();
    this.ripples.dispose();
  }

  private createGeometry(segments: number): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
}

export function waveUniformsFromBase(): {
  amp: number[];
  len: number[];
  omega: number[];
} {
  return {
    amp: BASE_WAVES.map((w) => w.amplitude),
    len: BASE_WAVES.map((w) => w.wavelength),
    omega: BASE_WAVES.map((w) => waveAngularFrequency(waveNumber(w.wavelength))),
  };
}
