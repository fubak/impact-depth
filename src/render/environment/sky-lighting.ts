import * as THREE from 'three';
import { SKY_RADIANCE_GLSL } from '../atmosphere';
import { pickSkyLightingSource, type SkyLightingSource } from './sky-source';

export interface SkyLightingState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  cloudCoverage: number;
  lightning: number;
  isNight: boolean;
  weatherPreset?: 'calm' | 'breeze' | 'storm';
  golden?: number;
  twilight?: number;
}

export interface SkyLightingDiagnostics {
  source: SkyLightingSource;
  ready: boolean;
  generation: number;
  lastRefreshSeconds: number | null;
  minimumRefreshSeconds: number;
  signature: string | null;
}

const MIN_REFRESH_SECONDS = 2;

function quantize(value: number, steps: number): number {
  return Math.round(THREE.MathUtils.clamp(value, -1, 1) * steps);
}

/** Stable, deliberately coarse key so moving weather cannot regenerate a PMREM every frame. */
export function skyLightingSignature(state: SkyLightingState): string {
  return [
    quantize(state.sunDir.x, 16),
    quantize(state.sunDir.y, 16),
    quantize(state.sunDir.z, 16),
    quantize(state.cloudCoverage, 8),
    state.isNight ? 1 : 0,
    state.weatherPreset === 'storm' ? 2 : state.weatherPreset === 'calm' ? 0 : 1,
    quantize(state.lightning, 4),
    quantize(state.golden ?? 0, 8),
  ].join(':');
}

/**
 * Owns the scene's outdoor image-based lighting. Procedural sky PMREM is the
 * fail-closed path; a local HDR equirect may replace it during day.
 */
export class SkyLighting {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly captureScene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private target: THREE.WebGLRenderTarget | null = null;
  private hdrTarget: THREE.WebGLRenderTarget | null = null;
  private hdrReady = false;
  private hdrFailed = false;
  private isNight = false;
  private weatherPreset: 'calm' | 'breeze' | 'storm' = 'breeze';
  private sunY = 1;
  private signature: string | null = null;
  private lastRefreshSeconds: number | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly minimumRefreshSeconds = MIN_REFRESH_SECONDS,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    this.pmrem.compileEquirectangularShader();
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x3d9fe3) },
        uHorizon: { value: new THREE.Color(0xd5efff) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff0cf) },
        uCloudCoverage: { value: 0.5 },
        uLightning: { value: 0 },
        uGolden: { value: 0 },
        uTwilight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uCloudCoverage;
        uniform float uLightning;
        uniform float uGolden;
        uniform float uTwilight;
        varying vec3 vDirection;
        ${SKY_RADIANCE_GLSL}
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), f.x), f.y);
        }
        void main() {
          vec3 dir = normalize(vDirection);
          vec3 sd = normalize(uSunDir);
          vec3 color = skyRadiance(dir, sd, uTop, uHorizon, uSunColor, uGolden, uTwilight);
          float sunDot = max(dot(dir, sd), 0.0);
          // Soft sun lobe (not the disc) so IBL speculars carry a warm highlight.
          color += uSunColor * (pow(sunDot, 512.0) * 8.0 + pow(sunDot, 12.0) * 0.3);
          float clouds = smoothstep(0.72 - uCloudCoverage * 0.48, 0.88, noise(dir.xz * 7.0 / max(0.3, dir.y + 0.55)));
          clouds *= smoothstep(-0.08, 0.18, dir.y);
          color = mix(color, uSunColor * (0.45 + sunDot * 0.35), clouds * (0.25 + uCloudCoverage * 0.45));
          // Sea below: the lower hemisphere lights hull bottoms with a dim water tone.
          vec3 sea = mix(vec3(0.02, 0.1, 0.14), uHorizon * 0.18, 0.4);
          color = mix(color, sea, smoothstep(0.0, -0.2, dir.y));
          color += vec3(uLightning * 0.7);
          gl_FragColor = vec4(max(color, vec3(0.001)), 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.material);
    this.captureScene.add(this.sky);
  }

  bindHdrEquirect(texture: THREE.Texture): void {
    if (this.disposed) return;
    this.hdrFailed = false;
    this.hdrReady = true;
    const next = this.pmrem.fromEquirectangular(texture);
    const previous = this.hdrTarget;
    this.hdrTarget = next;
    this.applyActiveEnvironment();
    previous?.dispose();
    this.generation++;
  }

  markHdrFailed(): void {
    this.hdrFailed = true;
    this.hdrReady = false;
    this.applyActiveEnvironment();
  }

  private currentSource(): SkyLightingSource {
    return pickSkyLightingSource({
      hdrReady: this.hdrReady,
      hdrFailed: this.hdrFailed,
      isNight: this.isNight,
      weatherPreset: this.weatherPreset,
      sunY: this.sunY,
    });
  }

  private applyActiveEnvironment(): void {
    if (this.disposed) return;
    if (this.currentSource() === 'hdr-pmrem' && this.hdrTarget) {
      this.scene.environment = this.hdrTarget.texture;
      return;
    }
    if (this.target) this.scene.environment = this.target.texture;
  }

  update(state: SkyLightingState, nowSeconds: number, force = false): boolean {
    if (this.disposed) return false;
    this.isNight = state.isNight;
    this.weatherPreset = state.weatherPreset ?? 'breeze';
    this.sunY = state.sunDir.y;
    const source = this.currentSource();
    if (source === 'hdr-pmrem') {
      this.applyActiveEnvironment();
      return false;
    }

    const signature = skyLightingSignature(state);
    const cadenceElapsed =
      this.lastRefreshSeconds === null ||
      nowSeconds - this.lastRefreshSeconds >= this.minimumRefreshSeconds;
    if (!force && (signature === this.signature || !cadenceElapsed)) {
      this.applyActiveEnvironment();
      return false;
    }

    this.material.uniforms.uTop.value.copy(state.skyTop);
    this.material.uniforms.uHorizon.value.copy(state.skyHorizon);
    this.material.uniforms.uSunDir.value.copy(state.sunDir);
    this.material.uniforms.uSunColor.value.copy(state.sunColor);
    this.material.uniforms.uCloudCoverage.value = THREE.MathUtils.clamp(state.cloudCoverage, 0, 1);
    this.material.uniforms.uGolden.value = state.golden ?? 0;
    this.material.uniforms.uTwilight.value = state.isNight ? 1 : (state.twilight ?? 0);
    // Lightning is presentation-only (hemi/ambient flash); never bake into lasting IBL.
    this.material.uniforms.uLightning.value = 0;

    const next = this.pmrem.fromScene(this.captureScene, 0.04);
    const previous = this.target;
    this.target = next;
    this.applyActiveEnvironment();
    previous?.dispose();
    this.signature = signature;
    this.lastRefreshSeconds = nowSeconds;
    this.generation++;
    return true;
  }

  getDiagnostics(): SkyLightingDiagnostics {
    return {
      source: this.currentSource(),
      ready: (this.target !== null || this.hdrTarget !== null) && !this.disposed,
      generation: this.generation,
      lastRefreshSeconds: this.lastRefreshSeconds,
      minimumRefreshSeconds: this.minimumRefreshSeconds,
      signature: this.signature,
    };
  }

  reset(): void {
    this.signature = null;
    this.lastRefreshSeconds = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const env = this.scene.environment;
    if (env === this.target?.texture || env === this.hdrTarget?.texture) {
      this.scene.environment = null;
    }
    this.target?.dispose();
    this.target = null;
    this.hdrTarget?.dispose();
    this.hdrTarget = null;
    this.sky.geometry.dispose();
    this.material.dispose();
    this.pmrem.dispose();
  }
}
