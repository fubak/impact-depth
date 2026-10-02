import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  attachCausticLighting,
  CAUSTIC_HOOK_CACHE_KEY,
  CAUSTIC_PROJECT_GAIN,
  CAUSTIC_PROJECT_GLSL,
  CAUSTIC_SAMPLE_GLSL,
  CAUSTICS_PROFILES,
  type CausticFrame,
  causticAttenuation,
  receiverCausticEnergy,
  detachCausticLighting,
  followCellMetres,
  projectSunRayToBed,
  quantizeFollowRegion,
  rayAreaConcentration,
  receiverRoleGain,
  UnderwaterCaustics,
} from '../../src/render/ocean/caustics';

function frame(overrides: Partial<CausticFrame> = {}): CausticFrame {
  return {
    time: 1,
    dt: 1 / 60,
    followX: 12.4,
    followZ: -8.2,
    sunDir: { x: 0.25, y: 0.9, z: 0.2 },
    waveHeight: 0.5,
    maps: {
      displacements: [new THREE.DataTexture(new Float32Array(4), 1, 1)],
      slopes: [new THREE.DataTexture(new Float32Array(4), 1, 1)],
      lengths: [1792, 211, 27.3],
    },
    ...overrides,
  };
}

describe('caustic projection math', () => {
  it('concentrates when projected area shrinks and fades when it grows', () => {
    expect(rayAreaConcentration(4, 4)).toBeCloseTo(1, 5);
    expect(rayAreaConcentration(4, 1)).toBeGreaterThan(1);
    expect(rayAreaConcentration(4, 8)).toBeLessThan(1);
    expect(rayAreaConcentration(4, 0)).toBe(0);
  });

  it('projects a downward refracted sun ray onto the bed', () => {
    const hit = projectSunRayToBed({
      surface: new THREE.Vector3(0, 0.4, 0),
      normal: new THREE.Vector3(0.15, 0.98, 0).normalize(),
      sunDir: new THREE.Vector3(0.2, 0.95, 0.1).normalize(),
      bedY: -12,
    });
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.x)).toBeGreaterThan(0.01);
    expect(hit!.x).toBeLessThan(8);
  });

  it('shader source uses the shared surface field and refraction, not noise paint', () => {
    expect(CAUSTIC_PROJECT_GLSL).toContain('oceanDisplacement');
    expect(CAUSTIC_PROJECT_GLSL).toContain('refract(');
    expect(CAUSTIC_PROJECT_GLSL).toContain('concentration');
    expect(CAUSTIC_PROJECT_GLSL).not.toContain('snoise');
    expect(CAUSTIC_PROJECT_GLSL).not.toContain('sridge');
  });
});

describe('caustic attenuation and follow quantization', () => {
  it('dims with depth, cover, storm, and night', () => {
    const clear = causticAttenuation({
      depthMetres: 0,
      surfaceCover: 0,
      storm: 0,
      night: 0,
    });
    expect(
      causticAttenuation({ depthMetres: 24, surfaceCover: 0, storm: 0, night: 0 }),
    ).toBeLessThan(clear);
    expect(
      causticAttenuation({ depthMetres: 0, surfaceCover: 0.9, storm: 0, night: 0 }),
    ).toBeLessThan(clear);
    expect(
      causticAttenuation({ depthMetres: 0, surfaceCover: 0, storm: 1, night: 0 }),
    ).toBeLessThan(clear);
    expect(causticAttenuation({ depthMetres: 0, surfaceCover: 0, storm: 0, night: 1 })).toBe(0);
  });

  it('keeps nearby orbit samples on the same quantized cell', () => {
    const cell = followCellMetres('high', 'detail');
    const a = quantizeFollowRegion(cell * 3 + cell * 0.1, cell * 2 + cell * 0.1, cell);
    const b = quantizeFollowRegion(cell * 3 + cell * 0.3, cell * 2 + cell * 0.25, cell);
    expect(a).toEqual(b);
    const c = quantizeFollowRegion(cell * 5 + cell * 0.1, cell * 2 + cell * 0.1, cell);
    expect(c.x).not.toBe(a.x);
  });

  it('gives hulls no energy above water and less at -20 m than at -2 m', () => {
    const above = receiverCausticEnergy({ receiverY: 1, waterHeight: 0, role: 'hull' });
    const shallow = receiverCausticEnergy({ receiverY: -2, waterHeight: 0, role: 'hull' });
    const deep = receiverCausticEnergy({ receiverY: -20, waterHeight: 0, role: 'hull' });
    const bed = receiverCausticEnergy({ receiverY: -20, waterHeight: 0, role: 'seabed' });
    expect(above).toBe(0);
    expect(shallow).toBeGreaterThan(0.2);
    expect(deep).toBeLessThan(shallow);
    expect(bed).toBeGreaterThan(deep);
    expect(CAUSTIC_SAMPLE_GLSL).toContain('uCausticWaterHeight');
    expect(CAUSTIC_SAMPLE_GLSL).toContain('submergence');
  });

  it('assigns distinct receiver gains without extra program variants', () => {
    expect(receiverRoleGain('seabed')).toBeGreaterThan(1);
    expect(receiverRoleGain('seabed')).toBeGreaterThan(receiverRoleGain('hull'));
    expect(receiverRoleGain('weapon')).toBeLessThan(receiverRoleGain('rock'));
  });

  it('fully fades at night while staying strong at noon', () => {
    const noon = causticAttenuation({ depthMetres: 0, surfaceCover: 0, storm: 0, night: 0 });
    const dusk = causticAttenuation({ depthMetres: 0, surfaceCover: 0, storm: 0, night: 0.5 });
    const night = causticAttenuation({ depthMetres: 0, surfaceCover: 0, storm: 0, night: 1 });
    expect(noon).toBe(1);
    expect(dusk).toBeCloseTo(0.5, 5);
    expect(night).toBe(0);
  });
});

describe('UnderwaterCaustics lifecycle', () => {
  it('covers the follow seabed mesh so map POVs do not show a postage-stamp square', () => {
    expect(CAUSTICS_PROFILES.high.wideExtent).toBeGreaterThanOrEqual(440);
    expect(CAUSTIC_SAMPLE_GLSL).toContain('causticInside');
    expect(CAUSTIC_SAMPLE_GLSL).toContain('altitudeFade');
    expect(CAUSTIC_SAMPLE_GLSL).toContain('smoothstep(70.0, 120.0, cameraPosition.y)');
    expect(CAUSTIC_SAMPLE_GLSL).not.toContain(
      'clamp((world - origin) / max(extent, 1.0) + 0.5, 0.0, 1.0)',
    );
  });

  it('constructs quality-scaled wide and detail targets in linear color space', () => {
    const caustics = new UnderwaterCaustics('high');
    const high = CAUSTICS_PROFILES.high;
    expect(caustics.wide.width).toBe(high.wide);
    expect(caustics.detail.width).toBe(high.detail);
    expect(caustics.wide.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(caustics.detail.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(caustics.wide.texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    caustics.dispose();
  });

  it('resizes targets on quality change and survives dispose twice', () => {
    const caustics = new UnderwaterCaustics('high');
    caustics.setQuality('low');
    expect(caustics.wide.width).toBe(CAUSTICS_PROFILES.low.wide);
    expect(caustics.detail.width).toBe(CAUSTICS_PROFILES.low.detail);
    expect(caustics.getDiagnostics().quality).toBe('low');
    caustics.resize(1024, 700, 1.25);
    expect(caustics.wide.width).toBe(CAUSTICS_PROFILES.low.wide);
    caustics.dispose();
    caustics.dispose();
    expect(caustics.getDiagnostics().ready).toBe(false);
  });

  it('freezes history while paused and clears it on mission reset', () => {
    const caustics = new UnderwaterCaustics('medium');
    const live = frame();
    caustics.update(null, live);
    const afterLive = caustics.getDiagnostics().historyTime;
    expect(afterLive).toBeGreaterThan(0);
    caustics.update(null, { ...live, paused: true, dt: 1 });
    expect(caustics.getDiagnostics().historyTime).toBe(afterLive);
    expect(caustics.getDiagnostics().passCount).toBe(0);
    caustics.reset(4);
    expect(caustics.getDiagnostics().missionGeneration).toBe(4);
    expect(caustics.getDiagnostics().historyTime).toBe(0);
    expect(caustics.getDiagnostics().strength).toBe(0);
    caustics.dispose();
  });

  it('quantizes follow during update and zeros strength at night', () => {
    const caustics = new UnderwaterCaustics('high');
    caustics.update(null, frame({ followX: 12.4, followZ: -8.2 }));
    const first = caustics.getDiagnostics();
    caustics.update(null, frame({ followX: 12.45, followZ: -8.18 }));
    expect(caustics.getDiagnostics().followX).toBe(first.followX);
    expect(caustics.getDiagnostics().followZ).toBe(first.followZ);
    caustics.update(null, frame({ night: true }));
    expect(caustics.getDiagnostics().strength).toBe(0);
    caustics.dispose();
  });

  it('stays disabled without surface maps so Gerstner default is unchanged', () => {
    const caustics = new UnderwaterCaustics('high');
    caustics.update(null, frame({ maps: null }));
    expect(caustics.receiverUniforms.uCausticEnabled.value).toBe(0);
    caustics.dispose();
  });

  it('enables receiver sampling when spectral maps are present', () => {
    const caustics = new UnderwaterCaustics('high');
    caustics.update(null, frame());
    expect(caustics.receiverUniforms.uCausticEnabled.value).toBe(1);
    expect(caustics.getDiagnostics().strength).toBe(1);
    expect(CAUSTIC_PROJECT_GAIN).toBeGreaterThan(1);
    caustics.dispose();
  });

  it('preserves prior shader hooks, cache keys, color space, and normal maps', () => {
    const map = new THREE.Texture();
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map, normalMap });
    let previousCalls = 0;
    material.onBeforeCompile = (shader) => {
      previousCalls += 1;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\n// wind-hook',
      );
    };
    material.customProgramCacheKey = () => 'vegetation-wind-0.16';

    const caustics = new UnderwaterCaustics('medium');
    caustics.attachToMaterial(material, 'hull');
    caustics.attachToMaterial(material, 'hull');

    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>\nvoid main() {}',
      fragmentShader: '#include <common>\n#include <lights_fragment_end>\nvoid main() {}',
      uniforms: {},
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(previousCalls).toBe(1);
    expect(shader.vertexShader).toContain('wind-hook');
    expect(shader.vertexShader).toContain('vCausticWorld');
    expect(shader.fragmentShader).toContain('sampleProjectedCaustics');
    expect(shader.fragmentShader).toContain(
      'reflectedLight.directDiffuse += sampleProjectedCaustics(vCausticWorld)',
    );
    expect(shader.fragmentShader).not.toContain('diffuseColor.rgb * sampleProjectedCaustics');
    expect(material.customProgramCacheKey()).toContain('vegetation-wind-0.16');
    expect(material.customProgramCacheKey()).toContain(CAUSTIC_HOOK_CACHE_KEY);
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.normalMap).toBe(normalMap);

    detachCausticLighting(material);
    expect(material.customProgramCacheKey()).toBe('vegetation-wind-0.16');
    expect(material.userData.silentDepthsCaustics).toBeUndefined();

    attachCausticLighting(material, caustics.receiverUniforms, 'weapon');
    expect(material.customProgramCacheKey()).toContain(CAUSTIC_HOOK_CACHE_KEY);
    caustics.dispose();
    material.dispose();
    map.dispose();
    normalMap.dispose();
  });
});
