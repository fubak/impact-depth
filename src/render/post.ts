import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityName } from './quality';

/**
 * Additive bloom that leaves the authored image byte-identical.
 *
 * The scene is full of custom ShaderMaterials authored in display space
 * (ocean, sky, foam, particles). Rendering them through an EffectComposer
 * treats those sRGB values as linear HDR, so OutputPass re-encodes them —
 * a visible double-gamma wash across the whole frame. Instead the base
 * frame renders through the normal direct path, a second pass draws only
 * emitter-layer objects into a half-res HDR target, UnrealBloomPass
 * blurs that into a halo texture, and the halo is composited additively
 * over the canvas. Colours match the non-bloom path exactly apart from
 * glow around emitters.
 */

/** Objects on this layer are re-rendered into the bloom source target. */
export const BLOOM_LAYER = 4;

// The source contains only emitters on black; additive particle stacking
// pushes flash cores well past 1.0, so the threshold picks hot cores over
// single-author-value whites like spray domes.
export const BLOOM_THRESHOLD = 0.85;
export const BLOOM_STRENGTH = 0.42;
export const BLOOM_RADIUS = 0.3;

/** `?bloom=1` forces on at any quality (testing); `?bloom=0` forces off; else high only. */
export function bloomEnabledFor(quality: QualityName, search = ''): boolean {
  const flag = new URLSearchParams(search).get('bloom');
  if (flag === '1') return true;
  if (flag === '0') return false;
  return quality === 'high';
}

export interface BloomRig {
  render(): void;
  setSize(width: number, height: number): void;
  setPixelRatio(dpr: number): void;
  dispose(): void;
  /** Internal targets, exposed for e2e probes and diagnostics. */
  readonly debug?: { source: THREE.WebGLRenderTarget; bloom: UnrealBloomPass };
}

export type BloomRigFactory = (
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  scene: THREE.Scene,
  camera: THREE.Camera,
) => BloomRig;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tBloom;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tBloom, vUv).rgb, 1.0);
}
`;

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function defaultRigFactory(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  scene: THREE.Scene,
  camera: THREE.Camera,
): BloomRig {
  let cssW = Math.max(1, width);
  let cssH = Math.max(1, height);
  let dpr = 1;
  const source = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );
  bloom.renderToScreen = false;
  // renderTargetsHorizontal[0] receives the composited mip halo; its texture
  // object is stable across setSize() so this binding stays live.
  const composite = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: { tBloom: { value: bloom.renderTargetsHorizontal[0]!.texture } },
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  const clearColor = new THREE.Color();
  const applySize = () => {
    const w = Math.max(1, Math.round((cssW * dpr) / 2));
    const h = Math.max(1, Math.round((cssH * dpr) / 2));
    source.setSize(w, h);
    bloom.setSize(w, h);
  };
  applySize();
  return {
    render(): void {
      // 1. Base frame via the normal path — authored colours unchanged.
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      // 2. Emitters-only pass into the half-res HDR source.
      const prevMask = camera.layers.mask;
      const clearAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      camera.layers.mask = 1 << BLOOM_LAYER;
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(source);
      renderer.render(scene, camera);
      camera.layers.mask = prevMask;
      renderer.setRenderTarget(null);
      renderer.setClearColor(clearColor, clearAlpha);
      // 3. Halo: bloom composite lands in renderTargetsHorizontal[0]; the
      //    pass also blends into `source`, which we discard.
      bloom.render(renderer, source, source, 0, false);
      // 4. Add the halo over the finished frame. bloom.render() leaves the
      //    source target bound — rebind the canvas first or the composite
      //    writes into it instead of the screen.
      renderer.setRenderTarget(null);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      composite.render(renderer);
      renderer.autoClear = autoClear;
    },
    setSize(w: number, h: number): void {
      cssW = Math.max(1, w);
      cssH = Math.max(1, h);
      applySize();
    },
    setPixelRatio(d: number): void {
      dpr = d;
      applySize();
    },
    dispose(): void {
      source.dispose();
      bloom.dispose();
      composite.material.dispose();
      composite.dispose();
    },
    debug: { source, bloom },
  };
}

export class PostPipeline {
  private rig: BloomRig | null = null;
  private enabled = false;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly factory: BloomRigFactory = defaultRigFactory,
  ) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.dispose();
  }

  /** Render with the bloom composite. Caller guarantees `isEnabled`. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.rig) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.rig = this.factory(this.renderer, size.x, size.y, scene, camera);
      if (this.width > 0) this.rig.setSize(this.width, this.height);
      this.rig.setPixelRatio(this.dpr);
    }
    this.rig.render();
  }

  /** CSS-pixel canvas size; the rig multiplies by DPR internally. */
  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.rig?.setSize(width, height);
  }

  setPixelRatio(dpr: number): void {
    this.dpr = dpr;
    this.rig?.setPixelRatio(dpr);
  }

  /** Drop targets so a restored context rebuilds them lazily on next render. */
  reset(): void {
    this.dispose();
  }

  dispose(): void {
    this.rig?.dispose();
    this.rig = null;
  }
}
