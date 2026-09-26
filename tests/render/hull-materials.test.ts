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

  it('bumps material.version only when periscope transparency actually flips', () => {
    const material = standard();
    const step = (peri: boolean): number => {
      const before = material.version;
      applyHullPresentation(material, { peri, depthMetres: 3 });
      return material.version - before;
    };
    expect(step(false)).toBe(0);
    expect(step(true)).toBe(1);
    expect(step(true)).toBe(0);
    expect(step(false)).toBe(1);
    expect(step(false)).toBe(0);
    expect(step(true)).toBe(1);
  });

  it('does not bake cyan self-light into imported hulls', () => {
    const material = standard();
    configureSurfaceMaterial(material);
    expect(material.emissiveIntensity).toBeLessThan(0.05);
    expect(material.emissive.getHex()).toBe(0);
  });

  it('clamps station lighting after restore without cyan emissive', () => {
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a5560,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x000000,
      emissiveIntensity: 0,
      envMapIntensity: 1,
    });
    captureMaterialBaseline(material);
    applyHullPresentation(material, { peri: false, depthMetres: 0 });
    expect(material.metalness).toBeLessThanOrEqual(0.18);
    expect(material.roughness).toBeGreaterThanOrEqual(0.5);
    expect(material.envMapIntensity).toBeCloseTo(0.85);
    expect(material.emissive.getHex()).toBe(0);
    expect(material.emissiveIntensity).toBe(0);
  });

  it('applies depth fade on top of the 0.85 envMapIntensity scale', () => {
    const material = standard();
    captureMaterialBaseline(material);
    applyHullPresentation(material, { peri: false, depthMetres: 14 });
    const depthFade = 1 - Math.min(0.45, 14 / 28);
    expect(material.envMapIntensity).toBeCloseTo(0.7 * depthFade * 0.85);
  });
});
