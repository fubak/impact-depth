import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { chaseDepth, hullDepth } from '../../src/game/sim/systems';

describe('torpedo depth chase', () => {
  it('dives a straight Mk-14 onto a submarine and stays level without a target', () => {
    expect(hullDepth('sub')).toBeGreaterThan(hullDepth('merchant'));
    const stepped = chaseDepth(0.5, 0.32, 0.1);
    expect(stepped).toBeLessThan(0.5);
    expect(stepped).toBeGreaterThan(0.32);

    let state = startMission(createGame(19));
    const sub = state.ships.find((ship) => ship.kind === 'sub');
    expect(sub).toBeDefined();
    state = {
      ...state,
      selectedTargetId: sub!.id,
      submarine: {
        ...state.submarine,
        x: sub!.x - 6,
        y: sub!.y,
        z: 0.5,
        heading: 0,
        reloadMk14: 0,
        torpedoes: 4,
      },
      weaponMode: 'torpedo',
    };
    state = updateGame(state, [{ type: 'fireWeapon' }], FIXED_DT);
    const launched = state.torpedoes.find((torpedo) => torpedo.owner === 'player');
    expect(launched).toBeDefined();
    const startZ = launched!.z;
    let fish = launched!;
    for (let step = 0; step < 90 && state.ships.some((ship) => ship.id === sub!.id); step += 1) {
      state = updateGame(state, [], FIXED_DT);
      fish = state.torpedoes.find((torpedo) => torpedo.id === launched!.id) ?? fish;
    }
    expect(fish.z).toBeLessThan(startZ);
    expect(Math.abs(fish.z - hullDepth('sub'))).toBeLessThan(0.08);
  });
});
