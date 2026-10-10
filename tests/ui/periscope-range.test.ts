import { describe, expect, it } from 'vitest';
import { METERS_PER_UNIT } from '../../src/game/sim/constants';
import { nearestRangeUnits } from '../../src/ui/periscope';

const vessel = { x: 0, z: 0, heading: 0 };
const ship = (x: number, z: number) => ({ x, z, speed: 0 });

describe('periscope range readout', () => {
  it('reports sim units (what the rest of the HUD shows), not render metres', () => {
    const metres = 22 * METERS_PER_UNIT;
    const range = nearestRangeUnits(vessel, [ship(metres, 0)], 0);
    expect(range?.units).toBeCloseTo(22, 5);
  });

  it('ignores contacts outside the look cone and returns null when none is in view', () => {
    expect(nearestRangeUnits(vessel, [ship(0, 100)], 0)).toBeNull();
    expect(nearestRangeUnits(vessel, [], 0)).toBeNull();
  });

  it('picks the nearest contact inside the cone', () => {
    const range = nearestRangeUnits(vessel, [ship(500, 0), ship(100, 0)], 0);
    expect(range?.units).toBeCloseTo(100 / METERS_PER_UNIT, 5);
  });

  it('follows the look direction, not the hull heading', () => {
    expect(nearestRangeUnits(vessel, [ship(0, 100)], Math.PI / 2)?.units).toBeCloseTo(20, 5);
  });
});
