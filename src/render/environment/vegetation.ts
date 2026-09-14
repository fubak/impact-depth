import * as THREE from 'three';
import {
  generatePalmPlacements,
  generateShrubPlacements,
  hash2,
  ISLAND_MESH_RADIUS_FACTOR,
  sampleIslandHeight,
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
    wind?: {
      time: { value: number };
      direction: { value: THREE.Vector2 };
      strength: { value: number };
    };
  };
};

export const WIND_VERTEX_GLSL = /* glsl */ `
float windPhase = dot(instanceMatrix[3].xz, vec2(0.031, 0.027)) + uVegetationTime * 1.7;
float windWeight = smoothstep(0.15, 5.2, position.y);
transformed.xz += uWindDirection * sin(windPhase + position.y * 0.72) * windWeight * uWindStrength * uWindSway;
`;

function compileWind(
  shader: THREE.WebGLProgramParametersWithUniforms,
  wind: WindMaterial['userData']['wind'],
  sway: number,
): void {
  if (!wind) return;
  Object.assign(shader.uniforms, {
    uVegetationTime: wind.time,
    uWindDirection: wind.direction,
    uWindStrength: wind.strength,
    uWindSway: { value: sway },
  });
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nuniform float uVegetationTime;\nuniform vec2 uWindDirection;\nuniform float uWindStrength;\nuniform float uWindSway;`,
    )
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERTEX_GLSL}`);
}

function windMaterial(color: number, sway = 0.16): WindMaterial {
  const wind = {
    time: { value: 0 },
    direction: { value: new THREE.Vector2(1, 0) },
    strength: { value: 0.5 },
  };
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.18,
  }) as WindMaterial;
  material.userData.wind = wind;
  material.onBeforeCompile = (shader) => compileWind(shader, wind, sway);
  material.customProgramCacheKey = () => `vegetation-wind-${sway}`;
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: 0.18,
  }) as THREE.MeshDepthMaterial & { userData: WindMaterial['userData'] };
  depth.userData.wind = wind;
  depth.onBeforeCompile = (shader) => compileWind(shader, wind, sway);
  depth.customProgramCacheKey = () => `vegetation-wind-depth-${sway}`;
  material.userData.depthMaterial = depth;
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
    if (part.index)
      for (let i = 0; i < part.index.count; i++) indices.push(part.index.getX(i) + offset);
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

/** Tapered palm frond ribbon: width shrinks toward the tip with droop and twist. */
function makePalmFrond(
  length: number,
  baseWidth: number,
  tipWidth: number,
  droop: number,
  twist: number,
  widthSegments = 6,
): THREE.BufferGeometry {
  const frond = new THREE.PlaneGeometry(length, baseWidth, widthSegments, 2);
  frond.translate(length * 0.5, 0, 0);
  const pos = frond.getAttribute('position') as THREE.BufferAttribute;
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v);
    let y = pos.getY(v);
    let z = pos.getZ(v);
    const along = Math.max(0, Math.min(1, x / length));
    const width = baseWidth * (1 - along) + tipWidth * along;
    y = (y / baseWidth) * width - droop * along * along + 0.12 * Math.sin(along * Math.PI);
    z *= Math.sin(Math.PI * along) * (0.28 + 0.72 * (1 - along));
    const midrib = Math.exp(-((y / (width * 0.5 + 0.01)) ** 2)) * 0.05 * (1 - along);
    z += midrib;
    const twistAngle = twist * along;
    const cosT = Math.cos(twistAngle);
    const sinT = Math.sin(twistAngle);
    pos.setY(v, y * cosT - z * sinT);
    pos.setZ(v, y * sinT + z * cosT);
  }
  return frond;
}

function groundCoverGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 0, 0, 0.55],
    [0.16, 0.04, -0.11, 0.48],
    [-0.13, 0.02, 0.12, 0.42],
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [ox, oy, oz, radius] = blobs[i]!;
    const blob = new THREE.IcosahedronGeometry(radius, 1);
    blob.scale(1.15 + i * 0.12, 0.38 + i * 0.07, 0.92 + i * 0.08);
    blob.translate(ox, 0.34 + oy, oz);
    const pos = blob.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const nudge = (hash2(v, i + 11) - 0.5) * 0.09;
      pos.setX(v, pos.getX(v) + nudge);
      pos.setY(v, pos.getY(v) * (0.92 + hash2(v + 3, i) * 0.12));
      pos.setZ(v, pos.getZ(v) + nudge * 0.65);
    }
    parts.push(blob);
  }
  return merge(parts);
}

function grassClumpGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.3;
    const height = 0.52 + (i % 3) * 0.16;
    const radius = 0.09 + (i % 2) * 0.035;
    const blade = new THREE.ConeGeometry(radius, height, 4);
    blade.translate(Math.cos(angle) * 0.1, height * 0.5, Math.sin(angle) * 0.1);
    blade.rotateZ((hash2(i, 5) - 0.5) * 0.22);
    blade.rotateX((hash2(i, 9) - 0.5) * 0.28);
    blade.scale(1, 1, 0.72 + hash2(i, 13) * 0.35);
    parts.push(blade);
  }
  return merge(parts);
}

/** Exported for geometry nondegeneracy tests. */
export function generateRockPlacements(spec: IslandSpec, step = 4.2): FoliagePlacement[] {
  const out: FoliagePlacement[] = [];
  const lim = spec.radius * 0.72;
  for (let x = -lim; x <= lim; x += step) {
    for (let z = -lim; z <= lim; z += step) {
      const jitterX = (hash2(x + 11, spec.seed) - 0.5) * step * 0.8;
      const jitterZ = (hash2(z - 7, spec.seed + 3) - 0.5) * step * 0.8;
      const lx = x + jitterX;
      const lz = z + jitterZ;
      const y = sampleIslandHeight(lx, lz, spec);
      if (y < 1.35 || y > spec.peak * 0.72) continue;
      if (hash2(lx * 3, lz * 5 + spec.seed) < 0.62) continue;
      out.push({
        kind: 'canopy',
        x: lx,
        y,
        z: lz,
        rot: hash2(lx, lz) * Math.PI * 2,
        scale: 0.55 + hash2(lz, lx) * 0.7,
      });
    }
  }
  return out.slice(0, 18);
}

export function palmCrownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frondCount = 12;
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + (i % 3) * 0.11;
    const length = 1.92 + (i % 4) * 0.24 + (i % 2) * 0.07;
    const droop = 0.52 + (i % 5) * 0.08;
    const twist = 0.05 + (i % 4) * 0.055;
    const pitch = -0.2 + (i % 3) * 0.05;
    const frond = makePalmFrond(length, 0.56, 0.05, droop, twist, 7);
    frond.rotateZ(pitch);
    frond.rotateY(-angle);
    frond.translate(0, 4.8 + (i % 3) * 0.06, 0);
    parts.push(frond);
    if (i % 2 === 0) {
      const leaflet = makePalmFrond(length * 0.6, 0.34, 0.04, droop * 0.72, -twist * 0.55, 5);
      leaflet.rotateZ(pitch + 0.14);
      leaflet.rotateY(-angle + 0.17);
      leaflet.translate(0, 4.76 + (i % 3) * 0.06, 0.09);
      parts.push(leaflet);
    }
  }
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.35;
    const inner = makePalmFrond(1.15 + (i % 2) * 0.18, 0.4, 0.05, 0.22, 0.035, 4);
    inner.rotateZ(0.38);
    inner.rotateY(-angle);
    inner.translate(0, 5.02, 0);
    parts.push(inner);
  }
  return merge(parts);
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
    dummy.rotation.set(
      0,
      item.rot,
      item.kind === 'palm'
        ? (hash2(i, spec.seed) - 0.5) * 0.08
        : (hash2(i, spec.seed + 1) - 0.5) * 0.14,
    );
    if (item.kind === 'palm') {
      dummy.scale.setScalar(item.scale);
    } else {
      const sx = item.scale * (0.82 + hash2(i, spec.seed) * 0.36);
      const sy =
        item.scale *
        (item.kind === 'canopy'
          ? 0.88 + hash2(i + 2, spec.seed) * 0.38
          : 0.52 + hash2(i + 2, spec.seed) * 0.38);
      const sz = item.scale * (0.76 + hash2(i + 4, spec.seed) * 0.42);
      dummy.scale.set(sx, sy, sz);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHSL(
      0.28 + (hash2(i + 7, spec.seed) - 0.5) * 0.03,
      0.32,
      0.22 + hash2(i, spec.seed + 3) * 0.1,
    );
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.userData.capacity = placements.length;
  mesh.userData.isVegetation = true;
  const depth = (material as WindMaterial).userData.depthMaterial as THREE.Material | undefined;
  if (depth) mesh.customDepthMaterial = depth;
  void specs;
  return mesh;
}

export function islandVegetationCount(capacity: number, density: number): number {
  if (capacity <= 0) return 0;
  const scaled = Math.round(capacity * Math.max(0, Math.min(1, density)));
  return Math.max(1, Math.min(capacity, scaled));
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

    specs.forEach((spec, islandIndex) => {
      const palms = generatePalmPlacements(spec, 2.45).map((item) => ({ spec, item }));
      const ground = generateShrubPlacements(spec, 1.85).map((item) => ({ spec, item }));
      const rocks = generateRockPlacements(spec).map((item) => ({ spec, item }));
      const trunks = makeInstances(
        new THREE.CylinderGeometry(0.1, 0.22, 5, 7, 4).translate(0, 2.5, 0),
        windMaterial(0x6b5137, 0.045),
        [spec],
        palms,
      );
      const crowns = makeInstances(
        palmCrownGeometry(),
        windMaterial(0x2f6a3c, 0.32),
        [spec],
        palms,
      );
      const shrubs = makeInstances(
        groundCoverGeometry(),
        windMaterial(0x355e38, 0.11),
        [spec],
        ground,
      );
      const grassPlacements = ground.filter((_, i) => i % 2 === 0);
      const grass = makeInstances(
        grassClumpGeometry(),
        windMaterial(0x4a7240, 0.2),
        [spec],
        grassPlacements,
      );
      const boulders = makeInstances(
        new THREE.DodecahedronGeometry(0.55, 0),
        windMaterial(0x6a6e62, 0.01),
        [spec],
        rocks,
      );
      const layered: Array<[THREE.InstancedMesh, string]> = [
        [trunks, 'trunk'],
        [crowns, 'crown'],
        [shrubs, 'shrub'],
        [grass, 'grass'],
        [boulders, 'rock'],
      ];
      for (const [mesh, layer] of layered) {
        if (mesh.count === 0 && (mesh.userData.capacity as number) === 0) {
          mesh.dispose();
          continue;
        }
        mesh.userData.islandIndex = islandIndex;
        mesh.userData.layer = layer;
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    });
    this.setQuality(this.quality);
  }

  setQuality(profile: VegetationQuality): void {
    this.quality = profile;
    for (const mesh of this.meshes) {
      const capacity = mesh.userData.capacity as number;
      mesh.count = islandVegetationCount(capacity, profile.vegetationDensity);
      mesh.castShadow = profile.vegetationShadows;
      mesh.receiveShadow = false;
    }
  }

  setColor(colorHex: string): void {
    const base = new THREE.Color(colorHex);
    for (const mesh of this.meshes) {
      const layer = mesh.userData.layer as string;
      if (layer === 'trunk' || layer === 'rock') continue;
      (mesh.material as THREE.MeshStandardMaterial).color
        .copy(base)
        .offsetHSL(layer === 'grass' ? 0.02 : 0, 0, layer === 'shrub' ? -0.05 : 0.03);
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

    const reach = this.quality.vegetationLodDistance;
    for (const mesh of this.meshes) {
      const islandIndex = mesh.userData.islandIndex as number | undefined;
      const bound = islandIndex !== undefined ? this.islandBounds[islandIndex] : undefined;
      const visible =
        cameraPosition && bound
          ? cameraPosition.distanceTo(bound.center) <= reach + bound.radius
          : true;
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
