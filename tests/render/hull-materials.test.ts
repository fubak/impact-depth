import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureSurfaceMaterial } from '../../src/render/assets';
import {
  applyHullPresentation,
  captureMaterialBaseline,
  ensureUniqueStandardMaterials,
  restoreMaterialBaseline,
} from '../../src/render/presentation/hull-materials';

function standard(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x4a5560,
    metalness: 0.12,
    roughness: 0.55,
    emissive: 0x000000,
    emissiveIntensity: 0,
    envMapIntensity: 0.7,
  });
}

describe('hull material baselines', () => {
  it('restores exact authored values after a deep-to-surface roundtrip', () => {
    const material = standard();
    captureMaterialBaseline(material);
    applyHullPresentation(material, { peri: false, depthMetres: 18 });
    expect(material.emissiveIntensity).toBeLessThan(0.15);
    applyHullPresentation(material, { peri: false, depthMetres: 0 });
    restoreMaterialBaseline(material);
    expect(material.emissive.getHex()).toBe(0);
    expect(material.emissiveIntensity).toBe(0);
    expect(material.metalness).toBeCloseTo(0.12);
    expect(material.roughness).toBeCloseTo(0.55);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
  });

  it('does not leak presentation edits across two hulls that started from one material', () => {
    const shared = standard();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    ensureUniqueStandardMaterials(a);
    ensureUniqueStandardMaterials(b);
    expect(a.material).not.toBe(b.material);
    applyHullPresentation(a.material as THREE.MeshStandardMaterial, {
      peri: true,
      depthMetres: 7,
    });
    expect((b.material as THREE.MeshStandardMaterial).opacity).toBe(1);
    expect((b.material as THREE.MeshStandardMaterial).transparent).toBe(false);
  });

  it('does not bake cyan self-light into imported hulls', () => {
    const material = standard();
    configureSurfaceMaterial(material);
    expect(material.emissiveIntensity).toBeLessThan(0.05);
    expect(material.emissive.getHex()).toBe(0);
  });
});
