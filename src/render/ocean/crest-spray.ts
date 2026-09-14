/** GPU spray born at breaking crests and rock impacts. Presentation only. */

import * as THREE from 'three';
import { SPECTRUM_SAMPLE_GLSL } from './spectrum';
import { SURFACE_FUNCTIONS_GLSL } from './surface';
import {
  createFloatTarget,
  disposeMaterial,
  disposeTarget,
  SimulationPass,
  simulationMaterial,
  withRendererPass,
} from './resources';
import type { WorldFoamMaps } from './world-foam';

const PASS_VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

export const CREST_SPRAY_COUNT_HIGH = 384;
export const CREST_SPRAY_COUNT_COMPACT = 192;

export const CREST_SPRAY_UPDATE_GLSL = /* glsl */ `
${SPECTRUM_SAMPLE_GLSL}
uniform sampler2D uCoastal;
uniform float uCoastalEnabled;
uniform vec2 uCoastalOrigin;
uniform float uCoastalExtent;
uniform vec2 uSwellDirection;
uniform sampler2D uBedTex;
uniform vec2 uBedOrigin;
uniform float uBedExtent;
uniform float uWetBand;
uniform float uWaveHeight;
${SURFACE_FUNCTIONS_GLSL}
uniform sampler2D uParticles;
uniform sampler2D uVelocities;
uniform float uCount;
uniform float uDelta;
uniform float uTime;
uniform float uStorm;
uniform float uOutputVelocity;
uniform vec3 uEmitter;
void main() {
  float index = floor(gl_FragCoord.x);
  vec2 uv = vec2((index + 0.5) / uCount, 0.5);
  vec4 origin = texture2D(uParticles, uv);
  vec4 velocity = texture2D(uVelocities, uv);
  float age = uTime - origin.a;
  if (age < velocity.a) {
    gl_FragColor = uOutputVelocity > 0.5 ? velocity : origin;
    return;
  }
  vec2 randv = vec2(fract(sin(index * 127.1 + uTime * 13.7) * 43758.5453), fract(sin(index * 269.5 + uTime * 7.1) * 43758.5453));
  vec2 p = uEmitter.xz + (randv - 0.5) * 90.0;
  float bed = texture2D(uBedTex, clamp((p - uBedOrigin) / max(uBedExtent, 1.0), 0.0, 1.0)).r;
  vec3 wave = oceanDisplacement(p);
  vec3 n = oceanNormal(p);
  float compression = smoothstep(0.32, 0.7, length(n.xz)) * smoothstep(0.08, 0.55, wave.y);
  float surf = 1.0 - smoothstep(1.2, 14.0, max(0.05, -bed));
  float impact = smoothstep(-1.2, 0.15, bed) * compression * 0.7;
  float energy = clamp(compression * 0.7 * surf + impact + compression * uStorm * 0.45, 0.0, 1.0);
  float probability = energy * uDelta * mix(0.9, 2.2, uStorm);
  if (bed > wave.y || fract(sin(index * 43.0 + uTime * 1.31) * 43758.5453) > probability) {
    gl_FragColor = uOutputVelocity > 0.5 ? velocity : origin;
    return;
  }
  vec4 coast = coastAt(p);
  vec2 dir = length(coast.yz) > 0.12 ? normalize(coast.yz) : uSwellDirection;
  float life = 0.55 + randv.x * 1.05 + uStorm * 0.4;
  vec3 launch = vec3(dir.x * (0.35 + energy), 1.0 + energy * 2.1, dir.y * (0.35 + energy));
  origin = vec4(p.x + wave.x, wave.y + 0.06, p.y + wave.z, uTime);
  velocity = vec4(launch, life);
  gl_FragColor = uOutputVelocity > 0.5 ? velocity : origin;
}
`;

export class CrestSpraySystem {
  readonly points: THREE.Points;
  private readonly pass = new SimulationPass();
  private readonly dummy: THREE.DataTexture;
  private readonly origins: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly velocities: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly updateMaterial: THREE.ShaderMaterial;
  private readonly drawMaterial: THREE.ShaderMaterial;
  private index = 0;
  private readonly count: number;

  constructor(compact = false) {
    this.count = compact ? CREST_SPRAY_COUNT_COMPACT : CREST_SPRAY_COUNT_HIGH;
    this.dummy = new THREE.DataTexture(
      new Float32Array(4),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.dummy.needsUpdate = true;
    this.origins = [
      createFloatTarget({ width: this.count, height: 1, wrap: THREE.ClampToEdgeWrapping }),
      createFloatTarget({ width: this.count, height: 1, wrap: THREE.ClampToEdgeWrapping }),
    ];
    this.velocities = [
      createFloatTarget({ width: this.count, height: 1, wrap: THREE.ClampToEdgeWrapping }),
      createFloatTarget({ width: this.count, height: 1, wrap: THREE.ClampToEdgeWrapping }),
    ];
    const simUniforms = {
      uDisplacement0: { value: this.dummy as THREE.Texture },
      uDisplacement1: { value: this.dummy as THREE.Texture },
      uDisplacement2: { value: this.dummy as THREE.Texture },
      uSlope0: { value: this.dummy as THREE.Texture },
      uSlope1: { value: this.dummy as THREE.Texture },
      uSlope2: { value: this.dummy as THREE.Texture },
      uCascadeLength: { value: new THREE.Vector3(1792, 211, 27.3) },
      uCascadeSize: { value: new THREE.Vector3(1, 1, 1) },
      uCoastal: { value: this.dummy as THREE.Texture },
      uCoastalEnabled: { value: 0 },
      uCoastalOrigin: { value: new THREE.Vector2() },
      uCoastalExtent: { value: 1 },
      uSwellDirection: { value: new THREE.Vector2(1, 0) },
      uBedTex: { value: this.dummy as THREE.Texture },
      uBedOrigin: { value: new THREE.Vector2() },
      uBedExtent: { value: 1 },
      uWetBand: { value: 6 },
      uWaveHeight: { value: 1 },
      uParticles: { value: this.dummy as THREE.Texture },
      uVelocities: { value: this.dummy as THREE.Texture },
      uCount: { value: this.count },
      uDelta: { value: 1 / 30 },
      uTime: { value: 0 },
      uStorm: { value: 0 },
      uOutputVelocity: { value: 0 },
      uEmitter: { value: new THREE.Vector3() },
    };
    this.updateMaterial = simulationMaterial(simUniforms, CREST_SPRAY_UPDATE_GLSL, PASS_VERTEX);
    this.drawMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uParticles: { value: this.origins[0].texture },
        uVelocities: { value: this.velocities[0].texture },
        uTime: { value: 0 },
        uPixelHeight: { value: 900 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float particleIndex;
        uniform sampler2D uParticles;
        uniform sampler2D uVelocities;
        uniform float uTime;
        uniform float uPixelHeight;
        varying float vAlpha;
        void main() {
          vec4 origin = texture2D(uParticles, vec2(particleIndex, 0.5));
          vec4 velocity = texture2D(uVelocities, vec2(particleIndex, 0.5));
          float age = max(0.0, uTime - origin.a);
          float life = max(0.01, velocity.a);
          if (age >= life) {
            vAlpha = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 1.0;
            return;
          }
          vec3 world = origin.xyz + velocity.xyz * age - vec3(0.0, 2.5 * age * age, 0.0);
          vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(life * 0.4, life, age)) * 0.28;
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((0.04 + age * 0.07) * uPixelHeight / max(1.0, -mv.z), 1.0, 9.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float alpha = exp(-r * r * 4.5) * vAlpha;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(0.86, 0.93, 0.96, alpha);
        }
      `,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.count * 3), 3),
    );
    const indices = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) indices[i] = (i + 0.5) / this.count;
    geometry.setAttribute('particleIndex', new THREE.BufferAttribute(indices, 1));
    this.points = new THREE.Points(geometry, this.drawMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.name = 'crest-spray';
  }

  update(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    time: number,
    dt: number,
    maps: WorldFoamMaps | null,
  ): void {
    this.points.visible = Boolean(maps) && camera.position.y < 70;
    if (!this.points.visible || !maps) return;
    const u = this.updateMaterial.uniforms;
    for (let i = 0; i < 3; i++) {
      u[`uDisplacement${i}`]!.value = maps.displacements[i];
      u[`uSlope${i}`]!.value = maps.slopes[i];
    }
    (u.uCascadeLength!.value as THREE.Vector3).set(
      maps.lengths[0] ?? 1,
      maps.lengths[1] ?? 1,
      maps.lengths[2] ?? 1,
    );
    u.uBedTex!.value = maps.bed ?? this.dummy;
    (u.uBedOrigin!.value as THREE.Vector2).set(maps.bedOrigin?.x ?? 0, maps.bedOrigin?.z ?? 0);
    u.uBedExtent!.value = maps.bedExtent ?? 1;
    u.uWetBand!.value = maps.wetBand ?? 6;
    u.uWaveHeight!.value = maps.waveHeight ?? 1;
    u.uCoastal!.value = maps.coastal ?? this.dummy;
    u.uCoastalEnabled!.value = maps.coastalEnabled && maps.coastal ? 1 : 0;
    (u.uCoastalOrigin!.value as THREE.Vector2).set(
      maps.coastalOrigin?.x ?? 0,
      maps.coastalOrigin?.z ?? 0,
    );
    u.uCoastalExtent!.value = maps.coastalExtent ?? 1;
    (u.uSwellDirection!.value as THREE.Vector2).set(
      maps.swellDirection?.x ?? 1,
      maps.swellDirection?.z ?? 0,
    );
    u.uStorm!.value = maps.storm ?? 0;
    u.uTime!.value = time;
    u.uDelta!.value = Math.min(dt, 0.08);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    (u.uEmitter!.value as THREE.Vector3).copy(camera.position).addScaledVector(forward, 28);
    const next = 1 - this.index;
    u.uParticles!.value = this.origins[this.index].texture;
    u.uVelocities!.value = this.velocities[this.index].texture;
    withRendererPass(renderer, () => {
      u.uOutputVelocity!.value = 0;
      this.pass.run(renderer, this.updateMaterial, this.origins[next]);
      u.uOutputVelocity!.value = 1;
      this.pass.run(renderer, this.updateMaterial, this.velocities[next]);
    });
    this.index = next;
    this.drawMaterial.uniforms.uParticles!.value = this.origins[this.index].texture;
    this.drawMaterial.uniforms.uVelocities!.value = this.velocities[this.index].texture;
    this.drawMaterial.uniforms.uTime!.value = time;
    this.drawMaterial.uniforms.uPixelHeight!.value = renderer.domElement.height || 900;
  }

  dispose(): void {
    this.dummy.dispose();
    this.points.geometry.dispose();
    disposeMaterial(this.updateMaterial);
    disposeMaterial(this.drawMaterial);
    this.pass.dispose();
    disposeTarget(this.origins[0]);
    disposeTarget(this.origins[1]);
    disposeTarget(this.velocities[0]);
    disposeTarget(this.velocities[1]);
  }
}
