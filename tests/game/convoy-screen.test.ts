import { describe, expect, it } from 'vitest';
import { screenIntent } from '../../src/game/sim/convoy-screen';
import { createGame, startMission } from '../../src/game/sim/api';
import { seedWave } from '../../src/game/sim/create';
import { roveLegs, ROVE_RADIUS } from '../../src/game/sim/transit-route';
import { WORLD_CENTER } from '../../src/game/sim/constants';
import { shipMaxSpeed } from '../../src/game/sim/sonar';

const stateWith = (wave: number) => ({ ...startMission(createGame(7)), ships: seedWave(7, wave) });

describe('convoy screen station keeping', () => {
  it('returns null for a ship with no live anchor', () => {
    const state = stateWith(2);
    const lead = state.ships[0]!;
    expect(screenIntent(lead, state)).toBeNull();
  });

  it('holds the convoy heading and a sane speed when sitting in the slot', () => {
    const state = stateWith(2);
    const escort = state.ships.find((ship) => ship.formationRole)!;
    const anchor = state.ships[0]!;
    const cos = Math.cos(anchor.heading);
    const sin = Math.sin(anchor.heading);
    const along = escort.formationAlong ?? 0;
    const lateral = escort.formationLateral ?? 0;
    const placed = {
      ...escort,
      x: anchor.x + cos * along - sin * lateral,
      y: anchor.y + sin * along + cos * lateral,
    };
    const intent = screenIntent(placed, { ...state, time: 0 })!;
    expect(intent).not.toBeNull();
    expect(Math.abs(Math.atan2(Math.sin(intent.heading - anchor.heading), Math.cos(intent.heading - anchor.heading)))).toBeLessThan(0.6);
    expect(intent.speedFrac).toBeGreaterThan(0);
    expect(intent.speedFrac).toBeLessThanOrEqual(1);
    expect(intent.speedFrac * shipMaxSpeed[escort.kind]).toBeLessThan(anchor.speed * 1.5);
  });

  it('speeds up when the slot is far ahead and eases off when it is behind', () => {
    const state = stateWith(2);
    const escort = state.ships.find((ship) => ship.formationRole === 'wing')!;
    const anchor = state.ships[0]!;
    const behind = { ...escort, x: anchor.x - Math.cos(anchor.heading) * 30, y: anchor.y - Math.sin(anchor.heading) * 30 };
    const ahead = { ...escort, x: anchor.x + Math.cos(anchor.heading) * 30, y: anchor.y + Math.sin(anchor.heading) * 30 };
    const slow = screenIntent(ahead, state)!;
    const fast = screenIntent(behind, state)!;
    expect(fast.speedFrac).toBeGreaterThan(slow.speedFrac);
  });
});

describe('roving legs', () => {
  it('are two points on the rove circle and deterministic', () => {
    const legs = roveLegs(7, 2, 5);
    expect(legs).toHaveLength(2);
    expect(roveLegs(7, 2, 5)).toEqual(legs);
    for (const leg of legs) {
      expect(Math.hypot(leg.x - WORLD_CENTER, leg.y - WORLD_CENTER)).toBeCloseTo(ROVE_RADIUS, 6);
    }
  });
});
