import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ISLAND_SPECS } from '../../src/core/terrain';
import { palmCrownGeometry, VegetationField } from '../../src/render/environment/vegetation';

function compileWindMaterial(material: THREE.MeshStandardMaterial): void {
  // Three's onBeforeCompile second arg is WebGLRenderer; tests only need the shader params.
  material.onBeforeCompile?.(
    {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>',
    } as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
}

describe('vegetation geometry', () => {
  // Wet-sand shoreline band lives on island terrain material (islands.ts), not vegetation.
  // Littoral palms/shrubs are seeded on grass/beach bands via generatePalmPlacements / generateShrubPlacements.

  it('builds a nondegenerate palm crown with tapered fronds', () => {
    const geo = palmCrownGeometry();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    expect(geo.attributes.position.count).toBeGreaterThan(120);
    expect(geo.boundingSphere?.radius ?? 0).toBeGreaterThan(2.2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }

    const unique = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      unique.add(
        `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`,
      );
    }
    expect(unique.size).toBeGreaterThan(80);

    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    expect(Math.max(size.x, size.z)).toBeGreaterThan(size.y * 0.75);

    const crownY = 4.85;
    let maxReach = 0;
    let maxRibbon = 0;
    for (let i = 0; i < pos.count; i++) {
      maxReach = Math.max(maxReach, Math.hypot(pos.getX(i), pos.getZ(i)));
      maxRibbon = Math.max(maxRibbon, Math.abs(pos.getY(i) - crownY) + Math.abs(pos.getZ(i)));
    }
    expect(maxReach).toBeGreaterThan(1.9);
    expect(maxReach).toBeGreaterThan(maxRibbon * 0.42);

    geo.dispose();
  });
});

describe('vegetation wind and LOD', () => {
  it('installs wind uniforms and updates them each frame', () => {
    const field = new VegetationField(ISLAND_SPECS.slice(0, 2));
    for (const mesh of field.group.children) {
      compileWindMaterial((mesh as THREE.InstancedMesh).material as THREE.MeshStandardMaterial);
    }

    field.update(12.5, 1.1, 0.9, new THREE.Vector3(0, 20, 0), false);
    const hooks = field.getWindUniforms();
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks[0]?.time).toBe(12.5);
    expect(hooks[0]?.strength).toBeCloseTo(0.9, 5);

    field.update(20, 1.1, 0.9, new THREE.Vector3(0, 20, 0), true);
    const paused = field.getWindUniforms();
    expect(paused[0]?.time).toBe(12.5);

    field.dispose();
  });

  it('uses world island bounds for distance LOD instead of local geometry center', () => {
    const field = new VegetationField(ISLAND_SPECS.slice(0, 2));
    const farIsland = ISLAND_SPECS[1]!;
    const far = new THREE.Vector3(farIsland.cx + 5000, 30, farIsland.cz + 5000);
    field.update(0, 0, 0.5, far, false);
    for (const mesh of field.group.children) {
      expect((mesh as THREE.InstancedMesh).visible).toBe(false);
    }

    const near = new THREE.Vector3(farIsland.cx, 25, farIsland.cz);
    field.update(0, 0, 0.5, near, false);
    for (const mesh of field.group.children) {
      expect((mesh as THREE.InstancedMesh).visible).toBe(true);
    }

    field.dispose();
  });
});
