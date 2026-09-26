import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { launchHeading } from '../../src/game/sim/systems';
import type { GameState } from '../../src/game/sim/types';

/** Deep is 0.82 and the tube lock is 0.80, so a Deep boat must not shoot. */
function readyBoat(z: number): GameState {
  const state = startMission(createGame(19));
  return {
    ...state,
    ships: [],
    weaponMode: 'torpedo',
    torpedoSpread: false,
    autopilot: { ...state.autopilot, enabled: false },
    submarine: {
      ...state.submarine,
      z,
      targetDepth: z,
      sysTubes: 1,
      torpedoes: state.submarine.maxTorpedoes,
      reloadMk14: 0,
      speed: 0,
      targetSpeed: 0,
    },
  };
}

describe('tube arc', () => {
  it('will not launch an Mk-14 directly astern', () => {
    const state = readyBoat(0.5);
    const heading = state.submarine.heading;
    const astern = heading + Math.PI;
    const launched = launchHeading(heading, astern);
    const delta = Math.atan2(Math.sin(launched - heading), Math.cos(launched - heading));
    expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI / 3 + 1e-6);
    expect(Math.abs(delta)).toBeGreaterThan(Math.PI / 6);
  });
});

describe('fire depth lock', () => {
  it('does not fire an Mk-14 from Deep', () => {
    const state = readyBoat(0.82);
    const fired = state.stats.torpedoesFired;
    const next = updateGame(state, [{ type: 'fireWeapon' }], 0);
    expect(next.stats.torpedoesFired).toBe(fired);
    expect(next.messages.some((message) => message.text === 'TUBES LOCKED — TOO DEEP')).toBe(true);
  });

  it('fires one Mk-14 at attack depth', () => {
    const state = readyBoat(0.5);
    const next = updateGame(state, [{ type: 'fireWeapon' }], 0);
    expect(next.stats.torpedoesFired).toBe(state.stats.torpedoesFired + 1);
    expect(next.messages.some((message) => message.text === 'TUBES LOCKED — TOO DEEP')).toBe(false);
  });
});
