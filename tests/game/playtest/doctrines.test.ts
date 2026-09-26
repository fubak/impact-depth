import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import { createGame, setAutopilot, startMission, updateGame } from '../../../src/game/sim/api';
import type { AutopilotTactic, GameState } from '../../../src/game/sim/types';
import { getTerrain, isCrushedBySeamount } from '../../../src/game/sim/world';

const SEEDS = [1, 7, 19, 42, 91] as const;
const HORIZON = 180;
const ATTACK: AutopilotTactic[] = ['ambush', 'stalk', 'intercept'];

function runDoctrine(
  seed: number,
  tactic: AutopilotTactic,
  done: (state: GameState) => boolean,
): GameState {
  let state = startMission(createGame(seed));
  const target = state.ships.find((ship) => ship.kind === 'merchant') ?? state.ships[0]!;
  state = setAutopilot(state, tactic, target.id);
  const steps = Math.ceil(HORIZON / FIXED_DT);
  for (let index = 0; index < steps && !done(state); index += 1) {
    state = updateGame(state, [], FIXED_DT);
  }
  return state;
}

describe('playtest doctrines', () => {
  it('ambush, stalk and intercept each fire within 3 min on the pacing seeds', () => {
    for (const seed of SEEDS) {
      for (const tactic of ATTACK) {
        const state = runDoctrine(seed, tactic, (current) => current.stats.torpedoesFired > 0);
        expect(state.stats.torpedoesFired, `${tactic} seed ${seed}`).toBeGreaterThan(0);
        expect(state.time, `${tactic} seed ${seed}`).toBeLessThan(HORIZON);
        expect(state.phase, `${tactic} seed ${seed}`).toBe('playing');
      }
    }
  }, 60_000);

  it('evade breaks contact alive within 3 min on seeds 1 and 19', () => {
    for (const seed of [1, 19] as const) {
      const state = runDoctrine(
        seed,
        'evade',
        (current) => current.autopilot.tactic === 'manual' || current.submarine.hp <= 0,
      );
      expect(state.submarine.hp, `seed ${seed}`).toBeGreaterThan(0);
      expect(state.autopilot.tactic, `seed ${seed}`).toBe('manual');
      expect(state.time, `seed ${seed}`).toBeLessThan(HORIZON);
    }
  }, 60_000);

  for (const seed of [7, 42, 91] as const) {
    it(`evade on seed ${seed} returns to manual alive without sitting in a seamount`, () => {
      const state = runDoctrine(
        seed,
        'evade',
        (current) => current.autopilot.tactic === 'manual' || current.submarine.hp <= 0,
      );
      expect(state.submarine.hp, `seed ${seed}`).toBeGreaterThan(0);
      expect(state.autopilot.tactic).toBe('manual');
      expect(state.time).toBeLessThan(180);
      const terrain = getTerrain(state.terrainSeed);
      expect(
        isCrushedBySeamount(terrain, state.submarine.x, state.submarine.y, state.submarine.z),
      ).toBe(false);
    }, 60_000);
  }
});
