import * as THREE from 'three';
import { QUALITY_PROFILES } from '../quality';
import type {
  EnvironmentBackend,
  EnvironmentDiagnostics,
  EnvironmentFrame,
  EnvironmentQuality,
  OceanBackendName,
  WorldVersion,
} from '../environment/types';
import type { PackedHeightField } from '../environment/terrain-texture';
import { Ocean } from '../ocean';

export class GerstnerBackend implements EnvironmentBackend {
  readonly name: OceanBackendName = 'gerstner';
  private disposed = false;
  private missionGeneration = 0;
  private requestedBackend: OceanBackendName = 'gerstner';
  private worldVersion: WorldVersion = 'legacy-v1';
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;

  constructor(
    readonly ocean: Ocean,
    opts?: { requestedBackend?: OceanBackendName; worldVersion?: WorldVersion },
  ) {
    this.requestedBackend = opts?.requestedBackend ?? 'gerstner';
    this.worldVersion = opts?.worldVersion ?? 'legacy-v1';
  }

  bindPassTargets(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.renderer = renderer;
    this.camera = camera;
  }

  bindHeightField(field: PackedHeightField): void {
    if (this.disposed) return;
    this.ocean.bindHeightField(field);
  }

  prepare(frame: EnvironmentFrame): void {
    if (this.disposed) return;
    const fog = new THREE.Color(frame.fogColor.r, frame.fogColor.g, frame.fogColor.b);
    const sunDir = new THREE.Vector3(frame.sunDir.x, frame.sunDir.y, frame.sunDir.z);
    const sunColor = new THREE.Color(frame.sunColor.r, frame.sunColor.g, frame.sunColor.b);
    const sky = new THREE.Color(frame.skyColor.r, frame.skyColor.g, frame.skyColor.b);
    this.ocean.update(
      frame.time,
      frame.ocean,
      frame.fogDensity,
      fog,
      sunDir,
      sunColor,
      sky,
      frame.dt,
      frame.sandColorHex,
    );
    this.ocean.setReadability(frame.readability.clarity, frame.readability.absorption);
    this.ocean.follow(frame.followX, frame.followZ);
    if (!frame.paused) this.ocean.emitMotionRipples([...frame.wakes]);
    this.ocean.bindSpectralMaps(null);
    this.ocean.mesh.visible = true;
  }

  renderPasses(): void {
    if (this.disposed || !this.renderer || !this.camera) return;
    this.ocean.preRender(this.renderer, this.camera);
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) return;
    this.ocean.resize(width, height, dpr);
  }

  setQuality(profile: EnvironmentQuality): void {
    if (this.disposed) return;
    this.ocean.setQuality(QUALITY_PROFILES[profile]);
  }

  reset(missionGeneration: number): void {
    this.missionGeneration = missionGeneration;
  }

  getDiagnostics(): EnvironmentDiagnostics {
    return {
      backend: 'gerstner',
      requestedBackend: this.requestedBackend,
      ready: !this.disposed,
      fallbackReason: null,
      missionGeneration: this.missionGeneration,
      worldVersion: this.worldVersion,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer = null;
    this.camera = null;
  }
}
