import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VfxPool } from '../../src/render/vfx';

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

  it('reuses one additive radial sprite texture across hits', () => {
    const pool = new VfxPool(4);
    pool.emit('explosion', new THREE.Vector3(), 0);
    pool.emit('wake', new THREE.Vector3(), 0);
    const a = pool.group.children[0] as THREE.Sprite;
    const b = pool.group.children[1] as THREE.Sprite;
    expect(a).toBeInstanceOf(THREE.Sprite);
    expect(b).toBeInstanceOf(THREE.Sprite);
    const matA = a.material as THREE.SpriteMaterial;
    const matB = b.material as THREE.SpriteMaterial;
    expect(matA.blending).toBe(THREE.AdditiveBlending);
    expect(matB.blending).toBe(THREE.AdditiveBlending);
    expect(matA.map).toBeTruthy();
    expect(matA.map).toBe(matB.map);
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
    const sprite = pool.group.children[0] as THREE.Sprite;
    const y = sprite.position.y;
    for (let i = 0; i < 60; i++) pool.update(0.1);
    expect(sprite.position.y).toBe(y);
    pool.update(0.2);
    expect(sprite.position.y).toBeGreaterThan(y);
    pool.dispose();
  });

  it('recycles materials so allocation stays bounded', () => {
    const pool = new VfxPool(8);
    const mats = new Set<THREE.Material>();
    for (let i = 0; i < 1000; i++) {
      pool.emit('explosion', new THREE.Vector3(), i * 0.01);
      pool.update(i * 0.01);
      for (const c of pool.group.children) mats.add((c as THREE.Sprite).material as THREE.Material);
    }
    expect(mats.size).toBeLessThanOrEqual(9);
    expect(pool.group.children.length).toBe(pool.getDiagnostics().alive);
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

  it('uses additive blending for flash/fire only and no fog on flash', () => {
    const pool = new VfxPool(20);
    pool.emitBurst({ preset: 'torpedoHit', x: 0, y: 0, z: 0, intensity: 1 }, 0);
    for (const c of pool.group.children) {
      const m = (c as THREE.Sprite).material as THREE.SpriteMaterial;
      expect([THREE.AdditiveBlending, THREE.NormalBlending]).toContain(m.blending);
    }
    const kinds = new Map<THREE.Blending, number>();
    for (const c of pool.group.children) {
      const b = ((c as THREE.Sprite).material as THREE.SpriteMaterial).blending;
      kinds.set(b, (kinds.get(b) ?? 0) + 1);
    }
    expect(kinds.get(THREE.NormalBlending)).toBeGreaterThan(0);
    const flash = pool.group.children[0] as THREE.Sprite;
    expect((flash.material as THREE.SpriteMaterial).fog).toBe(false);
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
