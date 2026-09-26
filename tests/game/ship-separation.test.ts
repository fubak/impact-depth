import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { WORLD_CENTER } from '../../src/game/sim/constants';
import { shipClearRadius } from '../../src/game/sim/pathfinding';
import { separateShips } from '../../src/game/sim/ship-separation';
import type { Ship } from '../../src/game/sim/types';

function hull(id: string, x: number, y: number, kind: Ship['kind'] = 'merchant'): Ship {
  return {
    id,
    kind,
    name: id,
    x,
    y,
    heading: 0,
    speed: 1,
    hp: 40,
    maxHp: 40,
    alert: 0,
    holdContact: 0,
    weaponCooldown: 9,
    patrolIndex: 0,
    path: [],
    repathTimer: 0,
  };
}

function minClear(a: Ship, b: Ship): number {
  return shipClearRadius(a.kind) + shipClearRadius(b.kind) + 0.2;
}

describe('surface ships do not occupy the same water', () => {
  it('pushes stacked hulls apart past their combined radius', () => {
    const a = hull('a', WORLD_CENTER, WORLD_CENTER);
    const b = hull('b', WORLD_CENTER, WORLD_CENTER);
    const [na, nb] = separateShips([a, b]);
    expect(Math.hypot(na!.x - nb!.x, na!.y - nb!.y)).toBeGreaterThanOrEqual(minClear(a, b) - 0.02);
  });

  it('keeps a convoy from remaining overlapped after several sim steps', () => {
    let state = startMission(createGame(9));
    const first = state.ships[0]!;
    state = {
      ...state,
      ships: state.ships.map((ship, index) =>
        index === 0 ? ship : { ...ship, x: first.x, y: first.y, path: [], speed: 0.4 },
      ),
    };
    for (let i = 0; i < Math.ceil(1.5 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const live = state.ships.filter((s) => s.sinking === undefined);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i]!;
        const b = live[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(minClear(a, b) - 0.05);
      }
    }
  });
});
