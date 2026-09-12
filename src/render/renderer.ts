import * as THREE from 'three';
import type { QualityProfile } from './quality';

/**
 * r185 WebGL presentation. `PCFSoftShadowMap` is no longer in the shader
 * define table, so programs compile as `SHADOWMAP_TYPE_BASIC` (`sampler2D`)
 * while the shadow pass allocates compare-mode depth textures for PCF
 * (`sampler2DShadow`). That mismatch fails program validation (1282).
 */
export function isSoftwareWebGlRendererName(name: string): boolean {
  return /swiftshader|llvmpipe|softpipe|microsoft basic render|gdi generic/i.test(name);
}

export function configureWebGlRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

export function disableShadowsOnSoftwareRenderer(renderer: THREE.WebGLRenderer): void {
  const gl = renderer.getContext();
  if (!gl) return;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  if (isSoftwareWebGlRendererName(name)) renderer.shadowMap.enabled = false;
}

export class RendererHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private maxDpr = 1.75;
  private shadowCadence = 1;
  private frame = 0;
  private contextStatus: 'ready' | 'lost' | 'restoring' | 'failed' = 'ready';
  private recoveryHandler: ((signal: AbortSignal) => Promise<void>) | null = null;
  private statusHandler:
    | ((status: 'ready' | 'lost' | 'restoring' | 'failed', reason?: string) => void)
    | null = null;
  private recoveryAbort: AbortController | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    configureWebGlRenderer(this.renderer);
    disableShadowsOnSoftwareRenderer(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.resize();
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  get canSubmit(): boolean {
    return this.contextStatus === 'ready';
  }

  setContextRecoveryHandlers(
    recover: (signal: AbortSignal) => Promise<void>,
    status: (state: 'ready' | 'lost' | 'restoring' | 'failed', reason?: string) => void,
  ): void {
    this.recoveryHandler = recover;
    this.statusHandler = status;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.recoveryAbort?.abort();
    this.recoveryAbort = null;
    this.contextStatus = 'lost';
    this.statusHandler?.('lost');
  };

  private readonly onContextRestored = (): void => {
    const abort = new AbortController();
    this.recoveryAbort?.abort();
    this.recoveryAbort = abort;
    this.contextStatus = 'restoring';
    this.statusHandler?.('restoring');
    configureWebGlRenderer(this.renderer);
    disableShadowsOnSoftwareRenderer(this.renderer);
    void (this.recoveryHandler?.(abort.signal) ?? Promise.resolve())
      .then(() => {
        if (abort.signal.aborted) return;
        this.contextStatus = 'ready';
        this.recoveryAbort = null;
        this.resize();
        this.statusHandler?.('ready');
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        this.contextStatus = 'failed';
        this.recoveryAbort = null;
        this.statusHandler?.('failed', error instanceof Error ? error.message : String(error));
      });
  };

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  setQuality(profile: QualityProfile): void {
    if (this.maxDpr === profile.dpr && this.renderer.shadowMap.enabled === profile.shadows) return;
    this.maxDpr = profile.dpr;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.shadowCadence = Math.max(1, profile.shadowCadence);
    this.renderer.shadowMap.autoUpdate = this.shadowCadence === 1;
    disableShadowsOnSoftwareRenderer(this.renderer);
    this.resize();
  }

  resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.canSubmit) return;
    if (this.renderer.shadowMap.enabled && this.shadowCadence > 1) {
      this.renderer.shadowMap.needsUpdate = this.frame % this.shadowCadence === 0;
    }
    this.renderer.render(scene, camera);
    this.frame += 1;
  }

  getPerformanceDiagnostics() {
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debug
      ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const vendor = debug
      ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))
      : String(gl.getParameter(gl.VENDOR));
    return {
      renderer: rendererName,
      vendor,
      software: isSoftwareWebGlRendererName(rendererName),
      dpr: this.renderer.getPixelRatio(),
      drawingBuffer: {
        width: this.renderer.domElement.width,
        height: this.renderer.domElement.height,
      },
      render: { ...this.renderer.info.render },
      memory: { ...this.renderer.info.memory },
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.recoveryAbort?.abort();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
  }
}
