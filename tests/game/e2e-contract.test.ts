import { expect, it } from 'vitest';
import { createGame, startMission } from '../../src/game/sim/api';
import { DEFAULT_PATROL_MODE } from '../e2e/helpers.mjs';

it('default patrol mode contract: startMission sets viewMode to DEFAULT_PATROL_MODE', () => {
  const game = startMission(createGame(1));
  expect(game.viewMode).toBe(DEFAULT_PATROL_MODE);
});
