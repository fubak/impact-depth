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
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  setQuality(profile: QualityProfile): void {
    if (this.maxDpr === profile.dpr && this.renderer.shadowMap.enabled === profile.shadows) return;
    this.maxDpr = profile.dpr;
    this.renderer.shadowMap.enabled = profile.shadows;
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
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
