import type { EffectKind } from '../vfx';
import { ATLAS, type Rgba } from '../fx/particle-system';

export type FxPreset =
  | 'torpedoHit'
  | 'sink'
  | 'chargeBlast'
  | 'launch'
  | 'playerHit'
  | 'subBurst'
  | 'surfaceBreak'
  | 'shellSplash'
  | 'gunMuzzle'
  | 'subSink';

/** One burst request in world metres. `intensity` scales sizes (1 = reference hull). */
export type FxBurst = {
  preset: FxPreset;
  x: number;
  y: number;
  z: number;
  intensity: number;
  /** Seabed Y (world metres) under the burst — silt shows only near the bed. */
  bedY?: number;
};

/**
 * One particle of a burst: offset from the burst origin, size and velocity in
 * metres and m/s. Optional fields map straight onto the instanced system.
 */
export type FxParticleSpec = {
  kind: EffectKind;
  dx: number;
  dy: number;
  dz: number;
  scale: number;
  vx: number;
  vy: number;
  vz: number;
  ttl?: number;
  /** Delayed spawn — used by secondary bursts that follow the main flash. */
  delay?: number;
  gravity?: number;
  drag?: number;
  buoyancy?: number;
  terminal?: number;
  wobble?: number;
  sizeEnd?: number;
  rotSpeed?: number;
  stretch?: number;
  frame?: number;
  color0?: Rgba;
  colorMid?: Rgba;
  color1?: Rgba;
  additive?: boolean;
  surfaceDeath?: 'bubble' | 'splash';
  /** Debris leaves a short smoke trail; emitted as a `trail` side event. */
  trailInterval?: number;
};

/** Seeded LCG (Numerical Recipes constants) so bursts are reproducible and never use Math.random. */
export function createLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedFor(burst: FxBurst): number {
  const h =
    (Math.round(burst.x * 31) * 73856093) ^
    (Math.round(burst.y * 31) * 19349663) ^
    (Math.round(burst.z * 31) * 83492791) ^
    (burst.preset.length * 2654435761);
  return h >>> 0;
}

type Rand = () => number;

const between = (rand: Rand, lo: number, hi: number): number => lo + (hi - lo) * rand();
const pick = <T>(rand: Rand, items: readonly T[]): T =>
  items[Math.min(items.length - 1, Math.floor(rand() * items.length))]!;

const GRAVITY = -9.8;

/** Fire colour ramp: white → yellow-orange → dark red → transparent smoke. */
const FIRE_0: Rgba = [1, 0.99, 0.92, 1];
const FIRE_MID: Rgba = [1, 0.62, 0.18, 0.9];
const FIRE_1: Rgba = [0.16, 0.09, 0.07, 0];
const SMOKE_0: Rgba = [0.13, 0.13, 0.14, 0.85];
const SMOKE_1: Rgba = [0.32, 0.33, 0.34, 0];
const WATER_0: Rgba = [0.96, 0.99, 1, 0.9];
const WATER_1: Rgba = [0.8, 0.9, 0.96, 0];

function fireball(rand: Rand, k: number, count: number, delay = 0): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const r = between(rand, 0, 4) * k;
    out.push({
      kind: 'fireball',
      dx: Math.cos(a) * r,
      dy: between(rand, 0.5, 3.5) * k,
      dz: Math.sin(a) * r,
      scale: between(rand, 8, 13) * k,
      sizeEnd: between(rand, 15, 22) * k,
      vx: Math.cos(a) * between(rand, 0.5, 2.5),
      vy: between(rand, 3, 8),
      vz: Math.sin(a) * between(rand, 0.5, 2.5),
      ttl: between(rand, 1.4, 2.4),
      delay,
      drag: 0.6,
      rotSpeed: between(rand, -1.2, 1.2),
      frame: pick(rand, [ATLAS.fireA, ATLAS.fireB, ATLAS.fireC]),
      color0: FIRE_0,
      colorMid: FIRE_MID,
      color1: FIRE_1,
      additive: true,
    });
  }
  return out;
}

/** Rising, spreading black-grey column. 8–12 s life so the kill lingers. */
function smokeColumn(rand: Rand, k: number, count: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const r = between(rand, 0.5, 5) * k;
    out.push({
      kind: 'smoke',
      dx: Math.cos(a) * r,
      dy: between(rand, 1, 8) * k,
      dz: Math.sin(a) * r,
      scale: between(rand, 5, 9) * k,
      sizeEnd: between(rand, 18, 30) * k,
      vx: Math.cos(a) * between(rand, 0.4, 1.6),
      vy: between(rand, 3.5, 7),
      vz: Math.sin(a) * between(rand, 0.4, 1.6),
      ttl: between(rand, 8, 12),
      drag: 0.15,
      buoyancy: 0,
      rotSpeed: between(rand, -0.4, 0.4),
      frame: pick(rand, [ATLAS.smokeA, ATLAS.smokeB, ATLAS.smokeC]),
      color0: SMOKE_0,
      colorMid: [0.22, 0.22, 0.23, 0.55],
      color1: SMOKE_1,
      additive: false,
    });
  }
  return out;
}

/**
 * Water column: spray thrown up at 29–36 m/s under gravity reaches a 43–66 m
 * apex and falls back into the sea, splashing on re-entry.
 */
function waterColumn(
  rand: Rand,
  k: number,
  count: number,
  halfWidth: number,
  vyLo: number,
  vyHi: number,
): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      kind: 'spray',
      dx: between(rand, -halfWidth, halfWidth) * k,
      dy: between(rand, 0, 2),
      dz: between(rand, -halfWidth, halfWidth) * k,
      scale: between(rand, 4.5, 8.5) * k,
      sizeEnd: between(rand, 9, 15) * k,
      vx: between(rand, -1.6, 1.6),
      vy: between(rand, vyLo, vyHi),
      vz: between(rand, -1.6, 1.6),
      ttl: between(rand, 6, 7.5),
      gravity: GRAVITY,
      drag: 0.04,
      frame: pick(rand, [ATLAS.droplet, ATLAS.foam, ATLAS.dense]),
      color0: WATER_0,
      colorMid: [0.92, 0.97, 1, 0.75],
      color1: WATER_1,
      additive: false,
      surfaceDeath: 'splash',
    });
  }
  return out;
}

/** Ballistic chunks with short smoke trails; they splash when they come down. */
function debrisArc(rand: Rand, k: number, count: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const speed = between(rand, 6, 14);
    out.push({
      kind: 'debris',
      dx: between(rand, -1, 1),
      dy: between(rand, 0.5, 3),
      dz: between(rand, -1, 1),
      scale: between(rand, 0.35, 0.9) * k,
      vx: Math.cos(a) * speed,
      vy: between(rand, 9, 22),
      vz: Math.sin(a) * speed,
      ttl: between(rand, 5, 8),
      gravity: GRAVITY,
      rotSpeed: between(rand, -6, 6),
      frame: ATLAS.debris,
      additive: false,
      surfaceDeath: 'splash',
      trailInterval: 0.09,
    });
  }
  return out;
}

function sparks(rand: Rand, k: number, count: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const speed = between(rand, 8, 22);
    out.push({
      kind: 'spark',
      dx: 0,
      dy: between(rand, 0.5, 3),
      dz: 0,
      scale: between(rand, 0.5, 1.1) * k,
      vx: Math.cos(a) * speed,
      vy: between(rand, 6, 24),
      vz: Math.sin(a) * speed,
      ttl: between(rand, 0.4, 0.9),
      gravity: GRAVITY,
      frame: ATLAS.spark,
      stretch: 0.08,
      color0: [1, 0.95, 0.75, 1],
      color1: [1, 0.35, 0.08, 0],
      additive: true,
    });
  }
  return out;
}

/** Small delayed secondary explosions 0.3–1.5 s behind the main blast. */
function secondaryBursts(rand: Rand, k: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  const count = 2 + Math.floor(rand() * 2);
  for (let b = 0; b < count; b += 1) {
    const delay = between(rand, 0.3, 1.5);
    const ox = between(rand, -5, 5) * k;
    const oz = between(rand, -5, 5) * k;
    const oy = between(rand, 0, 3) * k;
    out.push({
      kind: 'flash',
      dx: ox,
      dy: oy,
      dz: oz,
      scale: between(rand, 6, 10) * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 0.25,
      delay,
      frame: ATLAS.soft,
      color0: FIRE_0,
      color1: [1, 0.55, 0.15, 0],
      additive: true,
    });
    for (let i = 0; i < 3; i += 1) {
      const a = between(rand, 0, Math.PI * 2);
      out.push({
        kind: 'fireball',
        dx: ox + Math.cos(a) * 1.5,
        dy: oy + between(rand, 0, 1.5),
        dz: oz + Math.sin(a) * 1.5,
        scale: between(rand, 3.5, 6) * k,
        sizeEnd: between(rand, 7, 11) * k,
        vx: Math.cos(a) * between(rand, 0.5, 2),
        vy: between(rand, 2, 6),
        vz: Math.sin(a) * between(rand, 0.5, 2),
        ttl: between(rand, 0.7, 1.2),
        delay,
        drag: 0.5,
        frame: pick(rand, [ATLAS.fireA, ATLAS.fireB, ATLAS.fireC]),
        color0: FIRE_0,
        colorMid: FIRE_MID,
        color1: FIRE_1,
        additive: true,
      });
    }
  }
  return out;
}

function bubbleCloud(rand: Rand, k: number, count: number, radius: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const r = Math.sqrt(rand()) * radius;
    out.push({
      kind: 'bubbles',
      dx: Math.cos(a) * r,
      dy: between(rand, -radius * 0.5, radius * 0.5),
      dz: Math.sin(a) * r,
      scale: between(rand, 0.5, 2.2) * k,
      sizeEnd: between(rand, 0.9, 3.4) * k,
      vx: Math.cos(a) * between(rand, 0.2, 1.4),
      vy: between(rand, 0.5, 2.5),
      vz: Math.sin(a) * between(rand, 0.2, 1.4),
      ttl: between(rand, 6, 14),
      terminal: between(rand, 4, 8),
      wobble: between(rand, 0.4, 1.1),
      frame: ATLAS.bubble,
      color0: [0.8, 0.93, 0.97, 0.75],
      color1: [0.85, 0.95, 1, 0.5],
      additive: false,
      surfaceDeath: 'bubble',
    });
  }
  return out;
}

function ring(
  rand: Rand,
  kind: EffectKind,
  count: number,
  radius: number,
  size: readonly [number, number],
  rise: readonly [number, number],
): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const r = between(rand, 0.2, 1) * radius;
    out.push({
      kind,
      dx: Math.cos(a) * r,
      dy: between(rand, 0, radius * 0.5),
      dz: Math.sin(a) * r,
      scale: between(rand, size[0], size[1]),
      vx: Math.cos(a) * radius * 0.15,
      vy: between(rand, rise[0], rise[1]),
      vz: Math.sin(a) * radius * 0.15,
    });
  }
  return out;
}

/** Glowing fragments: a few hot points among the dark debris. */
function embers(rand: Rand, k: number, count: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = between(rand, 0, Math.PI * 2);
    const speed = between(rand, 4, 10);
    out.push({
      kind: 'ember',
      dx: between(rand, -1, 1),
      dy: between(rand, 0.5, 3),
      dz: between(rand, -1, 1),
      scale: between(rand, 0.5, 1.1) * k,
      vx: Math.cos(a) * speed,
      vy: between(rand, 6, 16),
      vz: Math.sin(a) * speed,
      ttl: between(rand, 1.2, 2.2),
      gravity: GRAVITY,
      rotSpeed: between(rand, -4, 4),
      additive: true,
      surfaceDeath: 'splash',
    });
  }
  return out;
}

/** Surface torpedo hit: flash, fireball, water column, debris, secondaries. */
const surfaceHit = (rand: Rand, k: number): FxParticleSpec[] => [
  {
    kind: 'flash',
    dx: 0,
    dy: 2,
    dz: 0,
    scale: 24 * k,
    sizeEnd: 38 * k,
    vx: 0,
    vy: 0,
    vz: 0,
    ttl: 0.28,
    frame: ATLAS.soft,
    color0: FIRE_0,
    color1: [1, 0.6, 0.2, 0],
    additive: true,
  },
  ...fireball(rand, k, 8),
  ...waterColumn(rand, k, 44, 4, 29, 36),
  ...smokeColumn(rand, k, 14),
  ...debrisArc(rand, k, 10 + Math.floor(rand() * 7)),
  ...embers(rand, k, 5),
  ...sparks(rand, k, 14),
  ...secondaryBursts(rand, k),
  {
    kind: 'shockwave',
    dx: 0,
    dy: 0.5,
    dz: 0,
    scale: 4 * k,
    sizeEnd: 24 * k,
    vx: 0,
    vy: 0,
    vz: 0,
    ttl: 0.55,
    frame: ATLAS.ring,
    color0: [0.95, 1, 1, 0.4],
    color1: [0.95, 1, 1, 0],
    additive: false,
  },
];

/** Underwater detonation: flash + dense bubble cloud. Meshes handle the dome. */
const underwaterBlast = (rand: Rand, k: number, bedGap: number | undefined): FxParticleSpec[] => {
  const out: FxParticleSpec[] = [
    {
      kind: 'flash',
      dx: 0,
      dy: 0,
      dz: 0,
      scale: 14 * k,
      sizeEnd: 30 * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 0.3,
      frame: ATLAS.soft,
      color0: [0.75, 0.95, 1, 1],
      color1: [0.3, 0.6, 0.75, 0],
      additive: true,
    },
    {
      kind: 'shockwave',
      dx: 0,
      dy: 0,
      dz: 0,
      scale: 3 * k,
      sizeEnd: 18 * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 0.55,
      frame: ATLAS.ring,
      color0: [0.85, 0.95, 1, 0.35],
      color1: [0.85, 0.95, 1, 0],
      additive: false,
    },
    ...bubbleCloud(rand, k, 70, 7 * k),
  ];
  // Near the seabed the blast kicks up a silt cloud.
  if (bedGap !== undefined && bedGap < 12) {
    for (let i = 0; i < 12; i += 1) {
      const a = between(rand, 0, Math.PI * 2);
      const r = between(rand, 0.5, 6) * k;
      out.push({
        kind: 'silt',
        dx: Math.cos(a) * r,
        dy: between(rand, -1, 2),
        dz: Math.sin(a) * r,
        scale: between(rand, 4, 9) * k,
        sizeEnd: between(rand, 9, 16) * k,
        vx: Math.cos(a) * between(rand, 0.5, 1.5),
        vy: between(rand, 0.3, 1.2),
        vz: Math.sin(a) * between(rand, 0.5, 1.5),
        ttl: between(rand, 5, 9),
        drag: 0.3,
        buoyancy: -0.4,
        frame: ATLAS.silt,
        color0: [0.5, 0.42, 0.3, 0.7],
        color1: [0.45, 0.38, 0.28, 0],
        additive: false,
      });
    }
  }
  return out;
};

const PRESETS: Record<FxPreset, (rand: Rand, k: number, bedGap?: number) => FxParticleSpec[]> = {
  torpedoHit: surfaceHit,
  sink: (rand, k) => [
    // A hull going under: steam, spray ring and the escaping-air boil.
    ...ring(rand, 'steam', 6, 8 * k, [5 * k, 9 * k], [1.5, 3.5]),
    ...ring(rand, 'spray', 10, 7 * k, [2 * k, 4.5 * k], [5, 12]),
    ...bubbleCloud(rand, k, 18, 6 * k),
  ],
  chargeBlast: (rand, k, bedGap) => underwaterBlast(rand, k, bedGap),
  /** Torpedo launch: bow bubble burst; the caller adds a surface boil when shallow. */
  launch: (rand, k) => [
    ...bubbleCloud(rand, k, 10, 1.6 * k),
    {
      kind: 'flash',
      dx: 0,
      dy: 0,
      dz: 0,
      scale: 3.5 * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 0.18,
      frame: ATLAS.soft,
      color0: [0.8, 0.95, 1, 0.9],
      color1: [0.8, 0.95, 1, 0],
      additive: true,
    },
  ],
  playerHit: (rand, k) => [
    {
      kind: 'flash',
      dx: 0,
      dy: 0,
      dz: 0,
      scale: 10 * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 0.3,
      frame: ATLAS.soft,
      color0: [0.7, 0.92, 1, 1],
      color1: [0.3, 0.5, 0.7, 0],
      additive: true,
    },
    ...ring(rand, 'bubbles', 10, 4 * k, [0.8 * k, 2 * k], [2, 5]),
    ...ring(rand, 'silt', 4, 3 * k, [2 * k, 4 * k], [0.4, 1.2]),
  ],
  /** Underwater kill: bubbles and a shock, not a surface fireball. */
  subBurst: (rand, k, bedGap) => underwaterBlast(rand, k * 1.3, bedGap),
  /** Enemy submarine destroyed: venting bubble mass, debris and drifting oil. */
  subSink: (rand, k, bedGap) => [
    ...underwaterBlast(rand, k * 1.2, bedGap),
    ...bubbleCloud(rand, k, 40, 10 * k),
    ...debrisArc(rand, k, 8),
  ],
  /** Water column when a hull breaks the surface on the way down. */
  surfaceBreak: (rand, k) => [
    {
      kind: 'shockwave',
      dx: 0,
      dy: 0.2,
      dz: 0,
      scale: 6 * k,
      sizeEnd: 40 * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 1,
      frame: ATLAS.ring,
      color0: [0.95, 1, 1, 0.75],
      color1: [0.95, 1, 1, 0],
      additive: false,
    },
    ...waterColumn(rand, k, 14, 3.5, 16, 24),
    ...ring(rand, 'spray', 8, 8 * k, [2.5 * k, 6 * k], [4, 10]),
    ...ring(rand, 'steam', 4, 7 * k, [4 * k, 8 * k], [1, 3]),
  ],
  /** Shell splash: a thin 10–15 m column — small next to a torpedo column. */
  shellSplash: (rand, k) => [
    ...waterColumn(rand, k, 6, 1.6, 14.5, 17),
    ...ring(rand, 'spray', 4, 2 * k, [1 * k, 2 * k], [3, 7]),
    {
      kind: 'shockwave',
      dx: 0,
      dy: 0.2,
      dz: 0,
      scale: 2 * k,
      sizeEnd: 12 * k,
      vx: 0,
      vy: 0,
      vz: 0,
      ttl: 0.6,
      frame: ATLAS.ring,
      color0: [0.95, 1, 1, 0.6],
      color1: [0.95, 1, 1, 0],
      additive: false,
    },
  ],
  /** Muzzle blast + powder smoke at the firing hull's deck. */
  gunMuzzle: (rand, k) => [
    {
      kind: 'flash',
      dx: 0,
      dy: 0,
      dz: 0,
      scale: 7 * k,
      sizeEnd: 12 * k,
      vx: 0,
      vy: 0.5,
      vz: 0,
      ttl: 0.16,
      frame: ATLAS.soft,
      color0: [1, 0.9, 0.6, 1],
      color1: [1, 0.5, 0.15, 0],
      additive: true,
    },
    ...ring(rand, 'spark', 5, 1.5 * k, [0.4 * k, 0.8 * k], [2, 7]),
    ...ring(rand, 'smoke', 4, 1.2 * k, [2.5 * k, 5 * k], [1, 3]),
  ],
};

/** Map a burst preset to a deterministic particle list. Pure; imports no game types. */
export function burstParticles(burst: FxBurst): FxParticleSpec[] {
  const k = Math.max(0.1, burst.intensity);
  const bedGap = burst.bedY === undefined ? undefined : Math.max(0, burst.y - burst.bedY);
  return PRESETS[burst.preset](createLcg(seedFor(burst)), k, bedGap);
}
