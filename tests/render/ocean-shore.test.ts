import { describe, expect, it } from 'vitest';
import { islandShoreUniforms } from '../../src/render/ocean';
import { ISLAND_SPECS } from '../../src/core/terrain';

describe('islandShoreUniforms', () => {
  it('packs the three cay discs for the shoreline depth field', () => {
    const packed = islandShoreUniforms(ISLAND_SPECS);
    expect(packed.a.x).toBe(ISLAND_SPECS[0]!.cx);
    expect(packed.a.y).toBe(ISLAND_SPECS[0]!.cz);
    expect(packed.a.z).toBe(ISLAND_SPECS[0]!.radius);
    expect(packed.a.w).toBe(ISLAND_SPECS[0]!.peak);
    expect(packed.b.z).toBeGreaterThan(0);
    expect(packed.c.z).toBeGreaterThan(0);
  });

  it('zeros unused island slots', () => {
    const packed = islandShoreUniforms([{ cx: 10, cz: -20, radius: 30, peak: 12 }]);
    expect(packed.a.z).toBe(30);
    expect(packed.b.z).toBe(0);
    expect(packed.c.z).toBe(0);
  });
});
