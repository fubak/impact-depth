import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';

describe('command fuzz / boundary hardening', () => {
  it('survives chaotic helm and order spam without NaN', () => {
    let state = startMission(createGame(91));
    const impulses = [-2, -1, 0, 1, 2, 99, -99];
    for (let i = 0; i < 2400; i++) {
      const surge = impulses[i % impulses.length]!;
      const yaw = impulses[(i * 3) % impulses.length]!;
      const depth = impulses[(i * 7) % impulses.length]!;
      const dt = i % 17 === 0 ? 0 : i % 31 === 0 ? 0.25 : 1 / 60;
      state = updateGame(state, [{ type: 'helm', surge, yaw, depth }], dt);
      expect(Number.isFinite(state.submarine.x)).toBe(true);
      expect(Number.isFinite(state.submarine.y)).toBe(true);
      expect(Number.isFinite(state.submarine.z)).toBe(true);
      expect(Number.isFinite(state.submarine.speed)).toBe(true);
      expect(state.ships.length).toBeLessThan(80);
      expect(state.torpedoes.length).toBeLessThan(80);
    }
  });
});
