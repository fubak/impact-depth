import * as THREE from 'three';

const BASELINE_KEY = 'silentDepthsMaterialBaseline';

export interface MaterialBaseline {
  readonly color: number;
  readonly emissive: number;
  readonly emissiveIntensity: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly depthWrite: boolean;
  readonly envMapIntensity: number;
}

export interface HullPresentation {
  readonly peri: boolean;
  readonly depthMetres: number;
}

function isStandard(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  return (
    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
  );
}

export function captureMaterialBaseline(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): MaterialBaseline {
  const existing = material.userData[BASELINE_KEY] as MaterialBaseline | undefined;
  if (existing) return existing;
  const baseline: MaterialBaseline = {
    color: material.color.getHex(),
    emissive: material.emissive.getHex(),
    emissiveIntensity: material.emissiveIntensity,
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    envMapIntensity: material.envMapIntensity,
  };
  material.userData[BASELINE_KEY] = baseline;
  return baseline;
}

export function restoreMaterialBaseline(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
  const baseline = captureMaterialBaseline(material);
  material.color.setHex(baseline.color);
  material.emissive.setHex(baseline.emissive);
  material.emissiveIntensity = baseline.emissiveIntensity;
  material.metalness = baseline.metalness;
  material.roughness = baseline.roughness;
  material.opacity = baseline.opacity;
  material.transparent = baseline.transparent;
  material.depthWrite = baseline.depthWrite;
  material.envMapIntensity = baseline.envMapIntensity;
}

/** Periscope ghosting + station lighting clamps. Depth never writes cyan emission. */
export function applyHullPresentation(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  presentation: HullPresentation,
): void {
  const previousTransparent = material.transparent;
  restoreMaterialBaseline(material);
  const peri = presentation.peri;
  material.transparent = peri;
  // r185 bakes opaque/transparent into the program key; a flip needs a recompile.
  if (material.transparent !== previousTransparent) material.needsUpdate = true;
  material.opacity = peri ? 0.35 : 1;
  material.depthWrite = !peri;
  material.metalness = Math.min(material.metalness, 0.18);
  material.roughness = Math.max(material.roughness, 0.5);
  const depth = Math.max(0, presentation.depthMetres);
  material.envMapIntensity =
    captureMaterialBaseline(material).envMapIntensity * (1 - Math.min(0.45, depth / 28)) * 0.85;
}

export function ensureUniqueStandardMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const next = materials.map((material) => {
      if (!isStandard(material)) return material;
      if (material.userData.presentationOwner === object.uuid) return material;
      const clone = material.clone();
      clone.userData.presentationOwner = object.uuid;
      captureMaterialBaseline(clone);
      return clone;
    });
    object.material = Array.isArray(object.material) ? next : next[0]!;
  });
}

export function presentHullObject(root: THREE.Object3D, presentation: HullPresentation): void {
  ensureUniqueStandardMaterials(root);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (isStandard(material)) applyHullPresentation(material, presentation);
    }
  });
}
