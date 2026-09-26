import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';

describe('stealth start', () => {
  it('begins submerged below periscope depth and running silent', () => {
    const { submarine } = startMission(createGame(19));
    // Surfaced or scope-deep starts read as exposed; the opening must feel hunted-not-hunting.
    expect(submarine.z).toBeGreaterThanOrEqual(0.45);
    expect(submarine.targetDepth).toBeGreaterThanOrEqual(0.45);
    expect(submarine.silentRunning).toBe(true);
    expect(submarine.scopeUp).toBe(false);
  });

  it('is undetected by every contact over the opening minute of doing nothing', () => {
    let state = startMission(createGame(19));
    let worstAlert = 0;
    for (let t = 0; t < 60 * 20; t++) {
      state = updateGame(state, [], 1 / 20);
      for (const ship of state.ships) worstAlert = Math.max(worstAlert, ship.alert);
    }
    // 0.25 is where escorts switch from patrol speed to pursuit (systems.ts).
    expect(worstAlert).toBeLessThan(0.25);
  });
});
