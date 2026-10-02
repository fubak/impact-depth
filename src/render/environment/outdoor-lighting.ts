import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import type { AtmosphereState } from '../atmosphere';
import { SkyLighting, type SkyLightingDiagnostics, type SkyLightingState } from './sky-lighting';
import { pickSkyLightingSource } from './sky-source';

export const HDR_PUBLIC_PATH = `${import.meta.env.BASE_URL}assets/environment/v1/kloofendal_48d_partly_cloudy_puresky_1k.hdr`;

export type OutdoorLightingInput = {
  atmosphere: AtmosphereState;
  cloudCoverage: number;
  /** Presentation-only; never baked into PMREM (see sky-lighting update). */
  lightning: number;
  nowSeconds: number;
  weatherPreset?: 'calm' | 'breeze' | 'storm';
};

/** PMREM state aligned with sun/sky/horizon/clouds/time — excludes transient lightning. */
export function buildSkyLightingState(
  input: Omit<OutdoorLightingInput, 'nowSeconds'>,
): SkyLightingState {
  return {
    sunDir: input.atmosphere.sunDir,
    sunColor: input.atmosphere.sunColor,
    skyTop: input.atmosphere.skyTop,
    skyHorizon: input.atmosphere.skyHorizon,
    cloudCoverage: input.cloudCoverage,
    lightning: 0,
    isNight: input.atmosphere.isNight,
    weatherPreset: input.weatherPreset,
    golden: input.atmosphere.golden,
    twilight: input.atmosphere.twilight,
  };
}

/**
 * Scene-facing wrapper for outdoor IBL. Procedural PMREM first; local HDR
 * swaps in when the versioned pack loads. Same-origin path only.
 */
export class OutdoorLighting {
  private skyLighting: SkyLighting | null = null;
  private scene: THREE.Scene | null = null;
  private hdrTexture: THREE.Texture | null = null;
  private hdrFailed = false;
  private loadGeneration = 0;

  bind(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.skyLighting) return;
    this.scene = scene;
    this.skyLighting = new SkyLighting(renderer, scene);
    this.skyLighting.update(
      buildSkyLightingState({
        atmosphere: {
          sunDir: new THREE.Vector3(0.2, 0.9, 0.3).normalize(),
          sunColor: new THREE.Color(1, 0.94, 0.81),
          moonDir: new THREE.Vector3(-0.2, -0.9, -0.3),
          fogColor: new THREE.Color(0.84, 0.93, 1),
          skyTop: new THREE.Color(0.24, 0.62, 0.89),
          skyHorizon: new THREE.Color(0.84, 0.94, 1),
          ambient: 0.78,
          isNight: false,
          sunElevation: 64,
          golden: 0,
          twilight: 0,
        },
        cloudCoverage: 0.5,
        lightning: 0,
      }),
      0,
      true,
    );
    this.beginHdrLoad();
  }

  private beginHdrLoad(): void {
    const generation = ++this.loadGeneration;
    const loader = new HDRLoader();
    loader.load(
      HDR_PUBLIC_PATH,
      (texture) => {
        if (generation !== this.loadGeneration || !this.skyLighting) {
          texture.dispose();
          return;
        }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.hdrTexture?.dispose();
        this.hdrTexture = texture;
        this.hdrFailed = false;
        this.skyLighting.bindHdrEquirect(texture);
        if (this.skyLighting.getDiagnostics().source === 'hdr-pmrem' && this.scene) {
          this.scene.background = texture;
        }
      },
      undefined,
      () => {
        if (generation !== this.loadGeneration) return;
        this.hdrFailed = true;
        this.skyLighting?.markHdrFailed();
      },
    );
  }

  update(input: OutdoorLightingInput, force = false): boolean {
    if (!this.skyLighting) return false;
    const changed = this.skyLighting.update(buildSkyLightingState(input), input.nowSeconds, force);
    if (
      pickSkyLightingSource({
        hdrReady: this.hdrTexture !== null && !this.hdrFailed,
        hdrFailed: this.hdrFailed,
        isNight: input.atmosphere.isNight,
        weatherPreset: input.weatherPreset,
        sunY: input.atmosphere.sunDir.y,
      }) === 'hdr-pmrem' &&
      this.scene &&
      this.hdrTexture
    ) {
      this.scene.background = this.hdrTexture;
      if (this.scene.fog instanceof THREE.FogExp2 && !input.atmosphere.isNight) {
        this.scene.fog.density *= 0.55;
      }
    }
    return changed;
  }

  reset(): void {
    this.skyLighting?.reset();
  }

  dispose(): void {
    this.loadGeneration++;
    this.skyLighting?.dispose();
    this.skyLighting = null;
    this.hdrTexture?.dispose();
    this.hdrTexture = null;
    this.hdrFailed = false;
    this.scene = null;
  }

  getDiagnostics(): SkyLightingDiagnostics | null {
    return this.skyLighting?.getDiagnostics() ?? null;
  }
}
