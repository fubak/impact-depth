import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import { createScenario, setAutopilot, startMission, updateGame } from '../../../src/game/sim/api';
import type { GameState } from '../../../src/game/sim/types';
import { getWorld } from '../../../src/game/world/queries';
import { isNavigable, playerNavProfile } from '../../../src/game/world/littoral';

const BUDGET_S = 180;
const dist = (s: GameState) => Math.hypot(s.submarine.x - s.base.x, s.submarine.y - s.base.y);

function emptyV2(seed: number): GameState {
  const state = startMission(
    createScenario({ scenario: 'patrol', seed, worldVersion: 'littoral-v2' }),
  );
  return {
    ...state,
    ships: [],
    messages: [...state.messages, { id: 'w', text: 'WAVE 99 INBOUND', ttl: 10_000 }],
    submarine: { ...state.submarine, hp: 20, sysFlood: 0 },
  };
}

describe('return to base in littoral-v2 (navigation, empty ocean)', () => {
  for (const seed of [1, 3, 5, 7, 11, 19, 23, 42, 57, 91, 123, 777, 1234, 4242]) {
    it(`seed ${seed}: arrives within ${BUDGET_S}s without grounding or a false blocked`, () => {
      let state = setAutopilot(emptyV2(seed), 'exfil');
      const world = getWorld('littoral-v2', state.terrainSeed);
      let offWater = 0;
      for (let i = 0; i < Math.ceil(BUDGET_S / FIXED_DT); i += 1) {
        if (dist(state) <= state.base.radius || state.submarine.hp <= 0) break;
        state = updateGame(state, [], FIXED_DT);
        if (
          !isNavigable(world, state.submarine.x, state.submarine.y, {
            ...playerNavProfile(0.28),
            radiusSim: 0,
          })
        )
          offWater += 1;
      }
      expect(
        state.messages.some((m) => m.text === 'CANNOT REACH BASE'),
        'false blocked',
      ).toBe(false);
      expect(state.submarine.hp, 'survived').toBeGreaterThan(0);
      expect(dist(state), `dist seed ${seed} t=${state.time.toFixed(0)}`).toBeLessThanOrEqual(
        state.base.radius,
      );
      expect(offWater, 'ticks spent off navigable water').toBe(0);
    }, 120_000);
  }
});
