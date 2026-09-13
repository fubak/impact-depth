import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pickSkyLightingSource } from '../../src/render/environment/sky-source';
import { skyLightingSignature } from '../../src/render/environment/sky-lighting';

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
