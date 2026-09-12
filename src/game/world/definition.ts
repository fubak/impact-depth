import { LAND_LEVEL, METERS_PER_UNIT, WORLD_SIZE } from '../sim/constants';

export type WorldVersion = 'legacy-v1' | 'littoral-v2';

/** Horizontal footprint plus required water column. Wave crests are ignored. */
export interface NavigationProfile {
  radiusSim: number;
  requiredWaterMetres: number;
}

export interface WorldDefinition {
  version: WorldVersion;
  seed: number;
  size: number;
  metresPerUnit: number;
  seaLevelNormalized: number;
  halfExtentMetres: number;
  /** Compatibility 0..1 field for legacy callers; not metres on v2. */
  bedNormalized: readonly number[];
  /** Canonical signed bed, positive up, sea = 0. Present on littoral-v2. */
  bedMetres?: Float32Array;
  bedGridSize?: number;
  bedSpacingMetres?: number;
  bedOriginMetres?: number;
}

export function resolveWorldVersion(raw: string | null | undefined): WorldVersion {
  if (raw === 'littoral-v2') return 'littoral-v2';
  return 'legacy-v1';
}

export function worldCacheKey(version: WorldVersion, seed: number, size: number): string {
  return `${version}:${seed >>> 0}:${size}`;
}

export function emptyWorldMeta(
  version: WorldVersion,
  seed: number,
  size = WORLD_SIZE,
): Omit<WorldDefinition, 'bedNormalized'> {
  return {
    version,
    seed: seed >>> 0,
    size,
    metresPerUnit: METERS_PER_UNIT,
    seaLevelNormalized: LAND_LEVEL,
    halfExtentMetres: (size * METERS_PER_UNIT) / 2,
  };
}

/** Inverse of the CP2 legacy metre mapping; v2 gameplay must not treat this as metres. */
export function metresToNormalizedBed(metres: number): number {
  if (metres >= 0) return LAND_LEVEL + metres / 12;
  return LAND_LEVEL * (1 + metres / 28);
}
