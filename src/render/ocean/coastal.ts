/** Finite-depth coastal travel field. Terrain extents are injected, never demo-hard-coded. */

import { DEFAULT_PEAK_WAVELENGTH, GRAVITY, TAU } from './spectrum';

export type BedSampler = (worldX: number, worldZ: number) => number;

export interface CoastalPhysics {
  readonly gravity: number;
  readonly peakWavelength: number;
  readonly swellDirection: number;
  /** Bed height (m, up) above which travel is blocked. */
  readonly landCutoff: number;
  readonly fetchBlockHeight: number;
  readonly fetchDampHeight: number;
  readonly fetchDamp: number;
  readonly fetchSteps: number;
  readonly fetchStepMetres: number;
  readonly fetchRayCount: number;
  readonly fetchRaySpread: number;
  readonly sweepCycles: number;
  readonly minDepth: number;
}

export const COASTAL_PHYSICS: CoastalPhysics = {
  gravity: GRAVITY,
  peakWavelength: DEFAULT_PEAK_WAVELENGTH,
  swellDirection: 0.48,
  landCutoff: 1.8,
  fetchBlockHeight: 0.8,
  fetchDampHeight: -0.5,
  fetchDamp: 0.87,
  fetchSteps: 28,
  fetchStepMetres: 12,
  fetchRayCount: 7,
  fetchRaySpread: 0.14,
  sweepCycles: 8,
  minDepth: 0.38,
};

export interface CoastalFieldConfig {
  /** World-space min corner of the field (metres). */
  readonly originX: number;
  readonly originZ: number;
  /** Square extent in metres. Independent of FFT tile lengths. */
  readonly extent: number;
  readonly resolution: number;
  readonly physics?: Partial<CoastalPhysics>;
  readonly signal?: AbortSignal;
}

export interface CoastalField {
  readonly data: Float32Array;
  readonly resolution: number;
  readonly originX: number;
  readonly originZ: number;
  readonly extent: number;
  readonly directionX: number;
  readonly directionZ: number;
  readonly phaseSpeed: number;
  readonly swellDirection: number;
}

const INF = 1e8;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
}

export function solveFiniteDepthK(
  depth: number,
  k0: number,
  omega2: number,
  gravity: number,
): number {
  const h = Math.max(depth, 1e-4);
  let k = Math.max(k0, Math.sqrt(omega2 / (gravity * h)));
  for (let j = 0; j < 5; j++) {
    const t = Math.tanh(k * h);
    k = Math.max(k0, k - (gravity * k * t - omega2) / (gravity * (t + k * h * (1 - t * t))));
  }
  return k;
}

function clampWorld(value: number, origin: number, extent: number): number {
  return Math.min(origin + extent - 1e-4, Math.max(origin, value));
}

/**
 * CPU travel-time / exposure field. Sync: no rAF. Callers inject bed heights.
 * Output RGBA: delay metres, unit swell dir xz, fetch exposure.
 */
export function buildCoastalField(sampleBed: BedSampler, config: CoastalFieldConfig): CoastalField {
  const n = config.resolution;
  if (n < 8) throw new Error('coastal resolution must be at least 8');
  if (!(config.extent > 0)) throw new Error('coastal extent must be positive');
  const physics: CoastalPhysics = { ...COASTAL_PHYSICS, ...config.physics };
  const { originX, originZ, extent } = config;
  const dx = extent / n;
  const dirX = Math.cos(physics.swellDirection);
  const dirZ = Math.sin(physics.swellDirection);
  const k0 = TAU / physics.peakWavelength;
  const omega2 = physics.gravity * k0;
  const c0 = Math.sqrt(physics.gravity / k0);
  const farX = originX - extent / 2;
  const farZ = originZ - extent / 2;

  const bed = new Float32Array(n * n);
  const slow = new Float32Array(n * n);
  const travel = new Float64Array(n * n).fill(INF);
  const fixed = new Uint8Array(n * n);

  const readBed = (wx: number, wz: number): number =>
    sampleBed(clampWorld(wx, originX, extent), clampWorld(wz, originZ, extent));

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      throwIfAborted(config.signal);
      const i = z * n + x;
      const wx = originX + (x + 0.5) * dx;
      const wz = originZ + (z + 0.5) * dx;
      const height = readBed(wx, wz);
      bed[i] = height;
      const h = Math.max(physics.minDepth, -height);
      const k = solveFiniteDepthK(h, k0, omega2, physics.gravity);
      slow[i] = k / Math.sqrt(omega2);
      if (height > physics.landCutoff) continue;
      if (x === 0 || z === 0) {
        travel[i] = ((wx - farX) * dirX + (wz - farZ) * dirZ) / c0;
        fixed[i] = 1;
      }
    }
  }

  const sweeps: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let cycle = 0; cycle < physics.sweepCycles; cycle++) {
    throwIfAborted(config.signal);
    for (const [sx, sz] of sweeps) {
      for (let zz = 0; zz < n; zz++) {
        for (let xx = 0; xx < n; xx++) {
          const x = sx > 0 ? xx : n - xx - 1;
          const z = sz > 0 ? zz : n - zz - 1;
          const i = z * n + x;
          if (fixed[i] || bed[i]! > physics.landCutoff) continue;
          const a = Math.min(x ? travel[i - 1]! : INF, x + 1 < n ? travel[i + 1]! : INF);
          const b = Math.min(z ? travel[i - n]! : INF, z + 1 < n ? travel[i + n]! : INF);
          const step = slow[i]! * dx;
          const diff = Math.abs(a - b);
          const value =
            diff >= step
              ? Math.min(a, b) + step
              : (a + b + Math.sqrt(Math.max(0, 2 * step * step - diff * diff))) * 0.5;
          travel[i] = Math.min(travel[i]!, value);
        }
      }
    }
  }

  const halfRays = (physics.fetchRayCount - 1) / 2;
  const data = new Float32Array(n * n * 4);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      throwIfAborted(config.signal);
      const i = z * n + x;
      const wx = originX + (x + 0.5) * dx;
      const wz = originZ + (z + 0.5) * dx;
      const reference = (wx - farX) * dirX + (wz - farZ) * dirZ;
      const base = i * 4;
      if (travel[i]! > 1e7) {
        data[base] = 0;
        data[base + 1] = dirX;
        data[base + 2] = dirZ;
        data[base + 3] = 0.04;
        continue;
      }
      const validTime = (j: number): number => (travel[j]! > 1e7 ? travel[i]! : travel[j]!);
      const gx = validTime(z * n + Math.min(n - 1, x + 1)) - validTime(z * n + Math.max(0, x - 1));
      const gz = validTime(Math.min(n - 1, z + 1) * n + x) - validTime(Math.max(0, z - 1) * n + x);
      const length = Math.hypot(gx, gz) || 1;
      let exposure = 0;
      for (let ray = -halfRays; ray <= halfRays; ray++) {
        const angle = physics.swellDirection + ray * physics.fetchRaySpread;
        const rx = Math.cos(angle);
        const rz = Math.sin(angle);
        let energy = 1;
        for (let step = 1; step <= physics.fetchSteps; step++) {
          const distance = step * physics.fetchStepMetres;
          const h = readBed(wx - rx * distance, wz - rz * distance);
          if (h > physics.fetchBlockHeight) {
            energy = 0.025;
            break;
          }
          if (h > physics.fetchDampHeight) energy *= physics.fetchDamp;
        }
        exposure += energy / physics.fetchRayCount;
      }
      exposure = 0.09 + 0.91 * exposure;
      data[base] = Math.max(-10, Math.min(800, travel[i]! * c0 - reference));
      data[base + 1] = gx / length;
      data[base + 2] = gz / length;
      data[base + 3] = exposure;
    }
  }

  return {
    data,
    resolution: n,
    originX,
    originZ,
    extent,
    directionX: dirX,
    directionZ: dirZ,
    phaseSpeed: c0,
    swellDirection: physics.swellDirection,
  };
}

/**
 * Same solver as `buildCoastalField`, yielding to the event loop so spectral
 * patrol frames keep painting while a field rebuilds.
 */
export async function buildCoastalFieldAsync(
  sampleBed: BedSampler,
  config: CoastalFieldConfig,
): Promise<CoastalField> {
  const n = config.resolution;
  if (n < 8) throw new Error('coastal resolution must be at least 8');
  if (!(config.extent > 0)) throw new Error('coastal extent must be positive');
  const physics: CoastalPhysics = { ...COASTAL_PHYSICS, ...config.physics };
  const { originX, originZ, extent } = config;
  const dx = extent / n;
  const dirX = Math.cos(physics.swellDirection);
  const dirZ = Math.sin(physics.swellDirection);
  const k0 = TAU / physics.peakWavelength;
  const omega2 = physics.gravity * k0;
  const c0 = Math.sqrt(physics.gravity / k0);
  const farX = originX - extent / 2;
  const farZ = originZ - extent / 2;

  const bed = new Float32Array(n * n);
  const slow = new Float32Array(n * n);
  const travel = new Float64Array(n * n).fill(INF);
  const fixed = new Uint8Array(n * n);
  let ops = 0;
  let lastYield = performance.now();
  const checkpoint = async (): Promise<void> => {
    throwIfAborted(config.signal);
    ops += 1;
    const now = performance.now();
    // Yield at most every ~2ms of CPU so frames keep painting without
    // flooding the event loop (unit tests use the same async path).
    if (ops % 256 === 0 && now - lastYield >= 2) {
      lastYield = now;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      throwIfAborted(config.signal);
    }
  };

  const readBed = (wx: number, wz: number): number =>
    sampleBed(clampWorld(wx, originX, extent), clampWorld(wz, originZ, extent));

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      await checkpoint();
      const i = z * n + x;
      const wx = originX + (x + 0.5) * dx;
      const wz = originZ + (z + 0.5) * dx;
      const height = readBed(wx, wz);
      bed[i] = height;
      const h = Math.max(physics.minDepth, -height);
      const k = solveFiniteDepthK(h, k0, omega2, physics.gravity);
      slow[i] = k / Math.sqrt(omega2);
      if (height > physics.landCutoff) continue;
      if (x === 0 || z === 0) {
        travel[i] = ((wx - farX) * dirX + (wz - farZ) * dirZ) / c0;
        fixed[i] = 1;
      }
    }
  }

  const sweeps: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let cycle = 0; cycle < physics.sweepCycles; cycle++) {
    for (const [sx, sz] of sweeps) {
      for (let zz = 0; zz < n; zz++) {
        for (let xx = 0; xx < n; xx++) {
          await checkpoint();
          const x = sx > 0 ? xx : n - xx - 1;
          const z = sz > 0 ? zz : n - zz - 1;
          const i = z * n + x;
          if (fixed[i] || bed[i]! > physics.landCutoff) continue;
          const a = Math.min(x ? travel[i - 1]! : INF, x + 1 < n ? travel[i + 1]! : INF);
          const b = Math.min(z ? travel[i - n]! : INF, z + 1 < n ? travel[i + n]! : INF);
          const step = slow[i]! * dx;
          const diff = Math.abs(a - b);
          const value =
            diff >= step
              ? Math.min(a, b) + step
              : (a + b + Math.sqrt(Math.max(0, 2 * step * step - diff * diff))) * 0.5;
          travel[i] = Math.min(travel[i]!, value);
        }
      }
    }
  }

  const halfRays = (physics.fetchRayCount - 1) / 2;
  const data = new Float32Array(n * n * 4);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      await checkpoint();
      const i = z * n + x;
      const wx = originX + (x + 0.5) * dx;
      const wz = originZ + (z + 0.5) * dx;
      const reference = (wx - farX) * dirX + (wz - farZ) * dirZ;
      const base = i * 4;
      if (travel[i]! > 1e7) {
        data[base] = 0;
        data[base + 1] = dirX;
        data[base + 2] = dirZ;
        data[base + 3] = 0.04;
        continue;
      }
      const validTime = (j: number): number => (travel[j]! > 1e7 ? travel[i]! : travel[j]!);
      const gx = validTime(z * n + Math.min(n - 1, x + 1)) - validTime(z * n + Math.max(0, x - 1));
      const gz = validTime(Math.min(n - 1, z + 1) * n + x) - validTime(Math.max(0, z - 1) * n + x);
      const length = Math.hypot(gx, gz) || 1;
      let exposure = 0;
      for (let ray = -halfRays; ray <= halfRays; ray++) {
        const angle = physics.swellDirection + ray * physics.fetchRaySpread;
        const rx = Math.cos(angle);
        const rz = Math.sin(angle);
        let energy = 1;
        for (let step = 1; step <= physics.fetchSteps; step++) {
          const distance = step * physics.fetchStepMetres;
          const h = readBed(wx - rx * distance, wz - rz * distance);
          if (h > physics.fetchBlockHeight) {
            energy = 0.025;
            break;
          }
          if (h > physics.fetchDampHeight) energy *= physics.fetchDamp;
        }
        exposure += energy / physics.fetchRayCount;
      }
      exposure = 0.09 + 0.91 * exposure;
      data[base] = Math.max(-10, Math.min(800, travel[i]! * c0 - reference));
      data[base + 1] = gx / length;
      data[base + 2] = gz / length;
      data[base + 3] = exposure;
    }
  }

  return {
    data,
    resolution: n,
    originX,
    originZ,
    extent,
    directionX: dirX,
    directionZ: dirZ,
    phaseSpeed: c0,
    swellDirection: physics.swellDirection,
  };
}

/** Coastal sampling GLSL. World origin/extent are uniforms (not 1100 from the demo). */
export const COASTAL_GLSL = /* glsl */ `
uniform sampler2D uCoastMap;
uniform sampler2D uHeightMap;
uniform vec2 uCoastOrigin;
uniform float uCoastExtent;
uniform vec2 uHeightOrigin;
uniform float uHeightExtent;
uniform float uSwellGain, uSurfaceWind, uTime;
uniform vec2 uWindDirection;
uniform vec2 uSwellDirection;
vec2 coastUv(vec2 p) { return (p - uCoastOrigin) / uCoastExtent; }
vec2 heightUv(vec2 p) { return (p - uHeightOrigin) / uHeightExtent; }
vec4 coastField(vec2 p) {
  vec2 uv = coastUv(p);
  vec4 c = texture2D(uCoastMap, clamp(uv, .001, .999));
  float edge = 1.0 - smoothstep(.41, .495, max(abs(uv.x - .5), abs(uv.y - .5)));
  c = mix(vec4(0.0, uSwellDirection.x, uSwellDirection.y, 1.0), c, edge);
  c.a = clamp(c.a, 0.0, 1.0);
  c.yz *= inversesqrt(max(dot(c.yz, c.yz), 1e-8));
  return c;
}
float energyRegion(vec2 p) {
  return .88 + .09 * sin(dot(p, vec2(.0031, .0017)) - uTime * .012)
    + .065 * sin(dot(p, vec2(-.0013, .0041)) + uTime * .009);
}
vec2 swellCoordinates(vec2 p, vec4 c) { return p + uSwellDirection * c.x; }
vec2 windCoordinates(vec2 p) {
  return vec2(dot(p, uWindDirection), dot(p, vec2(-uWindDirection.y, uWindDirection.x)));
}
vec2 turnSwell(vec2 v, vec2 direction) {
  vec2 base = uSwellDirection;
  return direction * dot(v, base) + vec2(-direction.y, direction.x) * dot(v, vec2(-base.y, base.x));
}
vec2 turnWind(vec2 v) { return uWindDirection * v.x + vec2(-uWindDirection.y, uWindDirection.x) * v.y; }
float coastalDepth(vec2 p) { return max(.05, -texture2D(uHeightMap, clamp(heightUv(p), .001, .999)).r); }
float coastalFoamSupport(float depth) { return 1.0 - smoothstep(22.0, 40.0, depth); }
float swellEnvelope(float depth, float exposure) {
  float kh = .08055 * depth;
  float shoal = clamp(pow(1.0 / max(.05, tanh(kh)), .25) * mix(.86, 1.0, smoothstep(12.0, 45.0, depth)), .86, 1.8);
  float energy = sqrt(exposure);
  float limit = min(1.0, (.36 * depth + .065) / max(.08, .64 * uSwellGain * shoal * energy));
  return shoal * energy * limit;
}
float breakerPotential(vec2 p, float crest, float compression) {
  vec4 c = coastField(p);
  float depth = coastalDepth(p);
  float height = 1.5 * uSwellGain * sqrt(c.a);
  float instability = smoothstep(.48, .9, height / max(.3, depth));
  float amplitude = max(.12, .64 * uSwellGain * swellEnvelope(depth, c.a));
  float crestEvent = smoothstep(.45, 1.05, crest / amplitude);
  float exposure = smoothstep(.08, .65, c.a);
  return instability * crestEvent * smoothstep(.05, .5, depth)
    * (1.0 - smoothstep(9.0, 18.0, depth)) * exposure
    + compression * .10 * exposure;
}
`;
