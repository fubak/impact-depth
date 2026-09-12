import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { adaptToLookDevSim } from '../../src/game/adapt/lookdev';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';

describe('presentation wave attitude', () => {
  it('puts surface ships on the Gerstner sample instead of a flat heave=0', () => {
    let state = startMission(createGame(19));
    state = { ...state, settings: DEFAULT_SETTINGS };
    for (let i = 0; i < 180; i++) state = updateGame(state, [], 1 / 60);
    const sim = adaptToLookDevSim(state);
    const merchant = sim.ships.find((ship) => ship.kind === 'merchant');
    expect(merchant).toBeTruthy();
    expect(
      Math.abs(merchant!.heave) + Math.abs(merchant!.pitch) + Math.abs(merchant!.roll),
    ).toBeGreaterThan(0.02);
  });

  it('damps player heave when deep so the hull stays under the sheet', () => {
    let state = startMission(createGame(19));
    state = {
      ...state,
      settings: DEFAULT_SETTINGS,
      submarine: { ...state.submarine, z: 0.82, targetDepth: 0.82 },
    };
    for (let i = 0; i < 60; i++) state = updateGame(state, [], 1 / 60);
    const sim = adaptToLookDevSim(state);
    expect(sim.vessel.depth).toBeGreaterThan(15);
    expect(Math.abs(sim.vessel.heave)).toBeLessThan(0.15);
  });
});
