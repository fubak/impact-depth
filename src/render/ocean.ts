import * as THREE from 'three';
import type { OceanSettings } from '../core/types';
import { BASE_WAVES, waveAngularFrequency, waveNumber } from '../core/waves';

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uWaveHeight;
uniform float uChoppiness;
uniform float uSeaState;
uniform vec4 uWaveAmp;
uniform vec4 uWaveLen;
uniform vec4 uWaveDir;
uniform vec4 uWaveSteep;
uniform vec4 uWavePhase;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFoam;

vec3 gerstner(
  vec3 pos,
  float amp,
  float wavelength,
  float dirAngle,
  float steepness,
  float phase,
  float heightScale,
  float chopScale,
  inout vec3 tangent,
  inout vec3 binormal
) {
  float a = amp * heightScale;
  float k = 6.28318530718 / max(wavelength, 0.001);
  float omega = sqrt(9.81 * k);
  vec2 d = vec2(cos(dirAngle), sin(dirAngle));
  float Q = (steepness * chopScale) / max(k * a * 4.0, 0.0001);
  float theta = k * dot(d, pos.xz) - omega * uTime + phase;
  float s = sin(theta);
  float c = cos(theta);

  pos.x += Q * a * d.x * c;
  pos.z += Q * a * d.y * c;
  pos.y += a * s;

  tangent += vec3(
    -d.x * d.x * Q * a * k * s,
    d.x * a * k * c,
    -d.x * d.y * Q * a * k * s
  );
  binormal += vec3(
    -d.x * d.y * Q * a * k * s,
    d.y * a * k * c,
    -d.y * d.y * Q * a * k * s
  );

  return pos;
}

void main() {
  vec3 pos = position;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  float heightScale = uWaveHeight * (0.45 + uSeaState * 0.9);
  float chopScale = uChoppiness * (0.55 + uSeaState * 0.55);

  pos = gerstner(pos, uWaveAmp.x, uWaveLen.x, uWaveDir.x, uWaveSteep.x, uWavePhase.x, heightScale, chopScale, tangent, binormal);
  pos = gerstner(pos, uWaveAmp.y, uWaveLen.y, uWaveDir.y, uWaveSteep.y, uWavePhase.y, heightScale, chopScale, tangent, binormal);
  pos = gerstner(pos, uWaveAmp.z, uWaveLen.z, uWaveDir.z, uWaveSteep.z, uWavePhase.z, heightScale, chopScale, tangent, binormal);
  pos = gerstner(pos, uWaveAmp.w, uWaveLen.w, uWaveDir.w, uWaveSteep.w, uWavePhase.w, heightScale, chopScale, tangent, binormal);

  vec3 objectNormal = normalize(cross(binormal, tangent));
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;

  float crest = pos.y / max(heightScale * 0.85, 0.001);
  float crestBand = smoothstep(0.55, 0.9, crest) * (1.0 - smoothstep(0.9, 1.2, crest));
  float breakNoise = sin(vWorldPos.x * 1.4 + uTime * 1.8) * sin(vWorldPos.z * 1.1 - uTime * 1.3);
  vFoam = crestBand * (0.25 + 0.75 * step(0.2, breakNoise));

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uFoamAmount;
uniform float uFogDensity;
uniform vec3 uFogColor;
uniform float uClarity;
uniform float uAbsorption;
uniform float uTime;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vFoam;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);

  float ndotv = clamp(dot(N, V), 0.0, 1.0);
  float fresnel = pow(1.0 - ndotv, 2.85);
  float overhead = ndotv;

  // Visible Caribbean sheet: ~0.22 looking down, stronger at grazing
  float clarity = clamp(uClarity, 0.0, 1.0);
  float alphaDown = mix(0.28, 0.22, clarity);
  float alphaGraze = mix(0.74, 0.58, clarity * 0.4);
  float alpha = mix(alphaGraze, alphaDown, overhead);
  alpha = max(alpha, fresnel * 0.7);
  alpha = clamp(alpha, 0.2, 0.78);

  float depthHint = clamp(
    uAbsorption * (0.22 + (1.0 - overhead) * 0.48 + fresnel * 0.16),
    0.0,
    1.0
  );
  vec3 water = mix(uShallowColor, uDeepColor, depthHint);
  // Bright azure/turquoise under sunlight
  vec3 caribbean = vec3(0.18, 0.82, 0.86);
  water = mix(water, caribbean, 0.22 + overhead * 0.2);
  water = mix(water, uShallowColor * 1.12, overhead * 0.28);
  water = mix(water, uSkyColor, fresnel * 0.35);

  vec3 L = normalize(uSunDir);
  float ndotl = max(dot(N, L), 0.0);
  water += uSunColor * ndotl * 0.08;
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 180.0);
  water += uSunColor * spec * (0.32 + fresnel * 0.65);

  float foamMask = vFoam * uFoamAmount * (0.45 + 0.55 * sin(vWorldPos.x * 2.2 + uTime * 2.5));
  water = mix(water, vec3(0.9, 0.95, 0.96), clamp(foamMask, 0.0, 0.28));
  alpha = max(alpha, foamMask * 0.12);

  float dist = length(cameraPosition - vWorldPos);
  float fogFactor = 1.0 - exp(-uFogDensity * dist * 0.35);
  water = mix(water, uFogColor, clamp(fogFactor, 0.0, 0.22));

  gl_FragColor = vec4(water, alpha);
}
`;

function hexToVec3(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geometry: THREE.PlaneGeometry;
  private readonly size: number;
  private segments: number;

  constructor(size = 560, segments = 200) {
    this.size = size;
    this.segments = segments;
    this.geometry = this.createGeometry(segments);

    const amps = BASE_WAVES.map((w) => w.amplitude);
    const lens = BASE_WAVES.map((w) => w.wavelength);
    const dirs = BASE_WAVES.map((w) => w.direction);
    const steeps = BASE_WAVES.map((w) => w.steepness);
    const phases = BASE_WAVES.map((w) => w.phase);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uWaveHeight: { value: 0.55 },
        uChoppiness: { value: 0.45 },
        uSeaState: { value: 0.32 },
        uWaveAmp: { value: new THREE.Vector4(...amps) },
        uWaveLen: { value: new THREE.Vector4(...lens) },
        uWaveDir: { value: new THREE.Vector4(...dirs) },
        uWaveSteep: { value: new THREE.Vector4(...steeps) },
        uWavePhase: { value: new THREE.Vector4(...phases) },
        uDeepColor: { value: hexToVec3('#0b88c4') },
        uShallowColor: { value: hexToVec3('#42dde0') },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
        uSunColor: { value: new THREE.Vector3(1.0, 0.94, 0.81) },
        uSkyColor: { value: new THREE.Vector3(0.24, 0.62, 0.89) },
        uFoamAmount: { value: 0.14 },
        uFogDensity: { value: 0.0007 },
        uFogColor: { value: new THREE.Vector3(0.84, 0.93, 1.0) },
        uClarity: { value: 0.72 },
        uAbsorption: { value: 0.36 },
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
  }

  setSegments(segments: number): void {
    if (segments === this.segments) return;
    const old = this.geometry;
    this.segments = segments;
    this.geometry = this.createGeometry(segments);
    this.mesh.geometry = this.geometry;
    old.dispose();
  }

  update(
    time: number,
    ocean: OceanSettings,
    fogDensity: number,
    fogColor: THREE.Color,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    skyColor: THREE.Color,
  ): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uWaveHeight.value = ocean.waveHeight;
    u.uChoppiness.value = ocean.choppiness;
    u.uSeaState.value = ocean.seaState;
    u.uDeepColor.value.copy(hexToVec3(ocean.deepColor));
    u.uShallowColor.value.copy(hexToVec3(ocean.shallowColor));
    u.uFoamAmount.value = ocean.foamAmount;
    u.uClarity.value = ocean.clarity;
    u.uAbsorption.value = ocean.absorption;
    u.uFogDensity.value = fogDensity;
    u.uFogColor.value.set(fogColor.r, fogColor.g, fogColor.b);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.set(sunColor.r, sunColor.g, sunColor.b);
    u.uSkyColor.value.set(skyColor.r, skyColor.g, skyColor.b);
  }

  follow(x: number, z: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private createGeometry(segments: number): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(this.size, this.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
}

export function waveUniformsFromBase(): {
  amp: number[];
  len: number[];
  omega: number[];
} {
  return {
    amp: BASE_WAVES.map((w) => w.amplitude),
    len: BASE_WAVES.map((w) => w.wavelength),
    omega: BASE_WAVES.map((w) => waveAngularFrequency(waveNumber(w.wavelength))),
  };
}
