import * as THREE from 'three';
import {
  createFloatTarget,
  disposeMaterial,
  disposeTarget,
  SimulationPass,
  simulationMaterial,
  withRendererPass,
} from './resources';
import { PASS_VERTEX_GLSL } from './spectrum';
import {
  FOOTPRINT_SITES,
  footprintPoints,
  type FootprintSite,
} from '../presentation/vessel-attitude';

export type SurfaceProbeSite = FootprintSite | 'camera';

export interface SurfaceProbeRequest {
  readonly id: string;
  readonly entityId: string;
  readonly site: SurfaceProbeSite;
  readonly x: number;
  readonly z: number;
}

export interface SurfaceProbeResult extends SurfaceProbeRequest {
  readonly height: number;
  readonly slopeX: number;
  readonly slopeZ: number;
  readonly time: number;
  readonly queryX: number;
  readonly queryZ: number;
  readonly missionGeneration: number;
  readonly backendGeneration: number;
}

export interface SurfaceProbeMaps {
  readonly displacements: readonly THREE.Texture[];
  readonly slopes: readonly THREE.Texture[];
  readonly lengths: readonly number[];
}

export interface SurfaceProbeQuery {
  readonly missionGeneration: number;
  readonly backendGeneration: number;
  readonly now?: number;
  readonly maxAge?: number;
  readonly livingIds?: ReadonlySet<string>;
}

export interface SurfaceProbeRequestContext {
  readonly time: number;
  readonly missionGeneration: number;
  readonly backendGeneration: number;
}

/** Drop a result that is older than this (seconds) even if generations match. */
export const PROBE_MAX_AGE = 0.75;

const PROBE_FRAGMENT = /* glsl */ `
uniform sampler2D uPoints;
uniform sampler2D uDisplacement0, uDisplacement1, uDisplacement2;
uniform sampler2D uSlope0, uSlope1, uSlope2;
uniform vec3 uLength;
uniform float uCount;
vec3 displacement(vec2 p) {
  return texture2D(uDisplacement0, p/uLength.x).xyz
    + texture2D(uDisplacement1, p/uLength.y).xyz
    + texture2D(uDisplacement2, p/uLength.z).xyz;
}
vec2 slope(vec2 p) {
  return texture2D(uSlope0, p/uLength.x).xy
    + texture2D(uSlope1, p/uLength.y).xy
    + texture2D(uSlope2, p/uLength.z).xy;
}
void main() {
  float index = floor(gl_FragCoord.x);
  if (index >= uCount) { gl_FragColor = vec4(0.0); return; }
  vec2 requested = texelFetch(uPoints, ivec2(int(index), 0), 0).xy;
  // Spectral textures encode displacement at their undisplaced grid location.
  // Fixed-point inversion finds the source point whose displaced xz reaches the
  // requested world point, matching the rendered surface rather than just height.
  vec2 source = requested;
  for (int i = 0; i < 4; i++) source = requested - displacement(source).xz;
  vec3 d = displacement(source);
  vec2 s = slope(source);
  gl_FragColor = vec4(d.y, s, 1.0);
}`;

export function probeSampleId(entityId: string, site: SurfaceProbeSite): string {
  return `${entityId}:${site}`;
}

export function buildFootprintRequests(
  entityId: string,
  x: number,
  z: number,
  heading: number,
  span: number,
): SurfaceProbeRequest[] {
  const points = footprintPoints(x, z, heading, span);
  return FOOTPRINT_SITES.map((site) => ({
    id: probeSampleId(entityId, site),
    entityId,
    site,
    x: points[site].x,
    z: points[site].z,
  }));
}

export function isFreshProbe(sample: SurfaceProbeResult, query: SurfaceProbeQuery): boolean {
  if (sample.missionGeneration !== query.missionGeneration) return false;
  if (sample.backendGeneration !== query.backendGeneration) return false;
  if (query.livingIds && !query.livingIds.has(sample.entityId) && sample.entityId !== 'camera') {
    return false;
  }
  if (query.now !== undefined) {
    const age = query.now - sample.time;
    const maxAge = query.maxAge ?? PROBE_MAX_AGE;
    if (age > maxAge) return false;
  }
  return true;
}

export function filterProbeResults(
  samples: readonly SurfaceProbeResult[],
  query: SurfaceProbeQuery,
): SurfaceProbeResult[] {
  return samples.filter((sample) => isFreshProbe(sample, query));
}

export function decodeProbeOutput(
  batch: readonly SurfaceProbeRequest[],
  output: ArrayLike<number>,
  context: SurfaceProbeRequestContext,
): SurfaceProbeResult[] {
  return batch.map((request, i) => ({
    ...request,
    height: output[i * 4] ?? 0,
    slopeX: output[i * 4 + 1] ?? 0,
    slopeZ: output[i * 4 + 2] ?? 0,
    time: context.time,
    queryX: request.x,
    queryZ: request.z,
    missionGeneration: context.missionGeneration,
    backendGeneration: context.backendGeneration,
  }));
}

/** One bounded asynchronous GPU readback shared by all visible surface vessels. */
export class SurfaceProbeQueue {
  readonly capacity: number;
  private readonly pass = new SimulationPass();
  private readonly target: THREE.WebGLRenderTarget;
  private readonly pointsData: Float32Array;
  private readonly points: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private pending = false;
  private token = 0;
  private latest: SurfaceProbeResult[] = [];
  private disposed = false;
  private gpuReleased = false;

  constructor(capacity = 32) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.pointsData = new Float32Array(this.capacity * 4);
    this.points = new THREE.DataTexture(this.pointsData, this.capacity, 1, THREE.RGBAFormat, THREE.FloatType);
    this.points.minFilter = THREE.NearestFilter;
    this.points.magFilter = THREE.NearestFilter;
    this.points.needsUpdate = true;
    this.target = createFloatTarget({ width: this.capacity, height: 1, type: THREE.FloatType });
    this.material = simulationMaterial({
      uPoints: { value: this.points }, uCount: { value: 0 },
      uDisplacement0: { value: null }, uDisplacement1: { value: null }, uDisplacement2: { value: null },
      uSlope0: { value: null }, uSlope1: { value: null }, uSlope2: { value: null },
      uLength: { value: new THREE.Vector3(1, 1, 1) },
    }, PROBE_FRAGMENT, PASS_VERTEX_GLSL);
  }

  get hasPendingReadback(): boolean {
    return this.pending;
  }

  request(
    renderer: THREE.WebGLRenderer,
    maps: SurfaceProbeMaps,
    requests: readonly SurfaceProbeRequest[],
    context: SurfaceProbeRequestContext,
  ): void {
    if (this.disposed || this.pending || requests.length === 0) return;
    if (maps.displacements.length < 3 || maps.slopes.length < 3) return;
    const batch = requests.slice(0, this.capacity);
    this.pointsData.fill(0);
    batch.forEach((request, i) => {
      this.pointsData[i * 4] = request.x;
      this.pointsData[i * 4 + 1] = request.z;
    });
    this.points.needsUpdate = true;
    const u = this.material.uniforms;
    u.uCount!.value = batch.length;
    for (let i = 0; i < 3; i++) {
      u[`uDisplacement${i}`]!.value = maps.displacements[i];
      u[`uSlope${i}`]!.value = maps.slopes[i];
    }
    (u.uLength!.value as THREE.Vector3).set(maps.lengths[0] ?? 1, maps.lengths[1] ?? 1, maps.lengths[2] ?? 1);
    // SimulationPass leaves the bound target; restore so the main canvas pass is not stolen.
    withRendererPass(renderer, () => {
      this.pass.run(renderer, this.material, this.target);
    });
    const output = new Float32Array(this.capacity * 4);
    const token = ++this.token;
    this.pending = true;
    void renderer.readRenderTargetPixelsAsync(this.target, 0, 0, this.capacity, 1, output).then(() => {
      if (this.disposed || token !== this.token) return;
      this.latest = decodeProbeOutput(batch, output, context);
    }).catch(() => {
      /* Late/unsupported readback leaves the bounded previous presentation result. */
    }).finally(() => {
      if (token === this.token) this.pending = false;
      if (this.disposed) this.releaseGpu();
    });
  }

  consume(query: SurfaceProbeQuery): readonly SurfaceProbeResult[] {
    return filterProbeResults(this.latest, query);
  }

  /**
   * Invalidate results and any in-flight token. Does not dispose GPU targets
   * (a pending readback may still hold them). A new `request` waits until that
   * readback's `finally` clears `pending`.
   */
  reset(): void {
    this.token += 1;
    this.latest = [];
    // Leave `pending` true while a readback is in flight so a second request
    // cannot overlap. The superseded `finally` clears the flag.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.token += 1;
    this.latest = [];
    if (!this.pending) this.releaseGpu();
  }

  private releaseGpu(): void {
    if (this.gpuReleased) return;
    this.gpuReleased = true;
    this.pending = false;
    this.points.dispose();
    disposeTarget(this.target);
    disposeMaterial(this.material);
    this.pass.dispose();
  }
}
