import { describe, expect, it } from 'vitest';
import { buildCoastalField } from '../../src/render/ocean/coastal';
import {
  buildPackedInitialSpectrum,
  cascadeSeed,
  createSpectrumRng,
  DEFAULT_CASCADES,
  DEFAULT_SPECTRUM_SEED,
  evolveMode,
  fftSizeForQuality,
  gaussian,
  jonswapDensity,
  peakOmega,
  samplePackedRgba,
  SPECTRUM_SAMPLE_GLSL,
  SPECTRUM_PACK_GLSL,
  waveVector,
  type CascadeSpec,
} from '../../src/render/ocean/spectrum';

const swell = DEFAULT_CASCADES[0]!;

function tinySpec(overrides: Partial<CascadeSpec> = {}): CascadeSpec {
  return { ...swell, ...overrides };
}

describe('spectrum rng and jonswap', () => {
  it('same seed yields the same uniform sequence', () => {
    const a = createSpectrumRng(19);
    const b = createSpectrumRng(19);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('different seeds diverge', () => {
    const a = createSpectrumRng(19);
    const b = createSpectrumRng(77);
    expect(a()).not.toBe(b());
  });

  it('gaussian is deterministic for a given rng stream', () => {
    const a = createSpectrumRng(DEFAULT_SPECTRUM_SEED);
    const b = createSpectrumRng(DEFAULT_SPECTRUM_SEED);
    expect(gaussian(a)).toBe(gaussian(b));
    expect(gaussian(a)).toBe(gaussian(b));
  });

  it('jonswap density is finite, zero at k=0, and peaks near the peak omega', () => {
    const omegaP = peakOmega();
    const kPeak = (omegaP * omegaP) / 9.81;
    expect(jonswapDensity(0, omegaP)).toBe(0);
    const peak = jonswapDensity(kPeak, omegaP);
    const tail = jonswapDensity(kPeak * 8, omegaP);
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeGreaterThan(tail);
    expect(peak).toBeGreaterThan(0);
  });

  it('keeps swell, wind, and chop as independent cascade inputs', () => {
    expect(DEFAULT_CASCADES.map((c) => c.role)).toEqual(['swell', 'wind', 'chop']);
    expect(DEFAULT_CASCADES[0]!.length).toBeGreaterThan(DEFAULT_CASCADES[1]!.length);
    expect(DEFAULT_CASCADES[1]!.length).toBeGreaterThan(DEFAULT_CASCADES[2]!.length);
    expect(fftSizeForQuality('high', 'wind')).toBe(256);
    expect(fftSizeForQuality('high', 'swell')).toBe(128);
    expect(fftSizeForQuality('low', 'chop')).toBe(64);
    expect(cascadeSeed(7, 'swell')).not.toBe(cascadeSeed(7, 'wind'));
  });
});

describe('packed initial spectrum', () => {
  it('is bit-identical for the same seed and independent of time', () => {
    const params = { spec: tinySpec(), fftSize: 16, seed: 19 };
    const a = buildPackedInitialSpectrum(params);
    const b = buildPackedInitialSpectrum(params);
    expect(a.initial).toEqual(b.initial);
    expect(a.fftSize).toBe(16);
    expect(a.initial.length).toBe(16 * 16 * 4);
  });

  it('changes when the seed changes', () => {
    const spec = tinySpec();
    const a = buildPackedInitialSpectrum({ spec, fftSize: 16, seed: 19 });
    const b = buildPackedInitialSpectrum({ spec, fftSize: 16, seed: 20 });
    expect(a.initial.some((value, i) => value !== b.initial[i])).toBe(true);
  });

  it('does not read a shared rng stream across builds', () => {
    const spec = tinySpec();
    buildPackedInitialSpectrum({ spec, fftSize: 8, seed: 3 });
    const first = buildPackedInitialSpectrum({ spec, fftSize: 8, seed: 3 });
    const second = buildPackedInitialSpectrum({ spec, fftSize: 8, seed: 3 });
    expect(first.initial).toEqual(second.initial);
  });
});

describe('spectrum time evolution', () => {
  it('is deterministic for explicit seed and time', () => {
    const packed = buildPackedInitialSpectrum({ spec: tinySpec(), fftSize: 16, seed: 77 });
    const { kx, kz } = waveVector(3, 5, packed.fftSize, packed.length);
    const initial = samplePackedRgba(packed, 3, 5);
    const a = evolveMode(initial, kx, kz, 4.25);
    const b = evolveMode(initial, kx, kz, 4.25);
    expect(a).toEqual(b);
    expect(Number.isFinite(a.heightRe)).toBe(true);
  });

  it('changes with time for an energetic mode', () => {
    const packed = buildPackedInitialSpectrum({ spec: tinySpec(), fftSize: 16, seed: 77 });
    let found = false;
    for (let z = 0; z < packed.fftSize && !found; z++) {
      for (let x = 0; x < packed.fftSize; x++) {
        const initial = samplePackedRgba(packed, x, z);
        if (initial.every((c) => Math.abs(c) < 1e-12)) continue;
        const { kx, kz } = waveVector(x, z, packed.fftSize, packed.length);
        const t0 = evolveMode(initial, kx, kz, 0);
        const t1 = evolveMode(initial, kx, kz, 1.7);
        expect(t0.heightRe !== t1.heightRe || t0.heightIm !== t1.heightIm).toBe(true);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('returns a zero mode at the DC bin', () => {
    const packed = buildPackedInitialSpectrum({ spec: tinySpec(), fftSize: 8, seed: 1 });
    const evolved = evolveMode(samplePackedRgba(packed, 0, 0), 0, 0, 12);
    expect(evolved).toMatchObject({ heightRe: 0, heightIm: 0, dispX: 0, dispZ: 0, omega: 0 });
  });
});

describe('spectrum sampling GLSL', () => {
  it('samples cascade displacement and slope with tile-length uniforms', () => {
    expect(SPECTRUM_SAMPLE_GLSL).toContain('uDisplacement0');
    expect(SPECTRUM_SAMPLE_GLSL).toContain('uSlope0');
    expect(SPECTRUM_SAMPLE_GLSL).toContain('uCascadeLength');
    expect(SPECTRUM_SAMPLE_GLSL).toContain('spectralDisplacement');
    expect(SPECTRUM_SAMPLE_GLSL).toContain('spectralSlope');
    expect(SPECTRUM_SAMPLE_GLSL).not.toContain('1100.0');
  });

  it('packs Tessendorf lambda below the folding threshold that makes honeycomb plates', () => {
    expect(SPECTRUM_PACK_GLSL).toContain('min(0.72, pow(uGain, .75)) * 0.40');
    expect(SPECTRUM_PACK_GLSL).not.toContain('min(1.15, pow(uGain, .75)) * 0.72');
  });
});

describe('coastal field (cpu, injected terrain)', () => {
  it('uses caller extents instead of the demo 1100 m world', () => {
    const extent = 64;
    const field = buildCoastalField((x, z) => (Math.hypot(x - 8, z - 8) < 6 ? 4 : -12), {
      originX: 0,
      originZ: 0,
      extent,
      resolution: 16,
    });
    expect(field.extent).toBe(64);
    expect(field.originX).toBe(0);
    expect(field.data.length).toBe(16 * 16 * 4);
    expect(field.data.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('is deterministic for the same injected bed', () => {
    const sample = (x: number, _z: number) => -6 + Math.sin(x * 0.2) * 2;
    const config = { originX: -20, originZ: -20, extent: 40, resolution: 12 } as const;
    const a = buildCoastalField(sample, config);
    const b = buildCoastalField(sample, config);
    expect(a.data).toEqual(b.data);
  });
});
