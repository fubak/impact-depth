import * as THREE from 'three';

/** Attach multi-level LODs; `detail` becomes the near level (moved into the LOD). */
/** Near / mid / cull. No box proxy — boxes read as “block ships” inside patrol range. */
export const DEFAULT_LOD_DISTANCES: readonly [number, number, number] = [280, 900, 1600];

export function wrapWithLod(
  detail: THREE.Object3D,
  distances: readonly [number, number, number] = DEFAULT_LOD_DISTANCES,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `${detail.name || 'entity'}-lod-root`;
  Object.assign(root.userData, detail.userData);
  root.userData.hasLod = true;

  const lod = new THREE.LOD();
  lod.name = 'entity-lod';

  lod.addLevel(detail, 0);

  const mid = detail.clone(true);
  pruneForMidLod(mid);
  lod.addLevel(mid, distances[0]);

  const cull = new THREE.Group();
  cull.name = 'lod-cull';
  lod.addLevel(cull, distances[1]);

  root.add(lod);
  root.userData.lod = lod;
  return root;
}

export function updateEntityLods(root: THREE.Object3D, camera: THREE.Camera): void {
  root.traverse((object) => {
    if (object instanceof THREE.LOD) object.update(camera);
  });
}

function pruneForMidLod(root: THREE.Object3D): void {
  const hideName =
    /antenna|radar|ladder|boom|rail|window|searchlight|strap|fin|beacon|wheel|crate|liferaft|corner|nacelle|cockpit/i;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (hideName.test(object.name) || hideName.test(object.parent?.name ?? '')) {
      object.visible = false;
    }
  });
}
