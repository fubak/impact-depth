import * as THREE from 'three';

type EffectKind = 'wake' | 'explosion' | 'plume' | 'pickup';

type Particle = {
  mesh: THREE.Mesh;
  kind: EffectKind;
  born: number;
  ttl: number;
};

/** Fixed-size visual-only pool; effects are never written back to game state. */
export class VfxPool {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private cap: number;

  constructor(cap = 120) {
    this.cap = cap;
    this.group.name = 'vfx-pool';
  }

  emit(kind: EffectKind, position: THREE.Vector3, now: number): void {
    if (this.particles.length >= this.cap) this.remove(this.particles[0]!);
    const color = kind === 'explosion' ? 0xffa33b : kind === 'plume' ? 0x9dd9df : kind === 'pickup' ? 0x9ce9c0 : 0xe8fbff;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(kind === 'wake' ? 0.2 : 0.55, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'wake' ? 0.36 : 0.82, depthWrite: false }),
    );
    mesh.position.copy(position);
    this.group.add(mesh);
    this.particles.push({ mesh, kind, born: now, ttl: kind === 'wake' ? 1.2 : kind === 'pickup' ? 1.8 : 0.9 });
  }

  setCap(cap: number): void {
    this.cap = cap;
    while (this.particles.length > cap) this.remove(this.particles[0]!);
  }

  update(now: number): void {
    for (const particle of [...this.particles]) {
      const life = (now - particle.born) / particle.ttl;
      if (life >= 1) {
        this.remove(particle);
        continue;
      }
      particle.mesh.scale.setScalar(1 + life * (particle.kind === 'plume' ? 5 : 3));
      particle.mesh.position.y += particle.kind === 'plume' ? 0.018 : 0.004;
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - life) * 0.7;
    }
  }

  dispose(): void {
    for (const particle of [...this.particles]) this.remove(particle);
  }

  private remove(particle: Particle): void {
    this.group.remove(particle.mesh);
    particle.mesh.geometry.dispose();
    (particle.mesh.material as THREE.Material).dispose();
    this.particles.splice(this.particles.indexOf(particle), 1);
  }
}
