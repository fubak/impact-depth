import { describe, expect, it } from 'vitest';
import { createGame, createScenario, rerunScenario } from '../../src/game/sim/api';
import {
  isNavigable,
  playerNavProfile,
  surfaceShipNavProfile,
} from '../../src/game/world/littoral';
import { getWorld } from '../../src/game/world/queries';
import type { WorldVersion } from '../../src/game/world/definition';
import { findPath, findWorldPath, makeClear } from '../../src/game/sim/pathfinding';
import { getTerrain, isLand } from '../../src/game/sim/world';
import type { GameState } from '../../src/game/sim/types';

const WORLDS: readonly WorldVersion[] = ['legacy-v1', 'littoral-v2'];
const SCENARIOS = ['patrol', 'convoy-strike'] as const;

/** Spawn/base/exit validity against the world the state claims to be in. */
function expectSpawnsValid(state: GameState): void {
  const points = [
    { label: 'submarine', x: state.submarine.x, y: state.submarine.y, ship: false },
    { label: 'base', x: state.base.x, y: state.base.y, ship: false },
    ...state.ships.map((s) => ({ label: s.id, x: s.x, y: s.y, ship: true })),
    ...(state.strikeExit
      ? [{ label: 'exit', x: state.strikeExit.x, y: state.strikeExit.y, ship: false }]
      : []),
  ];
  for (const p of points) {
    if (state.worldVersion === 'littoral-v2') {
      const world = getWorld('littoral-v2', state.terrainSeed);
      const profile = p.ship ? surfaceShipNavProfile(0.1) : playerNavProfile(0.28);
      expect(isNavigable(world, p.x, p.y, profile), `${p.label} on water in v2`).toBe(true);
    } else {
      const terrain = getTerrain(state.terrainSeed);
      expect(isLand(terrain, p.x, p.y), `${p.label} on water in legacy`).toBe(false);
    }
  }
}

describe('scenario factory — consistent worlds', () => {
  for (const worldVersion of WORLDS) {
    for (const scenario of SCENARIOS) {
      describe(`${scenario} @ ${worldVersion}`, () => {
        it('is born in the requested world with a world-valid spawn, base and exit', () => {
          const state = createScenario({ scenario, seed: 19, worldVersion });
          expect(state.worldVersion).toBe(worldVersion);
          expect(state.scenario).toBe(scenario);
          expectSpawnsValid(state);
        });

        it('is deterministic for the same seed and settings', () => {
          const a = createScenario({ scenario, seed: 7, worldVersion });
          const b = createScenario({ scenario, seed: 7, worldVersion });
          expect(b).toEqual(a);
        });

        it('retry preserves seed, world and scenario and rebuilds the same initial state', () => {
          const original = createScenario({ scenario, seed: 42, worldVersion });
          const dirty: GameState = { ...original, phase: 'gameover', tick: 999, time: 55 };
          const retry = rerunScenario(dirty);
          expect(retry).toEqual(original);
        });

        it('new seed changes the seed-derived layout but not world or scenario', () => {
          const first = createScenario({ scenario, seed: 19, worldVersion });
          const next = rerunScenario(first, 23);
          expect(next.seed).toBe(23);
          expect(next.worldVersion).toBe(worldVersion);
          expect(next.scenario).toBe(first.scenario);
          expect(next.terrainSeed).toBe(23);
          expectSpawnsValid(next);
        });
      });
    }
  }

  it('does not relabel a legacy-built world: v2 patrol differs from the legacy build', () => {
    const legacy = createGame(19, 'legacy-v1');
    const v2 = createScenario({ scenario: 'patrol', seed: 19, worldVersion: 'littoral-v2' });
    expect(v2.worldVersion).toBe('littoral-v2');
    expect(legacy.worldVersion).toBe('legacy-v1');
    const world = getWorld('littoral-v2', 19);
    expect(isNavigable(world, v2.submarine.x, v2.submarine.y, playerNavProfile(0.28))).toBe(true);
  });

  it('defaults to the legacy world', () => {
    expect(createScenario({ scenario: 'patrol', seed: 3 }).worldVersion).toBe('legacy-v1');
  });

  describe('the base is reachable from the boat (not just on water)', () => {
    // Seed 7 historically placed the FOB in a sealed lagoon; the wide sweep guards the class.
    const LEGACY_SEEDS = [1, 3, 5, 7, 11, 19, 23, 42, 57, 91, 123, 777, 1234, 4242];

    for (const seed of LEGACY_SEEDS) {
      it(`legacy-v1 seed ${seed}: a route exists from the boat to the base`, () => {
        const state = createScenario({ scenario: 'patrol', seed });
        const path = findPath(
          { x: state.submarine.x, y: state.submarine.y },
          state.base,
          makeClear(getTerrain(state.terrainSeed), 0.2),
          1600,
        );
        expect(path.length, `seed ${seed} base ${state.base.x},${state.base.y}`).toBeGreaterThan(0);
      });
    }

    for (const seed of [7, 19, 42]) {
      it(`littoral-v2 seed ${seed}: a route exists from the boat to the base`, () => {
        const state = createScenario({ scenario: 'patrol', seed, worldVersion: 'littoral-v2' });
        const world = getWorld('littoral-v2', state.terrainSeed);
        const path = findWorldPath(
          world,
          { x: state.submarine.x, y: state.submarine.y },
          state.base,
          playerNavProfile(0.28),
          1600,
        );
        expect(path.length, `seed ${seed}`).toBeGreaterThan(0);
      });
    }

    it('keeps an already-reachable base exactly where the generator put it', () => {
      const state = createScenario({ scenario: 'patrol', seed: 19 });
      expect(state.base.x).toBeCloseTo(13.2, 1);
      expect(state.base.y).toBeCloseTo(13.2, 1);
    });
  });
});
