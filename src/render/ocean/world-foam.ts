/** World-space shoreline foam (wide + near ping-pong). Spectral only. */

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

const PASS_VERTEX = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

export const WORLD_FOAM_WIDE_EXTENT_M = 760;
export const WORLD_FOAM_NEAR_EXTENT_M = 128;

export const SAMPLE_WORLD_FOAM_GLSL = /* glsl */ `
uniform sampler2D uWorldFoamWide;
uniform sampler2D uWorldFoamNear;
uniform vec3 uWorldFoamRegion;
uniform float uWorldFoamDetail;
uniform float uWorldFoamEnabled;
float sampleWorldFoam(vec2 p) {
  if (uWorldFoamEnabled < 0.5) return 0.0;
  float wide = texture2D(uWorldFoamWide, clamp(p / 760.0 + 0.5, 0.001, 0.999)).r;
  vec2 uv = (p - uWorldFoamRegion.xy) / max(uWorldFoamRegion.z, 1.0) + 0.5;
  float edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
  float blend = (1.0 - smoothstep(0.32, 0.47, edge)) * uWorldFoamDetail;
  float near = texture2D(uWorldFoamNear, clamp(uv, 0.001, 0.999)).r;
  return mix(wide, near, blend);
}
`;

export const WORLD_FOAM_DERIVE_GLSL = /* glsl */ `
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
uniform sampler2D uPrevious;
uniform sampler2D uFoamWide;
uniform vec3 uRegion;
uniform vec3 uPreviousRegion;
uniform float uSize;
uniform float uDelta;
uniform float uStorm;
uniform float uNear;
uniform vec2 uWind;
uniform float uTime;
vec4 previousAt(vec2 p) {
  vec2 uv = (p - uPreviousRegion.xy) / max(uPreviousRegion.z, 1.0) + 0.5;
  if (max(abs(uv.x - 0.5), abs(uv.y - 0.5)) > 0.496) {
    return uNear > 0.5 ? texture2D(uFoamWide, clamp(p / 760.0 + 0.5, 0.001, 0.999)) : vec4(0.0);
  }
  return texture2D(uPrevious, uv);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 p = uRegion.xy + (uv - 0.5) * uRegion.z;
  float bed = texture2D(uBedTex, clamp((p - uBedOrigin) / max(uBedExtent, 1.0), 0.0, 1.0)).r;
  float depth = max(0.05, -bed);
  if (bed > 0.85 || depth > 40.0) { gl_FragColor = vec4(0.0); return; }
  vec4 coast = coastAt(p);
  vec2 travel = length(coast.yz) > 0.12 ? normalize(coast.yz) : uSwellDirection;
  vec2 flow = travel * (0.35 + uStorm * 0.45) + uWind * 0.14;
  vec4 old = previousAt(p - flow * uDelta);
  float life = mix(2.4, 6.8, coast.w) * mix(1.0, 1.35, uStorm);
  float foam = old.r * exp(-uDelta / life);
  vec3 wave = oceanDisplacement(p);
  vec3 n = oceanNormal(p);
  float breaking = smoothstep(0.28, 0.82, length(n.xz)) * smoothstep(0.04, 0.42, wave.y);
  float surf = 1.0 - smoothstep(1.6, 18.0, depth);
  float source = (breaking * 0.52 + oceanFoam(p) * 0.22) * surf;
  float deposited = 1.0 - exp(-uDelta * source * 1.7);
  foam = clamp(foam + (1.0 - foam) * deposited, 0.0, 1.0);
  foam *= 1.0 - smoothstep(-0.15, 1.1, bed);
  gl_FragColor = vec4(foam, deposited, 0.0, 1.0);
}
`;

export interface WorldFoamMaps {
  readonly displacements: readonly THREE.Texture[];
  readonly slopes: readonly THREE.Texture[];
  readonly lengths: readonly number[];
  readonly bed?: THREE.Texture | null;
  readonly bedOrigin?: { x: number; z: number };
  readonly bedExtent?: number;
  readonly wetBand?: number;
  readonly waveHeight?: number;
  readonly coastal?: THREE.Texture | null;
  readonly coastalEnabled?: boolean;
  readonly coastalOrigin?: { x: number; z: number };
  readonly coastalExtent?: number;
  readonly swellDirection?: { x: number; z: number };
  readonly storm?: number;
  readonly wind?: { x: number; z: number };
}

type FoamLevel = {
  size: number;
  extent: number;
  region: THREE.Vector3;
  targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  index: number;
  elapsed: number;
};

export class WorldFoamSystem {
  private readonly pass = new SimulationPass();
  private readonly dummy: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly levels: FoamLevel[];
  private detail = 0;
  enabled = false;

  constructor(compact = false) {
    this.dummy = new THREE.DataTexture(
      new Float32Array(4),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.dummy.needsUpdate = true;
    const wideSize = compact ? 256 : 384;
    const nearSize = compact ? 192 : 256;
    this.levels = [
      this.makeLevel(wideSize, WORLD_FOAM_WIDE_EXTENT_M),
      this.makeLevel(nearSize, WORLD_FOAM_NEAR_EXTENT_M),
    ];
    this.material = simulationMaterial(
      {
        uDisplacement0: { value: this.dummy },
        uDisplacement1: { value: this.dummy },
        uDisplacement2: { value: this.dummy },
        uSlope0: { value: this.dummy },
        uSlope1: { value: this.dummy },
        uSlope2: { value: this.dummy },
        uCascadeLength: { value: new THREE.Vector3(1792, 211, 27.3) },
        uCascadeSize: { value: new THREE.Vector3(1, 1, 1) },
        uCoastal: { value: this.dummy },
        uCoastalEnabled: { value: 0 },
        uCoastalOrigin: { value: new THREE.Vector2() },
        uCoastalExtent: { value: 1 },
        uSwellDirection: { value: new THREE.Vector2(1, 0) },
        uBedTex: { value: this.dummy },
        uBedOrigin: { value: new THREE.Vector2() },
        uBedExtent: { value: 1 },
        uWetBand: { value: 6 },
        uWaveHeight: { value: 1 },
        uPrevious: { value: this.dummy },
        uFoamWide: { value: this.dummy },
        uRegion: { value: new THREE.Vector3() },
        uPreviousRegion: { value: new THREE.Vector3() },
        uSize: { value: wideSize },
        uDelta: { value: 1 / 30 },
        uStorm: { value: 0 },
        uNear: { value: 0 },
        uWind: { value: new THREE.Vector2(0.3, 0.8) },
        uTime: { value: 0 },
      },
      WORLD_FOAM_DERIVE_GLSL,
      PASS_VERTEX,
    );
  }

  private makeLevel(size: number, extent: number): FoamLevel {
    const targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [
      createFloatTarget({ width: size, height: size, wrap: THREE.ClampToEdgeWrapping }),
      createFloatTarget({ width: size, height: size, wrap: THREE.ClampToEdgeWrapping }),
    ];
    for (const target of targets) {
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
    }
    return {
      size,
      extent,
      region: new THREE.Vector3(0, 0, extent),
      targets,
      index: 0,
      elapsed: 0,
    };
  }

  applyTo(uniforms: THREE.ShaderMaterial['uniforms']): void {
    uniforms.uWorldFoamWide!.value = this.levels[0]!.targets[this.levels[0]!.index].texture;
    uniforms.uWorldFoamNear!.value = this.levels[1]!.targets[this.levels[1]!.index].texture;
    (uniforms.uWorldFoamRegion!.value as THREE.Vector3).copy(this.levels[1]!.region);
    uniforms.uWorldFoamDetail!.value = this.detail;
    uniforms.uWorldFoamEnabled!.value = this.enabled ? 1 : 0;
  }

  update(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    follow: { x: number; z: number },
    time: number,
    dt: number,
    maps: WorldFoamMaps | null,
  ): void {
    if (!maps || maps.displacements.length < 3) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
    const u = this.material.uniforms;
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
    (u.uWind!.value as THREE.Vector2).set(maps.wind?.x ?? 0.3, maps.wind?.z ?? 0.8);
    u.uTime!.value = time;
    const wantDetail = camera.position.y < 70 ? 1 : 0;
    this.detail += (wantDetail - this.detail) * (1 - Math.exp(-dt * 2));
    const vx = follow.x - camera.position.x;
    const vz = follow.z - camera.position.z;
    const length = Math.max(1, Math.hypot(vx, vz));
    const ahead = Math.min(length, Math.max(18, Math.min(42, camera.position.y * 2.4)));
    const focusX = camera.position.x + (vx / length) * ahead;
    const focusZ = camera.position.z + (vz / length) * ahead;
    withRendererPass(renderer, () => {
      for (let i = 0; i < this.levels.length; i++) {
        const level = this.levels[i]!;
        if (i === 1 && this.detail < 0.01) {
          level.elapsed = 0;
          continue;
        }
        level.elapsed += dt;
        const interval = i === 0 ? 1 / 12 : 1 / 24;
        if (level.elapsed < interval) continue;
        const step = Math.min(level.elapsed, 0.12);
        level.elapsed = 0;
        (u.uPreviousRegion!.value as THREE.Vector3).copy(level.region);
        if (i === 1) {
          level.region.set(
            Math.round(focusX / 8) * 8,
            Math.round(focusZ / 8) * 8,
            WORLD_FOAM_NEAR_EXTENT_M,
          );
        } else {
          level.region.set(follow.x, follow.z, WORLD_FOAM_WIDE_EXTENT_M);
        }
        (u.uRegion!.value as THREE.Vector3).copy(level.region);
        u.uPrevious!.value = level.targets[level.index].texture;
        u.uFoamWide!.value = this.levels[0]!.targets[this.levels[0]!.index].texture;
        u.uSize!.value = level.size;
        u.uDelta!.value = step;
        u.uNear!.value = i;
        level.index = 1 - level.index;
        this.pass.run(renderer, this.material, level.targets[level.index]);
      }
    });
  }

  dispose(): void {
    this.dummy.dispose();
    disposeMaterial(this.material);
    this.pass.dispose();
    for (const level of this.levels) {
      disposeTarget(level.targets[0]);
      disposeTarget(level.targets[1]);
    }
  }
}
