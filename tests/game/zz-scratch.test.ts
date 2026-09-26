import { it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
it('measure', () => {
  for (const dist of [0.8, 2, 4]) {
    let state = startMission(createGame(19));
    const escort = state.ships.find((s) => s.kind === 'cruiser')!;
    state = {
      ...state,
      ships: state.ships.map((s) =>
        s.id === escort.id
          ? { ...s, x: state.submarine.x + dist, y: state.submarine.y, alert: 1, holdContact: 8, weaponCooldown: 0 }
          : { ...s, x: s.x + 200, y: s.y + 200 },
      ),
      submarine: { ...state.submarine, invuln: 0, hp: 100, noise: 0.6, silentRunning: false },
    };
    const trace: string[] = [];
    for (let i = 0; i < Math.ceil(12 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      if (i % 40 === 0) trace.push(`${(i * FIXED_DT).toFixed(0)}s:${state.submarine.hp.toFixed(0)}`);
    }
    console.log('DIST', dist, trace.join(' '));
  }
});
