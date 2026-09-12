/** Owned JONSWAP / cascade spectrum (Techartist ocean-simulation, MIT, 3f756c1). */

import type { EnvironmentQuality } from '../environment/types';

export const GRAVITY = 9.81;
export const TAU = Math.PI * 2;
export const DEFAULT_PEAK_WAVELENGTH = 78;
export const DEFAULT_SPECTRUM_SEED = 192731;
/** Deep-water capillary term used when evolving a mode (not in JONSWAP density). */
export const CAPILLARY_SIGMA = 0.000074;

export type CascadeRole = 'swell' | 'wind' | 'chop';

export interface CascadeSpec {
  readonly role: CascadeRole;
  /** Horizontal tile length in metres. Independent of gameplay bounds. */
  readonly length: number;
  readonly minWave: number;
  readonly maxWave: number;
  readonly rms: number;
  readonly direction: number;
  readonly gain: number;
}

export const DEFAULT_CASCADES: readonly CascadeSpec[] = [
  {
    role: 'swell',
    length: 1792,
    minWave: 20,
    maxWave: 950,
    rms: 0.49,
    direction: 0.48,
    gain: 1.45,
  },
  { role: 'wind', length: 211, minWave: 2.5, maxWave: 30, rms: 0.16, direction: 0, gain: 1.25 },
  {
    role: 'chop',
    length: 27.3,
    minWave: 0.25,
    maxWave: 3.8,
    rms: 0.017,
    direction: 0.3,
    gain: 1.1,
  },
];

export interface SpectrumBuildParams {
  readonly spec: CascadeSpec;
  readonly fftSize: number;
  readonly seed: number;
  readonly peakWavelength?: number;
  readonly gravity?: number;
}

export interface PackedSpectrum {
  readonly fftSize: number;
  readonly length: number;
  readonly seed: number;
  /** RGBA32F: h0(k).xy, h0(-k).zw */
  readonly initial: Float32Array;
  readonly energy: number;
  readonly scale: number;
}

export interface EvolvedMode {
  readonly heightRe: number;
  readonly heightIm: number;
  readonly dispX: number;
  readonly dispZ: number;
  readonly omega: number;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function peakOmega(peakWavelength = DEFAULT_PEAK_WAVELENGTH, gravity = GRAVITY): number {
  return Math.sqrt((gravity * TAU) / peakWavelength);
}

/** Isolated visual RNG. Callers pass seed; never reads `game.rngState` or `Math.random`. */
export function createSpectrumRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cascadeSeed(base: number, role: CascadeRole): number {
  if (role === 'swell') return base | 0;
  if (role === 'wind') return (base + 0x9e3779b9) | 0;
  return (base + 0x85ebca6b) | 0;
}

export function gaussian(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-8, rng()))) * Math.cos(TAU * rng());
}

export function fftSizeForQuality(quality: EnvironmentQuality, role: CascadeRole): number {
  if (quality === 'low') return 64;
  if (quality === 'high' && role === 'wind') return 256;
  return 128;
}

/** Profile FFT sizes must stay aligned with `fftSizeForQuality`. */
export function spectralFftSizeForQuality(quality: EnvironmentQuality): {
  swell: number;
  wind: number;
  chop: number;
} {
  return {
    swell: fftSizeForQuality(quality, 'swell'),
    wind: fftSizeForQuality(quality, 'wind'),
    chop: fftSizeForQuality(quality, 'chop'),
  };
}

export function cascadeSpecsForQuality(_quality: EnvironmentQuality): CascadeSpec[] {
  return DEFAULT_CASCADES.map((spec) => ({ ...spec }));
}

export function waveVector(
  x: number,
  z: number,
  fftSize: number,
  length: number,
): { kx: number; kz: number; k: number } {
  const deltaK = TAU / length;
  const kx = (x < fftSize / 2 ? x : x - fftSize) * deltaK;
  const kz = (z < fftSize / 2 ? z : z - fftSize) * deltaK;
  return { kx, kz, k: Math.hypot(kx, kz) };
}

export function jonswapDensity(k: number, omegaPeak: number, gravity = GRAVITY): number {
  if (k < 1e-5) return 0;
  const omega = Math.sqrt(gravity * k);
  const sigma = omega <= omegaPeak ? 0.07 : 0.09;
  const peak = Math.exp(-0.5 * ((omega - omegaPeak) / (sigma * omegaPeak)) ** 2);
  return (
    ((0.0081 * gravity ** 2) / omega ** 5) *
    Math.exp(-1.25 * (omegaPeak / omega) ** 4) *
    3.3 ** peak
  );
}

export function cascadeBand(wavelength: number, spec: CascadeSpec): number {
  return (
    smoothstep(spec.minWave, spec.minWave * 1.35, wavelength) *
    (1 - smoothstep(spec.maxWave * 0.75, spec.maxWave, wavelength))
  );
}

export function directionalSpreading(kx: number, kz: number, k: number, spec: CascadeSpec): number {
  const alignment = (kx * Math.cos(spec.direction) + kz * Math.sin(spec.direction)) / k;
  const exponent = spec.length > 1000 ? 14 : 3;
  return 0.97 * Math.max(alignment, 0) ** exponent + 0.015;
}

/**
 * Packed initial Phillips/JONSWAP amplitudes. Same seed + spec ⇒ identical bytes.
 * Time is applied later by `evolveMode` / the evolve pass, not here.
 */
export function buildPackedInitialSpectrum(params: SpectrumBuildParams): PackedSpectrum {
  const fftSize = params.fftSize;
  if (fftSize < 2 || (fftSize & (fftSize - 1)) !== 0) {
    throw new Error(`fftSize must be a power of two, got ${fftSize}`);
  }
  const spec = params.spec;
  const gravity = params.gravity ?? GRAVITY;
  const omegaPeak = peakOmega(params.peakWavelength ?? DEFAULT_PEAK_WAVELENGTH, gravity);
  const rng = createSpectrumRng(params.seed);
  const deltaK = TAU / spec.length;
  const coefficients = new Float32Array(fftSize * fftSize * 2);
  let energy = 0;
  for (let z = 0; z < fftSize; z++) {
    for (let x = 0; x < fftSize; x++) {
      const { kx, kz, k } = waveVector(x, z, fftSize, spec.length);
      const index = (z * fftSize + x) * 2;
      if (k < 0.00001) continue;
      const band = cascadeBand(TAU / k, spec);
      if (band === 0) continue;
      const jonswap = jonswapDensity(k, omegaPeak, gravity);
      const spreading = directionalSpreading(kx, kz, k, spec);
      const density =
        ((jonswap * 0.5 * Math.sqrt(gravity / k)) / k) * spreading * deltaK ** 2 * band;
      const amplitude = Math.sqrt(Math.max(0, density) * 0.5);
      const re = gaussian(rng) * amplitude;
      const im = gaussian(rng) * amplitude;
      coefficients[index] = re;
      coefficients[index + 1] = im;
      energy += re * re + im * im;
    }
  }
  const scale = spec.rms / Math.sqrt(Math.max(1e-15, energy * 2));
  const initial = new Float32Array(fftSize * fftSize * 4);
  for (let z = 0; z < fftSize; z++) {
    for (let x = 0; x < fftSize; x++) {
      const i = (z * fftSize + x) * 4;
      const k = i / 2;
      const opposite = (((fftSize - z) % fftSize) * fftSize + ((fftSize - x) % fftSize)) * 2;
      initial[i] = coefficients[k]! * scale;
      initial[i + 1] = coefficients[k + 1]! * scale;
      initial[i + 2] = coefficients[opposite]! * scale;
      initial[i + 3] = coefficients[opposite + 1]! * scale;
    }
  }
  return { fftSize, length: spec.length, seed: params.seed, initial, energy, scale };
}

export function evolveMode(
  initial: readonly [number, number, number, number],
  kx: number,
  kz: number,
  time: number,
  gravity = GRAVITY,
  capillary = CAPILLARY_SIGMA,
): EvolvedMode {
  const magnitude = Math.hypot(kx, kz);
  if (magnitude < 0.00001) {
    return { heightRe: 0, heightIm: 0, dispX: 0, dispZ: 0, omega: 0 };
  }
  const omega = Math.sqrt(gravity * magnitude * (1 + magnitude * magnitude * capillary));
  const cr = Math.cos(omega * time);
  const ci = Math.sin(omega * time);
  const h0r = initial[0];
  const h0i = initial[1];
  const hnR = initial[2];
  const hnI = initial[3];
  const aRe = h0r * cr - h0i * -ci;
  const aIm = h0r * -ci + h0i * cr;
  const bRe = hnR * cr - -hnI * ci;
  const bIm = hnR * ci + -hnI * cr;
  const heightRe = aRe + bRe;
  const heightIm = aIm + bIm;
  const dx = kx / magnitude;
  const dz = kz / magnitude;
  return {
    heightRe,
    heightIm,
    dispX: -heightIm * dx - heightRe * dz,
    dispZ: heightRe * dx - heightIm * dz,
    omega,
  };
}

export function samplePackedRgba(
  packed: PackedSpectrum,
  x: number,
  z: number,
): [number, number, number, number] {
  const i = (z * packed.fftSize + x) * 4;
  return [
    packed.initial[i]!,
    packed.initial[i + 1]!,
    packed.initial[i + 2]!,
    packed.initial[i + 3]!,
  ];
}

export const PASS_VERTEX_GLSL = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

export const SPECTRUM_EVOLVE_GLSL = /* glsl */ `
uniform sampler2D uInitial;
uniform float uTime, uLength;
uniform int uSize;
vec2 multiplyComplex(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 k = vec2(cell);
  if (cell.x >= uSize / 2) k.x -= float(uSize);
  if (cell.y >= uSize / 2) k.y -= float(uSize);
  k *= 6.283185307 / uLength;
  float magnitude = length(k);
  if (magnitude < .00001) { gl_FragColor = vec4(0.0); return; }
  float omega = sqrt(9.81 * magnitude * (1.0 + magnitude * magnitude * .000074));
  vec2 rotation = vec2(cos(omega * uTime), sin(omega * uTime));
  vec4 initial = texelFetch(uInitial, cell, 0);
  vec2 h = multiplyComplex(initial.xy, vec2(rotation.x, -rotation.y)) + multiplyComplex(vec2(initial.z, -initial.w), rotation);
  vec2 d = k / magnitude;
  vec2 packedDisplacement = vec2(-h.y * d.x - h.x * d.y, h.x * d.x - h.y * d.y);
  gl_FragColor = vec4(h, packedDisplacement);
}
`;

export const SPECTRUM_FFT_GLSL = /* glsl */ `
uniform sampler2D uInput;
uniform float uStep, uSize, uHorizontal;
vec2 multiplyComplex(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  vec2 cell = gl_FragCoord.xy - .5;
  float index = uHorizontal > .5 ? cell.x : cell.y;
  float evenIndex = floor(index / uStep) * uStep * .5 + mod(index, uStep * .5);
  vec2 evenCell = uHorizontal > .5 ? vec2(evenIndex, cell.y) : vec2(cell.x, evenIndex);
  vec2 oddCell = evenCell + (uHorizontal > .5 ? vec2(uSize * .5, 0) : vec2(0, uSize * .5));
  vec4 evenValue = texelFetch(uInput, ivec2(evenCell), 0), oddValue = texelFetch(uInput, ivec2(oddCell), 0);
  float angle = 6.283185307 * index / uStep;
  vec2 twiddle = vec2(cos(angle), sin(angle));
  gl_FragColor = evenValue + vec4(multiplyComplex(twiddle, oddValue.xy), multiplyComplex(twiddle, oddValue.zw));
}
`;

export const SPECTRUM_PACK_GLSL = /* glsl */ `
uniform sampler2D uInput;
uniform float uGain;
void main() {
  vec4 field = texelFetch(uInput, ivec2(gl_FragCoord.xy), 0);
  float chop = min(2.0, pow(uGain, .75)) * 1.05;
  gl_FragColor = vec4(field.b * chop, field.r * uGain, field.a * chop, 1.0);
}
`;

export const SPECTRUM_DERIVE_GLSL = /* glsl */ `
uniform sampler2D uDisplacement, uPrevious;
uniform float uSize, uLength, uDelta, uFoamStorm;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize, texel = vec2(1.0 / uSize, 0.0);
  vec3 dx = (texture2D(uDisplacement, uv + texel.xy).xyz - texture2D(uDisplacement, uv - texel.xy).xyz) * uSize / (2.0 * uLength);
  vec3 dz = (texture2D(uDisplacement, uv + texel.yx).xyz - texture2D(uDisplacement, uv - texel.yx).xyz) * uSize / (2.0 * uLength);
  vec3 n = cross(vec3(dz.x, dz.y, 1.0 + dz.z), vec3(1.0 + dx.x, dx.y, dx.z));
  n *= inversesqrt(max(dot(n, n), 1e-12));
  vec2 slope = clamp(-n.xz / max(.25, n.y), vec2(-4.0), vec2(4.0));
  float jacobian = (1.0 + dx.x) * (1.0 + dz.z) - dx.z * dz.x;
  float previous = texture2D(uPrevious, uv - vec2(1.9, .8) * uDelta / uLength).b;
  float breaking = smoothstep(.22, .48, 1.0 - jacobian);
  float foam = max(previous * exp(-uDelta * mix(.62,.35,uFoamStorm)), breaking);
  gl_FragColor = vec4(slope, foam, dot(slope, slope));
}
`;

/** Displacement / slope sampling. Cascade tile lengths are uniforms, not world size. */
export const SPECTRUM_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uDisplacement0, uDisplacement1, uDisplacement2;
uniform sampler2D uSlope0, uSlope1, uSlope2;
uniform vec3 uCascadeLength;
uniform vec3 uCascadeSize;
vec3 spectralLOD(float footprint) {
  return max(vec3(0.0), log2(max(vec3(.001), footprint * uCascadeSize / uCascadeLength)));
}
vec2 cascadeUv(vec2 p, float lengthMetres) {
  return p / max(lengthMetres, 1.0);
}
vec3 spectralDisplacement(vec2 p) {
  vec3 swell = texture2D(uDisplacement0, cascadeUv(p, uCascadeLength.x)).xyz;
  vec3 wind = texture2D(uDisplacement1, cascadeUv(p, uCascadeLength.y)).xyz;
  vec3 chop = texture2D(uDisplacement2, cascadeUv(p, uCascadeLength.z)).xyz;
  return swell + wind + chop;
}
vec2 spectralSlope(vec2 p) {
  vec2 swell = texture2D(uSlope0, cascadeUv(p, uCascadeLength.x)).xy;
  vec2 wind = texture2D(uSlope1, cascadeUv(p, uCascadeLength.y)).xy;
  vec2 chop = texture2D(uSlope2, cascadeUv(p, uCascadeLength.z)).xy;
  return swell + wind + chop;
}
`;
