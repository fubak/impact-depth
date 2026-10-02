import * as THREE from 'three';
import { burstParticles, type FxBurst } from './presentation/combat-fx';
import {
  ATLAS,
  ParticleSystem,
  type ParticleSpawn,
  type Rgba,
} from './fx/particle-system';

export type EffectKind =
  | 'wake'
  | 'explosion'
  | 'plume'
  | 'pickup'
  | 'flash'
  | 'fireball'
  | 'smoke'
  | 'debris'
  | 'shockwave'
  | 'spray'
  | 'bubbles'
  | 'spark'
  | 'silt'
  | 'steam'
  | 'ember';

type KindStyle = {
  frame: number;
  additive: boolean;
  ttl: number;
  growth: number;
  gravity: number;
  drag: number;
  buoyancy: number;
  /** Terminal rise speed while underwater (bubbles). */
  terminal: number;
  wobble: number;
  color0: Rgba;
  color1: Rgba;
  alpha: number;
  /** Eviction priority: lower is evicted first. */
  priority: number;
  surfaceDeath?: 'bubble' | 'splash';
};

const LEGACY = {
  additive: true,
  gravity: 0,
  drag: 0,
  buoyancy: 0,
  terminal: 0,
  wobble: 0,
  alpha: 0.82,
  priority: 3,
};

const STYLE: Record<EffectKind, KindStyle> = {
  wake: {
    ...LEGACY,
    frame: ATLAS.foam,
    color0: [0.91, 0.98, 1, 0.4],
    color1: [0.91, 0.98, 1, 0],
    ttl: 1.2,
    growth: 3,
    priority: 0,
  },
  explosion: {
    ...LEGACY,
    frame: ATLAS.fireA,
    color0: [1, 0.7, 0.28, 0.9],
    color1: [0.4, 0.2, 0.1, 0],
    ttl: 0.9,
    growth: 3,
  },
  plume: {
    ...LEGACY,
    frame: ATLAS.droplet,
    color0: [0.62, 0.85, 0.87, 0.7],
    color1: [0.62, 0.85, 0.87, 0],
    ttl: 0.9,
    growth: 5,
  },
  pickup: {
    ...LEGACY,
    frame: ATLAS.soft,
    color0: [0.61, 0.91, 0.75, 0.8],
    color1: [0.61, 0.91, 0.75, 0],
    ttl: 1.8,
    growth: 3,
  },
  flash: {
    ...LEGACY,
    frame: ATLAS.soft,
    color0: [1, 0.96, 0.82, 1],
    color1: [1, 0.7, 0.3, 0],
    ttl: 0.25,
    growth: 0.6,
    alpha: 1,
  },
  fireball: {
    ...LEGACY,
    frame: ATLAS.fireB,
    color0: [1, 0.85, 0.5, 0.95],
    color1: [0.35, 0.12, 0.06, 0],
    ttl: 0.9,
    growth: 0.5,
  },
  smoke: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.smokeA,
    color0: [0.29, 0.31, 0.32, 0.8],
    color1: [0.18, 0.19, 0.2, 0],
    ttl: 3.2,
    growth: 1.5,
    priority: 2,
  },
  debris: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.debris,
    color0: [0.17, 0.17, 0.17, 0.95],
    color1: [0.17, 0.17, 0.17, 0.6],
    ttl: 1.6,
    growth: 0,
    gravity: -9,
  },
  shockwave: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.ring,
    color0: [0.81, 0.91, 0.94, 0.7],
    color1: [0.81, 0.91, 0.94, 0],
    ttl: 0.7,
    growth: 5,
  },
  spray: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.droplet,
    color0: [0.89, 0.96, 1, 0.75],
    color1: [0.89, 0.96, 1, 0],
    ttl: 1.5,
    growth: 0.6,
    gravity: -9.8,
    surfaceDeath: 'splash',
  },
  bubbles: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.bubble,
    color0: [0.75, 0.9, 0.94, 0.7],
    color1: [0.75, 0.9, 0.94, 0.4],
    ttl: 2.5,
    growth: 0.3,
    terminal: 4,
    wobble: 0.6,
    priority: 1,
    surfaceDeath: 'bubble',
  },
  spark: {
    ...LEGACY,
    frame: ATLAS.spark,
    color0: [1, 0.92, 0.6, 1],
    color1: [1, 0.4, 0.1, 0],
    ttl: 0.7,
    growth: 0,
    gravity: -9.8,
  },
  silt: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.silt,
    color0: [0.5, 0.42, 0.3, 0.7],
    color1: [0.5, 0.42, 0.3, 0],
    ttl: 5,
    growth: 1,
    priority: 1,
  },
  steam: {
    ...LEGACY,
    additive: false,
    frame: ATLAS.smokeB,
    color0: [0.85, 0.9, 0.92, 0.6],
    color1: [0.85, 0.9, 0.92, 0],
    ttl: 2.6,
    growth: 1.8,
    priority: 2,
  },
  ember: {
    ...LEGACY,
    frame: ATLAS.glow,
    color0: [1, 0.6, 0.2, 0.9],
    color1: [0.5, 0.1, 0.02, 0],
    ttl: 1.4,
    growth: 0,
    gravity: -2,
  },
};

/** Constant upward drift of the original kinds, in metres per second. */
const LEGACY_RISE: Record<EffectKind, number> = {
  wake: 0.24,
  explosion: 0.24,
  plume: 1.08,
  pickup: 0.24,
  flash: 0,
  fireball: 0,
  smoke: 0,
  debris: 0,
  shockwave: 0,
  spray: 0,
  bubbles: 0,
  spark: 0,
  silt: 0,
  steam: 0,
  ember: 0,
};

const WAKE_MIN_INTERVAL = 1 / 30;

/** Visual-only pool over the instanced particle system; never feeds game state. */
export class VfxPool {
  readonly group = new THREE.Group();
  private readonly system: ParticleSystem;
  private readonly lastEmit = new Map<string, number>();
  private frameCursor = 0;
  private waterY = 0;

  constructor(cap = 120) {
    this.group.name = 'vfx-pool';
    this.system = new ParticleSystem(cap);
    this.group.add(this.system.group);
  }

  /** The water line used for bubble death, spray re-entry and underwater tint. */
  setWaterHeight(y: number): void {
    this.waterY = y;
  }

  /** Optional `key` throttles wake emission per source to ~30 Hz. */
  emit(kind: EffectKind, position: THREE.Vector3, now: number, key?: string): void {
    if (key !== undefined && kind === 'wake') {
      const last = this.lastEmit.get(key);
      if (last !== undefined && now >= last && now - last < WAKE_MIN_INTERVAL) return;
      this.lastEmit.set(key, now);
    }
    this.system.emit(
      this.toSpawn(kind, position.x, position.y, position.z, kind === 'wake' ? 0.4 : 1.1, {}),
      now,
    );
  }

  /** Direct spec emission for persistent emitters (ship fires, sinking foam). */
  emitSpec(spec: ParticleSpawn, now: number): void {
    this.system.emit(spec, now);
  }

  /** Spawn a preset combat burst (world metres). Jitter is seeded, never Math.random. */
  emitBurst(spec: FxBurst, now: number): void {
    for (const p of burstParticles(spec)) {
      this.system.emit(
        this.toSpawn(p.kind, spec.x + p.dx, spec.y + p.dy, spec.z + p.dz, p.scale, p),
        now,
      );
    }
  }

  private toSpawn(
    kind: EffectKind,
    x: number,
    y: number,
    z: number,
    baseScale: number,
    extra: {
      vx?: number;
      vy?: number;
      vz?: number;
      ttl?: number;
      delay?: number;
      gravity?: number;
      drag?: number;
      buoyancy?: number;
      terminal?: number;
      wobble?: number;
      sizeEnd?: number;
      rot?: number;
      rotSpeed?: number;
      stretch?: number;
      frame?: number;
      color0?: Rgba;
      colorMid?: Rgba;
      color1?: Rgba;
      additive?: boolean;
      priority?: number;
      surfaceDeath?: 'bubble' | 'splash';
      trailInterval?: number;
    },
  ): ParticleSpawn {
    const style = STYLE[kind];
    const rise = LEGACY_RISE[kind];
    const spawn: ParticleSpawn = {
      kind,
      x,
      y,
      z,
      vx: extra.vx ?? 0,
      vy: (extra.vy ?? 0) + rise,
      vz: extra.vz ?? 0,
      gravity: extra.gravity ?? style.gravity,
      drag: extra.drag ?? style.drag,
      buoyancy: extra.buoyancy ?? style.buoyancy,
      terminal: extra.terminal ?? style.terminal,
      wobble: extra.wobble ?? style.wobble,
      size0: baseScale,
      size1: extra.sizeEnd ?? baseScale * (1 + style.growth),
      rot: extra.rot ?? 0,
      rotSpeed: extra.rotSpeed ?? 0,
      color0: extra.color0 ?? [
        style.color0[0],
        style.color0[1],
        style.color0[2],
        style.color0[3] * style.alpha,
      ],
      colorMid: extra.colorMid,
      color1: extra.color1 ?? style.color1,
      ttl: extra.ttl ?? style.ttl,
      delay: extra.delay ?? 0,
      frame: extra.frame ?? this.pickFrame(style.frame),
      additive: extra.additive ?? style.additive,
      priority: extra.priority ?? style.priority,
      stretch: extra.stretch ?? 0,
      surfaceDeath: extra.surfaceDeath ?? style.surfaceDeath,
      trailInterval: extra.trailInterval ?? 0,
    };
    return spawn;
  }

  /** Smoke/fire atlas variants rotate deterministically instead of Math.random. */
  private pickFrame(base: number): number {
    if (base === ATLAS.smokeA || base === ATLAS.smokeB || base === ATLAS.smokeC) {
      this.frameCursor = (this.frameCursor + 1) % 3;
      return ATLAS.smokeA + this.frameCursor;
    }
    if (base === ATLAS.fireA || base === ATLAS.fireB || base === ATLAS.fireC) {
      this.frameCursor = (this.frameCursor + 1) % 3;
      return ATLAS.fireA + this.frameCursor;
    }
    return base;
  }

  getDiagnostics(): { alive: number; cap: number; byKind: Record<EffectKind, number> } {
    const diag = this.system.getDiagnostics();
    const byKind = Object.fromEntries(
      Object.keys(STYLE).map((kind) => [kind, 0]),
    ) as Record<EffectKind, number>;
    for (const [kind, count] of Object.entries(diag.byKind)) {
      if (kind in byKind) byKind[kind as EffectKind] = count;
    }
    return { alive: diag.alive, cap: diag.cap, byKind };
  }

  getPeak(): number {
    return this.system.getDiagnostics().peak;
  }

  setCap(cap: number): void {
    this.system.setCap(cap);
  }

  update(now: number): void {
    const events = this.system.update(now, this.waterY);
    for (const event of events) this.emitSideEvent(event, now);
    for (const [key, t] of this.lastEmit) {
      if (now - t > 2 || t > now) this.lastEmit.delete(key);
    }
  }

  /** Surface puffs, re-entry splashes and debris smoke trails re-enter as particles. */
  private emitSideEvent(
    event: { preset: 'surfacePuff' | 'splash' | 'trail'; x: number; y: number; z: number; size: number },
    now: number,
  ): void {
    if (event.preset === 'surfacePuff') {
      this.system.emit(
        {
          kind: 'spray',
          x: event.x,
          y: event.y + 0.15,
          z: event.z,
          vy: 0.8,
          size0: Math.min(2.2, event.size * 0.9 + 0.4),
          size1: 3,
          ttl: 0.7,
          frame: ATLAS.foam,
          additive: false,
          priority: 1,
          color0: [0.92, 0.98, 1, 0.55],
          color1: [0.92, 0.98, 1, 0],
        },
        now,
      );
      return;
    }
    if (event.preset === 'splash') {
      this.system.emit(
        {
          kind: 'spray',
          x: event.x,
          y: event.y + 0.2,
          z: event.z,
          vy: 2.4,
          gravity: -9.8,
          size0: Math.min(2.6, event.size * 0.8 + 0.6),
          size1: 4.5,
          ttl: 0.8,
          frame: ATLAS.droplet,
          additive: false,
          priority: 1,
          color0: [0.9, 0.96, 1, 0.7],
          color1: [0.9, 0.96, 1, 0],
        },
        now,
      );
      return;
    }
    this.system.emit(
      {
        kind: 'smoke',
        x: event.x,
        y: event.y,
        z: event.z,
        vy: 1.2,
        size0: event.size * 0.8,
        size1: event.size * 2.4,
        ttl: 1.1,
        frame: ATLAS.smokeB,
        additive: false,
        priority: 2,
        color0: [0.22, 0.23, 0.24, 0.5],
        color1: [0.22, 0.23, 0.24, 0],
      },
      now,
    );
  }

  /** Test/debug view of live particles (world metres). */
  debugParticles(): Array<{
    kind: string;
    x: number;
    y: number;
    z: number;
    size: number;
    additive: boolean;
  }> {
    return this.system.snapshot().map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      z: p.z,
      size: p.size,
      additive: p.additive,
    }));
  }

  dispose(): void {
    this.system.dispose();
    this.lastEmit.clear();
  }
}
