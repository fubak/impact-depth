import type { EffectKind } from '../vfx';

export type FxPreset =
  'torpedoHit' | 'sink' | 'chargeBlast' | 'launch' | 'playerHit' | 'subBurst' | 'surfaceBreak';

/** One burst request in world metres. `intensity` scales sizes (1 = reference hull). */
export type FxBurst = {
  preset: FxPreset;
  x: number;
  y: number;
  z: number;
  intensity: number;
};

/** One particle of a burst: offset from the burst origin, size and velocity, all in metres. */
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

function ring(
  rand: Rand,
  kind: EffectKind,
  count: number,
  radius: number,
  size: readonly [number, number],
  rise: readonly [number, number],
): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i++) {
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

function sprayColumn(rand: Rand, count: number, height: number): FxParticleSpec[] {
  const out: FxParticleSpec[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count;
    out.push({
      kind: 'spray',
      dx: between(rand, -2, 2),
      dy: t * height,
      dz: between(rand, -2, 2),
      scale: between(rand, 4, 8),
      vx: between(rand, -2, 2),
      vy: between(rand, 4, 9),
      vz: between(rand, -2, 2),
    });
  }
  return out;
}

const hit = (rand: Rand, k: number): FxParticleSpec[] => [
  { kind: 'flash', dx: 0, dy: 0, dz: 0, scale: 18 * k, vx: 0, vy: 0, vz: 0 },
  { kind: 'fireball', dx: 0, dy: 0, dz: 0, scale: between(rand, 10, 16) * k, vx: 0, vy: 2, vz: 0 },
  ...ring(rand, 'fireball', 3, 4 * k, [10 * k, 14 * k], [1, 4]),
  ...ring(rand, 'smoke', 4, 6 * k, [8 * k, 14 * k], [2, 5]),
  ...ring(rand, 'debris', 4, 5 * k, [1 * k, 2.5 * k], [6, 14]),
  { kind: 'shockwave', dx: 0, dy: 0, dz: 0, scale: 6 * k, vx: 0, vy: 0, vz: 0 },
  ...sprayColumn(rand, 5, 22 * k),
];

const PRESETS: Record<FxPreset, (rand: Rand, k: number) => FxParticleSpec[]> = {
  torpedoHit: hit,
  sink: (rand, k) => [
    ...hit(rand, k),
    ...ring(rand, 'smoke', 6, 10 * k, [12 * k, 20 * k], [1, 3]),
    ...ring(rand, 'bubbles', 8, 8 * k, [1 * k, 2.5 * k], [3, 6]),
  ],
  chargeBlast: (rand, k) => [
    { kind: 'shockwave', dx: 0, dy: 0, dz: 0, scale: 12 * k, vx: 0, vy: 0, vz: 0 },
    { kind: 'flash', dx: 0, dy: 0, dz: 0, scale: 10 * k, vx: 0, vy: 0, vz: 0 },
    ...ring(rand, 'bubbles', 10, 8 * k, [1 * k, 3 * k], [2, 6]),
    ...sprayColumn(rand, 4, 20 * k),
  ],
  launch: (rand, k) => [
    { kind: 'flash', dx: 0, dy: 0, dz: 0, scale: 4 * k, vx: 0, vy: 0, vz: 0 },
    ...ring(rand, 'bubbles', 6, 3 * k, [0.6 * k, 1.5 * k], [1, 3]),
    ...ring(rand, 'spray', 2, 2 * k, [2 * k, 4 * k], [2, 5]),
  ],
  playerHit: (rand, k) => [
    { kind: 'flash', dx: 0, dy: 0, dz: 0, scale: 8 * k, vx: 0, vy: 0, vz: 0 },
    ...ring(rand, 'smoke', 3, 3 * k, [3 * k, 6 * k], [1, 3]),
    ...ring(rand, 'debris', 4, 3 * k, [0.5 * k, 1.2 * k], [3, 8]),
  ],
  /** Underwater kill: bubbles and a shock, not a surface fireball. */
  subBurst: (rand, k) => [
    { kind: 'flash', dx: 0, dy: 0, dz: 0, scale: 14 * k, vx: 0, vy: 1, vz: 0 },
    { kind: 'shockwave', dx: 0, dy: 0, dz: 0, scale: 16 * k, vx: 0, vy: 0, vz: 0 },
    ...ring(rand, 'bubbles', 16, 10 * k, [1.2 * k, 3.4 * k], [4, 9]),
    ...ring(rand, 'debris', 6, 6 * k, [0.8 * k, 2 * k], [3, 8]),
  ],
  /** Water column when a hull breaks the surface on the way down. */
  surfaceBreak: (rand, k) => [
    { kind: 'shockwave', dx: 0, dy: 0.2, dz: 0, scale: 18 * k, vx: 0, vy: 0, vz: 0 },
    ...sprayColumn(rand, 8, 26 * k),
    ...ring(rand, 'spray', 6, 8 * k, [3 * k, 7 * k], [4, 10]),
    ...ring(rand, 'smoke', 4, 7 * k, [6 * k, 12 * k], [1, 3]),
  ],
};

/** Map a burst preset to a deterministic particle list. Pure; imports no game types. */
export function burstParticles(burst: FxBurst): FxParticleSpec[] {
  const k = Math.max(0.1, burst.intensity);
  return PRESETS[burst.preset](createLcg(seedFor(burst)), k);
}
