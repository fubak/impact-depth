import { describe, expect, it } from 'vitest';
import {
  BEAUFORT_MAX,
  beaufortFromWind,
  fullyDevelopedHs,
  peakPeriod,
  seaStateFromWind,
  significantWaveHeight,
  whitecapCoverage,
  windFromBeaufort,
  windFromSeaState,
} from '../../src/core/sea-model';

const within1pct = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(0.01);

// Reference table: independently computed from the plan formulas
// Hs = 0.0214 U^2 (x0.6 fetch), Tp = 0.7303 * 1.026 * U, W = 3.84e-6 * U^3.41.
const TABLE = [
  { u: 3, hsFull: 0.1926, tp: 2.2479, w: 1.6267e-4 },
  { u: 6, hsFull: 0.7704, tp: 4.4957, w: 1.7291e-3 },
  { u: 10, hsFull: 2.14, tp: 7.4929, w: 9.8703e-3 },
  { u: 15, hsFull: 4.815, tp: 11.2393, w: 3.9337e-2 },
  { u: 20, hsFull: 8.56, tp: 14.9858, w: 0.104916 },
];

describe('A1 - physical wave model matches the plan formulas', () => {
  for (const row of TABLE) {
    it(`U = ${row.u} m/s`, () => {
      within1pct(fullyDevelopedHs(row.u), row.hsFull);
      within1pct(significantWaveHeight(row.u), row.hsFull * 0.6);
      within1pct(significantWaveHeight(row.u, 1), row.hsFull);
      within1pct(peakPeriod(row.u), row.tp);
      within1pct(whitecapCoverage(row.u), row.w);
    });
  }

  it('fetch factor scales Hs linearly and defaults to 0.6', () => {
    expect(significantWaveHeight(10)).toBeCloseTo(significantWaveHeight(10, 0.6), 12);
    expect(significantWaveHeight(10, 0.3)).toBeCloseTo(fullyDevelopedHs(10) * 0.3, 12);
  });

  it('is zero in a dead calm and whitecaps stay in 0..1', () => {
    expect(significantWaveHeight(0)).toBe(0);
    expect(whitecapCoverage(0)).toBe(0);
    expect(whitecapCoverage(1000)).toBe(1);
    expect(whitecapCoverage(-5)).toBe(0);
  });

  it('is monotone increasing in wind', () => {
    let hs = -1;
    let tp = -1;
    let w = -1;
    for (let u = 0; u <= 30; u += 0.5) {
      expect(significantWaveHeight(u)).toBeGreaterThanOrEqual(hs);
      expect(peakPeriod(u)).toBeGreaterThanOrEqual(tp);
      expect(whitecapCoverage(u)).toBeGreaterThanOrEqual(w);
      hs = significantWaveHeight(u);
      tp = peakPeriod(u);
      w = whitecapCoverage(u);
    }
  });
});

describe('A2 - Beaufort / wind / sea state mapping', () => {
  it('maps the published band edges', () => {
    expect(beaufortFromWind(0)).toBe(0);
    expect(beaufortFromWind(0.4)).toBe(0);
    expect(beaufortFromWind(0.5)).toBe(1);
    expect(beaufortFromWind(1.6)).toBe(2);
    expect(beaufortFromWind(3.4)).toBe(3);
    expect(beaufortFromWind(5.5)).toBe(4);
    expect(beaufortFromWind(8)).toBe(5);
    expect(beaufortFromWind(10.8)).toBe(6);
    expect(beaufortFromWind(13.9)).toBe(7);
    expect(beaufortFromWind(17.2)).toBe(8);
    expect(beaufortFromWind(20.8)).toBe(9);
    expect(beaufortFromWind(60)).toBe(BEAUFORT_MAX);
  });

  it('covers 0..9 and is monotone', () => {
    const seen = new Set<number>();
    let previous = -1;
    for (let u = 0; u <= 30; u += 0.1) {
      const b = beaufortFromWind(u);
      expect(b).toBeGreaterThanOrEqual(previous);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(9);
      seen.add(b);
      previous = b;
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('windFromBeaufort round-trips through beaufortFromWind', () => {
    for (let b = 0; b <= 9; b++) expect(beaufortFromWind(windFromBeaufort(b))).toBe(b);
  });

  it('windFromBeaufort is strictly increasing and clamps out-of-range input', () => {
    for (let b = 1; b <= 9; b++)
      expect(windFromBeaufort(b)).toBeGreaterThan(windFromBeaufort(b - 1));
    expect(windFromBeaufort(-3)).toBe(windFromBeaufort(0));
    expect(windFromBeaufort(40)).toBe(windFromBeaufort(9));
  });

  it('seaStateFromWind is monotone, 0 at calm, 1 at Beaufort 9+', () => {
    expect(seaStateFromWind(0)).toBe(0);
    expect(seaStateFromWind(-2)).toBe(0);
    expect(seaStateFromWind(20.8)).toBe(1);
    expect(seaStateFromWind(40)).toBe(1);
    let previous = -1;
    for (let u = 0; u <= 25; u += 0.1) {
      const s = seaStateFromWind(u);
      expect(s).toBeGreaterThanOrEqual(previous);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      previous = s;
    }
  });

  it('is consistent with the look-dev presets (light-moderate seas 0.26-0.42)', () => {
    // A light breeze (Beaufort 3) is the default sector sea.
    const light = seaStateFromWind(windFromBeaufort(3));
    expect(light).toBeGreaterThan(0.2);
    expect(light).toBeLessThan(0.45);
    // A storm reads as the existing 'storm' preset threshold (>= 0.6).
    expect(seaStateFromWind(19)).toBeGreaterThanOrEqual(0.6);
  });

  it('windFromSeaState round-trips', () => {
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const clamped = Math.min(1, s);
      expect(seaStateFromWind(windFromSeaState(clamped))).toBeCloseTo(clamped, 9);
    }
    expect(windFromSeaState(0)).toBe(0);
    expect(windFromSeaState(-1)).toBe(0);
    expect(windFromSeaState(2)).toBeCloseTo(windFromSeaState(1), 12);
  });
});
