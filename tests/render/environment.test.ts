import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnvironmentController } from '../../src/render/environment/controller';
import { applySpectralMapUniforms } from '../../src/render/ocean';
import type {
  EnvironmentBackend,
  EnvironmentDiagnostics,
  EnvironmentFrame,
  EnvironmentQuality,
  OceanBackendName,
} from '../../src/render/environment/types';

class FakeBackend implements EnvironmentBackend {
  readonly name: OceanBackendName;
  disposed = 0;
  resets: number[] = [];
  prepares = 0;
  constructor(name: OceanBackendName) {
    this.name = name;
  }
  prepare(_frame: EnvironmentFrame): void {
    this.prepares += 1;
  }
  renderPasses(): void {}
  resize(_width: number, _height: number, _dpr: number): void {}
  setQuality(_profile: EnvironmentQuality): void {}
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

describe('EnvironmentController', () => {
  it('cancels in-flight init and disposes the partial backend', async () => {
    const gerstner = new FakeBackend('gerstner');
    const partial: FakeBackend[] = [];
    const controller = new EnvironmentController({
      backend: gerstner,
      factory: async (name) => {
        const next = new FakeBackend(name);
        partial.push(next);
        await new Promise((resolve) => setTimeout(resolve, 15));
        return next;
      },
    });
    const abort = new AbortController();
    const pending = controller.activate('spectral', abort.signal);
    abort.abort();
    await pending;
    expect(controller.current).toBe(gerstner);
    expect(partial[0]?.disposed).toBeGreaterThanOrEqual(1);
    expect(controller.getDiagnostics().fallbackReason).toBe('init cancelled');
  });

  it('falls back to gerstner when spectral construction fails', async () => {
    const gerstner = new FakeBackend('gerstner');
    const replacements: FakeBackend[] = [];
    const controller = new EnvironmentController({
      backend: gerstner,
      requestedBackend: 'spectral',
      factory: async (name) => {
        if (name === 'spectral') throw new Error('no float targets');
        const next = new FakeBackend('gerstner');
        replacements.push(next);
        return next;
      },
    });
    await controller.activate('spectral', new AbortController().signal);
    expect(controller.getDiagnostics().requestedBackend).toBe('spectral');
    expect(controller.getDiagnostics().backend).toBe('gerstner');
    expect(controller.getDiagnostics().fallbackReason).toBe('no float targets');
    expect(controller.current).toBe(gerstner);
    expect(replacements).toHaveLength(0);
  });

  it('resets mission generation on the active backend', () => {
    const gerstner = new FakeBackend('gerstner');
    const controller = new EnvironmentController({
      backend: gerstner,
      factory: async (name) => new FakeBackend(name),
    });
    controller.reset(7);
    expect(gerstner.resets).toEqual([7]);
    expect(controller.getDiagnostics().missionGeneration).toBe(7);
  });

  it('repeated dispose is safe and does not use a disposed backend', () => {
    const gerstner = new FakeBackend('gerstner');
    const controller = new EnvironmentController({
      backend: gerstner,
      factory: async (name) => new FakeBackend(name),
    });
    controller.dispose();
    controller.dispose();
    expect(gerstner.disposed).toBe(1);
    controller.prepare(frame());
    expect(gerstner.prepares).toBe(0);
  });

  it('does not own the injected renderer handle (factory receives abort only)', async () => {
    const renderer = { id: 'injected-renderer' };
    const gerstner = new FakeBackend('gerstner');
    const seen: unknown[] = [];
    const controller = new EnvironmentController({
      backend: gerstner,
      factory: async (name, signal) => {
        seen.push({ name, aborted: signal.aborted, renderer });
        if (name === 'spectral') throw new Error('spectral backend not implemented');
        return new FakeBackend('gerstner');
      },
    });
    await controller.activate('spectral', new AbortController().signal);
    expect(seen[0]).toMatchObject({ name: 'spectral', aborted: false, renderer });
    expect(controller.current).toBe(gerstner);
  });

  it('reports not ready when the inner backend is not ready', () => {
    class NotReady extends FakeBackend {
      getDiagnostics(): EnvironmentDiagnostics {
        return { ...super.getDiagnostics(), ready: false };
      }
    }
    const backend = new NotReady('spectral');
    const controller = new EnvironmentController({
      backend,
      requestedBackend: 'spectral',
      factory: async (name) => new FakeBackend(name),
    });
    expect(controller.getDiagnostics()).toMatchObject({
      backend: 'spectral',
      requestedBackend: 'spectral',
      ready: false,
    });
  });

  it('stays not ready until context resources are rebuilt and preserves mission generation', async () => {
    const original = new FakeBackend('gerstner');
    const replacement = new FakeBackend('gerstner');
    let finish!: (backend: EnvironmentBackend) => void;
    const controller = new EnvironmentController({
      backend: original,
      factory: () =>
        new Promise<EnvironmentBackend>((resolve) => {
          finish = resolve;
        }),
    });
    controller.reset(11);
    controller.invalidateForContextLoss();
    expect(controller.getDiagnostics()).toMatchObject({
      ready: false,
      recoveryStatus: 'lost',
      missionGeneration: 11,
    });

    const pending = controller.recover(new AbortController().signal);
    expect(controller.getDiagnostics()).toMatchObject({
      ready: false,
      recoveryStatus: 'rebuilding',
    });
    finish(replacement);
    await pending;

    expect(controller.current).toBe(replacement);
    expect(replacement.resets).toEqual([11]);
    expect(original.disposed).toBe(1);
    expect(controller.getDiagnostics()).toMatchObject({
      ready: true,
      recoveryStatus: 'ready',
      missionGeneration: 11,
    });
  });
});

describe('Ocean spectral texture bind', () => {
  it('toggles FFT maps without dropping Gerstner uniforms', () => {
    const dummy = new THREE.Texture();
    const tex = new THREE.Texture();
    const uniforms = {
      uSpectral: { value: 0 },
      uDisplacement0: { value: dummy },
      uDisplacement1: { value: dummy },
      uDisplacement2: { value: dummy },
      uSlope0: { value: dummy },
      uSlope1: { value: dummy },
      uSlope2: { value: dummy },
      uCascadeLength: { value: new THREE.Vector3(1, 1, 1) },
      uCascadeSize: { value: new THREE.Vector3(1, 1, 1) },
      uWaveAmp: { value: new THREE.Vector4(0.4, 0.3, 0.2, 0.1) },
    };
    applySpectralMapUniforms(uniforms, dummy, {
      displacements: [tex, tex, tex],
      slopes: [tex, tex, tex],
      lengths: [1792, 211, 27.3],
      sizes: [128, 256, 128],
    });
    expect(uniforms.uSpectral.value).toBe(1);
    expect(uniforms.uDisplacement0.value).toBe(tex);
    expect(uniforms.uSlope1.value).toBe(tex);
    expect(uniforms.uCascadeLength.value.x).toBe(1792);
    expect(uniforms.uCascadeLength.value.y).toBe(211);
    expect(uniforms.uCascadeSize.value.y).toBe(256);
    expect(uniforms.uWaveAmp.value.x).toBe(0.4);
    applySpectralMapUniforms(uniforms, dummy, null);
    expect(uniforms.uSpectral.value).toBe(0);
    expect(uniforms.uDisplacement0.value).toBe(dummy);
    dummy.dispose();
    tex.dispose();
  });
});
