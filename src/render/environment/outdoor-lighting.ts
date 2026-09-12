import * as THREE from 'three';
import type { AtmosphereState } from '../atmosphere';
import {
  SkyLighting,
  type SkyLightingDiagnostics,
  type SkyLightingState,
} from './sky-lighting';

export type OutdoorLightingInput = {
  atmosphere: AtmosphereState;
  cloudCoverage: number;
  /** Presentation-only; never baked into PMREM (see sky-lighting update). */
  lightning: number;
  nowSeconds: number;
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
  };
}

/**
 * Scene-facing wrapper for procedural outdoor IBL. Keeps PMREM ownership out of
 * scene.ts so ocean/optics agents can edit composition independently.
 */
export class OutdoorLighting {
  private skyLighting: SkyLighting | null = null;

  bind(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (this.skyLighting) return;
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
        },
        cloudCoverage: 0.5,
        lightning: 0,
      }),
      0,
      true,
    );
  }

  update(input: OutdoorLightingInput, force = false): boolean {
    if (!this.skyLighting) return false;
    return this.skyLighting.update(buildSkyLightingState(input), input.nowSeconds, force);
  }

  reset(): void {
    this.skyLighting?.reset();
  }

  dispose(): void {
    this.skyLighting?.dispose();
    this.skyLighting = null;
  }

  getDiagnostics(): SkyLightingDiagnostics | null {
    return this.skyLighting?.getDiagnostics() ?? null;
  }
}
