import * as THREE from 'three';

export interface SkyLightingState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  cloudCoverage: number;
  lightning: number;
  isNight: boolean;
}

export interface SkyLightingDiagnostics {
  source: 'procedural-sky-pmrem';
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
    quantize(state.lightning, 4),
  ].join(':');
}

/**
 * Owns the scene's outdoor image-based lighting. The source is a tiny local
 * procedural sky scene; generated PMREM textures are swapped atomically and
 * disposed here. No network or asset-loader path is involved.
 */
export class SkyLighting {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly captureScene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private target: THREE.WebGLRenderTarget | null = null;
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
        varying vec3 vDirection;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), f.x), f.y);
        }
        void main() {
          vec3 dir = normalize(vDirection);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 color = mix(uHorizon, uTop, pow(h, 0.75));
          float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
          color += uSunColor * (pow(sunDot, 512.0) * 10.0 + pow(sunDot, 12.0) * 0.35);
          float clouds = smoothstep(0.72 - uCloudCoverage * 0.48, 0.88, noise(dir.xz * 7.0 / max(0.3, dir.y + 0.55)));
          clouds *= smoothstep(-0.08, 0.18, dir.y);
          color = mix(color, uSunColor * (0.45 + sunDot * 0.35), clouds * (0.25 + uCloudCoverage * 0.45));
          color += vec3(uLightning * 0.7);
          gl_FragColor = vec4(max(color, vec3(0.001)), 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.material);
    this.captureScene.add(this.sky);
  }

  update(state: SkyLightingState, nowSeconds: number, force = false): boolean {
    if (this.disposed) return false;
    const signature = skyLightingSignature(state);
    const cadenceElapsed =
      this.lastRefreshSeconds === null ||
      nowSeconds - this.lastRefreshSeconds >= this.minimumRefreshSeconds;
    if (!force && (signature === this.signature || !cadenceElapsed)) return false;

    this.material.uniforms.uTop.value.copy(state.skyTop);
    this.material.uniforms.uHorizon.value.copy(state.skyHorizon);
    this.material.uniforms.uSunDir.value.copy(state.sunDir);
    this.material.uniforms.uSunColor.value.copy(state.sunColor);
    this.material.uniforms.uCloudCoverage.value = THREE.MathUtils.clamp(state.cloudCoverage, 0, 1);
    // Lightning is presentation-only (hemi/ambient flash); never bake into lasting IBL.
    this.material.uniforms.uLightning.value = 0;

    const next = this.pmrem.fromScene(this.captureScene, 0.04);
    const previous = this.target;
    this.target = next;
    this.scene.environment = next.texture;
    previous?.dispose();
    this.signature = signature;
    this.lastRefreshSeconds = nowSeconds;
    this.generation++;
    return true;
  }

  getDiagnostics(): SkyLightingDiagnostics {
    return {
      source: 'procedural-sky-pmrem',
      ready: this.target !== null && !this.disposed,
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
    if (this.scene.environment === this.target?.texture) this.scene.environment = null;
    this.target?.dispose();
    this.target = null;
    this.sky.geometry.dispose();
    this.material.dispose();
    this.pmrem.dispose();
  }
}
