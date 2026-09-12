import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyOpticsUniforms } from '../../src/render/ocean';
import { excludeFromWaterCapture, WaterOptics } from '../../src/render/ocean/optics';

function dummyColor(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

function dummyDepth(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array([1, 1, 1, 1]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  return texture;
}

function opticsUniforms(color: THREE.Texture, depth: THREE.Texture) {
  return {
    uOpticsEnabled: { value: 0 },
    uReflection: { value: color },
    uRefraction: { value: color },
    uRefractionDepth: { value: depth },
    uReflectionMatrix: { value: new THREE.Matrix4().makeTranslation(2, 0, 0) },
    uRefractionMatrix: { value: new THREE.Matrix4().makeTranslation(0, 3, 0) },
    uInverseProjection: { value: new THREE.Matrix4() },
    uCameraWorld: { value: new THREE.Matrix4() },
  };
}

describe('applyOpticsUniforms', () => {
  it('fails closed when optics are unbound', () => {
    const color = dummyColor();
    const depth = dummyDepth();
    const uniforms = opticsUniforms(color, depth);
    uniforms.uOpticsEnabled.value = 1;
    applyOpticsUniforms(uniforms, color, depth, null);
    expect(uniforms.uOpticsEnabled.value).toBe(0);
    expect(uniforms.uReflection.value).toBe(color);
    expect(uniforms.uRefractionDepth.value).toBe(depth);
    expect(uniforms.uReflectionMatrix.value.equals(new THREE.Matrix4())).toBe(true);
    color.dispose();
    depth.dispose();
  });

  it('binds capture textures and matrices when optics are present', () => {
    const color = dummyColor();
    const depth = dummyDepth();
    const optics = new WaterOptics();
    const uniforms = opticsUniforms(color, depth);
    applyOpticsUniforms(uniforms, color, depth, optics);
    expect(uniforms.uOpticsEnabled.value).toBe(1);
    expect(uniforms.uReflection.value).toBe(optics.reflection.texture);
    expect(uniforms.uRefraction.value).toBe(optics.refraction.texture);
    expect(uniforms.uRefractionDepth.value).toBe(optics.refraction.depthTexture);
    expect(uniforms.uReflectionMatrix.value.equals(optics.reflectionMatrix)).toBe(true);
    optics.dispose();
    expect(optics.getDiagnostics().ready).toBe(false);
    color.dispose();
    depth.dispose();
  });
});

describe('water capture membership', () => {
  it('marks UI cues so WaterOptics can hide them', () => {
    const cue = new THREE.Group();
    excludeFromWaterCapture(cue);
    expect(cue.userData.waterCapture).toBe(false);
  });
});
