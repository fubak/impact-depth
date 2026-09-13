import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EnvironmentController } from '../../src/render/environment/controller';
import type {
  EnvironmentBackend,
  EnvironmentDiagnostics,
  EnvironmentFrame,
  EnvironmentQuality,
  OceanBackendName,
} from '../../src/render/environment/types';
import {
  createFloatTarget,
  disposeMaterial,
  disposeTarget,
  disposeTexture,
  replaceOwnedResources,
  resizeTarget,
  SimulationPass,
  validateFloatFramebuffer,
  withRendererPass,
} from '../../src/render/ocean/resources';
import { fftSizeForQuality, spectralFftSizeForQuality } from '../../src/render/ocean/spectrum';
import { QUALITY_PROFILES, QualityGovernor } from '../../src/render/quality';

class FakeBackend implements EnvironmentBackend {
  readonly name: OceanBackendName;
  disposed = 0;
  resets: number[] = [];
  resizes: Array<{ width: number; height: number; dpr: number }> = [];
  qualities: EnvironmentQuality[] = [];
  prepares = 0;
  constructor(name: OceanBackendName) {
    this.name = name;
  }
  prepare(_frame: EnvironmentFrame): void {
    this.prepares += 1;
  }
  renderPasses(): void {}
  resize(width: number, height: number, dpr: number): void {
    this.resizes.push({ width, height, dpr });
  }
  setQuality(profile: EnvironmentQuality): void {
    this.qualities.push(profile);
  }
  reset(missionGeneration: number): void {
    this.resets.push(missionGeneration);
  }
  getDiagnostics(): EnvironmentDiagnostics {
    return {
      backend: this.name,
      requestedBackend: this.name,
      ready: this.disposed === 0,
      fallbackReason: null,
      missionGeneration: this.resets.at(-1) ?? 0,
      worldVersion: 'legacy-v1',
    };
  }
  dispose(): void {
    this.disposed += 1;
  }
}

function frame(): EnvironmentFrame {
  return {
    time: 1,
    dt: 1 / 60,
    paused: false,
    ocean: {
      seaState: 0.3,
      waveHeight: 0.5,
      choppiness: 0.4,
      deepColor: '#000',
      shallowColor: '#0ff',
      foamAmount: 0.1,
      clarity: 0.7,
      absorption: 0.3,
    },
    fogDensity: 0.001,
    fogColor: { r: 1, g: 1, b: 1 },
    sunDir: { x: 0, y: 1, z: 0 },
    sunColor: { r: 1, g: 1, b: 1 },
    skyColor: { r: 0.2, g: 0.4, b: 0.8 },
    sandColorHex: '#d9c39a',
    followX: 0,
    followZ: 0,
    readability: { clarity: 0.8, absorption: 0.2 },
    wakes: [],
  };
}

describe('quality profiles vs spectral FFT sizes', () => {
  it('matches spectrum.ts low/medium/high cascade sizes', () => {
    for (const name of ['low', 'medium', 'high'] as const) {
      expect(QUALITY_PROFILES[name].spectralFftSize).toEqual(spectralFftSizeForQuality(name));
      expect(QUALITY_PROFILES[name].spectralFftSize.wind).toBe(fftSizeForQuality(name, 'wind'));
    }
  });

  it('defines every presentation cost owned by one profile', () => {
    for (const profile of Object.values(QUALITY_PROFILES)) {
      expect(profile).toMatchObject({
        dpr: expect.any(Number),
        waterSegments: expect.any(Number),
        shadowCadence: expect.any(Number),
        particleCap: expect.any(Number),
        vegetationDensity: expect.any(Number),
        vegetationLodDistance: expect.any(Number),
        opticsScale: expect.any(Number),
        opticsCadence: expect.any(Number),
        foamScale: expect.any(Number),
        foamCadence: expect.any(Number),
        causticsScale: expect.any(Number),
        causticsCadence: expect.any(Number),
      });
      expect(Object.values(profile.spectralCadence).every((value) => value >= 1)).toBe(true);
    }
  });
});

describe('QualityGovernor forced URL quality', () => {
  it('stays fixed when locked even under slow frames', () => {
    const governor = new QualityGovernor({ initial: 'high', locked: true });
    for (let i = 0; i < 40; i++) governor.update(40, 0.2);
    expect(governor.current).toBe('high');
  });

  it('still steps high→medium→low when unlocked', () => {
    const governor = new QualityGovernor({ initial: 'high', locked: false });
    for (let i = 0; i < 45; i++) governor.update(16, 0.2);
    expect(governor.current).toBe('high');
    for (let i = 0; i < 20; i++) governor.update(40, 0.2);
    expect(governor.current).toBe('medium');
    for (let i = 0; i < 55; i++) governor.update(40, 0.2);
    expect(governor.current).toBe('medium');
    for (let i = 0; i < 30; i++) governor.update(50, 0.2);
    expect(governor.current).toBe('low');
  });
});

describe('environment resource lifecycle without WebGL', () => {
  it('dispose twice, reset, and resize cycles return to a stable baseline', () => {
    const gerstner = new FakeBackend('gerstner');
    const controller = new EnvironmentController({
      backend: gerstner,
      factory: async (name) => new FakeBackend(name),
    });
    for (let i = 1; i <= 20; i++) controller.reset(i);
    expect(gerstner.resets).toHaveLength(20);
    expect(controller.getDiagnostics().missionGeneration).toBe(20);

    for (let i = 0; i < 20; i++) {
      controller.resize(800 + i, 600 + i, 1);
      controller.setQuality(i % 2 === 0 ? 'high' : 'medium');
      controller.prepare(frame());
    }
    expect(gerstner.resizes).toHaveLength(20);
    expect(gerstner.qualities).toHaveLength(20);
    expect(gerstner.prepares).toBe(20);

    controller.dispose();
    controller.dispose();
    expect(gerstner.disposed).toBe(1);
    controller.prepare(frame());
    expect(gerstner.prepares).toBe(20);
  });

  it('float targets and simulation passes dispose twice and survive resize cycles', () => {
    const target = createFloatTarget({ width: 16, height: 16 });
    expect(target.width).toBe(16);
    for (const size of [32, 64, 48, 16]) resizeTarget(target, size, size);
    expect(target.width).toBe(16);
    disposeTarget(target);
    disposeTarget(target);

    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    disposeTexture(texture);
    disposeTexture(texture);

    const material = new THREE.MeshBasicMaterial();
    disposeMaterial(material);
    disposeMaterial(material);

    const pass = new SimulationPass();
    pass.dispose();
    pass.dispose();
  });

  it('atomically replaces and disposes owned resource generations', () => {
    type Resource = { generation: number; disposed: number };
    const disposed: Resource[] = [];
    let active: Resource = { generation: 0, disposed: 0 };
    for (let generation = 1; generation <= 20; generation++) {
      active = replaceOwnedResources(
        active,
        () => ({ generation, disposed: 0 }),
        (next) => {
          active = next;
        },
        (old) => {
          old.disposed += 1;
          disposed.push(old);
        },
      );
    }
    expect(active.generation).toBe(20);
    expect(disposed).toHaveLength(20);
    expect(disposed.every((resource) => resource.disposed === 1)).toBe(true);
  });

  it('keeps the prior resources when replacement binding fails', () => {
    const original = { id: 'original', disposed: 0 };
    const replacement = { id: 'replacement', disposed: 0 };
    let active = original;
    expect(() =>
      replaceOwnedResources(
        original,
        () => replacement,
        (next) => {
          active = next;
          if (next === replacement) throw new Error('bind failed');
        },
        (resource) => {
          resource.disposed += 1;
        },
      ),
    ).toThrow('bind failed');
    expect(active).toBe(original);
    expect(original.disposed).toBe(0);
    expect(replacement.disposed).toBe(1);
  });
});

function mockRenderer(framebufferStatus: number): THREE.WebGLRenderer {
  const gl = {
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    NO_ERROR: 0,
    checkFramebufferStatus: vi.fn(() => framebufferStatus),
    getError: vi.fn(() => 0),
  };
  let target: THREE.WebGLRenderTarget | null = null;
  return {
    extensions: { has: vi.fn(() => true) },
    getContext: vi.fn(() => gl),
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
    readRenderTargetPixels: vi.fn(),
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    localClippingEnabled: false,
    clippingPlanes: [],
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
    xr: { enabled: false },
  } as unknown as THREE.WebGLRenderer;
}

describe('float framebuffer validation and pass restoration', () => {
  it('checks completeness and readback on the actual bound target', () => {
    const renderer = mockRenderer(0x8cd5);
    expect(validateFloatFramebuffer(renderer)).toEqual({ supported: true, reason: null });
    expect(renderer.readRenderTargetPixels).toHaveBeenCalledOnce();
  });

  it('returns an explicit reason for an incomplete framebuffer', () => {
    const renderer = mockRenderer(0x8cd6);
    expect(validateFloatFramebuffer(renderer)).toMatchObject({
      supported: false,
      reason: expect.stringContaining('incomplete'),
    });
    expect(renderer.readRenderTargetPixels).not.toHaveBeenCalled();
  });

  it('restores renderer state when an auxiliary pass throws', () => {
    const renderer = mockRenderer(0x8cd5);
    expect(() =>
      withRendererPass(renderer, () => {
        renderer.autoClear = false;
        renderer.shadowMap.autoUpdate = false;
        throw new Error('pass failed');
      }),
    ).toThrow('pass failed');
    expect(renderer.autoClear).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null, 0, 0);
  });
});
