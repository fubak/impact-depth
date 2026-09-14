import { describe, expect, it } from 'vitest';
import { SPECTRAL_LOOKDOWN_BLEND } from '../../src/render/ocean';
import {
  SAMPLE_WORLD_FOAM_GLSL,
  WORLD_FOAM_DERIVE_GLSL,
  WORLD_FOAM_NEAR_EXTENT_M,
  WORLD_FOAM_WIDE_EXTENT_M,
} from '../../src/render/ocean/world-foam';
import { CREST_SPRAY_UPDATE_GLSL } from '../../src/render/ocean/crest-spray';

describe('world-space shoreline foam', () => {
  it('advects, deposits, and drains instead of summing cascade foam', () => {
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('previousAt');
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('exp(-uDelta / max(life, 0.08))');
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('deposited');
    expect(WORLD_FOAM_WIDE_EXTENT_M).toBe(760);
    expect(WORLD_FOAM_NEAR_EXTENT_M).toBe(128);
  });

  it('dies faster on land and deposits mainly in the 0.2–12 m surf band', () => {
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('bed > 0');
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('land * 10.0');
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('smoothstep(0.2, 0.9, depth)');
    expect(WORLD_FOAM_DERIVE_GLSL).toContain('smoothstep(8.0, 12.0, depth)');
  });

  it('samples a wide plus near field in the ocean shader', () => {
    expect(SAMPLE_WORLD_FOAM_GLSL).toContain('uWorldFoamWide');
    expect(SAMPLE_WORLD_FOAM_GLSL).toContain('uWorldFoamNear');
    expect(SAMPLE_WORLD_FOAM_GLSL).toContain('sampleWorldFoam');
  });
});

describe('GPU crest spray', () => {
  it('respawns slots at breaking crests and rock impacts', () => {
    expect(CREST_SPRAY_UPDATE_GLSL).toContain('compression');
    expect(CREST_SPRAY_UPDATE_GLSL).toContain('impact');
    expect(CREST_SPRAY_UPDATE_GLSL).toContain('probability');
    expect(CREST_SPRAY_UPDATE_GLSL).toContain('uEmitter');
  });
});

describe('depth-dependent Caribbean body', () => {
  it('darkens offshore nadir instead of milking the tactical look-down', () => {
    expect(SPECTRAL_LOOKDOWN_BLEND).toBeLessThan(0.3);
    expect(SPECTRAL_LOOKDOWN_BLEND).toBeGreaterThan(0.1);
  });
});
