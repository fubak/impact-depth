import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitPresentationHull, hullHeightY, hullLengthX, hullMinY } from '../../src/render/hull-fit';

describe('fitPresentationHull', () => {
  it('rotates a Z-long Kenney-style hull onto +X and sits the keel on y=0', () => {
    const root = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 8));
    hull.position.y = 0.5;
    root.add(hull);
    fitPresentationHull(root, 'freighter');
    expect(hullLengthX(root)).toBeCloseTo(26, 5);
    expect(hullMinY(root)).toBeCloseTo(0, 5);
    expect(hullHeightY(root)).toBeGreaterThan(1.5);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(size.z);
  });

  it('puts an aircraft fuselage on +X instead of the wingspan', () => {
    const root = new THREE.Group();
    const wings = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 1.2));
    const fuse = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 4));
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4));
    nose.position.z = 2.2;
    root.add(wings, fuse, nose);
    fitPresentationHull(root, 'aircraft');
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(size.x * 1.05);
    const noseWorld = nose.getWorldPosition(new THREE.Vector3());
    expect(noseWorld.x).toBeGreaterThan(0);
  });

  it('flips a Kenney-style X-long hull whose bow was baked onto −X', () => {
    const root = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 2));
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6));
    bow.position.x = -4.6;
    root.add(hull, bow);
    fitPresentationHull(root, 'battleship');
    const bowWorld = bow.getWorldPosition(new THREE.Vector3());
    expect(bowWorld.x).toBeGreaterThan(0);
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
