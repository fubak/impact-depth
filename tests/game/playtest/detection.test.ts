import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import {
  createGame,
  setDepthOrder,
  setSpeedOrder,
  sonarPulse,
  startMission,
  updateGame,
} from '../../../src/game/sim/api';
import type { GameState } from '../../../src/game/sim/types';

const SEEDS = [1, 7, 19, 42, 91] as const;

function ticks(state: GameState, seconds: number): GameState {
  const count = Math.max(1, Math.round(seconds / FIXED_DT));
  let next = state;
  for (let index = 0; index < count; index += 1) next = updateGame(next, [], FIXED_DT);
  return next;
}

describe('playtest detection', () => {
  it('an active ping reveals a silent boat that passive sonar has not heard', () => {
    let state = startMission(createGame(11));
    const boat = state.submarine;
    const escort = state.ships.find((ship) => ship.kind !== 'merchant') ?? state.ships[0]!;
    state = {
      ...state,
      submarine: {
        ...boat,
        speed: 0,
        targetSpeed: 0,
        silentRunning: true,
        z: 0.5,
        targetDepth: 0.5,
        noise: 0.08,
      },
      ships: [
        {
          ...escort,
          x: boat.x + 18,
          y: boat.y,
          alert: 0,
          holdContact: 0,
          weaponCooldown: 999,
          path: [],
          heading: 0,
        },
      ],
    };
    state = ticks(state, 2);
    expect(state.ships[0]!.alert).toBe(0);
    const stillQuiet = ticks(state, 1);
    expect(stillQuiet.ships[0]!.alert).toBe(0);

    const revealed = sonarPulse(state);
    expect(revealed.ships[0]!.alert).toBeGreaterThan(0);
    const hunted = ticks(revealed, 1);
    expect(hunted.ships[0]!.holdContact).toBeGreaterThan(0);
  });

  it('a detected enemy submarine fires a torpedo', () => {
    let state = startMission(createGame(13));
    const hunter = state.ships.find((ship) => ship.kind === 'sub');
    expect(hunter).toBeDefined();
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        speed: 0,
        targetSpeed: 0,
        silentRunning: true,
        z: 0.5,
        targetDepth: 0.5,
        invuln: 0,
        noise: 0.08,
      },
      ships: [
        {
          ...hunter!,
          x: state.submarine.x + 2.8,
          y: state.submarine.y,
          alert: 0.6,
          holdContact: 2,
          weaponCooldown: 0,
          sinking: undefined,
        },
      ],
      torpedoes: [],
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.torpedoes.some((torpedo) => torpedo.owner === 'enemy')).toBe(true);
  });

  it('logs time to first alert for a passive silent bot at attack depth', () => {
    for (const seed of SEEDS) {
      let state = setDepthOrder(startMission(createGame(seed)), 'attack');
      state = setSpeedOrder(state, 'stop');
      state = {
        ...state,
        submarine: {
          ...state.submarine,
          speed: 0,
          targetSpeed: 0,
          silentRunning: true,
        },
      };
      let firstAlert = -1;
      const limit = Math.ceil(180 / FIXED_DT);
      for (let index = 0; index < limit; index += 1) {
        state = updateGame(state, [], FIXED_DT);
        if (state.ships.some((ship) => ship.alert > 0.25)) {
          firstAlert = state.time;
          break;
        }
      }
      // Baseline for Plan 022 pacing. A removed detector leaves this at -1.
      console.log(
        `playtest silent seed=${seed} firstAlertSec=${firstAlert.toFixed(2)} depth=attack`,
      );
      expect(state.submarine.z).toBeGreaterThan(0.45);
      expect(state.submarine.silentRunning).toBe(true);
      expect(firstAlert).toBeGreaterThan(5);
      expect(firstAlert).toBeLessThan(40);
    }
  });
});
