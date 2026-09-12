import type { OceanSettings } from '../../core/types';
import type { QualityName } from '../quality';

export type OceanBackendName = 'gerstner' | 'spectral';
export type WorldVersion = 'legacy-v1' | 'littoral-v2';
export type EnvironmentQuality = QualityName;

export interface WakeBody {
  x: number;
  z: number;
  heading: number;
  speed: number;
  stern?: number;
}

export interface PresentationEntity {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly depth: number;
  readonly kind: string;
}

/** Copied presentation inputs. Never a live GameState reference. */
export interface EnvironmentFrame {
  time: number;
  dt: number;
  /** Freeze wave/foam/weather histories; cameras may still refresh optics. */
  paused?: boolean;
  reducedMotion?: boolean;
  ocean: OceanSettings;
  fogDensity: number;
  fogColor: { r: number; g: number; b: number };
  sunDir: { x: number; y: number; z: number };
  sunColor: { r: number; g: number; b: number };
  skyColor: { r: number; g: number; b: number };
  sandColorHex: string;
  followX: number;
  followZ: number;
  readability: { clarity: number; absorption: number };
  wakes: readonly WakeBody[];
  terrainSeed?: number;
  worldVersion?: WorldVersion;
}

export interface EnvironmentDiagnostics {
  backend: OceanBackendName;
  requestedBackend: OceanBackendName;
  ready: boolean;
  fallbackReason: string | null;
  missionGeneration: number;
  worldVersion: WorldVersion;
  recoveryStatus?: 'ready' | 'lost' | 'rebuilding' | 'failed';
}

export interface EnvironmentBackend {
  readonly name: OceanBackendName;
  prepare(frame: EnvironmentFrame): void;
  renderPasses(): void;
  resize(width: number, height: number, dpr: number): void;
  setQuality(profile: EnvironmentQuality): void;
  reset(missionGeneration: number): void;
  rebind?(): void;
  getDiagnostics(): EnvironmentDiagnostics;
  dispose(): void;
}

export interface BackendFactory {
  (name: OceanBackendName, signal: AbortSignal): Promise<EnvironmentBackend>;
}
