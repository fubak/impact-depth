import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { getTerrain, hullDepthLimit, isCrushedBySeamount } from '../../src/game/sim/world';

describe('seamount clearance', () => {
  it('a deep order over a seamount stops at the crush ceiling and deals no damage', () => {
    let state = startMission(createGame(7));
    const terrain = getTerrain(state.terrainSeed);
    const sub = state.submarine;
    let cell: { x: number; y: number } | null = null;
    for (let y = 2; y < 126 && !cell; y += 2) {
      for (let x = 2; x < 126 && !cell; x += 2) {
        if (isCrushedBySeamount(terrain, x, y, 0.72)) cell = { x, y };
      }
    }
    expect(cell).not.toBeNull();
    state = {
      ...state,
      ships: [],
      autopilot: { ...state.autopilot, enabled: false, tactic: 'manual' },
      submarine: {
        ...sub,
        x: cell!.x,
        y: cell!.y,
        z: 0.5,
        targetDepth: 0.72,
        hp: 100,
        invuln: 0,
        speed: 0,
        targetSpeed: 0,
        speedOrder: 'stop',
      },
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.submarine.hp).toBe(100);
    expect(
      isCrushedBySeamount(terrain, state.submarine.x, state.submarine.y, state.submarine.z),
    ).toBe(false);
    expect(state.submarine.z).toBeLessThanOrEqual(
      hullDepthLimit(terrain, state.submarine.x, state.submarine.y) + 1e-6,
    );
  });
});
