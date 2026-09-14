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
});
