import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitPresentationHull, hullLengthX, hullMinY } from '../../src/render/hull-fit';

describe('fitPresentationHull', () => {
  it('rotates a Z-long Kenney-style hull onto +X and sits the keel on y=0', () => {
    const root = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 8));
    hull.position.y = 0.5;
    root.add(hull);
    fitPresentationHull(root, 'freighter');
    expect(hullLengthX(root)).toBeCloseTo(26, 5);
    expect(hullMinY(root)).toBeCloseTo(0, 5);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.z);
  });

  it('lays a Y-up Sketchfab-style sub onto +X', () => {
    const root = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.5));
    hull.position.y = 4;
    root.add(hull);
    fitPresentationHull(root, 'sub_nautilus');
    expect(hullLengthX(root)).toBeCloseTo(22, 5);
    expect(hullMinY(root)).toBeCloseTo(0, 5);
  });
});
