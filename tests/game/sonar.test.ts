import { describe, expect, it } from 'vitest';
import { createGame, sonarPulse, startMission, updateGame } from '../../src/game/sim/api';
import { layerFactor, passiveRange } from '../../src/game/sim/sonar';

describe('sonar', () => {
  it('attenuates passive sound across the thermocline', () => {
    expect(layerFactor(0.2, 0.2)).toBe(1);
    expect(layerFactor(0.2, 0.9)).toBeLessThan(0.42);
    expect(passiveRange('player', 0.8, 0.2, 0.9)).toBeLessThan(passiveRange('player', 0.8, 0.2, 0.2));
  });

  it('creates stable active contacts and alerts nearby ships', () => {
    let state = startMission(createGame(30));
    state = { ...state, ships: state.ships.map((ship, index) => ({ ...ship, x: state.submarine.x + 4 + index, y: state.submarine.y })) };
    state = sonarPulse(state);
    expect(state.sonarPing).toBeGreaterThan(0);
    expect(state.sonarCooldown).toBeGreaterThan(0);
    expect(state.ships[0]!.alert).toBeGreaterThan(0);
    state = updateGame(state, [], 1);
    expect(state.sonarContacts[0]?.id).toMatch(/active-|passive-/);
    expect(state.sonarContacts[0]?.targetId).toBe(state.ships[0]?.id);
  });
});
