import * as THREE from 'three';

type EffectKind = 'wake' | 'explosion' | 'plume' | 'pickup';

type Particle = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  kind: EffectKind;
  born: number;
  ttl: number;
};

const COLORS: Record<EffectKind, number> = {
  wake: 0xe8fbff,
  explosion: 0xffa33b,
  plume: 0x9dd9df,
  pickup: 0x9ce9c0,
};

/**
 * Fixed-size visual-only pool; effects are never written back to game state.
 * Meshes, geometries and materials are recycled: torpedo wakes emit every
 * frame, so allocating per emit used to churn GPU buffers continuously.
 */
export class VfxPool {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly free: Particle[] = [];
  private readonly smallGeometry = new THREE.SphereGeometry(0.2, 8, 6);
  private readonly largeGeometry = new THREE.SphereGeometry(0.55, 8, 6);
  private cap: number;

  constructor(cap = 120) {
    this.cap = cap;
    this.group.name = 'vfx-pool';
  }

  emit(kind: EffectKind, position: THREE.Vector3, now: number): void {
    if (this.particles.length >= this.cap) this.release(this.particles[0]!);
    const particle = this.free.pop() ?? this.create();
    const mesh = particle.mesh;
    mesh.geometry = kind === 'wake' ? this.smallGeometry : this.largeGeometry;
    mesh.material.color.setHex(COLORS[kind]);
    mesh.material.opacity = kind === 'wake' ? 0.36 : 0.82;
    // Explosions are hot: push them past 1.0 so the bloom pass flares them.
    mesh.material.color.multiplyScalar(kind === 'explosion' ? 3 : 1);
    mesh.position.copy(position);
    mesh.scale.setScalar(1);
    mesh.visible = true;
    particle.kind = kind;
    particle.born = now;
    particle.ttl = kind === 'wake' ? 1.2 : kind === 'pickup' ? 1.8 : 0.9;
    this.particles.push(particle);
  }

  setCap(cap: number): void {
    this.cap = cap;
    while (this.particles.length > cap) this.release(this.particles[0]!);
  }

  update(now: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]!;
      const life = (now - particle.born) / particle.ttl;
      if (life >= 1 || life < 0) {
        this.release(particle);
        continue;
      }
      particle.mesh.scale.setScalar(1 + life * (particle.kind === 'plume' ? 5 : 3));
      particle.mesh.position.y += particle.kind === 'plume' ? 0.018 : 0.004;
      particle.mesh.material.opacity = (1 - life) * 0.7;
    }
  }

  get activeCount(): number {
    return this.particles.length;
  }

  dispose(): void {
    for (const particle of [...this.particles]) this.release(particle);
    for (const particle of this.free) {
      this.group.remove(particle.mesh);
      particle.mesh.material.dispose();
    }
    this.free.length = 0;
    this.smallGeometry.dispose();
    this.largeGeometry.dispose();
  }

  private create(): Particle {
    const mesh = new THREE.Mesh(
      this.smallGeometry,
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    this.group.add(mesh);
    return { mesh, kind: 'wake', born: 0, ttl: 1 };
  }

  private release(particle: Particle): void {
    const index = this.particles.indexOf(particle);
    if (index >= 0) this.particles.splice(index, 1);
    particle.mesh.visible = false;
    this.free.push(particle);
  }
}
