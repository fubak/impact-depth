import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as THREE from 'three';
import { pickSkyLightingSource } from '../../src/render/environment/sky-source';
import {
  SkyLighting,
  skyLightingSignature,
  type SkyLightingState,
} from '../../src/render/environment/sky-lighting';
import { buildSkyLightingState } from '../../src/render/environment/outdoor-lighting';

function state(overrides: Partial<Parameters<typeof skyLightingSignature>[0]> = {}) {
  return {
    sunDir: new THREE.Vector3(0.2, 0.9, 0.3).normalize(),
    sunColor: new THREE.Color(1, 0.9, 0.7),
    skyTop: new THREE.Color(0.2, 0.5, 0.9),
    skyHorizon: new THREE.Color(0.8, 0.9, 1),
    cloudCoverage: 0.5,
    lightning: 0,
    isNight: false,
    ...overrides,
  };
}

describe('procedural sky lighting key', () => {
  it('ignores sub-bin weather movement to bound PMREM refreshes', () => {
    expect(skyLightingSignature(state({ cloudCoverage: 0.5 }))).toBe(
      skyLightingSignature(state({ cloudCoverage: 0.51 })),
    );
  });

  it('changes for material day, weather, and lightning transitions', () => {
    const base = skyLightingSignature(state());
    expect(skyLightingSignature(state({ isNight: true }))).not.toBe(base);
    expect(skyLightingSignature(state({ cloudCoverage: 0.9 }))).not.toBe(base);
    expect(skyLightingSignature(state({ lightning: 1 }))).not.toBe(base);
  });
});

describe('pickSkyLightingSource', () => {
  it('uses hdr when the pack loaded and it is day', () => {
    expect(pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: false })).toBe(
      'hdr-pmrem',
    );
  });

  it('stays procedural when the pack is missing or failed', () => {
    expect(pickSkyLightingSource({ hdrReady: false, hdrFailed: false, isNight: false })).toBe(
      'procedural-sky-pmrem',
    );
    expect(pickSkyLightingSource({ hdrReady: false, hdrFailed: true, isNight: false })).toBe(
      'procedural-sky-pmrem',
    );
  });

  it('does not use the noon HDR at night', () => {
    expect(pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: true })).toBe(
      'procedural-sky-pmrem',
    );
  });

  it('drops the noon HDR in storm and at low sun', () => {
    expect(
      pickSkyLightingSource({
        hdrReady: true,
        hdrFailed: false,
        isNight: false,
        weatherPreset: 'storm',
      }),
    ).toBe('procedural-sky-pmrem');
    expect(
      pickSkyLightingSource({
        hdrReady: true,
        hdrFailed: false,
        isNight: false,
        sunY: 0.12,
      }),
    ).toBe('procedural-sky-pmrem');
  });
});

describe('plan 030 P08: overcast sky uses the procedural PMREM', () => {
  it('keeps the procedural sky under overcast or fog, and the HDR otherwise', () => {
    expect(
      pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: false, overcast: true }),
    ).toBe('procedural-sky-pmrem');
    expect(
      pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: false, overcast: false }),
    ).toBe('hdr-pmrem');
  });
});

/** Clear-sky noon input: the noon HDR would be picked for this unless overcast is set. */
function clearNoon(overrides: Partial<SkyLightingState> = {}): SkyLightingState {
  return {
    sunDir: new THREE.Vector3(0.2, 0.9, 0.3).normalize(),
    sunColor: new THREE.Color(1, 0.94, 0.81),
    skyTop: new THREE.Color(0.24, 0.62, 0.89),
    skyHorizon: new THREE.Color(0.84, 0.94, 1),
    cloudCoverage: 0.3,
    lightning: 0,
    isNight: false,
    weatherPreset: 'calm',
    ...overrides,
  };
}

function fakeTarget(): THREE.WebGLRenderTarget {
  return { texture: new THREE.Texture(), dispose: () => undefined } as unknown as THREE.WebGLRenderTarget;
}

/** Texture of the most recent PMREM target produced by a spied generator method. */
function lastTexture(spy: { mock: { results: Array<{ value: unknown }> } }): THREE.Texture {
  const value = spy.mock.results.at(-1)?.value as { texture: THREE.Texture } | undefined;
  if (!value) throw new Error('no PMREM target was generated');
  return value.texture;
}

describe('plan 030 P08 follow-up: overcast reaches scene.environment', () => {
  let scene: THREE.Scene;
  let lighting: SkyLighting;
  let fromEquirectangular: MockInstance;
  let fromScene: MockInstance;

  beforeEach(() => {
    // The PMREM generator needs a real GL context; stub the GPU work and keep the wiring real.
    vi.spyOn(THREE.PMREMGenerator.prototype, 'compileCubemapShader').mockImplementation(
      () => undefined,
    );
    vi.spyOn(THREE.PMREMGenerator.prototype, 'compileEquirectangularShader').mockImplementation(
      () => undefined,
    );
    fromEquirectangular = vi
      .spyOn(THREE.PMREMGenerator.prototype, 'fromEquirectangular')
      .mockImplementation(() => fakeTarget());
    fromScene = vi
      .spyOn(THREE.PMREMGenerator.prototype, 'fromScene')
      .mockImplementation(() => fakeTarget());
    vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose').mockImplementation(() => undefined);
    scene = new THREE.Scene();
    const renderer = { compile: () => undefined } as unknown as THREE.WebGLRenderer;
    // Zero cadence so the signature check alone decides whether the procedural PMREM refreshes.
    lighting = new SkyLighting(renderer, scene, 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function bindNoonHdr(): THREE.Texture {
    lighting.bindHdrEquirect(new THREE.Texture());
    return lastTexture(fromEquirectangular);
  }

  it('uses the noon HDR for a clear noon sky without the overcast flag (baseline)', () => {
    const hdrEnvironment = bindNoonHdr();
    lighting.update(clearNoon(), 0, true);
    expect(lighting.getDiagnostics().source).toBe('hdr-pmrem');
    expect(scene.environment).toBe(hdrEnvironment);
  });

  it('switches scene.environment to the procedural PMREM under overcast, even with the HDR bound', () => {
    const hdrEnvironment = bindNoonHdr();
    lighting.update(clearNoon({ overcast: true }), 0, true);
    expect(lighting.getDiagnostics().source).toBe('procedural-sky-pmrem');
    expect(scene.environment).toBe(lastTexture(fromScene));
    expect(scene.environment).not.toBe(hdrEnvironment);
  });

  it('keeps the HDR pick when overcast is explicitly false or left undefined', () => {
    const hdrEnvironment = bindNoonHdr();
    lighting.update(clearNoon({ overcast: false }), 0, true);
    expect(lighting.getDiagnostics().source).toBe('hdr-pmrem');
    expect(scene.environment).toBe(hdrEnvironment);

    lighting.update(clearNoon({ overcast: undefined }), 1, true);
    expect(lighting.getDiagnostics().source).toBe('hdr-pmrem');
    expect(scene.environment).toBe(hdrEnvironment);
  });

  it('keeps the overcast flag across a second update with the same input', () => {
    bindNoonHdr();
    lighting.update(clearNoon({ overcast: true }), 0, true);
    const procedural = lastTexture(fromScene);

    // Same signature, no force: this takes the early-return path and must still honour the flag.
    const refreshed = lighting.update(clearNoon({ overcast: true }), 1);
    expect(refreshed).toBe(false);
    expect(lighting.getDiagnostics().source).toBe('procedural-sky-pmrem');
    expect(scene.environment).toBe(procedural);
  });

  it('carries the overcast flag through the outdoor lighting state builder', () => {
    const atmosphere = {
      sunDir: new THREE.Vector3(0.2, 0.9, 0.3).normalize(),
      sunColor: new THREE.Color(1, 0.94, 0.81),
      moonDir: new THREE.Vector3(-0.2, -0.9, -0.3),
      fogColor: new THREE.Color(0.84, 0.93, 1),
      skyTop: new THREE.Color(0.24, 0.62, 0.89),
      skyHorizon: new THREE.Color(0.84, 0.94, 1),
      ambient: 0.78,
      isNight: false,
      sunElevation: 64,
      golden: 0,
      twilight: 0,
    };
    expect(
      buildSkyLightingState({ atmosphere, cloudCoverage: 0.3, lightning: 0, overcast: true }).overcast,
    ).toBe(true);
    expect(
      buildSkyLightingState({ atmosphere, cloudCoverage: 0.3, lightning: 0 }).overcast,
    ).toBeFalsy();
  });
});
