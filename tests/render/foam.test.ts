import { describe, expect, it } from 'vitest';
import { clearFoamTargets, FOAM_DERIVE_GLSL } from '../../src/render/ocean/foam';
import { SPECTRUM_DERIVE_GLSL } from '../../src/render/ocean/spectrum';
import { SURFACE_FUNCTIONS_GLSL } from '../../src/render/ocean/surface';

describe('foam derive GLSL', () => {
  it('shares one source of truth between foam.ts and spectrum.ts', () => {
    expect(SPECTRUM_DERIVE_GLSL).toBe(FOAM_DERIVE_GLSL);
  });

  it('derives foam from jacobian breaking and ping-pong history', () => {
    expect(FOAM_DERIVE_GLSL).toContain('jacobian');
    expect(FOAM_DERIVE_GLSL).toContain('uPrevious');
    expect(FOAM_DERIVE_GLSL).toContain('smoothstep');
    expect(FOAM_DERIVE_GLSL).toContain('uFoamStorm');
  });

  it('jitter advection instead of a fixed honeycomb lattice offset', () => {
    expect(FOAM_DERIVE_GLSL).toContain('foamHash');
    expect(FOAM_DERIVE_GLSL).toContain('uvA');
    expect(FOAM_DERIVE_GLSL).toContain('uvB');
    expect(FOAM_DERIVE_GLSL).not.toContain('vec2(1.9, .8)');
    expect(FOAM_DERIVE_GLSL).not.toMatch(/uv\s*-\s*vec2\(\s*1\.9/);
  });

  it('raises the breaking threshold so only sharp crests foam', () => {
    expect(FOAM_DERIVE_GLSL).toContain('smoothstep(.68, .94');
    expect(FOAM_DERIVE_GLSL).not.toContain('smoothstep(.50, .85');
    expect(FOAM_DERIVE_GLSL).not.toContain('smoothstep(.42, .72');
  });

  it('punches holes in jacobian basins so persistence cannot fill honeycomb plates', () => {
    expect(FOAM_DERIVE_GLSL).toContain('slopeBreak');
    expect(FOAM_DERIVE_GLSL).toContain('persist');
    expect(FOAM_DERIVE_GLSL).toContain('uv * 13.7');
    expect(FOAM_DERIVE_GLSL).toContain('foamPatch');
    expect(FOAM_DERIVE_GLSL).not.toMatch(/\bfloat patch\b/);
  });
});

describe('foam backend contract', () => {
  it('exports clearFoamTargets for history reset', () => {
    expect(typeof clearFoamTargets).toBe('function');
    expect(clearFoamTargets.length).toBe(3);
  });

  it('decay is faster in calm and slower in storm via uFoamStorm mix', () => {
    expect(FOAM_DERIVE_GLSL).toContain('mix(1.35, .55, clamp(uFoamStorm');
  });
});

describe('oceanFoam cascade mix', () => {
  it('weights chop foam over swell jacobian plates', () => {
    expect(SURFACE_FUNCTIONS_GLSL).toContain('swell * 0.05');
    expect(SURFACE_FUNCTIONS_GLSL).toContain('chop * 0.67');
    expect(SURFACE_FUNCTIONS_GLSL).not.toContain(') * 0.28');
  });
});
