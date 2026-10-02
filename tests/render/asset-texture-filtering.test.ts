import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureSurfaceMaterial } from '../../src/render/assets';

describe('texture anisotropic filtering', () => {
  it('sets anisotropy on map texture when present', () => {
    const material = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(),
    });
    configureSurfaceMaterial(material);
    expect(material.map?.anisotropy).toBe(4);
    material.dispose();
  });

  it('sets anisotropy on normalMap when present', () => {
    const material = new THREE.MeshStandardMaterial({
      normalMap: new THREE.Texture(),
    });
    configureSurfaceMaterial(material);
    expect(material.normalMap?.anisotropy).toBe(4);
    material.dispose();
  });

  it('sets anisotropy on roughnessMap when present', () => {
    const material = new THREE.MeshStandardMaterial({
      roughnessMap: new THREE.Texture(),
    });
    configureSurfaceMaterial(material);
    expect(material.roughnessMap?.anisotropy).toBe(4);
    material.dispose();
  });

  it('sets anisotropy on metalnessMap when present', () => {
    const material = new THREE.MeshStandardMaterial({
      metalnessMap: new THREE.Texture(),
    });
    configureSurfaceMaterial(material);
    expect(material.metalnessMap?.anisotropy).toBe(4);
    material.dispose();
  });

  it('sets anisotropy on aoMap when present', () => {
    const material = new THREE.MeshStandardMaterial({
      aoMap: new THREE.Texture(),
    });
    configureSurfaceMaterial(material);
    expect(material.aoMap?.anisotropy).toBe(4);
    material.dispose();
  });

  it('sets anisotropy on all texture maps simultaneously', () => {
    const material = new THREE.MeshPhysicalMaterial({
      map: new THREE.Texture(),
      normalMap: new THREE.Texture(),
      roughnessMap: new THREE.Texture(),
      metalnessMap: new THREE.Texture(),
      aoMap: new THREE.Texture(),
    });
    configureSurfaceMaterial(material);
    expect(material.map?.anisotropy).toBe(4);
    expect(material.normalMap?.anisotropy).toBe(4);
    expect(material.roughnessMap?.anisotropy).toBe(4);
    expect(material.metalnessMap?.anisotropy).toBe(4);
    expect(material.aoMap?.anisotropy).toBe(4);
    material.dispose();
  });

  it('leaves material anisotropy property at 0 for MeshPhysicalMaterial', () => {
    const material = new THREE.MeshPhysicalMaterial({
      map: new THREE.Texture(),
      anisotropy: 0.8,
    });
    configureSurfaceMaterial(material);
    // Material's physical anisotropy should stay 0, not be set to texture anisotropy
    expect(material.anisotropy).toBe(0);
    // But the map texture should have anisotropy
    expect(material.map?.anisotropy).toBe(4);
    material.dispose();
  });

  it('handles material with no texture maps gracefully', () => {
    const material = new THREE.MeshStandardMaterial();
    expect(() => configureSurfaceMaterial(material)).not.toThrow();
    expect(material.map).toBeNull();
    expect(material.normalMap).toBeNull();
    material.dispose();
  });
});
