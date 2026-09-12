import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, setAutopilot, startMission, updateGame } from '../../src/game/sim/api';

describe('close-range tactic engage', () => {
  it('ambush inside 10u should not instantly breakaway on select', () => {
    let state = startMission(createGame(19));
    for (let i = 0; i < 60; i++) state = updateGame(state, [], FIXED_DT);
    const ship = state.ships[0]!;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 6,
        y: ship.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
        invuln: 120,
        hp: 100,
        sysFlood: 0,
        reloadMk14: 0,
        torpedoes: 6,
      },
    };
    state = setAutopilot(state, 'ambush', ship.id);
    expect(['approach', 'setup']).toContain(state.autopilot.phase);
    expect(state.autopilot.shotTimer).toBeGreaterThan(2);
    const startDist = Math.hypot(state.submarine.x - ship.x, state.submarine.y - ship.y);
    let sawBreakaway = false;
    let maxDist = startDist;
    for (let i = 0; i < Math.ceil(2.5 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      if (state.autopilot.phase === 'breakaway') sawBreakaway = true;
      const live = state.ships.find((s) => s.id === ship.id);
      if (live) maxDist = Math.max(maxDist, Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y));
    }
    expect(sawBreakaway).toBe(false);
    expect(maxDist).toBeLessThan(startDist + 2.5);
  });
});
