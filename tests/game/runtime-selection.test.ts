import { describe, expect, it } from 'vitest';
import { parseRuntimeSelection } from '../../src/core/runtime-selection';

describe('parseRuntimeSelection', () => {
  it('defaults to gerstner, legacy-v1, high with no params', () => {
    expect(parseRuntimeSelection('')).toEqual({
      ocean: 'gerstner',
      world: 'legacy-v1',
      quality: 'high',
      qualityForced: false,
      diagnostics: [],
    });
  });

  it('accepts explicit spectral + littoral-v2 + medium', () => {
    const parsed = parseRuntimeSelection('?ocean=spectral&world=littoral-v2&quality=medium');
    expect(parsed.ocean).toBe('spectral');
    expect(parsed.world).toBe('littoral-v2');
    expect(parsed.quality).toBe('medium');
    expect(parsed.qualityForced).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('falls back with diagnostics for unknown values', () => {
    const parsed = parseRuntimeSelection('ocean=fft&world=v9&quality=ultra');
    expect(parsed.ocean).toBe('gerstner');
    expect(parsed.world).toBe('legacy-v1');
    expect(parsed.quality).toBe('high');
    expect(parsed.qualityForced).toBe(false);
    expect(parsed.diagnostics.join(' ')).toMatch(/unknown ocean/);
    expect(parsed.diagnostics.join(' ')).toMatch(/unknown world/);
    expect(parsed.diagnostics.join(' ')).toMatch(/unknown quality/);
  });
});
