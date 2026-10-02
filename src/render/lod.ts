import * as THREE from 'three';

/** Attach multi-level LODs; `detail` becomes the near level (moved into the LOD). */
/** Near / mid. Empty far cull is opt-in — it made the patrol vanish inside camera range. */
export const DEFAULT_LOD_DISTANCES: readonly [number, number, number] = [280, 900, 1600];

export interface LodWrapOptions {
  /**
   * Player and contacts stay on a real mesh. An empty far LOD makes the whole
   * patrol blink/vanish once the camera is ~280 m away (tactical orbit + map).
   */
  neverCull?: boolean;
}

export function wrapWithLod(
  detail: THREE.Object3D,
  distances: readonly [number, number, number] = DEFAULT_LOD_DISTANCES,
  options?: LodWrapOptions,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `${detail.name || 'entity'}-lod-root`;
  Object.assign(root.userData, detail.userData);
  root.userData.hasLod = true;

  const lod = new THREE.LOD();
  lod.name = 'entity-lod';

  const near = distances[0] ?? DEFAULT_LOD_DISTANCES[0];
  const cullAt = Math.max(distances[2] ?? DEFAULT_LOD_DISTANCES[2], near + 1);

  lod.addLevel(detail, 0);
  detail.visible = true;

  // A cloned mid hull looks like a second, blockier ship when LOD flips on
  // the first camera update. Fleet stays on one mesh; optional empty far cull only.
  if (options?.neverCull === false) {
    const cull = new THREE.Group();
    cull.name = 'lod-cull';
    lod.addLevel(cull, cullAt, 0.2);
    cull.visible = false;
  }

  root.add(lod);
  root.userData.lod = lod;
  return root;
}

export function updateEntityLods(root: THREE.Object3D, camera: THREE.Camera): void {
  root.traverse((object) => {
    if (object instanceof THREE.LOD) object.update(camera);
  });
}
