import { describe, expect, it } from 'vitest';
import { defenseCallout } from '../../src/game/sim/defense-callout';
import { createGame, startMission } from '../../src/game/sim/api';

describe('defense callout', () => {
  it('ranks incoming above a lock and a search', () => {
    const state = startMission(createGame(19));
    const hunter = {
      ...(state.ships.find((ship) => ship.kind !== 'merchant') ?? state.ships[0]!),
      kind: 'destroyer' as const,
      alert: 0.3,
      holdContact: 0,
    };
    const searching = {
      ...state,
      ships: [hunter],
    };
    expect(defenseCallout(searching)).toBe('SEARCH');
    const locked = {
      ...searching,
      ships: searching.ships.map((ship) =>
        ship.id === hunter.id ? { ...ship, alert: 0.6, holdContact: 2 } : ship,
      ),
    };
    expect(defenseCallout(locked)).toBe('LOCKED');
    const charge = {
      id: 'dc',
      kind: 'depthCharge' as const,
      sourceId: hunter.id,
      x: state.submarine.x + 4,
      y: state.submarine.y,
      z: 0.4,
      vx: 0,
      vy: 0,
      vz: 0,
      fuse: 2,
      damage: 10,
      radius: 1,
      targetDepth: 0.5,
    };
    expect(defenseCallout({ ...locked, depthCharges: [charge] })).toBe('INCOMING');
    const distant = {
      ...charge,
      id: 'far',
      x: state.submarine.x + 40,
      fuse: 12,
    };
    expect(defenseCallout({ ...locked, depthCharges: [distant] })).toBe('LOCKED');
  });
});
