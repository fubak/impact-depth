import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { FIXED_DT } from '../../src/core/sim';

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

describe('wave-1 survival balance', () => {
  it('keeps wave-1 contacts outside close engagement range at mission start', () => {
    for (const seed of [1, 7, 19, 42, 91]) {
      const state = startMission(createGame(seed));
      const sub = state.submarine;
      const minDist = Math.min(
        ...state.ships.map((ship) => distance(ship.x, ship.y, sub.x, sub.y)),
      );
      expect(minDist).toBeGreaterThan(12);
      expect(state.submarine.invuln).toBe(8);
      expect(state.submarine.speedOrder).toBe('oneThird');
    }
  });

  it('survives the opening grace window on seed 19 without combat commands', () => {
    let state = startMission(createGame(19));
    state = updateGame(state, [{ type: 'setDepthOrder', order: 'periscope' }], 0);
    state = updateGame(state, [{ type: 'setSpeedOrder', order: 'stop' }], 0);
    state = updateGame(state, [{ type: 'toggleSilentRunning' }], 0);
    // Opening grace: 8s invuln + wave-1 weapon cooldown. Assert the invuln window.
    const ticks = Math.ceil(12 / FIXED_DT);
    for (let i = 0; i < ticks; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
      if (state.phase === 'gameover') break;
    }
    expect(state.phase).not.toBe('gameover');
    expect(state.submarine.hp).toBeGreaterThan(95);
  });
});
