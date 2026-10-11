import { describe, expect, it } from 'vitest';
import { seedWave } from '../../src/game/sim/create';
import { WORLD_CENTER, WORLD_SIZE } from '../../src/game/sim/constants';
import {
  COLUMN_LEAD,
  LANE_END_RADIUS,
  LANE_OFFSET_MIN,
  laneEntry,
  transitLane,
} from '../../src/game/sim/transit-route';

describe('transit lanes', () => {
  it('are deterministic and keep both ends inside the world', () => {
    for (const seed of [1, 7, 19, 42, 91]) {
      for (let wave = 1; wave <= 6; wave += 1) {
        for (const slot of [0, 1]) {
          const lane = transitLane(seed, wave, slot);
          expect(lane).toEqual(transitLane(seed, wave, slot));
          for (const end of [lane.a, lane.b]) {
            expect(end.x).toBeGreaterThan(0);
            expect(end.x).toBeLessThan(WORLD_SIZE);
            expect(end.y).toBeGreaterThan(0);
            expect(end.y).toBeLessThan(WORLD_SIZE);
            expect(Math.hypot(end.x - WORLD_CENTER, end.y - WORLD_CENTER)).toBeCloseTo(
              LANE_END_RADIUS,
              6,
            );
          }
          expect(Math.atan2(lane.b.y - lane.a.y, lane.b.x - lane.a.x)).toBeCloseTo(
            Math.atan2(Math.sin(lane.heading), Math.cos(lane.heading)),
            6,
          );
        }
      }
    }
  });

  it('never passes closer to the centre than the minimum offset', () => {
    const lane = transitLane(7, 2, 0);
    const length = Math.hypot(lane.b.x - lane.a.x, lane.b.y - lane.a.y);
    const closest = Math.abs(
      ((lane.b.x - lane.a.x) * (lane.a.y - WORLD_CENTER) -
        (lane.a.x - WORLD_CENTER) * (lane.b.y - lane.a.y)) /
        length,
    );
    expect(closest).toBeGreaterThanOrEqual(LANE_OFFSET_MIN - 1e-6);
  });

  it('puts the convoy lead on its lane, sailing along it, with a two-end route', () => {
    for (const wave of [1, 2, 3]) {
      const lead = seedWave(7, wave)[0]!;
      const lane = transitLane(7, wave, 0);
      expect(lead.heading).toBeCloseTo(lane.heading, 6);
      expect(lead.path).toHaveLength(2);
      const entry = laneEntry(lane, COLUMN_LEAD);
      expect(Math.hypot(lead.x - entry.x, lead.y - entry.y)).toBeLessThan(6);
    }
  });

  it('sends the battleship down the opposite side of the sector', () => {
    const ships = seedWave(7, 2);
    const battleship = ships.find((ship) => ship.kind === 'battleship')!;
    expect(battleship.path).toHaveLength(2);
    expect(battleship.heading).toBeCloseTo(transitLane(7, 2, 1).heading, 6);
  });
});
