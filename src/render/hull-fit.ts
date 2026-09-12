import * as THREE from 'three';

/** Presentation length along +X after fit. Sized for the 640 m sector. */
export const HULL_LENGTH_M: Record<string, number> = {
  sub_nautilus: 22,
  uboat: 18,
  patrol: 14,
  destroyer: 24,
  cruiser: 30,
  battleship: 38,
  freighter: 26,
};

const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Game convention: +X bow, +Y up, keel at y=0.
 * Kenney hulls are Z-long with keel at 0; Sketchfab LA is often Y-up length.
 */
export function fitPresentationHull(root: THREE.Object3D, kind: string): void {
  const target = HULL_LENGTH_M[kind];
  if (!target) return;
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getSize(_size);

  if (_size.y >= _size.x && _size.y >= _size.z && _size.y > Math.max(_size.x, _size.z) * 1.2) {
    root.rotateZ(-Math.PI / 2);
    root.updateMatrixWorld(true);
    _box.setFromObject(root);
    _box.getSize(_size);
  }
  if (_size.z > _size.x * 1.08) {
    root.rotateY(Math.PI / 2);
    root.updateMatrixWorld(true);
    _box.setFromObject(root);
    _box.getSize(_size);
  }

  if (_size.x > 0.01) {
    root.scale.multiplyScalar(target / _size.x);
    root.updateMatrixWorld(true);
    _box.setFromObject(root);
    _box.getSize(_size);
  }

  _box.getCenter(_center);
  root.position.x -= _center.x;
  root.position.z -= _center.z;
  root.position.y -= _box.min.y;
  root.updateMatrixWorld(true);
}

export function hullLengthX(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getSize(_size);
  return _size.x;
}

export function hullMinY(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  return _box.min.y;
}
