import * as THREE from 'three';
import {
  biomeColorWeights,
  generatePalmPlacements,
  generateShrubPlacements,
  ISLAND_MESH_RADIUS_FACTOR,
  sampleIslandHeight,
  type IslandSpec,
  ISLAND_SPECS,
} from '../core/terrain';
import type { EnvironmentSettings } from '../core/types';

function hex(c: string): number {
  return new THREE.Color(c).getHex();
}

function tintIslandVertex(
  h: number,
  sand: THREE.Color,
  grass: THREE.Color,
  rock: THREE.Color,
  shelf: THREE.Color,
  out: THREE.Color,
): void {
  const w = biomeColorWeights(h);
  out.setRGB(
    shelf.r * w.shelf + sand.r * w.beach + grass.r * w.grass + rock.r * w.rock,
    shelf.g * w.shelf + sand.g * w.beach + grass.g * w.grass + rock.g * w.rock,
    shelf.b * w.shelf + sand.b * w.beach + grass.b * w.grass + rock.b * w.rock,
  );
}

/**
 * Radial disc terrain — natural circular silhouette, no square apron edges.
 * Rings × sectors; outer ring locks to seabed height.
 */
function buildIslandGeometry(spec: IslandSpec, rings = 44, sectors = 64): THREE.BufferGeometry {
  const maxR = spec.radius * ISLAND_MESH_RADIUS_FACTOR;
  const sand = new THREE.Color(0xc8b57a);
  const grass = new THREE.Color(0x3d8f52);
  const rock = new THREE.Color(0x7a8a72);
  const shelf = new THREE.Color(0x9aaa88);
  const tmp = new THREE.Color();

  // Center + rings * sectors
  const vertCount = 1 + rings * sectors;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  // Center
  const h0 = sampleIslandHeight(0, 0, spec);
  positions[0] = 0;
  positions[1] = h0;
  positions[2] = 0;
  tintIslandVertex(h0, sand, grass, rock, shelf, tmp);
  colors[0] = tmp.r;
  colors[1] = tmp.g;
  colors[2] = tmp.b;

  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    // Slight ease so beach/interior get more resolution
    const rt = t * t * (3 - 2 * t);
    const radius = maxR * rt;
    for (let s = 0; s < sectors; s++) {
      const ang = (s / sectors) * Math.PI * 2;
      // Soft coastline wobble — keeps silhouette organic
      const wobble = 1 + 0.04 * Math.sin(ang * 3 + spec.seed) + 0.025 * Math.cos(ang * 5 - spec.seed);
      const lx = Math.cos(ang) * radius * wobble;
      const lz = Math.sin(ang) * radius * wobble;
      const h = sampleIslandHeight(lx, lz, spec);
      const i = 1 + (ring - 1) * sectors + s;
      positions[i * 3] = lx;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = lz;
      tintIslandVertex(h, sand, grass, rock, shelf, tmp);
      // Soft rim blend into underwater shelf tones (keep light — avoid dark disc edge)
      const rimFade = Math.max(0, (rt - 0.88) / 0.12);
      if (rimFade > 0) {
        tmp.lerp(new THREE.Color(0x7ab0a0), rimFade * 0.35);
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
  }

  // Fan first ring to center — CCW when viewed from +Y
  for (let s = 0; s < sectors; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % sectors);
    indices.push(0, b, a);
  }
  // Quads between rings — CCW from +Y (a→b→c / b→d→c)
  for (let ring = 1; ring < rings; ring++) {
    const row = 1 + (ring - 1) * sectors;
    const next = 1 + ring * sectors;
    for (let s = 0; s < sectors; s++) {
      const s2 = (s + 1) % sectors;
      const a = row + s;
      const b = row + s2;
      const c = next + s;
      const d = next + s2;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let indexOffset = 0;
  for (const part of parts) {
    part.computeVertexNormals();
    const pos = part.attributes.position as THREE.BufferAttribute;
    const nor = part.attributes.normal as THREE.BufferAttribute;
    const idx = part.index;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
    }
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + indexOffset);
    }
    indexOffset += pos.count;
    part.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function createPalmPrototype(): { trunk: THREE.Mesh; crown: THREE.Mesh } {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.2, 5.0, 8),
    new THREE.MeshStandardMaterial({
      color: 0x6a513c,
      roughness: 0.88,
      metalness: 0.04,
      flatShading: false,
    }),
  );
  trunk.geometry.translate(0, 2.5, 0);

  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const frond = new THREE.SphereGeometry(1.15, 8, 5);
    frond.scale(1.55, 0.22, 0.42);
    frond.rotateY((i / 7) * Math.PI * 2);
    frond.rotateZ(0.22 + (i % 3) * 0.06);
    frond.translate(0.15, 4.85 + (i % 2) * 0.12, 0);
    fronds.push(frond);
  }
  const tip = new THREE.SphereGeometry(0.55, 8, 6);
  tip.scale(1.1, 0.7, 1.1);
  tip.translate(0, 5.15, 0);
  fronds.push(tip);

  const crown = new THREE.Mesh(
    mergeGeometries(fronds),
    new THREE.MeshStandardMaterial({
      color: 0x3d8f52,
      roughness: 0.82,
      metalness: 0.02,
      flatShading: false,
    }),
  );
  return { trunk, crown };
}

function createShrubPrototype(): THREE.Mesh {
  const a = new THREE.SphereGeometry(0.7, 10, 8);
  a.scale(1.35, 0.45, 1.1);
  a.translate(0, 0.35, 0);
  const b = new THREE.SphereGeometry(0.45, 8, 6);
  b.scale(1.1, 0.4, 0.95);
  b.translate(0.4, 0.42, 0.12);
  const c = new THREE.SphereGeometry(0.4, 8, 6);
  c.scale(1.0, 0.38, 0.9);
  c.translate(-0.35, 0.38, -0.1);
  return new THREE.Mesh(
    mergeGeometries([a, b, c]),
    new THREE.MeshStandardMaterial({
      color: 0x4a9a5c,
      roughness: 0.88,
      metalness: 0.02,
      flatShading: false,
    }),
  );
}

function createCanopyPrototype(): THREE.Mesh {
  const canopy = new THREE.SphereGeometry(1.15, 12, 10);
  canopy.scale(1.55, 0.42, 1.4);
  canopy.translate(0, 0.7, 0);
  return new THREE.Mesh(
    canopy,
    new THREE.MeshStandardMaterial({
      color: 0x3a8550,
      roughness: 0.86,
      metalness: 0.02,
      flatShading: false,
    }),
  );
}

export class IslandField {
  readonly group = new THREE.Group();
  private readonly terrains: THREE.Mesh[] = [];
  private readonly trunkMeshes: THREE.InstancedMesh[] = [];
  private readonly crownMeshes: THREE.InstancedMesh[] = [];
  private readonly shrubMeshes: THREE.InstancedMesh[] = [];
  private readonly canopyMeshes: THREE.InstancedMesh[] = [];
  private readonly dummy = new THREE.Object3D();
  private lastEnvKey = '';

  constructor(specs: readonly IslandSpec[] = ISLAND_SPECS) {
    const palm = createPalmPrototype();
    const shrub = createShrubPrototype();
    const canopy = createCanopyPrototype();

    for (const spec of specs) {
      const geo = buildIslandGeometry(spec);
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.03,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(spec.cx, 0, spec.cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Soften self-shadow so beaches don't go black under tropical sun
      mat.shadowSide = THREE.FrontSide;
      mesh.renderOrder = 0;
      this.terrains.push(mesh);
      this.group.add(mesh);

      const palms = generatePalmPlacements(spec, 3.1);
      if (palms.length > 0) {
        const trunks = new THREE.InstancedMesh(
          palm.trunk.geometry,
          (palm.trunk.material as THREE.Material).clone(),
          palms.length,
        );
        const crowns = new THREE.InstancedMesh(
          palm.crown.geometry,
          (palm.crown.material as THREE.Material).clone(),
          palms.length,
        );
        trunks.castShadow = true;
        crowns.castShadow = true;
        palms.forEach((p, i) => {
          this.dummy.position.set(spec.cx + p.x, p.y, spec.cz + p.z);
          this.dummy.rotation.set(0, p.rot, 0);
          this.dummy.scale.setScalar(p.scale);
          this.dummy.updateMatrix();
          trunks.setMatrixAt(i, this.dummy.matrix);
          crowns.setMatrixAt(i, this.dummy.matrix);
        });
        trunks.instanceMatrix.needsUpdate = true;
        crowns.instanceMatrix.needsUpdate = true;
        this.trunkMeshes.push(trunks);
        this.crownMeshes.push(crowns);
        this.group.add(trunks, crowns);
      }

      const shrubsAll = generateShrubPlacements(spec, 2.35);
      const shrubs = shrubsAll.filter((f) => f.kind === 'shrub');
      const canopies = shrubsAll.filter((f) => f.kind === 'canopy');

      if (shrubs.length > 0) {
        const inst = new THREE.InstancedMesh(
          shrub.geometry,
          (shrub.material as THREE.Material).clone(),
          shrubs.length,
        );
        inst.castShadow = true;
        shrubs.forEach((p, i) => {
          this.dummy.position.set(spec.cx + p.x, p.y, spec.cz + p.z);
          this.dummy.rotation.set(0, p.rot, 0);
          this.dummy.scale.setScalar(p.scale);
          this.dummy.updateMatrix();
          inst.setMatrixAt(i, this.dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        this.shrubMeshes.push(inst);
        this.group.add(inst);
      }

      if (canopies.length > 0) {
        const inst = new THREE.InstancedMesh(
          canopy.geometry,
          (canopy.material as THREE.Material).clone(),
          canopies.length,
        );
        inst.castShadow = true;
        canopies.forEach((p, i) => {
          this.dummy.position.set(spec.cx + p.x, p.y, spec.cz + p.z);
          this.dummy.rotation.set(0, p.rot, 0);
          this.dummy.scale.setScalar(p.scale);
          this.dummy.updateMatrix();
          inst.setMatrixAt(i, this.dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        this.canopyMeshes.push(inst);
        this.group.add(inst);
      }
    }

    palm.trunk.geometry.dispose();
    palm.crown.geometry.dispose();
    (palm.trunk.material as THREE.Material).dispose();
    (palm.crown.material as THREE.Material).dispose();
    shrub.geometry.dispose();
    (shrub.material as THREE.Material).dispose();
    canopy.geometry.dispose();
    (canopy.material as THREE.Material).dispose();
  }

  applyEnvironment(env: EnvironmentSettings): void {
    const key = `${env.sandColor}|${env.foliageColor}|${env.rockColor}`;
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;

    const sand = new THREE.Color(env.sandColor);
    const grass = new THREE.Color(env.foliageColor);
    const rock = new THREE.Color(env.rockColor);
    const shelf = sand.clone().lerp(new THREE.Color(0x8a7a52), 0.35);
    const tmp = new THREE.Color();

    for (const mesh of this.terrains) {
      const geo = mesh.geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const col = geo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        tintIslandVertex(pos.getY(i), sand, grass, rock, shelf, tmp);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      col.needsUpdate = true;
    }

    for (const crowns of this.crownMeshes) {
      (crowns.material as THREE.MeshStandardMaterial).color.setHex(hex(env.foliageColor));
    }
    for (const shrubs of this.shrubMeshes) {
      (shrubs.material as THREE.MeshStandardMaterial).color
        .setHex(hex(env.foliageColor))
        .offsetHSL(0.02, 0.05, 0.04);
    }
    for (const canopy of this.canopyMeshes) {
      (canopy.material as THREE.MeshStandardMaterial).color
        .setHex(hex(env.foliageColor))
        .offsetHSL(-0.02, 0.04, -0.06);
    }
  }

  dispose(): void {
    for (const mesh of this.terrains) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const m of [
      ...this.trunkMeshes,
      ...this.crownMeshes,
      ...this.shrubMeshes,
      ...this.canopyMeshes,
    ]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
