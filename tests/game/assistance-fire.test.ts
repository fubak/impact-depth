import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  fireWeapon,
  setAutopilot,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import { presentationEvents } from '../../src/ui/error-toast';

function stepFor(
  seed: number,
  tactic: 'ambush' | 'intercept',
  assistance: boolean,
  seconds: number,
) {
  let state = startMission(createGame(seed));
  const target = state.ships.find((ship) => ship.kind === 'merchant') ?? state.ships[0]!;
  state = { ...state, assistanceAutoFire: assistance };
  state = setAutopilot(state, tactic, target.id);
  const ammo = state.submarine.torpedoes;
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let index = 0; index < steps; index += 1) state = updateGame(state, [], FIXED_DT);
  return { state, ammo };
}

describe('player firing authority', () => {
  it('does not spend ammunition for ambush or intercept when assistance is off', () => {
    for (const tactic of ['ambush', 'intercept'] as const) {
      for (const seed of [1, 19, 42]) {
        const { state, ammo } = stepFor(seed, tactic, false, 25);
        expect(state.stats.torpedoesFired, `${tactic} ${seed}`).toBe(0);
        expect(state.submarine.torpedoes, `${tactic} ${seed}`).toBe(ammo);
        expect(state.submarine.seekers, `${tactic} ${seed}`).toBe(state.submarine.maxSeekers);
      }
    }
  }, 30_000);

  it('still fires a manual shot when assistance is off', () => {
    let state = startMission(createGame(19));
    state = {
      ...state,
      assistanceAutoFire: false,
      submarine: { ...state.submarine, z: 0.5, targetDepth: 0.5, reloadMk14: 0 },
    };
    const before = state.submarine.torpedoes;
    state = fireWeapon(state);
    expect(state.stats.torpedoesFired).toBe(1);
    expect(state.submarine.torpedoes).toBe(before - 1);
  });

  it('stops further automatic shots after assistance is turned off', () => {
    let state = startMission(createGame(1));
    const target = state.ships.find((ship) => ship.kind === 'merchant') ?? state.ships[0]!;
    state = setAutopilot(state, 'ambush', target.id);
    const steps = Math.ceil(20 / FIXED_DT);
    for (let index = 0; index < steps && state.stats.torpedoesFired === 0; index += 1) {
      state = updateGame(state, [], FIXED_DT);
    }
    expect(state.stats.torpedoesFired).toBeGreaterThan(0);
    const ammo = state.submarine.torpedoes;
    const fired = state.stats.torpedoesFired;
    state = { ...state, assistanceAutoFire: false };
    for (let index = 0; index < steps; index += 1) state = updateGame(state, [], FIXED_DT);
    expect(state.stats.torpedoesFired).toBe(fired);
    // A sunk ship can restock a tube. Assistance-off must not spend one.
    expect(state.submarine.torpedoes).toBeGreaterThanOrEqual(ammo);
  }, 30_000);
});

describe('wreck events under reduced motion', () => {
  it('drops flashes and keeps the sink', () => {
    const events = [{ type: 'torpedoHit' }, { type: 'shipSunk' }];
    expect(presentationEvents(events, false).map((event) => event.type)).toEqual(['shipSunk']);
    expect(presentationEvents(events, true)).toHaveLength(2);
  });
});
