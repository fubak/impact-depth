import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureSurfaceMaterial } from '../../src/render/assets';
import { Atmosphere } from '../../src/render/atmosphere';
import { wrapWithLod } from '../../src/render/lod';
import { configureWebGlRenderer, isSoftwareWebGlRendererName } from '../../src/render/renderer';

describe('r185 WebGL standard-material contract', () => {
  it('uses PCF shadow maps, not the removed PCFSoft define', () => {
    const renderer = {
      outputColorSpace: THREE.NoColorSpace,
      toneMapping: THREE.NoToneMapping,
      toneMappingExposure: 1,
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
    } as THREE.WebGLRenderer;
    configureWebGlRenderer(renderer);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(renderer.shadowMap.type).not.toBe(THREE.PCFSoftShadowMap);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });

  it('recognizes SwiftShader / llvmpipe as software renderers', () => {
    expect(
      isSoftwareWebGlRendererName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))'),
    ).toBe(true);
    expect(isSoftwareWebGlRendererName('ANGLE (NVIDIA, GeForce RTX 2080 Direct3D11)')).toBe(false);
  });

  it('keeps loaded PBR on a one-sided standard path without unused physical lobes', () => {
    const geometry = new THREE.BoxGeometry();
    const physical = new THREE.MeshPhysicalMaterial({
      side: THREE.DoubleSide,
      transmission: 1,
      anisotropy: 0.8,
      clearcoat: 0.4,
      sheen: 0.3,
      iridescence: 0.2,
      vertexColors: true,
    });
    configureSurfaceMaterial(physical, geometry);
    expect(physical.side).toBe(THREE.FrontSide);
    expect(physical.shadowSide).toBe(THREE.FrontSide);
    expect(physical.forceSinglePass).toBe(true);
    expect(physical.vertexColors).toBe(false);
    expect(physical.transmission).toBe(0);
    expect(physical.anisotropy).toBe(0);
    expect(physical.clearcoat).toBe(0);
    expect(physical.sheen).toBe(0);
    expect(physical.iridescence).toBe(0);
    geometry.dispose();
    physical.dispose();
  });

  it('enables vertexColors only when the geometry carries a color attribute', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
    );
    const material = new THREE.MeshStandardMaterial({ vertexColors: false });
    configureSurfaceMaterial(material, geometry);
    expect(material.vertexColors).toBe(true);
    geometry.dispose();
    material.dispose();
  });

  it('bakes the sun shadow frustum into the projection matrix', () => {
    const atmo = new Atmosphere();
    const cam = atmo.sun.shadow.camera;
    expect(cam.left).toBe(-140);
    expect(cam.right).toBe(140);
    const identityScaleX = 1;
    expect(cam.projectionMatrix.elements[0]).not.toBe(identityScaleX);
    expect(cam.projectionMatrix.elements[0]).toBeCloseTo(2 / 280, 6);
    atmo.dispose();
  });

  it('does not insert a box proxy LOD — far contacts keep a real mesh until cull', () => {
    const detail = new THREE.Group();
    detail.userData.assetKind = 'destroyer';
    detail.add(new THREE.Mesh(new THREE.BoxGeometry(8, 2, 2), new THREE.MeshStandardMaterial()));
    const root = wrapWithLod(detail, [40, 120, 280]);
    const lod = root.userData.lod as THREE.LOD;
    expect(lod.levels).toHaveLength(1);
    expect(lod.levels[0]!.object.children.length).toBeGreaterThan(0);
  });
});
