import { expect, it } from 'vitest';
import { createGame, startMission } from '../../src/game/sim/api';
import helpersSource from '../e2e/helpers.mjs?raw';

// helpers.mjs is untyped JS, so read the exported constant from its source text.
function e2eDefaultPatrolMode(): string {
  const match = /export const DEFAULT_PATROL_MODE = '([a-z]+)'/.exec(helpersSource);
  if (!match) throw new Error('DEFAULT_PATROL_MODE export not found in tests/e2e/helpers.mjs');
  return match[1]!;
}

it('default patrol mode contract: startMission sets viewMode to the e2e DEFAULT_PATROL_MODE', () => {
  const game = startMission(createGame(1));
  expect(game.viewMode).toBe(e2eDefaultPatrolMode());
});
