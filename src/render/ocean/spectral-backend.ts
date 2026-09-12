/** Spectral EnvironmentBackend. GPU FFT displacement; no rAF / second canvas. */

import * as THREE from 'three';
import type {
  EnvironmentBackend,
  EnvironmentDiagnostics,
  EnvironmentFrame,
  EnvironmentQuality,
  OceanBackendName,
  WorldVersion,
} from '../environment/types';
import { Ocean } from '../ocean';
import { QUALITY_PROFILES } from '../quality';
import type { CoastalField } from './coastal';
import {
  createFloatTarget,
  createSpectrumDataTexture,
  disposeMaterial,
  disposeTarget,
  disposeTexture,
  SimulationPass,
  simulationMaterial,
  supportsFloatColorBuffer,
  withRendererPass,
} from './resources';
import {
  buildPackedInitialSpectrum,
  cascadeSeed,
  cascadeSpecsForQuality,
  DEFAULT_SPECTRUM_SEED,
  fftSizeForQuality,
  PASS_VERTEX_GLSL,
  SPECTRUM_DERIVE_GLSL,
  SPECTRUM_EVOLVE_GLSL,
  SPECTRUM_FFT_GLSL,
  SPECTRUM_PACK_GLSL,
  type CascadeSpec,
} from './spectrum';

export type SpectralInitCode =
  'aborted' | 'missing-renderer' | 'missing-ocean' | 'no-float-targets' | 'fft-init-failed';

export class SpectralInitError extends Error {
  readonly name = 'SpectralInitError';
  constructor(
    message: string,
    readonly code: SpectralInitCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    Object.setPrototypeOf(this, SpectralInitError.prototype);
  }
}

export interface SpectralBackendOptions {
  renderer: THREE.WebGLRenderer;
  ocean: Ocean;
  quality?: EnvironmentQuality;
  worldVersion?: WorldVersion;
  requestedBackend?: OceanBackendName;
  seed?: number;
  coastal?: CoastalField | null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason =
    signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
  throw new SpectralInitError(reason.message, 'aborted', { cause: reason });
}

class GpuSpectralCascade {
  readonly length: number;
  readonly size: number;
  readonly displacement: THREE.WebGLRenderTarget;
  readonly ping: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  readonly normals: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  normalIndex = 0;
  private readonly initialTexture: THREE.DataTexture;
  private readonly evolve: THREE.ShaderMaterial;
  private readonly transform: THREE.ShaderMaterial;
  private readonly pack: THREE.ShaderMaterial;
  private readonly derive: THREE.ShaderMaterial;
  private disposed = false;

  constructor(
    spec: CascadeSpec,
    fftSize: number,
    seed: number,
    pass: SimulationPass,
    renderer: THREE.WebGLRenderer,
  ) {
    this.length = spec.length;
    this.size = fftSize;
    this.ping = [
      createFloatTarget({ width: fftSize, height: fftSize }),
      createFloatTarget({ width: fftSize, height: fftSize }),
    ];
    this.displacement = createFloatTarget({ width: fftSize, height: fftSize, mipmaps: true });
    this.normals = [
      createFloatTarget({ width: fftSize, height: fftSize, mipmaps: true }),
      createFloatTarget({ width: fftSize, height: fftSize, mipmaps: true }),
    ];
    const packed = buildPackedInitialSpectrum({ spec, fftSize, seed });
    this.initialTexture = createSpectrumDataTexture(packed.initial, fftSize);
    this.evolve = simulationMaterial(
      {
        uInitial: { value: this.initialTexture },
        uTime: { value: 0 },
        uSize: { value: fftSize },
        uLength: { value: spec.length },
      },
      SPECTRUM_EVOLVE_GLSL,
      PASS_VERTEX_GLSL,
    );
    this.transform = simulationMaterial(
      {
        uInput: { value: null },
        uStep: { value: 2 },
        uSize: { value: fftSize },
        uHorizontal: { value: 1 },
      },
      SPECTRUM_FFT_GLSL,
      PASS_VERTEX_GLSL,
    );
    this.pack = simulationMaterial(
      { uInput: { value: null }, uGain: { value: spec.gain } },
      SPECTRUM_PACK_GLSL,
      PASS_VERTEX_GLSL,
    );
    this.derive = simulationMaterial(
      {
        uDisplacement: { value: this.displacement.texture },
        uPrevious: { value: this.normals[0].texture },
        uSize: { value: fftSize },
        uLength: { value: spec.length },
        uDelta: { value: 1 / 60 },
        uFoamStorm: { value: 0 },
      },
      SPECTRUM_DERIVE_GLSL,
      PASS_VERTEX_GLSL,
    );
    const clear = simulationMaterial(
      {},
      'void main() { gl_FragColor = vec4(0.0); }',
      PASS_VERTEX_GLSL,
    );
    try {
      for (const target of this.normals) pass.run(renderer, clear, target);
    } finally {
      disposeMaterial(clear);
    }
  }

  setGain(gain: number): void {
    this.pack.uniforms.uGain!.value = gain;
  }

  setTime(time: number): void {
    this.evolve.uniforms.uTime!.value = time;
  }

  setFoamStorm(value: number): void {
    this.derive.uniforms.uFoamStorm!.value = value;
  }

  update(pass: SimulationPass, renderer: THREE.WebGLRenderer, delta: number): void {
    if (this.disposed) return;
    pass.run(renderer, this.evolve, this.ping[0]);
    let index = 0;
    for (let axis = 0; axis < 2; axis++) {
      this.transform.uniforms.uHorizontal!.value = axis === 0 ? 1 : 0;
      for (let size = 2; size <= this.size; size *= 2) {
        this.transform.uniforms.uInput!.value = this.ping[index]!.texture;
        this.transform.uniforms.uStep!.value = size;
        index = 1 - index;
        pass.run(renderer, this.transform, this.ping[index]!);
      }
    }
    this.pack.uniforms.uInput!.value = this.ping[index]!.texture;
    pass.run(renderer, this.pack, this.displacement);
    this.derive.uniforms.uPrevious!.value = this.normals[this.normalIndex]!.texture;
    this.derive.uniforms.uDelta!.value = delta;
    this.normalIndex = 1 - this.normalIndex;
    pass.run(renderer, this.derive, this.normals[this.normalIndex]!);
  }

  slopeTexture(): THREE.Texture {
    return this.normals[this.normalIndex]!.texture;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeTarget(this.ping[0]);
    disposeTarget(this.ping[1]);
    disposeTarget(this.displacement);
    disposeTarget(this.normals[0]);
    disposeTarget(this.normals[1]);
    disposeTexture(this.initialTexture);
    disposeMaterial(this.evolve);
    disposeMaterial(this.transform);
    disposeMaterial(this.pack);
    disposeMaterial(this.derive);
  }
}

export class SpectralBackend implements EnvironmentBackend {
  readonly name: OceanBackendName = 'spectral';
  private disposed = false;
  private missionGeneration = 0;
  private readonly requestedBackend: OceanBackendName;
  private readonly worldVersion: WorldVersion;
  private quality: EnvironmentQuality;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly ocean: Ocean;
  private readonly seed: number;
  private readonly coastal: CoastalField | null;
  private pass: SimulationPass | null = null;
  private cascades: GpuSpectralCascade[] = [];
  private time = 0;
  private dt = 1 / 60;
  private frame = 0;
  private gpuReady = false;
  private camera: THREE.Camera | null = null;

  constructor(options: SpectralBackendOptions) {
    this.renderer = options.renderer;
    this.ocean = options.ocean;
    this.quality = options.quality ?? 'high';
    this.worldVersion = options.worldVersion ?? 'legacy-v1';
    this.requestedBackend = options.requestedBackend ?? 'spectral';
    this.seed = options.seed ?? DEFAULT_SPECTRUM_SEED;
    this.coastal = options.coastal ?? null;
  }

  get coastalField(): CoastalField | null {
    return this.coastal;
  }

  get displacementTextures(): THREE.Texture[] {
    return this.cascades.map((cascade) => cascade.displacement.texture);
  }

  get slopeTextures(): THREE.Texture[] {
    return this.cascades.map((cascade) => cascade.slopeTexture());
  }

  initializeGpu(signal: AbortSignal): void {
    throwIfAborted(signal);
    if (!supportsFloatColorBuffer(this.renderer)) {
      throw new SpectralInitError(
        'Floating-point render targets are required for the ocean simulation.',
        'no-float-targets',
      );
    }
    const pass = new SimulationPass();
    const created: GpuSpectralCascade[] = [];
    try {
      withRendererPass(this.renderer, () => {
        const specs = cascadeSpecsForQuality(this.quality);
        for (const spec of specs) {
          throwIfAborted(signal);
          created.push(
            new GpuSpectralCascade(
              spec,
              fftSizeForQuality(this.quality, spec.role),
              cascadeSeed(this.seed, spec.role),
              pass,
              this.renderer,
            ),
          );
        }
        for (const cascade of created) cascade.update(pass, this.renderer, 1 / 60);
      });
    } catch (error) {
      for (const cascade of created) cascade.dispose();
      pass.dispose();
      if (error instanceof SpectralInitError) throw error;
      throw new SpectralInitError(
        error instanceof Error ? error.message : String(error),
        'fft-init-failed',
        { cause: error },
      );
    }
    this.pass = pass;
    this.cascades = created;
    this.bindOceanMaps();
    this.gpuReady = true;
  }

  bindPassTargets(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.renderer !== renderer) return;
    this.camera = camera;
  }

  private bindOceanMaps(): void {
    this.ocean.bindSpectralMaps({
      displacements: this.displacementTextures,
      slopes: this.slopeTextures,
      lengths: this.cascades.map((cascade) => cascade.length),
      sizes: this.cascades.map((cascade) => cascade.size),
    });
  }

  prepare(frame: EnvironmentFrame): void {
    if (this.disposed || !this.gpuReady) return;
    this.time = frame.time;
    this.dt = frame.paused ? 0 : frame.dt;
    const sea = frame.ocean.seaState;
    const chop = frame.ocean.choppiness;
    const [swell, wind, detail] = this.cascades;
    swell?.setGain(1.45 * (0.35 + sea * 1.1));
    wind?.setGain(1.25 * (0.4 + chop));
    detail?.setGain(1.1);
    for (const cascade of this.cascades) cascade.setTime(this.time);
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
    this.bindOceanMaps();
    this.ocean.mesh.visible = true;
  }

  renderPasses(): void {
    if (this.disposed || !this.gpuReady || !this.pass) return;
    const pass = this.pass;
    if (this.dt > 0) {
      withRendererPass(this.renderer, () => {
        this.renderer.autoClear = true;
        this.cascades.forEach((cascade, i) => {
          if (i === 0 && this.frame % 2 !== 0) return;
          cascade.update(pass, this.renderer, i === 0 ? this.dt * 2 : this.dt);
        });
      });
      this.frame += 1;
    }
    this.bindOceanMaps();
    if (this.camera) this.ocean.preRender(this.renderer, this.camera);
  }

  resize(_width: number, _height: number, _dpr: number): void {
    // FFT targets are cascade-sized, not viewport-sized.
  }

  setQuality(profile: EnvironmentQuality): void {
    this.quality = profile;
    this.ocean.setSegments(QUALITY_PROFILES[profile].waterSegments);
  }

  reset(missionGeneration: number): void {
    this.missionGeneration = missionGeneration;
    this.frame = 0;
  }

  getDiagnostics(): EnvironmentDiagnostics {
    return {
      backend: 'spectral',
      requestedBackend: this.requestedBackend,
      ready: this.gpuReady && !this.disposed,
      fallbackReason: this.gpuReady ? null : 'fft gpu path not initialized',
      missionGeneration: this.missionGeneration,
      worldVersion: this.worldVersion,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gpuReady = false;
    this.camera = null;
    this.ocean.bindSpectralMaps(null);
    for (const cascade of this.cascades) cascade.dispose();
    this.cascades = [];
    this.pass?.dispose();
    this.pass = null;
  }
}

export async function createSpectralBackend(
  options: Partial<SpectralBackendOptions> & { renderer?: THREE.WebGLRenderer; ocean?: Ocean },
  signal: AbortSignal,
): Promise<SpectralBackend> {
  await Promise.resolve();
  throwIfAborted(signal);
  if (!options.renderer) {
    throw new SpectralInitError(
      'spectral backend requires an injected WebGLRenderer',
      'missing-renderer',
    );
  }
  if (!options.ocean) {
    throw new SpectralInitError('spectral backend requires the patrol Ocean mesh', 'missing-ocean');
  }
  const backend = new SpectralBackend({
    renderer: options.renderer,
    ocean: options.ocean,
    quality: options.quality,
    worldVersion: options.worldVersion,
    requestedBackend: options.requestedBackend,
    seed: options.seed,
    coastal: options.coastal,
  });
  try {
    backend.initializeGpu(signal);
  } catch (error) {
    backend.dispose();
    throw error;
  }
  throwIfAborted(signal);
  return backend;
}
