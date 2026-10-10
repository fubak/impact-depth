import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import { createGame, setAutopilot, startMission, updateGame } from '../../../src/game/sim/api';
import type { GameState } from '../../../src/game/sim/types';
import { getTerrain, isCrushedBySeamount } from '../../../src/game/sim/world';

/**
 * Combat run: a healthy boat ordered Home at mission start, live wave-1 escorts, no
 * intervention. Arrival and survival are reported separately from the navigation matrix in
 * exfil-progress.test.ts. Outcomes are pinned so a doctrine or balance change that moves them
 * shows up as a reviewed diff (see docs/release/plan-025-phase5.md).
 */
const HORIZON_S = 180;

interface Outcome {
  readonly arrived: boolean;
  readonly survived: boolean;
  readonly falseBlocked: boolean;
  readonly crushed: boolean;
  readonly lastDamage: string | null;
  readonly elapsed: number;
}

function runCombatExfil(seed: number): Outcome {
  let state: GameState = startMission(createGame(seed));
  const target = state.ships.find((ship) => ship.kind === 'merchant') ?? state.ships[0]!;
  state = setAutopilot(state, 'exfil', target.id);
  const order = state.time;
  const inside = (s: GameState) =>
    Math.hypot(s.submarine.x - s.base.x, s.submarine.y - s.base.y) <= s.base.radius;
  for (let i = 0; i < Math.ceil(HORIZON_S / FIXED_DT); i += 1) {
    if (inside(state) || state.submarine.hp <= 0) break;
    state = updateGame(state, [], FIXED_DT);
  }
  return {
    arrived: inside(state),
    survived: state.submarine.hp > 0,
    falseBlocked: state.messages.some((m) => m.text === 'CANNOT REACH BASE'),
    crushed: isCrushedBySeamount(
      getTerrain(state.terrainSeed),
      state.submarine.x,
      state.submarine.y,
      state.submarine.z,
    ),
    lastDamage: state.submarine.lastDamage ?? null,
    elapsed: state.time - order,
  };
}

describe('return to base — combat survival (reported separately from navigation)', () => {
  // arrival and survival are distinct columns on purpose; a death is never counted as a pass.
  const EXPECTED: Record<
    number,
    { arrived: boolean; survived: boolean; lastDamage: string | null }
  > = {
    1: { arrived: false, survived: false, lastDamage: 'weapon' },
    7: { arrived: false, survived: false, lastDamage: 'weapon' },
    19: { arrived: true, survived: true, lastDamage: null },
    42: { arrived: true, survived: true, lastDamage: 'weapon' },
    91: { arrived: false, survived: false, lastDamage: 'weapon' },
  };

  for (const seed of [1, 7, 19, 42, 91] as const) {
    it(`seed ${seed}: outcome is pinned and is never terrain or a false "cannot reach"`, () => {
      const outcome = runCombatExfil(seed);
      expect(outcome.crushed, `seed ${seed} died to terrain`).toBe(false);
      expect(outcome.falseBlocked, `seed ${seed} reported base unreachable`).toBe(false);
      expect({
        arrived: outcome.arrived,
        survived: outcome.survived,
        lastDamage: outcome.lastDamage,
      }).toEqual(EXPECTED[seed]);
      expect(outcome.elapsed).toBeLessThanOrEqual(HORIZON_S);
    }, 90_000);
  }
});
