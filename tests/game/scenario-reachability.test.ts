import { describe, expect, it } from 'vitest';
import { createScenario } from '../../src/game/sim/api';
import { waterComponent } from '../../src/game/sim/pathfinding';
import { getTerrain } from '../../src/game/sim/world';

/** Every spawned contact, base and strike exit must share the boat's water in the legacy world. */
describe('legacy spawns are in the boat’s connected water', () => {
  const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1);

  for (const scenario of ['patrol', 'convoy-strike'] as const) {
    it(`${scenario}: base, contacts and exit are reachable on seeds 1-60`, () => {
      const unreachable: string[] = [];
      for (const seed of SEEDS) {
        const state = createScenario({ scenario, seed });
        const mask = waterComponent(getTerrain(state.terrainSeed), state.submarine);
        const connected = (p: { x: number; y: number }) =>
          mask[Math.floor(p.y) * 128 + Math.floor(p.x)] === 1;
        const points: [string, { x: number; y: number }][] = [
          ['base', state.base],
          ...state.ships.map((ship): [string, { x: number; y: number }] => [ship.id, ship]),
        ];
        if (state.strikeExit) points.push(['exit', state.strikeExit]);
        for (const [label, point] of points) {
          if (!connected(point)) unreachable.push(`seed ${seed} ${label}`);
        }
      }
      expect(unreachable).toEqual([]);
    });
  }
});
