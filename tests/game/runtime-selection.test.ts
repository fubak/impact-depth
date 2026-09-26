import { describe, expect, it } from 'vitest';
import { parseRuntimeSelection, selectQualityFromCapabilities } from '../../src/core/runtime-selection';

describe('selectQualityFromCapabilities', () => {
  // Table test over inputs: device capabilities to expected quality
  const testCases = [
    // Low-end: deviceMemory <= 4
    { caps: { deviceMemory: 4 }, want: 'low' as const, desc: 'deviceMemory=4' },
    { caps: { deviceMemory: 3 }, want: 'low' as const, desc: 'deviceMemory=3' },
    { caps: { deviceMemory: 1 }, want: 'low' as const, desc: 'deviceMemory=1' },
    // Low-end: hardwareConcurrency <= 4
    { caps: { hardwareConcurrency: 4 }, want: 'low' as const, desc: 'hardwareConcurrency=4' },
    { caps: { hardwareConcurrency: 2 }, want: 'low' as const, desc: 'hardwareConcurrency=2' },
    { caps: { hardwareConcurrency: 1 }, want: 'low' as const, desc: 'hardwareConcurrency=1' },
    // Low-end: mobile
    { caps: { isMobile: true }, want: 'low' as const, desc: 'isMobile=true' },
    // High-end: all above thresholds, not mobile
    { caps: { deviceMemory: 8, hardwareConcurrency: 8, isMobile: false }, want: 'high' as const, desc: 'high-end desktop' },
    { caps: { deviceMemory: 16, hardwareConcurrency: 16, isMobile: false }, want: 'high' as const, desc: 'very high-end desktop' },
    // Mixed: some conditions met
    { caps: { deviceMemory: 2, hardwareConcurrency: 8, isMobile: false }, want: 'low' as const, desc: 'low memory + high concurrency' },
    { caps: { deviceMemory: 8, hardwareConcurrency: 2, isMobile: false }, want: 'low' as const, desc: 'high memory + low concurrency' },
    { caps: { deviceMemory: 8, hardwareConcurrency: 8, isMobile: true }, want: 'low' as const, desc: 'high specs but mobile' },
    // Default (empty/undefined): should default to high
    { caps: {}, want: 'high' as const, desc: 'empty capabilities' },
    // Undefined values individually
    { caps: { deviceMemory: undefined }, want: 'high' as const, desc: 'undefined deviceMemory' },
    { caps: { hardwareConcurrency: undefined }, want: 'high' as const, desc: 'undefined hardwareConcurrency' },
    { caps: { isMobile: undefined }, want: 'high' as const, desc: 'undefined isMobile' },
  ];

  testCases.forEach(({ caps, want, desc }) => {
    it(`[${desc}] returns low when needed`, () => {
      const result = selectQualityFromCapabilities(caps);
      expect(result).toBe(want);
    });
  });

  it('prioritizes deviceMemory over other factors', () => {
    expect(selectQualityFromCapabilities({ deviceMemory: 2, hardwareConcurrency: 16 })).toBe('low');
  });

  it('prioritizes hardwareConcurrency when deviceMemory is above threshold', () => {
    expect(selectQualityFromCapabilities({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe('low');
  });

  it('respects mobile even when memory and concurrency are high', () => {
    expect(
      selectQualityFromCapabilities({
        deviceMemory: 16,
        hardwareConcurrency: 16,
        isMobile: true,
      }),
    ).toBe('low');
  });
});

describe('parseRuntimeSelection', () => {
  it('defaults to spectral, legacy-v1, high with no params and no low-end device', () => {
    expect(parseRuntimeSelection('', { deviceMemory: 8, hardwareConcurrency: 8, isMobile: false })).toEqual({
      ocean: 'spectral',
      world: 'legacy-v1',
      quality: 'high',
      qualityForced: false,
      diagnostics: [],
    });
  });

  it('selects low quality when device memory is <= 4, no ?quality= param', () => {
    expect(parseRuntimeSelection('', { deviceMemory: 4 }).quality).toBe('low');
    expect(parseRuntimeSelection('', { deviceMemory: 4 }).qualityForced).toBe(false);
  });

  it('selects low quality when hardware concurrency is <= 4, no ?quality= param', () => {
    expect(parseRuntimeSelection('', { hardwareConcurrency: 2 }).quality).toBe('low');
    expect(parseRuntimeSelection('', { hardwareConcurrency: 2 }).qualityForced).toBe(false);
  });

  it('selects low quality when UA is mobile, no ?quality= param', () => {
    expect(parseRuntimeSelection('', { isMobile: true }).quality).toBe('low');
    expect(parseRuntimeSelection('', { isMobile: true }).qualityForced).toBe(false);
  });

  it('?quality= param overrides low-end device detection', () => {
    // Even with low-end device, explicit param wins
    expect(parseRuntimeSelection('?quality=high', { deviceMemory: 2 }).quality).toBe('high');
    expect(parseRuntimeSelection('?quality=high', { deviceMemory: 2 }).qualityForced).toBe(true);

    expect(parseRuntimeSelection('?quality=medium', { hardwareConcurrency: 1 }).quality).toBe('medium');
    expect(parseRuntimeSelection('?quality=medium', { hardwareConcurrency: 1 }).qualityForced).toBe(true);
  });

  it('keeps spectral when ocean param is omitted but other params exist', () => {
    expect(parseRuntimeSelection('?world=legacy-v1', { deviceMemory: 8 }).ocean).toBe('spectral');
  });

  it('selects gerstner only when asked', () => {
    expect(parseRuntimeSelection('?ocean=gerstner', { deviceMemory: 8 }).ocean).toBe('gerstner');
  });

  it('accepts explicit spectral + littoral-v2 + medium', () => {
    const parsed = parseRuntimeSelection('?ocean=spectral&world=littoral-v2&quality=medium', {
      deviceMemory: 2, // low-end, but explicit param wins
    });
    expect(parsed.ocean).toBe('spectral');
    expect(parsed.world).toBe('littoral-v2');
    expect(parsed.quality).toBe('medium');
    expect(parsed.qualityForced).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('falls back with diagnostics for unknown values, using capability-based quality', () => {
    const parsed = parseRuntimeSelection('ocean=fft&world=v9&quality=ultra', {
      deviceMemory: 2, // low-end
    });
    expect(parsed.ocean).toBe('gerstner');
    expect(parsed.world).toBe('legacy-v1');
    expect(parsed.quality).toBe('low'); // based on deviceMemory
    expect(parsed.qualityForced).toBe(false);
    expect(parsed.diagnostics.join(' ')).toMatch(/unknown ocean/);
    expect(parsed.diagnostics.join(' ')).toMatch(/unknown world/);
    expect(parsed.diagnostics.join(' ')).toMatch(/unknown quality=ultra/);
  });

  it('handles mixed param validity: known ocean, unknown quality, uses capabilities for quality', () => {
    const parsed = parseRuntimeSelection('?ocean=gerstner&quality=invalid', {
      hardwareConcurrency: 4,
    });
    expect(parsed.ocean).toBe('gerstner');
    expect(parsed.quality).toBe('low'); // from capabilities
    expect(parsed.qualityForced).toBe(false);
  });
});
