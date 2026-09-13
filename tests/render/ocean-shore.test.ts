import { describe, expect, it } from 'vitest';
import { islandShoreUniforms, snappedFollowPosition } from '../../src/render/ocean';
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

describe('snappedFollowPosition', () => {
  it('does not crawl the tessellation grid every metre of vessel motion', () => {
    const first = snappedFollowPosition(0, 0, 40, -20, 16, 1.6);
    expect(first.x).toBe(48);
    expect(first.z).toBe(-16);
    const held = snappedFollowPosition(first.x, first.z, 44, -18, 16, 1.6);
    expect(held).toEqual(first);
    const moved = snappedFollowPosition(first.x, first.z, 80, 40, 16, 1.6);
    expect(moved.x).not.toBe(first.x);
  });
});
