import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { updateEntityLods, wrapWithLod } from '../../src/render/lod';

function hullDetail(): THREE.Group {
  const detail = new THREE.Group();
  detail.name = 'test-hull';
  detail.userData.assetKind = 'destroyer';
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(8, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0x333333 }),
  );
  box.name = 'hull';
  detail.add(box);
  const radar = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x999999 }),
  );
  radar.name = 'radar';
  detail.add(radar);
  return detail;
}

describe('entity LOD', () => {
  it('keeps a single hull so the camera cannot swap in a cloned mid mesh', () => {
    const root = wrapWithLod(hullDetail(), [40, 120, 280]);
    expect(root.userData.hasLod).toBe(true);
    const lod = root.userData.lod as THREE.LOD;
    expect(lod).toBeInstanceOf(THREE.LOD);
    expect(lod.levels).toHaveLength(1);
    expect(lod.levels[0]!.distance).toBe(0);
    expect(lod.levels[0]!.object.visible).toBe(true);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(0, 5, 10);
    camera.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    updateEntityLods(root, camera);
    expect(lod.getCurrentLevel()).toBe(0);
    expect(lod.levels[0]!.object.children.length).toBeGreaterThan(0);
  });

  it('keeps a real mesh when the camera is hundreds of metres away', () => {
    const root = wrapWithLod(hullDetail(), [40, 120, 280], { neverCull: true });
    const lod = root.userData.lod as THREE.LOD;
    expect(lod.levels).toHaveLength(1);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    camera.position.set(0, 150, 400);
    camera.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    updateEntityLods(root, camera);
    const level = lod.getCurrentLevel();
    expect(lod.levels[level]!.object.children.length).toBeGreaterThan(0);
  });

  it('only inserts an empty far level when cull is requested', () => {
    const root = wrapWithLod(hullDetail(), [40, 120, 280], { neverCull: false });
    const lod = root.userData.lod as THREE.LOD;
    expect(lod.levels).toHaveLength(2);
    expect(lod.levels[1]!.distance).toBe(280);
    expect(lod.levels[1]!.object.children).toHaveLength(0);
  });
});
