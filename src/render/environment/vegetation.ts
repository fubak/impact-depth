import * as THREE from 'three';
import {
  generatePalmPlacements,
  generateShrubPlacements,
  hash2,
  ISLAND_MESH_RADIUS_FACTOR,
  type FoliagePlacement,
  type IslandSpec,
} from '../../core/terrain';

export type VegetationQuality = {
  vegetationDensity: number;
  vegetationLodDistance: number;
  vegetationShadows: boolean;
};

type WindMaterial = THREE.MeshStandardMaterial & {
  userData: {
    wind?: { time: { value: number }; direction: { value: THREE.Vector2 }; strength: { value: number } };
  };
};

function windMaterial(color: number, sway = 0.16): WindMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.18,
  }) as WindMaterial;
  material.onBeforeCompile = (shader) => {
    const wind = {
      time: { value: 0 },
      direction: { value: new THREE.Vector2(1, 0) },
      strength: { value: 0.5 },
    };
    material.userData.wind = wind;
    Object.assign(shader.uniforms, {
      uVegetationTime: wind.time,
      uWindDirection: wind.direction,
      uWindStrength: wind.strength,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uVegetationTime;\nuniform vec2 uWindDirection;\nuniform float uWindStrength;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float windPhase = dot(instanceMatrix[3].xz, vec2(0.031, 0.027)) + uVegetationTime * 1.7;
         float windWeight = smoothstep(0.15, 5.2, position.y);
         transformed.xz += uWindDirection * sin(windPhase + position.y * 0.72) * windWeight * uWindStrength * ${sway.toFixed(3)};`,
      );
  };
  material.customProgramCacheKey = () => `vegetation-wind-${sway}`;
  return material;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const part of parts) {
    part.computeVertexNormals();
    const p = part.getAttribute('position');
    const n = part.getAttribute('normal');
    const uv = part.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (part.index) for (let i = 0; i < part.index.count; i++) indices.push(part.index.getX(i) + offset);
    offset += p.count;
    part.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Exported for geometry nondegeneracy tests. */
export function palmCrownGeometry(): THREE.BufferGeometry {
  const leaves: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const length = 2.1 + (i % 3) * 0.18;
    const leaf = new THREE.PlaneGeometry(length, 0.52, 5, 1);
    leaf.translate(length * 0.5, 0, 0);
    const pos = leaf.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const along = Math.max(0, pos.getX(v)) / length;
      pos.setY(v, -0.62 * along * along + 0.14 * Math.sin(along * Math.PI));
      pos.setZ(v, pos.getZ(v) * Math.sin(Math.PI * along));
    }
    leaf.rotateY(-angle);
    leaf.translate(0, 4.85 + (i % 2) * 0.07, 0);
    leaves.push(leaf);
  }
  return merge(leaves);
}

function makeInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  specs: readonly IslandSpec[],
  placements: readonly { spec: IslandSpec; item: FoliagePlacement }[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  placements.forEach(({ spec, item }, i) => {
    dummy.position.set(spec.cx + item.x, item.y, spec.cz + item.z);
    dummy.rotation.set(0, item.rot, item.kind === 'palm' ? (hash2(i, spec.seed) - 0.5) * 0.08 : 0);
    dummy.scale.setScalar(item.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.31 + (hash2(i + 7, spec.seed) - 0.5) * 0.035, 0.42, 0.28 + hash2(i, spec.seed + 3) * 0.12);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.userData.capacity = placements.length;
  mesh.userData.isVegetation = true;
  void specs;
  return mesh;
}

type IslandBounds = { center: THREE.Vector3; radius: number };

function islandBoundsFromSpec(spec: IslandSpec): IslandBounds {
  const radius = spec.radius * ISLAND_MESH_RADIUS_FACTOR + 48;
  return { center: new THREE.Vector3(spec.cx, 0, spec.cz), radius };
}

/** Seeded, instanced littoral vegetation with bounded density, distance LOD and shader wind. */
export class VegetationField {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly islandBounds: IslandBounds[] = [];
  private quality: VegetationQuality = {
    vegetationDensity: 1,
    vegetationLodDistance: 300,
    vegetationShadows: true,
  };
  private frozenWindTime = 0;

  constructor(specs: readonly IslandSpec[]) {
    this.islandBounds = specs.map(islandBoundsFromSpec);

    const palms = specs.flatMap((spec) => generatePalmPlacements(spec, 3.1).map((item) => ({ spec, item })));
    const ground = specs.flatMap((spec) => generateShrubPlacements(spec, 2.35).map((item) => ({ spec, item })));
    const trunks = makeInstances(
      new THREE.CylinderGeometry(0.1, 0.22, 5, 7, 4).translate(0, 2.5, 0),
      windMaterial(0x6b5137, 0.045),
      specs,
      palms,
    );
    const crowns = makeInstances(palmCrownGeometry(), windMaterial(0x397c45, 0.32), specs, palms);
    const shrubs = makeInstances(
      new THREE.IcosahedronGeometry(0.72, 1).scale(1.25, 0.55, 1.05).translate(0, 0.4, 0),
      windMaterial(0x3f824a, 0.11),
      specs,
      ground,
    );
    const grassPlacements = ground.filter((_, i) => i % 2 === 0);
    const grass = makeInstances(
      new THREE.ConeGeometry(0.24, 0.72, 5).translate(0, 0.34, 0),
      windMaterial(0x609550, 0.2),
      specs,
      grassPlacements,
    );
    this.meshes.push(trunks, crowns, shrubs, grass);
    this.group.add(...this.meshes);
    this.setQuality(this.quality);
  }

  setQuality(profile: VegetationQuality): void {
    this.quality = profile;
    for (const mesh of this.meshes) {
      const capacity = mesh.userData.capacity as number;
      mesh.count = Math.max(0, Math.min(capacity, Math.round(capacity * profile.vegetationDensity)));
      mesh.castShadow = profile.vegetationShadows;
      mesh.receiveShadow = false;
    }
  }

  setColor(colorHex: string): void {
    const base = new THREE.Color(colorHex);
    for (const [index, mesh] of this.meshes.entries()) {
      if (index === 0) continue;
      (mesh.material as THREE.MeshStandardMaterial).color
        .copy(base)
        .offsetHSL(index === 3 ? 0.02 : 0, 0, index === 2 ? -0.05 : 0.03);
    }
  }

  update(
    time: number,
    windDirection: number,
    windStrength: number,
    cameraPosition?: THREE.Vector3,
    paused = false,
  ): void {
    if (!paused) this.frozenWindTime = time;
    const windTime = paused ? this.frozenWindTime : time;
    const direction = new THREE.Vector2(Math.cos(windDirection), Math.sin(windDirection));
    const strength = Math.max(0, Math.min(1.5, windStrength));

    let visible = true;
    if (cameraPosition) {
      const reach = this.quality.vegetationLodDistance;
      visible = this.islandBounds.some(
        (bound) => cameraPosition.distanceTo(bound.center) <= reach + bound.radius,
      );
    }

    for (const mesh of this.meshes) {
      mesh.visible = visible;
      const wind = (mesh.material as WindMaterial).userData.wind;
      if (wind) {
        wind.time.value = windTime;
        wind.direction.value.copy(direction);
        wind.strength.value = strength;
      }
    }
  }

  /** Read wind uniform hooks after materials compile (tests / diagnostics). */
  getWindUniforms(): Array<{ time: number; direction: THREE.Vector2; strength: number }> {
    return this.meshes
      .map((mesh) => (mesh.material as WindMaterial).userData.wind)
      .filter((wind): wind is NonNullable<typeof wind> => Boolean(wind))
      .map((wind) => ({
        time: wind.time.value,
        direction: wind.direction.value.clone(),
        strength: wind.strength.value,
      }));
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.group.clear();
  }
}
