import * as THREE from 'three';
import { burstParticles, type FxBurst } from './presentation/combat-fx';

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
  | 'bubbles';

type Particle = {
  sprite: THREE.Sprite;
  kind: EffectKind;
  born: number;
  ttl: number;
  baseScale: number;
  vx: number;
  vy: number;
  vz: number;
};

type KindStyle = {
  color: number;
  additive: boolean;
  fog: boolean;
  ttl: number;
  growth: number;
  gravity: number;
  /** Eviction priority: lower is evicted first. */
  priority: number;
};

const LEGACY: Omit<KindStyle, 'color' | 'ttl' | 'growth'> = {
  additive: true,
  fog: true,
  gravity: 0,
  priority: 3,
};

const STYLE: Record<EffectKind, KindStyle> = {
  wake: { ...LEGACY, color: 0xe8fbff, ttl: 1.2, growth: 3, priority: 0 },
  explosion: { ...LEGACY, color: 0xffa33b, ttl: 0.9, growth: 3 },
  plume: { ...LEGACY, color: 0x9dd9df, ttl: 0.9, growth: 5 },
  pickup: { ...LEGACY, color: 0x9ce9c0, ttl: 1.8, growth: 3 },
  flash: { ...LEGACY, color: 0xfff4d0, ttl: 0.25, growth: 0.6, fog: false },
  fireball: { ...LEGACY, color: 0xff8a2a, ttl: 0.9, growth: 0.5 },
  smoke: { ...LEGACY, color: 0x4a4f52, ttl: 3.2, growth: 1.5, additive: false, priority: 2 },
  debris: { ...LEGACY, color: 0x2b2b2b, ttl: 1.6, growth: 0, additive: false, gravity: -9 },
  shockwave: { ...LEGACY, color: 0xcfe8f0, ttl: 0.7, growth: 5, additive: false },
  spray: { ...LEGACY, color: 0xe4f6ff, ttl: 1.5, growth: 0.6, additive: false, gravity: -4 },
  bubbles: { ...LEGACY, color: 0xbfe6f0, ttl: 2.5, growth: 0.3, additive: false, priority: 1 },
};

function createRadialTexture(): THREE.Texture {
  const size = 64;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
  // Node/unit tests: soft radial without DOM canvas.
  const data = new Uint8Array(size * size * 4);
  const mid = (size - 1) * 0.5;
  const maxR = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, Math.hypot(x - mid, y - mid) / maxR);
      const a = Math.round((1 - t) ** 2 * 255);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

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
};

const WAKE_MIN_INTERVAL = 1 / 30;
const MAX_STEP = 0.25;

/** Fixed-size visual-only pool; effects are never written back to game state. */
export class VfxPool {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly free: THREE.Sprite[] = [];
  private readonly lastEmit = new Map<string, number>();
  private readonly texture: THREE.Texture;
  private cap: number;
  private lastNow: number | undefined;

  constructor(cap = 120) {
    this.cap = cap;
    this.texture = createRadialTexture();
    this.group.name = 'vfx-pool';
  }

  /** Optional `key` throttles wake emission per source to ~30 Hz. */
  emit(kind: EffectKind, position: THREE.Vector3, now: number, key?: string): void {
    if (key !== undefined && kind === 'wake') {
      const last = this.lastEmit.get(key);
      if (last !== undefined && now >= last && now - last < WAKE_MIN_INTERVAL) return;
      this.lastEmit.set(key, now);
    }
    this.spawn(kind, position.x, position.y, position.z, now, kind === 'wake' ? 0.4 : 1.1, {});
  }

  /** Spawn a preset combat burst (world metres). Jitter is seeded, never Math.random. */
  emitBurst(spec: FxBurst, now: number): void {
    for (const p of burstParticles(spec)) {
      this.spawn(p.kind, spec.x + p.dx, spec.y + p.dy, spec.z + p.dz, now, p.scale, p);
    }
  }

  private spawn(
    kind: EffectKind,
    x: number,
    y: number,
    z: number,
    now: number,
    baseScale: number,
    extra: { vx?: number; vy?: number; vz?: number; ttl?: number },
  ): void {
    if (this.particles.length >= this.cap) this.evictOne();
    const style = STYLE[kind];
    const sprite = this.free.pop() ?? this.createSprite();
    const material = sprite.material as THREE.SpriteMaterial;
    material.color.setHex(style.color);
    material.opacity = kind === 'wake' ? 0.36 : 0.82;
    const blending = style.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (material.blending !== blending) material.blending = blending;
    if (material.fog !== style.fog) {
      material.fog = style.fog;
      material.needsUpdate = true;
    }
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(baseScale);
    this.group.add(sprite);
    this.particles.push({
      sprite,
      kind,
      born: now,
      ttl: extra.ttl ?? style.ttl,
      baseScale,
      vx: extra.vx ?? 0,
      vy: extra.vy ?? 0,
      vz: extra.vz ?? 0,
    });
  }

  getDiagnostics(): { alive: number; cap: number; byKind: Record<EffectKind, number> } {
    const byKind = Object.fromEntries(
      Object.keys(STYLE).map((kind) => [kind, 0]),
    ) as Record<EffectKind, number>;
    for (const particle of this.particles) byKind[particle.kind] += 1;
    return { alive: this.particles.length, cap: this.cap, byKind };
  }

  setCap(cap: number): void {
    this.cap = cap;
    while (this.particles.length > cap) this.evictOne();
  }

  update(now: number): void {
    const dt = this.lastNow === undefined ? 0 : Math.min(MAX_STEP, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]!;
      const life = (now - particle.born) / particle.ttl;
      if (life >= 1) {
        this.removeAt(i);
        continue;
      }
      const style = STYLE[particle.kind];
      particle.sprite.scale.setScalar(particle.baseScale * (1 + life * style.growth));
      particle.vy += style.gravity * dt;
      particle.sprite.position.x += particle.vx * dt;
      particle.sprite.position.z += particle.vz * dt;
      particle.sprite.position.y += (particle.vy + LEGACY_RISE[particle.kind]) * dt;
      (particle.sprite.material as THREE.SpriteMaterial).opacity = (1 - life) * 0.7;
    }
    for (const [key, t] of this.lastEmit) if (now - t > 2 || t > now) this.lastEmit.delete(key);
  }

  dispose(): void {
    while (this.particles.length > 0) this.removeAt(this.particles.length - 1);
    for (const sprite of this.free) (sprite.material as THREE.Material).dispose();
    this.free.length = 0;
    this.texture.dispose();
  }

  private createSprite(): THREE.Sprite {
    return new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  /** Lowest priority first (wake < bubbles < smoke < others), oldest within a priority. */
  private evictOne(): void {
    let victim = 0;
    let best = Infinity;
    this.particles.forEach((p, i) => {
      const priority = STYLE[p.kind].priority;
      if (priority < best) {
        best = priority;
        victim = i;
      }
    });
    this.removeAt(victim);
  }

  private removeAt(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    if (!particle) return;
    this.group.remove(particle.sprite);
    this.free.push(particle.sprite);
  }
}
