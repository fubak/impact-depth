import { describe, expect, it } from 'vitest';
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
  resizeTarget,
  SimulationPass,
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
});

describe('QualityGovernor forced URL quality', () => {
  it('stays fixed when locked even under slow frames', () => {
    const governor = new QualityGovernor({ initial: 'high', locked: true });
    for (let i = 0; i < 40; i++) governor.update(40, 0.2);
    expect(governor.current).toBe('high');
  });

  it('still steps high→medium→low when unlocked', () => {
    const governor = new QualityGovernor({ initial: 'high', locked: false });
    for (let i = 0; i < 20; i++) governor.update(40, 0.2);
    expect(governor.current).toBe('medium');
    for (let i = 0; i < 20; i++) governor.update(40, 0.2);
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
});
