/**
 * Deterministic Caribbean littoral terrain helpers (no Three.js).
 * Heights: positive = above water, negative = bathymetry depth (world Y).
 */

export type TerrainBiome = 'deep' | 'shelf' | 'beach' | 'grass' | 'rock';

function fract(n: number): number {
  return n - Math.floor(n);
}

/** Deterministic 2D hash in [0, 1). */
export function hash2(x: number, z: number): number {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise. */
export function valueNoise2(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = fade(x - x0);
  const fz = fade(z - z0);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

export function fbm2(x: number, z: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / Math.max(norm, 1e-6);
}

export interface IslandSpec {
  id: string;
  cx: number;
  cz: number;
  radius: number;
  peak: number;
  seed: number;
}

/** Outer radial extent of island mesh (normalized). Short shelf apron
 * blends into seabed without a wide visible disc. */
export const ISLAND_MESH_RADIUS_FACTOR = 1.35;

/** Island specs — one cay in tactical frame, one distant, one peri cue. */
export const ISLAND_SPECS: readonly IslandSpec[] = [
  // South of convoy lane: beach/foliage/mountain readable in default tactical
  { id: 'cay-near', cx: 38, cz: -55, radius: 38, peak: 15, seed: 17 },
  // Distant windward massing
  { id: 'cay-far', cx: 145, cz: 85, radius: 32, peak: 17, seed: 41 },
  // Port background / peri glance
  { id: 'cay-port', cx: -75, cz: 70, radius: 28, peak: 14, seed: 89 },
] as const;

/**
 * Seabed world Y under open water. Playable start area stays ~−12…−18
 * so a sub at ~8.5 m depth remains above the floor. Near cays the
 * shelf rises into turquoise shallows without punching through land.
 */
export function sampleSeabedY(x: number, z: number): number {
  const basin = fbm2(x * 0.014, z * 0.014, 5);
  const ridges = fbm2(x * 0.045 + 20, z * 0.045 - 8, 4);
  const banks = fbm2(x * 0.09 - 4, z * 0.09 + 6, 3);
  const micro = fbm2(x * 0.22, z * 0.22, 2);
  let depth = 14.0 + basin * 6.5 + ridges * 3.8 + banks * 2.2 + micro * 0.55;
  const shoreBias = fbm2(x * 0.007 - 3, z * 0.007 + 1, 3);
  depth -= shoreBias * 3.2;

  for (const island of ISLAND_SPECS) {
    const d = Math.hypot(x - island.cx, z - island.cz) / Math.max(island.radius, 1);
    if (d < 1.05 || d > 2.2) continue;
    const t = fade((2.2 - d) / 1.15);
    const shallow = 3.0 + (d - 1.05) * 5.2;
    depth = depth * (1 - t) + shallow * t;
  }

  const nearStart = Math.hypot(x, z - 18);
  if (nearStart < 48) {
    depth = Math.max(depth, 11.8);
  }
  depth = Math.max(3.2, Math.min(28, depth));
  return -depth;
}

export function classifySeabedTone(x: number, z: number): number {
  return fbm2(x * 0.07 + 9, z * 0.07 - 4, 3);
}

/**
 * Island height field in local coordinates (meters above water).
 * Continuous apron down to seabed — designed for radial disc meshes.
 */
export function sampleIslandHeight(localX: number, localZ: number, spec: IslandSpec): number {
  const r = Math.hypot(localX, localZ) / Math.max(spec.radius, 1);
  const ang = Math.atan2(localZ, localX);
  const seed = spec.seed * 0.17;
  const ridge =
    fbm2(localX * 0.045 + seed, localZ * 0.045 - seed, 3) * 0.22 +
    Math.cos(ang * 2.0 + seed) * 0.05 * fbm2(localX * 0.02, localZ * 0.02, 2);
  const seabed = sampleSeabedY(spec.cx + localX, spec.cz + localZ);
  const rim = ISLAND_MESH_RADIUS_FACTOR;

  let h: number;
  if (r >= rim) {
    h = seabed;
  } else if (r > 1.04) {
    const t = fade((rim - r) / (rim - 1.04));
    const beachFoot = 0.1 + ridge * 0.1;
    h = seabed + (beachFoot - seabed) * t;
  } else if (r > 0.7) {
    const t = fade((1.04 - r) / 0.34);
    const beachOuter = 0.15 + ridge * 0.12;
    const beachInner = 1.45 + ridge * 0.35;
    h = beachOuter + (beachInner - beachOuter) * t;
  } else if (r > 0.36) {
    const t = fade((0.7 - r) / 0.34);
    const foot = 1.45 + ridge * 0.35;
    const shoulder = 2.1 + ridge * 1.4 + spec.peak * 0.22 * t;
    h = foot + (shoulder - foot) * t * t;
  } else {
    const t = 1 - r / 0.36;
    const shoulder = 2.1 + ridge * 1.4 + spec.peak * 0.06;
    // Rounded massing — avoid spike / crater silhouettes
    const peak = spec.peak * 0.28 + Math.pow(t, 1.6) * spec.peak * 0.55 + ridge * 1.1;
    h = shoulder + (peak - shoulder) * fade(t);
  }
  return h;
}

export function islandBiome(height: number): TerrainBiome {
  if (height < -1.2) return 'deep';
  if (height < 0.25) return 'shelf';
  if (height < 2.0) return 'beach';
  if (height < 11.5) return 'grass';
  return 'rock';
}

/** Smooth biome mix weights for vertex colors (shelf/beach/grass/rock). */
export function biomeColorWeights(height: number): {
  shelf: number;
  beach: number;
  grass: number;
  rock: number;
} {
  const shelf = 1 - fade(Math.min(1, Math.max(0, (height + 1.5) / 1.8)));
  const beach = fade(Math.min(1, Math.max(0, (height - 0.05) / 1.6))) *
    (1 - fade(Math.min(1, Math.max(0, (height - 1.6) / 1.4))));
  const grass = fade(Math.min(1, Math.max(0, (height - 1.7) / 1.5))) *
    (1 - fade(Math.min(1, Math.max(0, (height - 9.5) / 3.5))));
  const rock = fade(Math.min(1, Math.max(0, (height - 10) / 4)));
  const sum = Math.max(1e-5, shelf + beach + grass + rock);
  return {
    shelf: shelf / sum,
    beach: beach / sum,
    grass: grass / sum,
    rock: rock / sum,
  };
}

export type FoliageKind = 'palm' | 'shrub' | 'canopy';

export type FoliagePlacement = {
  kind: FoliageKind;
  x: number;
  z: number;
  y: number;
  rot: number;
  scale: number;
};

/** Deterministic palm on grass band. */
export function palmCandidate(
  localX: number,
  localZ: number,
  spec: IslandSpec,
): FoliagePlacement | null {
  const h = sampleIslandHeight(localX, localZ, spec);
  if (islandBiome(h) !== 'grass') return null;
  if (h > 10.2) return null;
  const n = hash2(Math.floor(localX * 4 + spec.seed), Math.floor(localZ * 4 - spec.seed));
  if (n < 0.48) return null;
  return {
    kind: 'palm',
    x: localX,
    z: localZ,
    y: h,
    rot: n * Math.PI * 2,
    scale: 0.7 + hash2(localX + 2, localZ - 1) * 0.65,
  };
}

/** Low shrub / canopy cluster on grass or upper beach. */
export function shrubCandidate(
  localX: number,
  localZ: number,
  spec: IslandSpec,
): FoliagePlacement | null {
  const h = sampleIslandHeight(localX, localZ, spec);
  const biome = islandBiome(h);
  if (biome !== 'grass' && biome !== 'beach') return null;
  if (h < 1.35 || h > 9.5) return null;
  const n = hash2(Math.floor(localX * 5 - spec.seed), Math.floor(localZ * 5 + spec.seed));
  if (biome === 'beach' && n < 0.82) return null;
  if (biome === 'grass' && n < 0.35) return null;
  const canopy = n > 0.78 && biome === 'grass';
  return {
    kind: canopy ? 'canopy' : 'shrub',
    x: localX,
    z: localZ,
    y: h,
    rot: n * Math.PI * 2,
    scale: canopy
      ? 1.1 + hash2(localX, localZ + 3) * 0.7
      : 0.55 + hash2(localX - 1, localZ) * 0.55,
  };
}

/** Grid of palm placements for an island (authoritative / testable). */
export function generatePalmPlacements(spec: IslandSpec, step = 3.2): FoliagePlacement[] {
  const out: FoliagePlacement[] = [];
  const lim = spec.radius * 0.92;
  for (let x = -lim; x <= lim; x += step) {
    for (let z = -lim; z <= lim; z += step) {
      const jitterX = (hash2(x + spec.seed, z) - 0.5) * step * 0.7;
      const jitterZ = (hash2(z, x - spec.seed) - 0.5) * step * 0.7;
      const c = palmCandidate(x + jitterX, z + jitterZ, spec);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Denser shrub/canopy fill between palms. */
export function generateShrubPlacements(spec: IslandSpec, step = 2.4): FoliagePlacement[] {
  const out: FoliagePlacement[] = [];
  const lim = spec.radius * 0.95;
  for (let x = -lim; x <= lim; x += step) {
    for (let z = -lim; z <= lim; z += step) {
      const jitterX = (hash2(x - spec.seed * 2, z) - 0.5) * step * 0.75;
      const jitterZ = (hash2(z + 9, x + spec.seed) - 0.5) * step * 0.75;
      const c = shrubCandidate(x + jitterX, z + jitterZ, spec);
      if (c) out.push(c);
    }
  }
  return out;
}
