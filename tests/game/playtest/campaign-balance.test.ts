import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import {
  createGame,
  deployCountermeasure,
  fireWeapon,
  setAutopilot,
  setDepthOrder,
  setSpeedOrder,
  setWeapon,
  startMission,
  updateGame,
} from '../../../src/game/sim/api';
import { seedWave } from '../../../src/game/sim/create';
import type { GameState } from '../../../src/game/sim/types';

const SEEDS = [1, 7, 19, 42, 91] as const;
const HORIZON = 300;

/**
 * A competent scripted hunter: prioritises merchants, then escorts, then the
 * enemy sub; goes deep and evades with decoys whenever weapons are in the
 * water against it. Not optimal — deliberately ordinary play.
 */
function playHunter(state: GameState): GameState {
  let evadeUntil = 0;
  let lastFire = -99;
  const steps = Math.ceil(HORIZON / FIXED_DT);
  for (let i = 0; i < steps; i += 1) {
    const sub = state.submarine;
    const threatened =
      state.messages.some((m) => /TORPEDO IN THE WATER|DEPTH CHARGES/.test(m.text)) ||
      sub.lastDamage !== null;
    if (threatened) {
      evadeUntil = state.time + 22;
      if (sub.decoys > 0 && state.time % 5 < FIXED_DT) {
        state = deployCountermeasure(state);
      }
    }
    if (state.time < evadeUntil) {
      if (sub.targetDepth < 0.7) state = setDepthOrder(state, 'deep');
      state = setAutopilot(state, 'evade', state.selectedTargetId ?? undefined);
    } else {
      if (sub.targetDepth > 0.6) state = setDepthOrder(state, 'attack');
      const live = state.ships.filter((s) => s.sinking === undefined);
      const priority = (s: GameState['ships'][number]) =>
        s.kind === 'merchant' ? 0 : s.kind === 'sub' ? 3 : 1;
      live.sort(
        (a, b) =>
          priority(a) - priority(b) ||
          Math.hypot(a.x - sub.x, a.y - sub.y) - Math.hypot(b.x - sub.x, b.y - sub.y),
      );
      const target = live[0];
      if (target) {
        state = { ...state, selectedTargetId: target.id };
        if (state.autopilot.tactic !== 'ambush' || state.autopilot.targetId !== target.id) {
          state = setAutopilot(state, 'ambush', target.id);
        }
        const range = Math.hypot(target.x - sub.x, target.y - sub.y);
        const munitionsLeft = sub.torpedoes + sub.seekers;
        if (range < 10 && state.time - lastFire > 6 && munitionsLeft > 0) {
          const weapon =
            sub.seekers > 0 && range < 6 ? 'seeker' : sub.torpedoes > 0 ? 'torpedo' : 'seeker';
          state = setWeapon(state, weapon);
          const munitions = sub.torpedoes + sub.seekers;
          const next = fireWeapon(state);
          const nextMunitions = next.submarine.torpedoes + next.submarine.seekers;
          if (nextMunitions < munitions) {
            state = next;
            lastFire = state.time;
          }
        }
      }
    }
    state = updateGame(state, [], FIXED_DT);
    if (state.phase !== 'playing' || state.ships.length === 0) break;
  }
  return state;
}

describe('campaign balance (Plan 026)', () => {
  // One test per seed keeps each below the vitest worker RPC timeout.
  for (const seed of SEEDS) {
    it(
      `wave 1 seed ${seed}: a competent hunter clears the convoy merchants and survives`,
      () => {
        let state = startMission(createGame(seed));
        state = setDepthOrder(state, 'attack');
        state = setSpeedOrder(state, 'twoThirds');
        state = playHunter(state);
        const merchantsLeft = state.ships.filter(
          (s) => s.kind === 'merchant' && s.sinking === undefined,
        ).length;
        // Ordinary play is allowed to lose one merchant chase per seed — but
        // never the boat, and never the whole convoy.
        expect(merchantsLeft).toBeLessThanOrEqual(1);
        expect(state.submarine.hp).toBeGreaterThan(0);
      },
      120_000,
    );

    it(
      `wave 2 seed ${seed}: a competent hunter scores kills despite the reinforced screen`,
      () => {
        let state = startMission(createGame(seed));
        state = {
          ...state,
          ships: seedWave(seed, 2),
          submarine: { ...state.submarine, torpedoes: 12, seekers: 6 },
        };
        state = setDepthOrder(state, 'attack');
        state = setSpeedOrder(state, 'twoThirds');
        state = playHunter(state);
        // Wave 2's 4-escort screen + battleship + enemy subs mean the wave is
        // meant to hurt — a competent hunter still lands kills on every seed.
        expect(state.stats.shipsSunk).toBeGreaterThanOrEqual(2);
      },
      120_000,
    );
  }
});
