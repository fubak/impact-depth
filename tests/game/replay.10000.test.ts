import { expect, it } from 'vitest';
import { canonicalSnapshot } from '../../src/game/replay';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';

function run(): string {
  let state = startMission(createGame(42));
  for (let tick = 0; tick < 10_000; tick++) {
    const commands = tick % 180 === 0 ? [{ type: 'helm' as const, surge: 1, yaw: tick % 360 ? 0 : 1, depth: 0 }] : [];
    state = updateGame(state, commands, 1 / 60);
  }
  return canonicalSnapshot(state);
}
it('replays 10000 ticks byte-identically', () => expect(run()).toBe(run()));
