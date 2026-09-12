import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { FIXED_DT } from '../../src/core/sim';
import { getTerrain, isLand } from '../../src/game/sim/world';
import { makeClear, shipClearRadius } from '../../src/game/sim/pathfinding';

describe('surface ship land avoidance', () => {
  it('keeps wave ships off land during a short cruise', () => {
    let state = startMission(createGame(19));
    const terrain = getTerrain(state.terrainSeed);
    for (let i = 0; i < Math.ceil(90 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
    }
    for (const ship of state.ships) {
      if (ship.sinking !== undefined) continue;
      const clear = makeClear(terrain, shipClearRadius(ship.kind));
      expect(isLand(terrain, ship.x, ship.y)).toBe(false);
      expect(clear(ship.x, ship.y)).toBe(true);
    }
  });
});
