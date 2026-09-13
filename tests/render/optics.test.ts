import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyOpticsUniforms } from '../../src/render/ocean';
import { excludeFromWaterCapture, reflectedCamera, WaterOptics } from '../../src/render/ocean/optics';

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

function mockCaptureRenderer(options: { throwOnRender?: boolean } = {}): THREE.WebGLRenderer {
  let target: THREE.WebGLRenderTarget | null = null;
  return {
    extensions: { has: vi.fn(() => true) },
    getRenderTarget: vi.fn(() => target),
    getActiveCubeFace: vi.fn(() => 0),
    getActiveMipmapLevel: vi.fn(() => 0),
    getViewport: vi.fn((value: THREE.Vector4) => value.set(0, 0, 640, 480)),
    getScissor: vi.fn((value: THREE.Vector4) => value.set(0, 0, 640, 480)),
    getScissorTest: vi.fn(() => false),
    getClearColor: vi.fn((value: THREE.Color) => value.set(0x123456)),
    getClearAlpha: vi.fn(() => 1),
    setRenderTarget: vi.fn((value: THREE.WebGLRenderTarget | null) => {
      target = value;
    }),
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setClearColor: vi.fn(),
    clear: vi.fn(),
    render: vi.fn(() => {
      if (options.throwOnRender) throw new Error('render failed');
    }),
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    localClippingEnabled: false,
    clippingPlanes: [] as THREE.Plane[],
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
    xr: { enabled: false },
  } as unknown as THREE.WebGLRenderer;
}

describe('water capture membership', () => {
  it('marks UI cues so WaterOptics can hide them', () => {
    const cue = new THREE.Group();
    excludeFromWaterCapture(cue);
    expect(cue.userData.waterCapture).toBe(false);
  });

  it('hides HUD-like subtrees during capture and restores visibility', () => {
    const scene = new THREE.Scene();
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    const world = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const hud = new THREE.Group();
    const hudLabel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    excludeFromWaterCapture(hud);
    hud.add(hudLabel);
    scene.add(water, world, hud);
    hud.visible = true;
    hudLabel.visible = true;

    const renderer = mockCaptureRenderer();
    vi.mocked(renderer.render).mockImplementation(() => {
      expect(hud.visible).toBe(false);
    });

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const optics = new WaterOptics();
    optics.render(renderer, scene, camera, water, 0);

    expect(hud.visible).toBe(true);
    expect(hudLabel.visible).toBe(true);
    expect(renderer.render).toHaveBeenCalled();
    optics.dispose();
  });

  it('restores visibility and renderer clipping when render throws', () => {
    const renderer = mockCaptureRenderer({ throwOnRender: true });
    const baselinePlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 2)];
    renderer.clippingPlanes = baselinePlanes;
    renderer.localClippingEnabled = false;

    const scene = new THREE.Scene();
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    const hud = new THREE.Group();
    excludeFromWaterCapture(hud);
    scene.add(water, hud);
    hud.visible = true;

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const optics = new WaterOptics();
    expect(() => optics.render(renderer, scene, camera, water, 0)).toThrow('render failed');
    expect(hud.visible).toBe(true);
    expect(renderer.localClippingEnabled).toBe(false);
    expect(renderer.clippingPlanes).toStrictEqual(baselinePlanes);
    optics.dispose();
  });
});

describe('reflectedCamera', () => {
  it('reflects perspective cameras about a non-zero surface height', () => {
    const source = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    source.position.set(2, 10, -4);
    source.lookAt(0, 2, 0);
    source.updateMatrixWorld(true);

    const reflected = reflectedCamera(source, 2);
    expect(reflected.position.x).toBeCloseTo(2, 5);
    expect(reflected.position.y).toBeCloseTo(2 * 2 - 10, 5);
    expect(reflected.position.z).toBeCloseTo(-4, 5);
  });

  it('clones orthographic map cameras without changing depth encoding', () => {
    const source = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
    source.position.set(0, 50, 0);
    source.lookAt(0, 0, 0);
    source.updateMatrixWorld(true);

    const reflected = reflectedCamera(source, 1.5);
    expect(reflected).toBeInstanceOf(THREE.OrthographicCamera);
    expect(reflected.position.y).toBeCloseTo(2 * 1.5 - 50, 5);

    const optics = new WaterOptics();
    expect(optics.refraction.depthTexture?.type).toBe(THREE.UnsignedIntType);
    expect(optics.refraction.depthTexture?.minFilter).toBe(THREE.NearestFilter);
    expect(optics.refraction.depthTexture?.magFilter).toBe(THREE.NearestFilter);
    optics.dispose();
  });
});
