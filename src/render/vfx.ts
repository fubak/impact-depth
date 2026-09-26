import * as THREE from 'three';

type EffectKind = 'wake' | 'explosion' | 'plume' | 'pickup';

type Particle = {
  sprite: THREE.Sprite;
  kind: EffectKind;
  born: number;
  ttl: number;
  baseScale: number;
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
    if (this.particles.length >= this.cap) this.evictOne();
    const color =
      kind === 'explosion'
        ? 0xffa33b
        : kind === 'plume'
          ? 0x9dd9df
          : kind === 'pickup'
            ? 0x9ce9c0
            : 0xe8fbff;
    const baseScale = kind === 'wake' ? 0.4 : 1.1;
    const sprite = this.free.pop() ?? this.createSprite();
    const material = sprite.material as THREE.SpriteMaterial;
    material.color.setHex(color);
    material.opacity = kind === 'wake' ? 0.36 : 0.82;
    sprite.position.copy(position);
    sprite.scale.setScalar(baseScale);
    this.group.add(sprite);
    this.particles.push({
      sprite,
      kind,
      born: now,
      ttl: kind === 'wake' ? 1.2 : kind === 'pickup' ? 1.8 : 0.9,
      baseScale,
    });
  }

  getDiagnostics(): { alive: number; cap: number; byKind: Record<EffectKind, number> } {
    const byKind: Record<EffectKind, number> = { wake: 0, explosion: 0, plume: 0, pickup: 0 };
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
      particle.sprite.scale.setScalar(
        particle.baseScale * (1 + life * (particle.kind === 'plume' ? 5 : 3)),
      );
      particle.sprite.position.y += (particle.kind === 'plume' ? 1.08 : 0.24) * dt;
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

  /** Oldest wake first so explosions/plumes survive wake floods; else oldest overall. */
  private evictOne(): void {
    const wake = this.particles.findIndex((p) => p.kind === 'wake');
    this.removeAt(wake >= 0 ? wake : 0);
  }

  private removeAt(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    if (!particle) return;
    this.group.remove(particle.sprite);
    this.free.push(particle.sprite);
  }
}
