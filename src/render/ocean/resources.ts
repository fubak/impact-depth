/** GPU render-target helpers. Always restore renderer state in `finally`. */

import * as THREE from 'three';

export interface FloatTargetOptions {
  width: number;
  height: number;
  mipmaps?: boolean;
  wrap?: THREE.Wrapping;
  type?: THREE.TextureDataType;
}

export interface RendererStateSnapshot {
  target: THREE.WebGLRenderTarget | null;
  activeCubeFace: number;
  activeMipmapLevel: number;
  viewport: THREE.Vector4;
  scissor: THREE.Vector4;
  scissorTest: boolean;
  autoClear: boolean;
  autoClearColor: boolean;
  autoClearDepth: boolean;
  autoClearStencil: boolean;
  clearColor: THREE.Color;
  clearAlpha: number;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  localClippingEnabled: boolean;
  clippingPlanes: THREE.Plane[];
  shadowMapEnabled: boolean;
  shadowMapAutoUpdate: boolean;
  shadowMapNeedsUpdate: boolean;
  xrEnabled: boolean;
}

export interface FloatFramebufferSupport {
  supported: boolean;
  reason: string | null;
}

export function validateFloatFramebuffer(
  renderer: THREE.WebGLRenderer,
): FloatFramebufferSupport {
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    const advertised =
      renderer.extensions.has('EXT_color_buffer_float') ||
      renderer.extensions.has('WEBGL_color_buffer_float');
    if (!advertised) {
      return { supported: false, reason: 'floating-point color-buffer extension unavailable' };
    }

    target = createFloatTarget({ width: 1, height: 1, type: THREE.FloatType });
    return withRendererPass(renderer, () => {
      renderer.setRenderTarget(target);
      renderer.clear();
      const gl = renderer.getContext();
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        return {
          supported: false,
          reason: `floating-point framebuffer incomplete (0x${status.toString(16)})`,
        };
      }
      const pixel = new Float32Array(4);
      renderer.readRenderTargetPixels(target!, 0, 0, 1, 1, pixel);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        return {
          supported: false,
          reason: `floating-point framebuffer readback failed (0x${error.toString(16)})`,
        };
      }
      return { supported: true, reason: null };
    });
  } catch (error) {
    return {
      supported: false,
      reason: `floating-point framebuffer validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    target?.dispose();
  }
}

export function supportsFloatColorBuffer(renderer: THREE.WebGLRenderer): boolean {
  return validateFloatFramebuffer(renderer).supported;
}

export function createFloatTarget(options: FloatTargetOptions): THREE.WebGLRenderTarget {
  const mipmaps = options.mipmaps === true;
  const target = new THREE.WebGLRenderTarget(
    Math.max(1, options.width),
    Math.max(1, options.height),
    {
      type: options.type ?? THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    },
  );
  target.texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  target.texture.magFilter = mipmaps ? THREE.LinearFilter : THREE.NearestFilter;
  target.texture.generateMipmaps = mipmaps;
  const wrap = options.wrap ?? THREE.RepeatWrapping;
  target.texture.wrapS = wrap;
  target.texture.wrapT = wrap;
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

export function resizeTarget(target: THREE.WebGLRenderTarget, width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (target.width === w && target.height === h) return;
  target.setSize(w, h);
}

export function disposeTarget(target: THREE.WebGLRenderTarget | null | undefined): void {
  target?.dispose();
}

export function disposeTexture(texture: THREE.Texture | null | undefined): void {
  texture?.dispose();
}

export function disposeMaterial(material: THREE.Material | null | undefined): void {
  material?.dispose();
}

export function replaceOwnedResources<T>(
  current: T,
  create: () => T,
  activate: (resources: T) => void,
  dispose: (resources: T) => void,
): T {
  const replacement = create();
  try {
    activate(replacement);
  } catch (error) {
    try {
      activate(current);
    } finally {
      dispose(replacement);
    }
    throw error;
  }
  dispose(current);
  return replacement;
}

export function createSpectrumDataTexture(data: Float32Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  return texture;
}

export function captureRendererState(renderer: THREE.WebGLRenderer): RendererStateSnapshot {
  return {
    target: renderer.getRenderTarget(),
    activeCubeFace: renderer.getActiveCubeFace(),
    activeMipmapLevel: renderer.getActiveMipmapLevel(),
    viewport: renderer.getViewport(new THREE.Vector4()),
    scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
    autoClear: renderer.autoClear,
    autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth,
    autoClearStencil: renderer.autoClearStencil,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    localClippingEnabled: renderer.localClippingEnabled,
    clippingPlanes: renderer.clippingPlanes.slice(),
    shadowMapEnabled: renderer.shadowMap.enabled,
    shadowMapAutoUpdate: renderer.shadowMap.autoUpdate,
    shadowMapNeedsUpdate: renderer.shadowMap.needsUpdate,
    xrEnabled: renderer.xr.enabled,
  };
}

export function restoreRendererState(
  renderer: THREE.WebGLRenderer,
  snapshot: RendererStateSnapshot,
): void {
  renderer.setRenderTarget(snapshot.target, snapshot.activeCubeFace, snapshot.activeMipmapLevel);
  renderer.setViewport(snapshot.viewport);
  renderer.setScissor(snapshot.scissor);
  renderer.setScissorTest(snapshot.scissorTest);
  renderer.autoClear = snapshot.autoClear;
  renderer.autoClearColor = snapshot.autoClearColor;
  renderer.autoClearDepth = snapshot.autoClearDepth;
  renderer.autoClearStencil = snapshot.autoClearStencil;
  renderer.setClearColor(snapshot.clearColor, snapshot.clearAlpha);
  renderer.toneMapping = snapshot.toneMapping;
  renderer.toneMappingExposure = snapshot.toneMappingExposure;
  renderer.localClippingEnabled = snapshot.localClippingEnabled;
  renderer.clippingPlanes = snapshot.clippingPlanes;
  renderer.shadowMap.enabled = snapshot.shadowMapEnabled;
  renderer.shadowMap.autoUpdate = snapshot.shadowMapAutoUpdate;
  renderer.shadowMap.needsUpdate = snapshot.shadowMapNeedsUpdate;
  renderer.xr.enabled = snapshot.xrEnabled;
}

export function withRendererPass<T>(renderer: THREE.WebGLRenderer, fn: () => T): T {
  const snapshot = captureRendererState(renderer);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    try {
      restoreRendererState(renderer, snapshot);
    } catch (restoreError) {
      console.error('[silent-depths] renderer state restoration failed', restoreError);
    }
    throw error;
  }
  restoreRendererState(renderer, snapshot);
  return result;
}

export class SimulationPass {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly quad: THREE.Mesh;

  constructor() {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  run(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.quad.geometry.dispose();
    const material = this.quad.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    this.scene.remove(this.quad);
  }
}

export function simulationMaterial(
  uniforms: { [uniform: string]: THREE.IUniform },
  fragmentShader: string,
  vertexShader: string,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}
