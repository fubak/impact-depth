import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import { createGame, setAutopilot, startMission, updateGame } from '../../../src/game/sim/api';
import type { AutopilotTactic, GameState } from '../../../src/game/sim/types';

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
  it(
    'ambush, stalk and intercept each fire within 3 min on the pacing seeds',
    () => {
      for (const seed of SEEDS) {
        for (const tactic of ATTACK) {
          const state = runDoctrine(seed, tactic, (current) => current.stats.torpedoesFired > 0);
          expect(state.stats.torpedoesFired, `${tactic} seed ${seed}`).toBeGreaterThan(0);
          expect(state.time, `${tactic} seed ${seed}`).toBeLessThan(HORIZON);
          expect(state.phase, `${tactic} seed ${seed}`).toBe('playing');
        }
      }
    },
    60_000,
  );

  it(
    'evade breaks contact alive within 3 min on seeds 1 and 19',
    () => {
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
    },
    60_000,
  );

  // Current patrol: evade on these seeds floods out before the helm goes manual.
  it.fails(
    'evade breaks contact alive within 3 min on seeds 7, 42 and 91',
    () => {
      const dead = SEEDS.filter((seed) => seed !== 1 && seed !== 19).filter((seed) => {
        const state = runDoctrine(
          seed,
          'evade',
          (current) => current.autopilot.tactic === 'manual' || current.submarine.hp <= 0,
        );
        return state.submarine.hp <= 0 || state.autopilot.tactic !== 'manual';
      });
      expect(dead).toEqual([]);
    },
    60_000,
  );

  // Current patrol: exfil closes some range but is sunk before the FOB circle.
  it.fails(
    'exfil reaches the FOB alive within 3 min on seeds 1, 7, 19, 42 and 91',
    () => {
      const missed = SEEDS.filter((seed) => {
        const state = runDoctrine(seed, 'exfil', (current) => {
          const distance = Math.hypot(
            current.submarine.x - current.base.x,
            current.submarine.y - current.base.y,
          );
          return distance <= current.base.radius || current.submarine.hp <= 0;
        });
        const distance = Math.hypot(
          state.submarine.x - state.base.x,
          state.submarine.y - state.base.y,
        );
        return state.submarine.hp <= 0 || distance > state.base.radius;
      });
      expect(missed).toEqual([]);
    },
    60_000,
  );
});
