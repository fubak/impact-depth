/**
 * Cinematic post chain (Plan 021): HDR scene → bloom → grade → ACES/sRGB output.
 *
 * The scene renders into a linear half-float MSAA target so sun glints, the sun
 * disc and backlit crests keep their >1.0 energy for bloom. Grading happens in
 * linear light before the filmic curve: log-space contrast, saturation, a
 * golden-hour split tone (cool shadows / warm highlights) and a soft lens falloff.
 * `OutputPass` applies the renderer's tone mapping + output colour space, so every
 * material (including custom ShaderMaterials with the tonemapping includes) is
 * graded identically.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityName } from './quality';

export interface GradeParams {
  /** 0 noon … 1 golden hour. */
  golden: number;
  /** Look-dev vignette slider (0 … 0.8). */
  vignette: number;
  /** 0 above water … 1 fully submerged eye. */
  underwater?: number;
}

export interface PostProfile {
  bloom: boolean;
  bloomScale: number;
  samples: number;
}

export function postProfileFor(quality: QualityName, software = false): PostProfile {
  if (software) return { bloom: quality !== 'low', bloomScale: 0.5, samples: 0 };
  if (quality === 'high') return { bloom: true, bloomScale: 0.5, samples: 4 };
  if (quality === 'medium') return { bloom: true, bloomScale: 0.5, samples: 2 };
  return { bloom: false, bloomScale: 0.5, samples: 0 };
}

export const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uGolden: { value: 0 },
    uVignette: { value: 0.1 },
    uUnder: { value: 0 },
    uAspect: { value: 16 / 9 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGolden;
    uniform float uVignette;
    uniform float uUnder;
    uniform float uAspect;
    uniform float uSaturation;
    uniform float uContrast;
    varying vec2 vUv;
    void main() {
      vec3 col = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // Saturation (a touch richer at golden hour, muted underwater).
      float sat = uSaturation + uGolden * 0.1 - uUnder * 0.15;
      col = max(mix(vec3(luma), col, sat), vec3(0.0));
      // Log-space contrast pivoting on mid-grey keeps highlights from clipping early.
      float contrast = uContrast + uGolden * 0.06;
      col = 0.18 * exp2((log2(max(col, vec3(1e-5)) / 0.18)) * contrast);
      // Split tone: cool shadows, warm highlights; stronger as the sun drops.
      luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float t = smoothstep(0.015, 0.7, luma);
      vec3 shadowTint = mix(vec3(0.97, 1.0, 1.04), vec3(0.84, 0.94, 1.14), uGolden);
      vec3 highTint = mix(vec3(1.02, 1.0, 0.97), vec3(1.1, 0.98, 0.84), uGolden);
      col *= mix(shadowTint, highTint, t);
      // Lens falloff (the HUD keeps its own CSS vignette on top).
      vec2 d = vUv - 0.5;
      d.x *= uAspect;
      float r = length(d) / (0.5 * sqrt(uAspect * uAspect + 1.0));
      col *= 1.0 - (uVignette + uGolden * 0.08) * smoothstep(0.45, 1.05, r);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class CinematicPost {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly output: OutputPass;
  private readonly target: THREE.WebGLRenderTarget;
  private profile: PostProfile;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    profile: PostProfile,
  ) {
    this.profile = profile;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: profile.samples,
    });
    this.target.texture.name = 'cinematic-hdr';
    this.composer = new EffectComposer(renderer, this.target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 1.25);
    this.grade = new ShaderPass(GRADE_SHADER);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.applyProfile();
  }

  setProfile(profile: PostProfile): void {
    const samplesChanged = profile.samples !== this.profile.samples;
    this.profile = profile;
    if (samplesChanged) {
      this.composer.renderTarget1.samples = profile.samples;
      this.composer.renderTarget2.samples = profile.samples;
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
    }
    this.applyProfile();
  }

  setGrade(params: GradeParams): void {
    const u = this.grade.uniforms;
    u.uGolden!.value = THREE.MathUtils.clamp(params.golden, 0, 1);
    u.uVignette!.value = THREE.MathUtils.clamp(params.vignette * 0.6, 0, 0.5);
    u.uUnder!.value = THREE.MathUtils.clamp(params.underwater ?? 0, 0, 1);
    // Sunset: the disc and road glint bloom a little wider and warmer.
    this.bloom.strength = 0.14 + params.golden * 0.08;
    this.bloom.radius = 0.45 + params.golden * 0.15;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(this.width, this.height);
    this.grade.uniforms.uAspect!.value = this.width / this.height;
    this.applyProfile();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt?: number): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.composer.render(dt);
  }

  dispose(): void {
    this.bloom.dispose();
    this.grade.dispose();
    this.output.dispose();
    this.composer.dispose();
    this.target.dispose();
  }

  private applyProfile(): void {
    this.bloom.enabled = this.profile.bloom;
    const scale = this.profile.bloomScale;
    this.bloom.setSize(
      Math.max(1, Math.round(this.width * this.pixelRatio * scale)),
      Math.max(1, Math.round(this.height * this.pixelRatio * scale)),
    );
    void this.renderer;
  }
}
