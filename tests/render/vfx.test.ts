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
