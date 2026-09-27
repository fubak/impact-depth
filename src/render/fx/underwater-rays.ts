import * as THREE from 'three';
import type { QualityName } from '../quality';

/**
 * Underwater ambience: sun-shaft quads hanging from the surface plus a marine
 * snow point cloud around the camera. Both are presentation-only, deterministic
 * (seeded LCG, never Math.random), quality-gated, and hidden above water.
 */

const RAY_COUNT = 14;
const RAY_SPREAD_M = 22;
const RAY_LENGTH_M = 30;
const SNOW_CAPACITY = 400;
const SNOW_BOX_M = 26;

const SNOW_COUNT: Record<QualityName, number> = { high: 400, medium: 200, low: 0 };

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const NOISE_GLSL = /* glsl */ `
float rayHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.453))) * 43758.5453);
}
float rayNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(rayHash(i), rayHash(i + vec2(1.0, 0.0)), f.x),
    mix(rayHash(i + vec2(0.0, 1.0)), rayHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
`;

const RAY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RAY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  // Tapered shaft: bright at the waterline, dissolving downward, with a soft
  // horizontal falloff and scrolling density so the shaft shimmers.
  float taper = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  float edge = smoothstep(0.0, 0.3, vUv.x) * (1.0 - smoothstep(0.7, 1.0, vUv.x));
  float n = rayNoise(vec2(vUv.x * 3.0 + uSeed, vUv.y * 1.4 - uTime * 0.11));
  float n2 = rayNoise(vec2(vUv.x * 7.0 - uSeed, vUv.y * 3.0 - uTime * 0.19));
  float a = taper * edge * (0.35 + 0.65 * n * n2 * 1.6) * uIntensity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.75, 0.95, 0.95, a);
}
`;

const SNOW_VERT = /* glsl */ `
uniform float uSize;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.1, -mv.z);
  gl_PointSize = uSize * 220.0 / dist;
  gl_PointSize = min(gl_PointSize, 7.0);
  vFade = 1.0 - smoothstep(14.0, 24.0, dist);
  gl_Position = projectionMatrix * mv;
}
`;

const SNOW_FRAG = /* glsl */ `
uniform float uIntensity;
varying float vFade;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  float a = max(0.0, 1.0 - r) * vFade * uIntensity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.88, 0.94, 0.96, a * 0.5);
}
`;

export interface UnderwaterFxFrame {
  readonly camera: THREE.Camera;
  readonly underwater: boolean;
  /** Sampled surface height (world metres). */
  readonly waterHeight: number;
  /** Direction toward the sun, normalized. */
  readonly sunDir: { x: number; y: number; z: number };
  readonly isNight: boolean;
  readonly time: number;
  readonly dt: number;
}

export class UnderwaterFx {
  readonly group = new THREE.Group();
  private quality: QualityName = 'high';
  private readonly rays: { mesh: THREE.Mesh; offX: number; offZ: number; seed: number }[] = [];
  private readonly snow: THREE.Points;
  private readonly snowBase: Float32Array;
  private readonly snowDrift: Float32Array;
  private readonly snowMat: THREE.ShaderMaterial;
  private rayIntensity = 0;
  private snowIntensity = 0;

  constructor() {
    this.group.name = 'underwater-fx';
    const rand = lcg(0x5eed5a11);
    for (let i = 0; i < RAY_COUNT; i += 1) {
      const width = 1.6 + rand() * 3.2;
      const geometry = new THREE.PlaneGeometry(width, RAY_LENGTH_M, 1, 8);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uSeed: { value: i * 3.77 },
        },
        vertexShader: RAY_VERT,
        fragmentShader: RAY_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'underwater-ray';
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      const offX = (rand() - 0.5) * 2 * RAY_SPREAD_M;
      const offZ = (rand() - 0.5) * 2 * RAY_SPREAD_M;
      this.group.add(mesh);
      this.rays.push({ mesh, offX, offZ, seed: rand() });
    }

    // Marine snow: a fixed seeded field, wrapped in a box around the camera.
    this.snowBase = new Float32Array(SNOW_CAPACITY * 3);
    this.snowDrift = new Float32Array(SNOW_CAPACITY * 3);
    for (let i = 0; i < SNOW_CAPACITY; i += 1) {
      this.snowBase[i * 3] = (rand() - 0.5) * SNOW_BOX_M;
      this.snowBase[i * 3 + 1] = (rand() - 0.5) * SNOW_BOX_M;
      this.snowBase[i * 3 + 2] = (rand() - 0.5) * SNOW_BOX_M;
      this.snowDrift[i * 3] = (rand() - 0.5) * 0.24;
      this.snowDrift[i * 3 + 1] = -(0.05 + rand() * 0.22);
      this.snowDrift[i * 3 + 2] = (rand() - 0.5) * 0.24;
    }
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SNOW_CAPACITY * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 1 }, uIntensity: { value: 0 } },
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(geometry, this.snowMat);
    this.snow.name = 'marine-snow';
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 6;
    this.group.add(this.snow);
    this.group.visible = false;
  }

  setQuality(quality: QualityName): void {
    this.quality = quality;
  }

  get snowCount(): number {
    return SNOW_COUNT[this.quality];
  }

  update(frame: UnderwaterFxFrame): void {
    const cam = frame.camera;
    const depthM = Math.max(0, frame.waterHeight - cam.position.y);
    // Shafts die with depth, low sun and night; snow persists a little deeper.
    const sunUp = Math.max(0, Math.min(1, frame.sunDir.y * 1.6));
    const depthFade = Math.max(0, 1 - depthM / 26);
    const on = frame.underwater && !frame.isNight && this.quality !== 'low';
    this.rayIntensity += ((on ? sunUp * depthFade * 0.34 : 0) - this.rayIntensity) *
      Math.min(1, frame.dt * 4 + 0.02);
    const snowOn = frame.underwater && this.snowCount > 0;
    this.snowIntensity += ((snowOn ? 0.8 : 0) - this.snowIntensity) *
      Math.min(1, frame.dt * 4 + 0.02);

    this.group.visible = this.rayIntensity > 0.01 || this.snowIntensity > 0.01;
    if (!this.group.visible) return;

    // Refracted sun direction: Snell's law steepens shafts toward vertical.
    const sx = frame.sunDir.x;
    const sz = frame.sunDir.z;
    const hlen = Math.hypot(sx, sz);
    const sinAir = Math.min(1, hlen);
    const sinWater = sinAir / 1.33;
    const cosWater = Math.sqrt(1 - sinWater * sinWater);
    const hx = hlen > 1e-4 ? sx / hlen : 0;
    const hz = hlen > 1e-4 ? sz / hlen : 0;
    // Ray direction (downward): horizontal part along the sun azimuth.
    const dirX = hx * sinWater;
    const dirY = -cosWater;
    const dirZ = hz * sinWater;

    const up = new THREE.Vector3(0, 1, 0);
    const down = new THREE.Vector3(dirX, dirY, dirZ).normalize();
    // The quad's local +Y maps to the shaft's top: -down.
    const quat = new THREE.Quaternion().setFromUnitVectors(up, down.clone().negate());
    const camX = cam.position.x;
    const camY = cam.position.y;
    const camZ = cam.position.z;
    const waterY = frame.waterHeight;
    const halfLen = RAY_LENGTH_M * 0.5;
    for (const ray of this.rays) {
      const mat = ray.mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uTime!.value = frame.time;
      mat.uniforms.uIntensity!.value = this.rayIntensity * (0.55 + ray.seed * 0.7);
      // Hang the top edge just under the sampled surface, around the camera.
      ray.mesh.quaternion.copy(quat);
      ray.mesh.position.set(
        camX + ray.offX + down.x * halfLen,
        waterY - 0.3 + down.y * halfLen,
        camZ + ray.offZ + down.z * halfLen,
      );
    }

    // Marine snow wraps in a box around the camera; each point drifts slowly.
    const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const half = SNOW_BOX_M * 0.5;
    const count = this.snowCount;
    this.snow.geometry.setDrawRange(0, count);
    for (let i = 0; i < count; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const anchor = c === 0 ? camX : c === 1 ? camY : camZ;
        const base = this.snowBase[i * 3 + c]! + this.snowDrift[i * 3 + c]! * frame.time;
        const rel = ((((base - anchor) % SNOW_BOX_M) + SNOW_BOX_M) % SNOW_BOX_M) - half;
        arr[i * 3 + c] = anchor + rel;
      }
    }
    pos.needsUpdate = true;
    this.snowMat.uniforms.uIntensity!.value = this.snowIntensity;
  }

  reset(): void {
    this.rayIntensity = 0;
    this.snowIntensity = 0;
    this.group.visible = false;
  }

  dispose(): void {
    for (const ray of this.rays) {
      ray.mesh.geometry.dispose();
      (ray.mesh.material as THREE.Material).dispose();
      this.group.remove(ray.mesh);
    }
    this.snow.geometry.dispose();
    this.snowMat.dispose();
    this.group.remove(this.snow);
  }
}
