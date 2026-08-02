import { describe, expect, it } from 'vitest';
import { cancelAutopilot, createGame, setAutopilot, startMission, updateGame } from '../../src/game/sim/api';
import type { AutopilotTactic } from '../../src/game/sim/types';

describe('doctrine autopilot', () => {
  for (const tactic of ['ambush', 'stalk', 'intercept', 'evade', 'exfil'] satisfies AutopilotTactic[]) {
    it(`runs ${tactic} deterministically`, () => {
      let state = startMission(createGame(44));
      const targetId = state.ships[0]!.id;
      state = setAutopilot(state, tactic, targetId);
      state = updateGame(state, [], 1);
      expect(state.autopilot.tactic).toBe(tactic);
      expect(Number.isFinite(state.submarine.heading)).toBe(true);
      expect(state.submarine.targetSpeed).toBeGreaterThanOrEqual(0);
    });
  }

  it('cancels immediately without leaving a target or route', () => {
    let state = setAutopilot(startMission(createGame(45)), 'intercept');
    state = cancelAutopilot(state);
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');
    expect(state.autopilot.path).toEqual([]);
  });
});
