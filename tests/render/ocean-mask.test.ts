import { describe, expect, it } from 'vitest';
import { LAND_LEVEL } from '../../src/game/sim/constants';
import { createLegacyWorld, legacyHeight } from '../../src/game/world/legacy';
import {
  maskWaveDisplacement,
  normalizedBedToMetres,
  packWorldHeightTexture,
  samplePackedBed,
  SHORE_WET_BAND_METRES,
  waterCoverageFromBed,
} from '../../src/render/environment/terrain-texture';
import { simToWorldMeters } from '../../src/render/presentation/coordinates';

describe('ocean land coverage mask', () => {
  it('zeros Gerstner displacement on land and never lifts onto the bed', () => {
    const displaced = 1.4;
    const inlandBed = 8;
    const masked = maskWaveDisplacement(0, displaced, inlandBed);
    expect(waterCoverageFromBed(inlandBed)).toBe(0);
    expect(masked).toBe(0);
    expect(masked).toBeLessThan(Math.max(displaced, inlandBed + 0.02));
  });

  it('preserves open-water displacement and keeps a wet band at the shoreline', () => {
    expect(waterCoverageFromBed(-20)).toBeCloseTo(1, 6);
    expect(maskWaveDisplacement(0, 1.4, -20)).toBeCloseTo(1.4, 6);
    const shore = waterCoverageFromBed(0);
    expect(shore).toBeGreaterThan(0);
    expect(shore).toBeLessThan(1);
    expect(SHORE_WET_BAND_METRES).toBe(6);
    expect(waterCoverageFromBed(SHORE_WET_BAND_METRES)).toBe(0);
  });

  it('masks packed CPU land cells for seed 19 without beach lift', () => {
    const world = createLegacyWorld(19);
    const packed = packWorldHeightTexture(world);
    let land: { x: number; y: number } | null = null;
    let water: { x: number; y: number } | null = null;
    for (let y = 0.5; y < world.size && (!land || !water); y += 1) {
      for (let x = 0.5; x < world.size && (!land || !water); x += 1) {
        const h = legacyHeight(world, x, y);
        if (!land && h >= LAND_LEVEL) land = { x, y };
        if (!water && h < LAND_LEVEL - 0.45) water = { x, y };
      }
    }
    expect(land).not.toBeNull();
    expect(water).not.toBeNull();
    const landWorld = simToWorldMeters(land!.x, land!.y);
    const waterWorld = simToWorldMeters(water!.x, water!.y);
    const landBed = samplePackedBed(packed, landWorld.x, landWorld.z);
    const waterBed = samplePackedBed(packed, waterWorld.x, waterWorld.z);
    expect(landBed).toBeGreaterThanOrEqual(0);
    expect(waterBed).toBeLessThan(0);
    expect(normalizedBedToMetres(legacyHeight(world, land!.x, land!.y))).toBeGreaterThanOrEqual(0);
    expect(waterCoverageFromBed(landBed)).toBeLessThan(0.15);
    const maskedLand = maskWaveDisplacement(0, 2, landBed);
    expect(maskedLand).toBeLessThan(0.3);
    expect(maskedLand).toBeLessThan(Math.max(2, landBed + 0.02));
    expect(maskWaveDisplacement(0, 2, waterBed)).toBeCloseTo(2, 6);
  });
});
