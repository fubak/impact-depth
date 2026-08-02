import { describe, expect, it } from 'vitest';
import {
  biomeColorWeights,
  generatePalmPlacements,
  generateShrubPlacements,
  islandBiome,
  ISLAND_MESH_RADIUS_FACTOR,
  ISLAND_SPECS,
  sampleIslandHeight,
  sampleSeabedY,
  valueNoise2,
} from '../src/core/terrain';

describe('Caribbean terrain helpers', () => {
  it('produces deterministic noise', () => {
    expect(valueNoise2(1.25, 3.5)).toBe(valueNoise2(1.25, 3.5));
  });

  it('keeps playable start area deep enough for a submerged sub', () => {
    const y = sampleSeabedY(0, 18);
    expect(y).toBeLessThan(-10);
    expect(y).toBeGreaterThan(-22);
  });

  it('builds island massing with beach and peak', () => {
    const spec = ISLAND_SPECS[0]!;
    const shelf = sampleIslandHeight(spec.radius * 1.15, 0, spec);
    const beach = sampleIslandHeight(spec.radius * 0.92, 0, spec);
    const peak = sampleIslandHeight(0, 0, spec);
    expect(shelf).toBeLessThan(1);
    expect(beach).toBeGreaterThan(-0.5);
    expect(peak).toBeGreaterThan(beach);
    expect(islandBiome(beach)).toMatch(/beach|grass|shelf/);
    expect(islandBiome(peak)).toMatch(/rock|grass/);
  });

  it('joins island apron to seabed without a cliff', () => {
    const spec = ISLAND_SPECS[0]!;
    const outerR = ISLAND_MESH_RADIUS_FACTOR;
    const outer = sampleIslandHeight(spec.radius * outerR, 0, spec);
    const mid = sampleIslandHeight(spec.radius * 1.35, 0, spec);
    const near = sampleIslandHeight(spec.radius * 1.08, 0, spec);
    const floor = sampleSeabedY(spec.cx + spec.radius * outerR, spec.cz);
    expect(Math.abs(outer - floor)).toBeLessThan(0.2);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(outer - 1);
    let maxStep = 0;
    for (let rr = 1.08; rr < outerR - 0.04; rr += 0.04) {
      const a = sampleIslandHeight(spec.radius * rr, 0, spec);
      const b = sampleIslandHeight(spec.radius * (rr + 0.04), 0, spec);
      maxStep = Math.max(maxStep, Math.abs(a - b));
    }
    expect(maxStep).toBeLessThan(2.4);
  });

  it('raises turquoise shallows near cays while keeping start deep', () => {
    const nearCay = sampleSeabedY(38 + 48, -55);
    const start = sampleSeabedY(0, 18);
    expect(nearCay).toBeGreaterThan(-12);
    expect(start).toBeLessThan(-11);
  });

  it('places denser palms only on grass with trunks above water', () => {
    const spec = ISLAND_SPECS[0]!;
    const palms = generatePalmPlacements(spec, 3.2);
    expect(palms.length).toBeGreaterThan(12);
    for (const p of palms) {
      expect(p.y).toBeGreaterThan(1.2);
      expect(islandBiome(p.y)).toBe('grass');
      expect(p.kind).toBe('palm');
    }
    expect(generatePalmPlacements(spec, 3.2)).toEqual(palms);
  });

  it('places shrubs/canopy clusters deterministically', () => {
    const spec = ISLAND_SPECS[0]!;
    const shrubs = generateShrubPlacements(spec, 2.4);
    expect(shrubs.length).toBeGreaterThan(10);
    expect(generateShrubPlacements(spec, 2.4)).toEqual(shrubs);
  });

  it('smooths biome color weights across beach and grass', () => {
    const beach = biomeColorWeights(1.0);
    const grass = biomeColorWeights(5.0);
    expect(beach.beach).toBeGreaterThan(0.35);
    expect(grass.grass).toBeGreaterThan(0.5);
  });

  it('exposes at least two near-field island specs', () => {
    expect(ISLAND_SPECS.length).toBeGreaterThanOrEqual(2);
    expect(ISLAND_SPECS.some((s) => s.cx > 0)).toBe(true);
  });
});
