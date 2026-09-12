import { expect, it } from 'vitest';
import { canonicalSnapshot } from '../../src/game/replay';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';

function soak(): string {
  let state = startMission(createGame(91));
  for (let tick = 0; tick < 108_000; tick++) {
    state = updateGame(state, tick % 900 === 0 ? [{ type: 'helm', surge: 1, yaw: tick % 1_800 ? 0 : 1, depth: 0 }] : [], 1 / 60);
    if (tick % 600 === 0) {
      expect(state.torpedoes.length).toBeLessThan(20);
      expect(state.depthCharges.length).toBeLessThan(80);
      expect(state.sonarContacts.length).toBeLessThanOrEqual(6);
      expect(Number.isFinite(state.submarine.x)).toBe(true);
      expect(Number.isFinite(state.submarine.y)).toBe(true);
    }
  }
  return canonicalSnapshot(state);
}

it('completes a deterministic 30-minute accelerated threat soak', () => {
  expect(soak()).toBe(soak());
}, 180_000);
