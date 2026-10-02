import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { clampDepth } from '../../src/game/sim/coords';
import { DEPTH_TARGET, WORLD_SIZE } from '../../src/game/sim/constants';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { getTerrain, isLand, SEAMOUNT_CRUSH_DEPTH, terrainHeight } from '../../src/game/sim/world';

describe('deep order over a shoal', () => {
  it('stops above the rock instead of crushing the hull', () => {
    let state = startMission(createGame(19));
    const terrain = getTerrain(state.terrainSeed);
    let spot: { x: number; y: number } | null = null;
    for (let x = 4; x < WORLD_SIZE - 4 && !spot; x += 1) {
      for (let y = 4; y < WORLD_SIZE - 4; y += 1) {
        if (isLand(terrain, x, y)) continue;
        const floor = clampDepth(1 - terrainHeight(terrain, x, y) + 0.2);
        if (floor > SEAMOUNT_CRUSH_DEPTH + 0.05 && floor < DEPTH_TARGET.deep - 0.05) {
          spot = { x, y };
          break;
        }
      }
    }
    // The dive only matters where rock rises into the Deep band; that must exist in the seeded world.
    expect(spot).not.toBeNull();
    state = {
      ...state,
      ships: [],
      submarine: {
        ...state.submarine,
        x: spot!.x,
        y: spot!.y,
        z: DEPTH_TARGET.attack,
        targetDepth: DEPTH_TARGET.deep,
        speed: 0,
        targetSpeed: 0,
        invuln: 0,
        hp: 100,
      },
    };
    for (let i = 0; i < Math.ceil(20 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      expect(state.submarine.hp).toBe(100);
    }
    expect(state.submarine.targetDepth).toBeLessThan(DEPTH_TARGET.deep);
  });
});
