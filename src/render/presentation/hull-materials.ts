import * as THREE from 'three';
import { PLAYER_HULL_FOG_EXEMPT_M, PLAYER_HULL_FOG_FADE_M } from './immersion';

const BASELINE_KEY = 'silentDepthsMaterialBaseline';
const HULL_LIGHT_KEY = 'silentDepthsPlayerHullLight';

/** Linear albedo floor. Authored hulls sit near 0.03–0.09; this only lifts darker paint. */
export const UNDERWATER_ALBEDO_FLOOR = 0.08;
/** Neutral key, not the cyan belly fill (0x163848) that reads as a ghost. */
export const UNDERWATER_KEY_EMISSIVE = 0xb7c4be;
/** Stays under the 0.15 deep-hull emissive gate. */
export const UNDERWATER_KEY_INTENSITY = 0.12;
/**
 * Hull caustics are a cyan wash (role gain already < 1). Keep a fraction on
 * the player boat so the key/rim term, not the caustic tint, sets the read.
 */
export const PLAYER_HULL_CAUSTIC_SCALE = 0.4;

const CAUSTIC_ADD = 'reflectedLight.directDiffuse += sampleProjectedCaustics(vCausticWorld);';

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
  /** Camera is underwater and this mesh is the player boat. Contacts omit it. */
  readonly underwaterSubject?: boolean;
}

interface HullLightHook {
  previousCompile?: THREE.Material['onBeforeCompile'];
  previousCacheKey: () => string;
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

/** Periscope ghosting + station lighting clamps. Underwater key is neutral, never cyan. */
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
  if (presentation.underwaterSubject === true && depth > 0.5) {
    applyUnderwaterReadability(material);
    installUnderwaterHullLight(material);
    return;
  }
  removeUnderwaterHullLight(material);
}

function applyUnderwaterReadability(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
  material.color.r = Math.max(material.color.r, UNDERWATER_ALBEDO_FLOOR);
  material.color.g = Math.max(material.color.g, UNDERWATER_ALBEDO_FLOOR);
  material.color.b = Math.max(material.color.b, UNDERWATER_ALBEDO_FLOOR);
  material.emissive.setHex(UNDERWATER_KEY_EMISSIVE);
  material.emissiveIntensity = UNDERWATER_KEY_INTENSITY;
}

/** Fog exemption, bounded key/rim, and a quieter caustic wash. Player hull only. */
export function patchPlayerHullFragment(fragmentShader: string): string {
  const start = PLAYER_HULL_FOG_EXEMPT_M.toFixed(1);
  const end = (PLAYER_HULL_FOG_EXEMPT_M + PLAYER_HULL_FOG_FADE_M).toFixed(1);
  const scale = PLAYER_HULL_CAUSTIC_SCALE.toFixed(2);
  const scaled =
    'reflectedLight.directDiffuse += sampleProjectedCaustics(vCausticWorld) * ' + `${scale};`;
  let next = fragmentShader.replace(CAUSTIC_ADD, scaled);
  next = next.replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>
   {
     float silentNdV = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
     float silentRim = pow(1.0 - silentNdV, 2.2);
     vec3 silentKey = vec3(0.05, 0.06, 0.055) * clamp(normal.y * 0.55 + 0.45, 0.0, 1.0);
     reflectedLight.directDiffuse += silentKey + vec3(0.035, 0.05, 0.045) * silentRim;
   }`,
  );
  return next.replace(
    '#include <fog_fragment>',
    `vec3 silentDepthsPreFog = gl_FragColor.rgb;
   #include <fog_fragment>
   #ifdef USE_FOG
     float silentExempt = 1.0 - smoothstep(${start}, ${end}, vFogDepth);
     gl_FragColor.rgb = mix(gl_FragColor.rgb, silentDepthsPreFog, silentExempt);
   #endif`,
  );
}

function installUnderwaterHullLight(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
  if (material.userData[HULL_LIGHT_KEY]) return;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  const bag: HullLightHook = { previousCompile, previousCacheKey };
  material.userData[HULL_LIGHT_KEY] = bag;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = patchPlayerHullFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|player-hull-uw-30`;
  material.needsUpdate = true;
}

function removeUnderwaterHullLight(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
): void {
  const bag = material.userData[HULL_LIGHT_KEY] as HullLightHook | undefined;
  if (!bag) return;
  material.onBeforeCompile = bag.previousCompile ?? (() => undefined);
  material.customProgramCacheKey = bag.previousCacheKey;
  delete material.userData[HULL_LIGHT_KEY];
  material.needsUpdate = true;
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
