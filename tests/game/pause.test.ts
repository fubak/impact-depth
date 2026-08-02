import { expect, it } from 'vitest';
import { createGame, setPhase, updateGame } from '../../src/game/sim/api';

it('does not advance time or tick outside an active mission', () => {
  const state = setPhase(createGame(), 'paused');
  const next = updateGame(state, [], 1 / 60);
  expect(next.time).toBe(state.time);
  expect(next.tick).toBe(state.tick);
});
