import { describe, expect, it } from 'vitest';
import { adaptToLookDevSim } from '../../src/game/adapt/lookdev';
import { createGame, startMission } from '../../src/game/sim/api';

describe('look-dev elite flag (plan 030 P20)', () => {
  it('carries elite: true onto the surface ship snapshot', () => {
    const base = startMission(createGame(19));
    expect(base.ships.length).toBeGreaterThan(0);
    const state = {
      ...base,
      ships: base.ships.map((ship, index) => (index === 0 ? { ...ship, elite: true } : ship)),
    };
    const sim = adaptToLookDevSim(state);
    const eliteId = state.ships[0]!.id;
    const row = sim.ships.find((ship) => ship.id === eliteId);
    expect(row).toBeTruthy();
    expect(row!.elite).toBe(true);
  });

  it('omits the elite key on normal hulls', () => {
    const base = startMission(createGame(19));
    const sim = adaptToLookDevSim(base);
    expect(sim.ships.length).toBeGreaterThan(0);
    for (const row of sim.ships) {
      expect('elite' in row).toBe(false);
    }
  });
});
