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
import { SPECTRUM_SAMPLE_GLSL } from './spectrum';
import { SURFACE_FUNCTIONS_GLSL } from './surface';
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
  /** Hull origin at issue time. Spatial freshness uses this, not the site point. */
  readonly originX: number;
  readonly originZ: number;
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
  readonly bed?: THREE.Texture | null;
  readonly bedOrigin?: { x: number; z: number };
  readonly bedExtent?: number;
  readonly wetBand?: number;
  readonly waveHeight?: number;
  readonly coastal?: THREE.Texture | null;
  readonly coastalEnabled?: boolean;
  readonly coastalOrigin?: { x: number; z: number };
  readonly coastalExtent?: number;
  readonly swellDirection?: { x: number; z: number };
}

export interface SurfaceProbeQuery {
  readonly missionGeneration: number;
  readonly backendGeneration: number;
  readonly now?: number;
  readonly maxAge?: number;
  readonly livingIds?: ReadonlySet<string>;
  readonly positions?: ReadonlyMap<string, { x: number; z: number }>;
  readonly maxSpatialError?: number;
}

export interface ProbeSubject {
  readonly entityId: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly span: number;
  readonly depth: number;
}

export interface SurfaceProbeRequestContext {
  readonly time: number;
  readonly missionGeneration: number;
  readonly backendGeneration: number;
}

/** Drop a result that is older than this (seconds) even if generations match. */
export const PROBE_MAX_AGE = 0.75;
/** Initial GPU readback budget. Adapt from measured latency later. */
export const PROBE_CADENCE_HZ = 10;
/** Reject a footprint that was issued far from the hull's current position. */
export const PROBE_SPATIAL_TOLERANCE_M = 8;
/** Skip GPU attitude for hulls deeper than this (metres). */
export const PROBE_MAX_SUBJECT_DEPTH_M = 8;

export const PROBE_FRAGMENT = /* glsl */ `
${SPECTRUM_SAMPLE_GLSL}
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
${SURFACE_FUNCTIONS_GLSL}
uniform sampler2D uPoints;
uniform float uCount;
void main() {
  float index = floor(gl_FragCoord.x);
  if (index >= uCount) { gl_FragColor = vec4(0.0); return; }
  vec2 requested = texelFetch(uPoints, ivec2(int(index), 0), 0).xy;
  vec2 source = oceanInverseDisplacement(requested);
  vec3 d = oceanDisplacement(source);
  vec3 n = oceanNormal(source);
  gl_FragColor = vec4(d.y, n.xz, 1.0);
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
    originX: x,
    originZ: z,
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
  const pos = query.positions?.get(sample.entityId);
  if (pos) {
    const issuedX = sample.originX;
    const issuedZ = sample.originZ;
    const error = Math.hypot(issuedX - pos.x, issuedZ - pos.z);
    const maxError = query.maxSpatialError ?? PROBE_SPATIAL_TOLERANCE_M;
    if (error > maxError) return false;
  }
  return true;
}

export function shouldRequestProbes(
  pending: boolean,
  lastIssued: number | null,
  now: number,
  cadenceHz = PROBE_CADENCE_HZ,
): boolean {
  if (pending) return false;
  if (lastIssued === null || !Number.isFinite(lastIssued)) return true;
  const interval = 1 / Math.max(1, cadenceHz);
  return now - lastIssued >= interval - 1e-6;
}

export function prioritizeProbeRequests(
  subjects: readonly ProbeSubject[],
  camera: { x: number; z: number },
  capacity: number,
): SurfaceProbeRequest[] {
  const budget = Math.max(1, Math.floor(capacity));
  const usable = subjects.filter(
    (subject) => subject.entityId === 'player' || subject.depth <= PROBE_MAX_SUBJECT_DEPTH_M,
  );
  const ranked = [...usable].sort((a, b) => {
    if (a.entityId === 'player' && b.entityId !== 'player') return -1;
    if (b.entityId === 'player' && a.entityId !== 'player') return 1;
    return Math.hypot(a.x - camera.x, a.z - camera.z) - Math.hypot(b.x - camera.x, b.z - camera.z);
  });
  const requests: SurfaceProbeRequest[] = [];
  const hullBudget = Math.max(5, budget - 1);
  for (const subject of ranked) {
    const next = buildFootprintRequests(
      subject.entityId,
      subject.x,
      subject.z,
      subject.heading,
      subject.span,
    );
    if (requests.length + next.length > hullBudget) break;
    requests.push(...next);
  }
  if (requests.length < budget) {
    requests.push({
      id: probeSampleId('camera', 'center'),
      entityId: 'camera',
      site: 'center',
      x: camera.x,
      z: camera.z,
      originX: camera.x,
      originZ: camera.z,
    });
  }
  return requests.slice(0, budget);
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
  private readonly dummy: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private pending = false;
  private token = 0;
  private issued = 0;
  private latest: SurfaceProbeResult[] = [];
  private disposed = false;
  private gpuReleased = false;

  constructor(capacity = 32) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.pointsData = new Float32Array(this.capacity * 4);
    this.points = new THREE.DataTexture(
      this.pointsData,
      this.capacity,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.points.minFilter = THREE.NearestFilter;
    this.points.magFilter = THREE.NearestFilter;
    this.points.needsUpdate = true;
    this.dummy = new THREE.DataTexture(
      new Float32Array(4),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.dummy.needsUpdate = true;
    this.target = createFloatTarget({ width: this.capacity, height: 1, type: THREE.FloatType });
    this.material = simulationMaterial(
      {
        uPoints: { value: this.points },
        uCount: { value: 0 },
        uDisplacement0: { value: null },
        uDisplacement1: { value: null },
        uDisplacement2: { value: null },
        uSlope0: { value: null },
        uSlope1: { value: null },
        uSlope2: { value: null },
        uCascadeLength: { value: new THREE.Vector3(1, 1, 1) },
        uCascadeSize: { value: new THREE.Vector3(1, 1, 1) },
        uCoastal: { value: this.dummy },
        uCoastalEnabled: { value: 0 },
        uCoastalOrigin: { value: new THREE.Vector2(0, 0) },
        uCoastalExtent: { value: 1 },
        uSwellDirection: { value: new THREE.Vector2(1, 0) },
        uBedTex: { value: this.dummy },
        uBedOrigin: { value: new THREE.Vector2(0, 0) },
        uBedExtent: { value: 1 },
        uWetBand: { value: 6 },
        uWaveHeight: { value: 1 },
      },
      PROBE_FRAGMENT,
      PASS_VERTEX_GLSL,
    );
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
    (u.uCascadeLength!.value as THREE.Vector3).set(
      maps.lengths[0] ?? 1,
      maps.lengths[1] ?? 1,
      maps.lengths[2] ?? 1,
    );
    u.uBedTex!.value = maps.bed ?? this.dummy;
    (u.uBedOrigin!.value as THREE.Vector2).set(maps.bedOrigin?.x ?? 0, maps.bedOrigin?.z ?? 0);
    u.uBedExtent!.value = maps.bedExtent ?? 1;
    u.uWetBand!.value = maps.wetBand ?? 6;
    u.uWaveHeight!.value = maps.waveHeight ?? 1;
    u.uCoastal!.value = maps.coastal ?? this.dummy;
    u.uCoastalEnabled!.value = maps.coastalEnabled && maps.coastal ? 1 : 0;
    (u.uCoastalOrigin!.value as THREE.Vector2).set(
      maps.coastalOrigin?.x ?? 0,
      maps.coastalOrigin?.z ?? 0,
    );
    u.uCoastalExtent!.value = maps.coastalExtent ?? 1;
    (u.uSwellDirection!.value as THREE.Vector2).set(
      maps.swellDirection?.x ?? 1,
      maps.swellDirection?.z ?? 0,
    );
    // SimulationPass leaves the bound target; restore so the main canvas pass is not stolen.
    withRendererPass(renderer, () => {
      this.pass.run(renderer, this.material, this.target);
    });
    const output = new Float32Array(this.capacity * 4);
    const token = ++this.token;
    this.pending = true;
    this.issued += 1;
    void renderer
      .readRenderTargetPixelsAsync(this.target, 0, 0, this.capacity, 1, output)
      .then(() => {
        if (this.disposed || token !== this.token) return;
        this.latest = decodeProbeOutput(batch, output, context);
      })
      .catch(() => {
        /* Late/unsupported readback leaves the bounded previous presentation result. */
      })
      .finally(() => {
        // Clear unconditionally: reset()/dispose() bump `token` so this batch is
        // stale, but request() refuses work while `pending` is true. There cannot
        // be a newer overlapping readback under that gate.
        this.pending = false;
        if (this.disposed) this.releaseGpu();
      });
  }

  consume(query: SurfaceProbeQuery): readonly SurfaceProbeResult[] {
    return filterProbeResults(this.latest, query);
  }

  get readbackCount(): number {
    return this.issued;
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
    // cannot overlap. The in-flight `finally` always clears the flag.
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
    this.dummy.dispose();
    disposeTarget(this.target);
    disposeMaterial(this.material);
    this.pass.dispose();
  }
}
