import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { fitPresentationHull } from './hull-fit';
import type { ShipKind } from '../game/sim/types';

export type AssetEntity =
  | 'sub_nautilus'
  | 'patrol'
  | 'destroyer'
  | 'freighter'
  | 'cruiser'
  | 'battleship'
  | 'uboat'
  | 'aircraft'
  | 'fob_argus'
  | 'torpedo'
  | 'crate';

export type AssetMeshSource = 'gltf' | 'procedural' | 'missing';

type ManifestEntry = { gltf: string | null; fallback: string };
type AssetManifest = {
  version: number;
  licenseLedger: Array<{ id: string; source: string; license: string; usage: string }>;
  entities: Record<AssetEntity, ManifestEntry>;
  textures: { hullMetal: string; seabedSand: string };
};

/** Map sim / look-dev ship kinds onto manifest / registry entity keys. */
export function simKindToAssetEntity(kind: ShipKind | 'uboat' | 'merchant'): AssetEntity {
  if (kind === 'merchant') return 'freighter';
  if (kind === 'sub' || kind === 'uboat') return 'uboat';
  return kind;
}

/**
 * Residual size nudge after each class uses a dedicated GLB/procedural hull.
 * Heavy class scaling is baked into the mesh generators so clones stay comparable.
 */
export function fleetClassScale(kind: ShipKind | 'uboat' | 'merchant'): number {
  switch (kind) {
    case 'battleship':
      return 1.04;
    case 'cruiser':
      return 1.02;
    case 'patrol':
      return 0.98;
    case 'sub':
    case 'uboat':
      return 1;
    case 'merchant':
      return 1;
    default:
      return 1;
  }
}

/**
 * Keep glTF / procedural PBR on the r185 WebGL2 standard path: one-sided,
 * no unused physical lobes, vertexColors only when the geometry has color.
 * Double-sided MASK hulls otherwise compile a distinct MeshDepth + physical
 * variant (map + alphaTest + FLIP_SIDED) that fails validation on some GL.
 */
export function configureSurfaceMaterial(
  material: THREE.Material,
  geometry?: THREE.BufferGeometry,
): void {
  if (!(
    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
  )) {
    return;
  }
  material.side = THREE.FrontSide;
  material.shadowSide = THREE.FrontSide;
  material.forceSinglePass = true;
  material.vertexColors = Boolean(geometry?.hasAttribute('color'));
  material.metalness = Math.min(material.metalness, 0.22);
  material.roughness = Math.max(material.roughness, 0.4);
  material.envMapIntensity = material.envMapIntensity || 0.55;
  if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
  if (material instanceof THREE.MeshPhysicalMaterial) {
    material.transmission = 0;
    material.anisotropy = 0;
    material.clearcoat = 0;
    material.sheen = 0;
    material.iridescence = 0;
    material.thickness = 0;
    material.dispersion = 0;
  }
}

/**
 * glTF-first registry. Rendering remains available while models stream or when a
 * manifest entry intentionally names a procedural fallback.
 */
export class AssetRegistry {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<AssetEntity, THREE.Group>();
  private readonly loadState = new Map<AssetEntity, AssetMeshSource>();
  private manifest: AssetManifest | null = null;

  private readyResolve: () => void = () => undefined;
  readonly whenReady: Promise<void> = new Promise((resolve) => {
    this.readyResolve = resolve;
  });
  private readySettled = false;

  async preload(): Promise<void> {
    try {
      const response = await fetch('/assets/manifest.json');
      if (!response.ok) {
        this.finishReady();
        return;
      }
      this.manifest = (await response.json()) as AssetManifest;
      await Promise.all(
        (Object.keys(this.manifest.entities) as AssetEntity[]).map(async (kind) => {
          const url = this.manifest?.entities[kind].gltf;
          if (!url) {
            this.loadState.set(kind, 'missing');
            return;
          }
          try {
            const gltf = await this.loader.loadAsync(`/assets/${url}`);
            this.templates.set(kind, this.normalize(gltf.scene, kind));
            this.loadState.set(kind, 'gltf');
          } catch {
            this.loadState.set(kind, 'missing');
          }
        }),
      );
    } catch {
      // Offline/dev builds deliberately use procedural fallback views.
    }
    this.finishReady();
  }

  private finishReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyResolve();
  }

  /** LOD distance meters from manifest budgets when available. */
  getLodDistances(): [number, number, number] {
    const raw = (this.manifest as { budgets?: { lodDistancesM?: number[] } } | null)?.budgets
      ?.lodDistancesM;
    if (raw && raw.length >= 3) return [raw[0]!, raw[1]!, raw[2]!];
    return [280, 900, 1600];
  }

  clone(kind: AssetEntity): THREE.Group | undefined {
    const template = this.templates.get(kind);
    if (!template) return undefined;
    const group = template.clone(true);
    group.userData.assetKind = kind;
    group.userData.assetSource = 'gltf';
    return group;
  }

  hasGltf(kind: AssetEntity): boolean {
    return this.templates.has(kind);
  }

  /** Which entities resolved to glTF vs failed at preload (missing until preload finishes). */
  getLoadReport(): Record<AssetEntity, AssetMeshSource | 'pending'> {
    const entities: AssetEntity[] = [
      'sub_nautilus',
      'patrol',
      'destroyer',
      'freighter',
      'cruiser',
      'battleship',
      'uboat',
      'aircraft',
      'fob_argus',
      'torpedo',
      'crate',
    ];
    const report = {} as Record<AssetEntity, AssetMeshSource | 'pending'>;
    for (const kind of entities) {
      report[kind] = this.loadState.get(kind) ?? 'pending';
    }
    return report;
  }

  get licenses(): ReadonlyArray<AssetManifest['licenseLedger'][number]> {
    return this.manifest?.licenseLedger ?? [];
  }

  /**
   * Game convention: +X bow, +Y up. Sketchfab LA/Akula imports ended up with the
   * sail on −X (bow −X), so motion along +X looked like reverse. Flip those once.
   */
  private alignBowPlusX(scene: THREE.Group, kind: AssetEntity): void {
    if (kind !== 'sub_nautilus' && kind !== 'uboat') return;
    scene.updateMatrixWorld(true);
    const points: THREE.Vector3[] = [];
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry?.attributes?.position) return;
      const pos = object.geometry.attributes.position;
      const v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 2000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld);
        points.push(v.clone());
      }
    });
    if (points.length < 8) return;
    const ys = points.map((p) => p.y).sort((a, b) => a - b);
    const yCut = ys[Math.floor(ys.length * 0.9)]!;
    const top = points.filter((p) => p.y >= yCut);
    const sailX = top.reduce((sum, p) => sum + p.x, 0) / top.length;
    // LA/Akula sail sits forward of midships. Sail on −X means bow is −X → flip.
    if (sailX < 0) {
      scene.rotation.y += Math.PI;
      scene.updateMatrixWorld(true);
    }
  }

  private normalize(scene: THREE.Group, kind: AssetEntity): THREE.Group {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // GLTFLoader templates and their deep clones share geometry/materials.
      // Entity teardown must leave those cached resources alive.
      object.userData.fromGltf = true;
      object.castShadow = true;
      object.receiveShadow = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        configureSurfaceMaterial(material, object.geometry);
      });
    });
    fitPresentationHull(scene, kind);
    this.alignBowPlusX(scene, kind);
    scene.userData.assetKind = kind;
    scene.userData.assetSource = 'gltf';
    return scene;
  }
}
