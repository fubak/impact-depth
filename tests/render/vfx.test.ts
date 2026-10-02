import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VfxPool } from '../../src/render/vfx';
import { ParticleSystem } from '../../src/render/fx/particle-system';

function instancedMeshes(pool: VfxPool): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  pool.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.InstancedBufferGeometry) {
      meshes.push(obj);
    }
  });
  return meshes;
}

describe('combat VFX pool', () => {
  it('emits explosion, plume, and pickup particles under the cap', () => {
    const pool = new VfxPool(8);
    pool.emit('explosion', new THREE.Vector3(1, 0, 0), 1);
    pool.emit('plume', new THREE.Vector3(0, 1, 0), 1);
    pool.emit('pickup', new THREE.Vector3(0, 0, 1), 1);
    const diag = pool.getDiagnostics();
    expect(diag.alive).toBe(3);
    expect(diag.byKind.explosion).toBe(1);
    expect(diag.byKind.plume).toBe(1);
    expect(diag.byKind.pickup).toBe(1);
    pool.update(4);
    expect(pool.getDiagnostics().alive).toBe(0);
    pool.dispose();
  });

  it('evicts the oldest particle when the cap is full', () => {
    const pool = new VfxPool(2);
    pool.emit('wake', new THREE.Vector3(), 0);
    pool.emit('explosion', new THREE.Vector3(), 0.1);
    pool.emit('plume', new THREE.Vector3(), 0.2);
    const diag = pool.getDiagnostics();
    expect(diag.alive).toBe(2);
    expect(diag.byKind.wake).toBe(0);
    expect(diag.byKind.plume).toBe(1);
    pool.dispose();
  });

  it('draws every particle with two instanced meshes sharing one atlas', () => {
    const pool = new VfxPool(8);
    pool.emit('explosion', new THREE.Vector3(), 0);
    pool.emit('wake', new THREE.Vector3(), 0);
    const meshes = instancedMeshes(pool);
    expect(meshes).toHaveLength(2);
    const materials = meshes.map((mesh) => mesh.material as THREE.ShaderMaterial);
    const blendings = new Set(materials.map((material) => material.blending));
    expect(blendings.has(THREE.AdditiveBlending)).toBe(true);
    expect(blendings.has(THREE.NormalBlending)).toBe(true);
    expect(materials[0]!.uniforms.map?.value).toBeTruthy();
    expect(materials[0]!.uniforms.map?.value).toBe(materials[1]!.uniforms.map?.value);
    pool.dispose();
  });

  it('keeps explosions alive through a wake flood', () => {
    const pool = new VfxPool(4);
    pool.emit('explosion', new THREE.Vector3(), 0);
    for (let i = 0; i < 20; i++) pool.emit('wake', new THREE.Vector3(), 0.01 * i);
    const diag = pool.getDiagnostics();
    expect(diag.alive).toBe(4);
    expect(diag.byKind.explosion).toBe(1);
    pool.dispose();
  });

  it('does not move particles when time is frozen (paused)', () => {
    const pool = new VfxPool(4);
    pool.emit('plume', new THREE.Vector3(0, 1, 0), 0);
    pool.update(0.1);
    const y = pool.debugParticles()[0]!.y;
    for (let i = 0; i < 60; i++) pool.update(0.1);
    expect(pool.debugParticles()[0]!.y).toBe(y);
    pool.update(0.2);
    expect(pool.debugParticles()[0]!.y).toBeGreaterThan(y);
    pool.dispose();
  });

  it('keeps two draw meshes regardless of how many particles churn', () => {
    const pool = new VfxPool(8);
    for (let i = 0; i < 300; i++) {
      pool.emit('explosion', new THREE.Vector3(), i * 0.01);
      pool.emit('smoke', new THREE.Vector3(), i * 0.01);
      pool.update(i * 0.01);
      expect(instancedMeshes(pool)).toHaveLength(2);
    }
    expect(pool.getDiagnostics().alive).toBeLessThanOrEqual(8);
    pool.dispose();
  });

  it('throttles keyed wake emission to ~30 Hz', () => {
    const pool = new VfxPool(50);
    for (let i = 0; i < 60; i++) pool.emit('wake', new THREE.Vector3(), i / 60, 'torpedo:1');
    expect(pool.getDiagnostics().alive).toBeLessThanOrEqual(31);
    pool.dispose();
  });
});

describe('combat bursts', () => {
  it('flood of wakes never evicts an active flash', () => {
    const pool = new VfxPool(10);
    pool.emit('flash', new THREE.Vector3(), 0);
    for (let i = 0; i < 500; i++) pool.emit('wake', new THREE.Vector3(), 0.001 * i);
    const diag = pool.getDiagnostics();
    expect(diag.byKind.flash).toBe(1);
    expect(diag.alive).toBe(10);
    pool.dispose();
  });

  it('evicts bubbles before smoke before other kinds', () => {
    const pool = new VfxPool(3);
    pool.emit('flash', new THREE.Vector3(), 0);
    pool.emit('smoke', new THREE.Vector3(), 0);
    pool.emit('bubbles', new THREE.Vector3(), 0);
    pool.emit('fireball', new THREE.Vector3(), 0);
    expect(pool.getDiagnostics().byKind.bubbles).toBe(0);
    pool.emit('fireball', new THREE.Vector3(), 0);
    expect(pool.getDiagnostics().byKind.smoke).toBe(0);
    pool.dispose();
  });

  it('routes additive and alpha kinds into separate draw calls', () => {
    const pool = new VfxPool(200);
    pool.emitBurst({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 }, 0);
    const particles = pool.debugParticles();
    expect(particles.some((p) => p.additive)).toBe(true);
    expect(particles.some((p) => !p.additive)).toBe(true);
    pool.dispose();
  });

  it('setCap still holds after a burst', () => {
    const pool = new VfxPool(200);
    pool.emitBurst({ preset: 'sink', x: 0, y: 0, z: 0, intensity: 1 }, 0);
    pool.setCap(5);
    expect(pool.getDiagnostics().alive).toBe(5);
    pool.dispose();
  });
});

describe('instanced particle system', () => {
  it('bubbles rise to the surface and die there with a puff event', () => {
    const system = new ParticleSystem(64, 64);
    system.emit(
      {
        kind: 'bubbles',
        x: 0,
        y: -10,
        z: 0,
        size0: 1,
        ttl: 60,
        terminal: 6,
        surfaceDeath: 'bubble',
      },
      0,
    );
    let puffed = false;
    for (let t = 0; t < 8; t += 0.1) {
      const events = system.update(t, 0);
      if (events.some((event) => event.preset === 'surfacePuff')) puffed = true;
    }
    expect(puffed).toBe(true);
    expect(system.getDiagnostics().alive).toBe(0);
    system.dispose();
  });

  it('spray falling through the surface dies and reports a splash', () => {
    const system = new ParticleSystem(64, 64);
    system.emit(
      {
        kind: 'spray',
        x: 0,
        y: 4,
        z: 0,
        vy: -2,
        gravity: -9.8,
        size0: 2,
        ttl: 10,
        surfaceDeath: 'splash',
      },
      0,
    );
    let splashed = false;
    for (let t = 0; t < 3; t += 0.05) {
      const events = system.update(t, 0);
      if (events.some((event) => event.preset === 'splash')) splashed = true;
    }
    expect(splashed).toBe(true);
    expect(system.getDiagnostics().alive).toBe(0);
    system.dispose();
  });

  it('delayed particles stay parked until their delay elapses', () => {
    const system = new ParticleSystem(64, 64);
    system.emit(
      { kind: 'flash', x: 0, y: 0, z: 0, size0: 4, ttl: 0.3, delay: 1, additive: true },
      0,
    );
    const mesh = system.group.children[0] as THREE.Mesh;
    system.update(0.5);
    expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
    system.update(1.1);
    expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    system.dispose();
  });

  it('clears parked particles when time jumps backwards (mission restart)', () => {
    const system = new ParticleSystem(64, 64);
    system.emit(
      { kind: 'flash', x: 0, y: 0, z: 0, size0: 4, ttl: 100, delay: 50, additive: true },
      100,
    );
    system.update(110);
    system.update(0); // restart
    expect(system.getDiagnostics().alive).toBe(0);
    system.dispose();
  });

  it('produces a deterministic atlas identical between calls', () => {
    const a = new ParticleSystem(8, 8);
    const b = new ParticleSystem(8, 8);
    const texA = (a.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const texB = (b.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const dataA = (texA.uniforms.map?.value as THREE.DataTexture).image.data as Uint8Array;
    const dataB = (texB.uniforms.map?.value as THREE.DataTexture).image.data as Uint8Array;
    expect(dataA.length).toBeGreaterThan(0);
    expect(Array.from(dataA)).toEqual(Array.from(dataB));
    a.dispose();
    b.dispose();
  });
});
