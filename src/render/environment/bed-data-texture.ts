import * as THREE from 'three';
import type { PackedHeightField } from './terrain-texture';

/**
 * Upload CPU bed metres as R32F. Sampling UV is (worldXZ - origin) / extent
 * with texel-center bilinear and ClampToEdge — same as `samplePackedBed`.
 * Do not convert through half-float.
 */
export function createPackedBedDataTexture(field: PackedHeightField): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    field.bedMetres,
    field.spec.size,
    field.spec.size,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.internalFormat = 'R32F';
  texture.needsUpdate = true;
  return texture;
}

export function createDummyBedDataTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array([-28]),
    1,
    1,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.internalFormat = 'R32F';
  texture.needsUpdate = true;
  return texture;
}
