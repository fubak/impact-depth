import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  createScenario,
  keepHunting,
  restartGame,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import { seedWave } from '../../src/game/sim/create';
import { escalateWave } from '../../src/game/sim/endless';
import { WAVE_BREATHER } from '../../src/game/sim/constants';
import type { GameState } from '../../src/game/sim/types';

/** A patrol that has just been won: the last hull sinks on this tick and the wave is cleared. */
const victory = (wave = 1): GameState => {
  const s = startMission(createGame(21));
  const primed: GameState = {
    ...s,
    ships: [{ ...s.ships[0]!, sinking: 0 }],
    stats: { ...s.stats, shipsSunk: 7, wave },
  };
  return updateGame(primed, [], FIXED_DT);
};

describe('endless flow through the sim', () => {
  it('without keepHunting a victory stays a victory', () => {
    let s = victory();
    expect(s.phase).toBe('victory');
    for (let i = 0; i < 60; i++) s = updateGame(s, [], FIXED_DT);
    expect(s.phase).toBe('victory');
    expect(s.endless).toBeUndefined();
  });

  it('keepHunting resumes play in endless mode', () => {
    const next = keepHunting(victory());
    expect(next.phase).toBe('playing');
    expect(next.endless).toBe(true);
    expect(next.messages.some((message) => message.text === 'ENDLESS HUNT')).toBe(true);
  });

  it('the next wave arrives after the breather, escalated from wave 3', () => {
    let s = keepHunting(victory(2));
    const limit = Math.round((WAVE_BREATHER + 2) / FIXED_DT);
    let arrived: GameState | null = null;
    for (let i = 0; i < limit && arrived === null; i++) {
      const next = updateGame(s, [], FIXED_DT);
      if (next.stats.wave === 3) arrived = next;
      s = next;
    }
    expect(arrived).not.toBeNull();
    const after = arrived!;
    expect(after.phase).toBe('playing');
    expect(after.ships.length).toBeGreaterThan(0);
    expect(after.ships).toEqual(
      escalateWave(after.seed, 3, seedWave(after.seed, 3, undefined, after.worldVersion)),
    );
  });

  it('endless never declares victory again', () => {
    const s = startMission(createGame(21));
    const endlessPlaying: GameState = {
      ...s,
      endless: true,
      ships: [{ ...s.ships[0]!, sinking: 0 }],
      stats: { ...s.stats, shipsSunk: 30 },
    };
    expect(updateGame(endlessPlaying, [], FIXED_DT).phase).toBe('playing');
  });

  it('convoy strike cannot continue', () => {
    const strike: GameState = {
      ...createScenario({ scenario: 'convoy-strike', seed: 3 }),
      phase: 'victory',
    };
    const next = keepHunting(strike);
    expect(next.phase).toBe('victory');
    expect(next.endless).toBeUndefined();
  });

  it('restart clears endless', () => {
    expect(restartGame(keepHunting(victory())).endless).toBeUndefined();
  });

  it('is deterministic', () => {
    const run = (): GameState => {
      let s = keepHunting(victory(2));
      for (let i = 0; i < 1500; i++) s = updateGame(s, [], FIXED_DT);
      return s;
    };
    expect(run()).toEqual(run());
  });
});
