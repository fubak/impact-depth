import * as THREE from 'three';
import { classifySeabedTone, sampleSeabedY } from '../core/terrain';
import type { EnvironmentSettings } from '../core/types';

export type SeabedHeightSampler = (worldX: number, worldZ: number) => number;

/**
 * Procedural sandy bathymetry mesh that follows the player.
 * Built in XZ (Y-up) without Geometry.rotateX so height writes stick.
 * Colors are attenuated with depth so underwater sand reads teal, not dry beige.
 */
export class Seabed {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly size: number;
  private readonly segments: number;
  private originX = 0;
  private originZ = 0;
  private heightSampler: SeabedHeightSampler = sampleSeabedY;

  constructor(size = 440, segments = 100) {
    this.size = size;
    this.segments = segments;

    const verts = (segments + 1) * (segments + 1);
    const positions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const indices: number[] = [];

    for (let iz = 0; iz <= segments; iz++) {
      for (let ix = 0; ix <= segments; ix++) {
        const i = iz * (segments + 1) + ix;
        const lx = (ix / segments - 0.5) * size;
        const lz = (iz / segments - 0.5) * size;
        positions[i * 3] = lx;
        positions[i * 3 + 1] = -12;
        positions[i * 3 + 2] = lz;
      }
    }
    for (let iz = 0; iz < segments; iz++) {
      for (let ix = 0; ix < segments; ix++) {
        const a = iz * (segments + 1) + ix;
        const b = a + 1;
        const c = a + (segments + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setIndex(indices);

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: false,
    });
    const sandTexture = new THREE.TextureLoader().load('/assets/textures/seabed-sand-albedo.png');
    sandTexture.colorSpace = THREE.SRGBColorSpace;
    sandTexture.wrapS = THREE.RepeatWrapping;
    sandTexture.wrapT = THREE.RepeatWrapping;
    sandTexture.repeat.set(42, 42);
    this.material.map = sandTexture;

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.rebuild(0, 0, '#c8b57a');
  }

  /** Prefer the canonical world bed when littoral-v2 is active. */
  setHeightSampler(sampler: SeabedHeightSampler | null): void {
    const next = sampler ?? sampleSeabedY;
    if (next === this.heightSampler) return;
    this.heightSampler = next;
    this.originX = Number.NaN;
    this.originZ = Number.NaN;
  }

  private rebuild(ox: number, oz: number, sandHex: string): void {
    this.originX = ox;
    this.originZ = oz;
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.geometry.attributes.color as THREE.BufferAttribute;
    const sand = new THREE.Color(sandHex).multiplyScalar(0.92);
    const dark = sand.clone().multiplyScalar(0.78);
    const reef = new THREE.Color(0x4a8870).lerp(sand, 0.4);
    const deepTeal = new THREE.Color(0x2a8a90);

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const wx = ox + lx;
      const wz = oz + lz;
      const y = this.heightSampler(wx, wz);
      pos.setY(i, y);

      const tone = classifySeabedTone(wx, wz);
      const c = sand.clone().lerp(dark, tone * 0.4);
      if (tone > 0.72 && y > -9) c.lerp(reef, 0.22);
      const depth = Math.max(0, -y);
      const atten = Math.min(1, Math.max(0, (depth - 2.5) / 15));
      c.lerp(deepTeal, atten * 0.4);
      c.multiplyScalar(0.9 - atten * 0.12);
      const caustic = 0.95 + 0.07 * Math.sin(wx * 0.32) * Math.sin(wz * 0.26);
      c.multiplyScalar(caustic);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  follow(x: number, z: number, env: EnvironmentSettings): void {
    const cell = this.size / this.segments;
    const snapX = Math.round(x / cell) * cell;
    const snapZ = Math.round(z / cell) * cell;
    if (
      !Number.isFinite(this.originX) ||
      !Number.isFinite(this.originZ) ||
      Math.hypot(snapX - this.originX, snapZ - this.originZ) > cell * 2.5 ||
      this.material.userData.sand !== env.sandColor
    ) {
      this.material.userData.sand = env.sandColor;
      this.rebuild(snapX, snapZ, env.sandColor);
    }
    this.mesh.position.x = snapX;
    this.mesh.position.z = snapZ;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
