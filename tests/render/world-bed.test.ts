import { describe, expect, it } from 'vitest';
import { ISLAND_SPECS, sampleSeabedY } from '../../src/core/terrain';
import { sampleLittoralBedMetres } from '../../src/game/world/littoral';
import { getWorld } from '../../src/game/world/queries';
import {
  PRESENTATION_BED_CLEARANCE_M,
  clampPresentationY,
  presentationBedY,
} from '../../src/render/presentation/world-bed';

describe('presentation bed authority', () => {
  it('uses the active littoral-v2 bed instead of the legacy sampler on cay peaks', () => {
    const cay = ISLAND_SPECS[0]!;
    const v2 = presentationBedY('littoral-v2', 19, cay.cx, cay.cz);
    const legacy = sampleSeabedY(cay.cx, cay.cz);
    const world = getWorld('littoral-v2', 19);
    expect(v2).toBeCloseTo(sampleLittoralBedMetres(world, cay.cx, cay.cz), 5);
    expect(v2).not.toBeCloseTo(legacy, 1);
    expect(v2).toBeGreaterThan(0);
    expect(legacy).toBeLessThan(0);
  });

  it('keeps legacy-v1 on the look-dev seabed sampler', () => {
    expect(presentationBedY('legacy-v1', 19, 0, 18)).toBeCloseTo(sampleSeabedY(0, 18), 5);
  });

  it('clamps a hull to the active bed plus clearance without poisoning non-finite Y', () => {
    expect(clampPresentationY(-2, 1)).toBeCloseTo(1 + PRESENTATION_BED_CLEARANCE_M);
    expect(clampPresentationY(4, 1)).toBe(4);
    expect(Number.isFinite(clampPresentationY(Number.NaN, 1))).toBe(true);
  });
});
