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
    const incoming = {
      ...locked,
      depthCharges: [
        {
          id: 'dc',
          kind: 'depthCharge' as const,
          sourceId: hunter.id,
          x: 0,
          y: 0,
          z: 0,
          vz: 0,
          fuse: 1,
          damage: 10,
          radius: 1,
          targetDepth: 0.5,
        },
      ],
    };
    expect(defenseCallout(incoming)).toBe('INCOMING');
  });
});
