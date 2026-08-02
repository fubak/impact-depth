import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

type ManifestEntry = { gltf: string | null; fallback: string };
type AssetManifest = {
  version: number;
  licenseLedger: Array<{ id: string; source: string; license: string; usage: string }>;
  entities: Record<AssetEntity, ManifestEntry>;
  textures: { hullMetal: string; seabedSand: string };
};

/**
 * glTF-first registry. Rendering remains available while models stream or when a
 * manifest entry intentionally names a procedural fallback.
 */
export class AssetRegistry {
  private readonly loader = new GLTFLoader();
  private readonly templates = new Map<AssetEntity, THREE.Group>();
  private manifest: AssetManifest | null = null;

  async preload(): Promise<void> {
    try {
      const response = await fetch('/assets/manifest.json');
      if (!response.ok) return;
      this.manifest = (await response.json()) as AssetManifest;
      await Promise.all(
        (Object.keys(this.manifest.entities) as AssetEntity[]).map(async (kind) => {
          const url = this.manifest?.entities[kind].gltf;
          if (!url) return;
          try {
            const gltf = await this.loader.loadAsync(`/assets/${url}`);
            this.templates.set(kind, this.normalize(gltf.scene));
          } catch {
            // A failed optional visual asset must never interrupt the simulation.
          }
        }),
      );
    } catch {
      // Offline/dev builds deliberately use procedural fallback views.
    }
  }

  clone(kind: AssetEntity): THREE.Group | undefined {
    return this.templates.get(kind)?.clone(true);
  }

  get licenses(): ReadonlyArray<AssetManifest['licenseLedger'][number]> {
    return this.manifest?.licenseLedger ?? [];
  }

  private normalize(scene: THREE.Group): THREE.Group {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.metalness = Math.min(material.metalness, 0.8);
          material.roughness = Math.max(material.roughness, 0.25);
          if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
        }
      });
    });
    return scene;
  }
}
