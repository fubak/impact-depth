import * as THREE from 'three';

/**
 * Extra yaw after AABB fit so the authored nose/bow points +X (motion).
 * Kenney watercraft were imported with rotationY(-90), mapping kit +Z bow to −X.
 * The light plane's longest axis is wingspan, not the fuselage.
 */
export const FORWARD_YAW: Record<string, number> = {
  patrol: Math.PI,
  cruiser: Math.PI,
  battleship: Math.PI,
  freighter: Math.PI,
  aircraft: Math.PI / 2,
};

/** Presentation length along +X after fit. Sized for the 640 m sector. */
export const HULL_LENGTH_M: Record<string, number> = {
  sub_nautilus: 22,
  uboat: 18,
  patrol: 14,
  destroyer: 24,
  cruiser: 30,
  battleship: 38,
  freighter: 26,
  aircraft: 9.5,
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
  if (kind === 'aircraft') {
    // Wingspan is the longest horizontal. Put fuselage on +X, wings on Z.
    if (_size.x > _size.z * 1.05) {
      root.rotateY(Math.PI / 2);
      root.updateMatrixWorld(true);
      _box.setFromObject(root);
      _box.getSize(_size);
    }
  } else if (_size.z > _size.x * 1.08) {
    root.rotateY(Math.PI / 2);
    root.updateMatrixWorld(true);
    _box.setFromObject(root);
    _box.getSize(_size);
  }

  const yaw = FORWARD_YAW[kind];
  if (yaw && kind !== 'aircraft') {
    root.rotateY(yaw);
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

export function hullHeightY(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  _box.getSize(_size);
  return Math.max(1.5, Number.isFinite(_size.y) ? _size.y : 1.5);
}

export function hullMinY(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  _box.setFromObject(root);
  return _box.min.y;
}
