import { LAND_LEVEL, METERS_PER_UNIT, WORLD_SIZE } from '../../game/sim/constants';
import { simToWorldMeters } from '../../game/sim/coords';
import type { WorldDefinition } from '../../game/world/definition';
import { worldHeight } from '../../game/world/queries';

export interface HeightTextureSpec {
  size: number;
  originX: number;
  originZ: number;
  extent: number;
  /** Texel centers map to sim (x+0.5, y+0.5). */
  sampleMode: 'texel-center';
  clamp: 'edge';
  interpolation: 'bilinear';
  seaLevelNormalized: number;
  metresPerUnit: number;
}

export interface PackedHeightField {
  spec: HeightTextureSpec;
  /** Bed elevation in metres, positive up, sea ≈ 0. Legacy uses a temporary mapping. */
  bedMetres: Float32Array;
}

/** Temporary: treat normalized sim height 0..1 as 0..-28 m below, land as small positive. */
export function normalizedBedToMetres(normalized: number): number {
  if (normalized >= LAND_LEVEL) return (normalized - LAND_LEVEL) * 12;
  return -((LAND_LEVEL - normalized) / LAND_LEVEL) * 28;
}

export function packWorldHeightTexture(world: WorldDefinition): PackedHeightField {
  const size = world.size;
  const half = (WORLD_SIZE * METERS_PER_UNIT) / 2;
  const spec: HeightTextureSpec = {
    size,
    originX: -half,
    originZ: -half,
    extent: WORLD_SIZE * METERS_PER_UNIT,
    sampleMode: 'texel-center',
    clamp: 'edge',
    interpolation: 'bilinear',
    seaLevelNormalized: world.seaLevelNormalized,
    metresPerUnit: world.metresPerUnit,
  };
  const bedMetres = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      bedMetres[y * size + x] = normalizedBedToMetres(worldHeight(world, x + 0.5, y + 0.5));
    }
  }
  return { spec, bedMetres };
}

function clampIndex(i: number, size: number): number {
  return Math.max(0, Math.min(size - 1, i));
}

export function samplePackedBed(field: PackedHeightField, worldX: number, worldZ: number): number {
  const { spec, bedMetres } = field;
  const u = (worldX - spec.originX) / spec.extent;
  const v = (worldZ - spec.originZ) / spec.extent;
  const fx = u * spec.size - 0.5;
  const fy = v * spec.size - 0.5;
  const x0 = clampIndex(Math.floor(fx), spec.size);
  const y0 = clampIndex(Math.floor(fy), spec.size);
  const x1 = clampIndex(x0 + 1, spec.size);
  const y1 = clampIndex(y0 + 1, spec.size);
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  const a = bedMetres[y0 * spec.size + x0]!;
  const b = bedMetres[y0 * spec.size + x1]!;
  const c = bedMetres[y1 * spec.size + x0]!;
  const d = bedMetres[y1 * spec.size + x1]!;
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

export function simCellCenterToWorld(x: number, y: number): { x: number; z: number } {
  return simToWorldMeters(x, y);
}

/**
 * World-to-UV for the packed bed texture.
 * Texel centers sit at (i + 0.5) / size; LinearFilter + ClampToEdge matches `samplePackedBed`.
 */
export function packedBedUv(
  spec: HeightTextureSpec,
  worldX: number,
  worldZ: number,
): { u: number; v: number } {
  return {
    u: (worldX - spec.originX) / spec.extent,
    v: (worldZ - spec.originZ) / spec.extent,
  };
}

/** Narrow shoreline wash; inland of this bed height the ocean sheet is dry. */
export const SHORE_WET_BAND_METRES = 6;

export function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 1 over open water, fade across a narrow shoreline band, 0 inland.
 * Matches the Gerstner coverage mask (no water-on-land lift).
 */
export function waterCoverageFromBed(bedMetres: number, wetBand = SHORE_WET_BAND_METRES): number {
  return 1 - glslSmoothstep(-wetBand, wetBand * 0.2, bedMetres);
}

export function maskWaveDisplacement(
  restY: number,
  displacedY: number,
  bedMetres: number,
  wetBand = SHORE_WET_BAND_METRES,
): number {
  const coverage = waterCoverageFromBed(bedMetres, wetBand);
  return restY + (displacedY - restY) * coverage;
}
