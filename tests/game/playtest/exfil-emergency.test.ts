import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import { createGame, setAutopilot, startMission, updateGame } from '../../../src/game/sim/api';
import type { AutopilotTactic, GameState } from '../../../src/game/sim/types';
import { getTerrain, isCrushedBySeamount } from '../../../src/game/sim/world';

const HORIZON = 180;

function distanceToBase(state: GameState): number {
  return Math.hypot(state.submarine.x - state.base.x, state.submarine.y - state.base.y);
}

function cannotReach(state: GameState): boolean {
  return state.messages.some((message) => message.text === 'CANNOT REACH BASE');
}

function runDoctrine(
  seed: number,
  tactic: AutopilotTactic,
  done: (state: GameState) => boolean,
): GameState {
  let state = startMission(createGame(seed));
  const target = state.ships.find((ship) => ship.kind === 'merchant') ?? state.ships[0]!;
  state = setAutopilot(state, tactic, target.id);
  const steps = Math.ceil(HORIZON / FIXED_DT);
  for (let index = 0; index < steps && !done(state); index += 1) {
    state = updateGame(state, [], FIXED_DT);
  }
  return state;
}

function damagedExfil(seed = 1): GameState {
  let state = startMission(createGame(seed));
  state = {
    ...state,
    ships: [],
    submarine: { ...state.submarine, hp: 20, sysFlood: 0 },
  };
  return setAutopilot(state, 'exfil');
}

describe('emergency exfil', () => {
  it('leaves breakaway and closes on the base within 20 seconds', () => {
    let state = damagedExfil();
    const start = distanceToBase(state);
    const steps = Math.ceil(20 / FIXED_DT);
    for (let index = 0; index < steps; index += 1) state = updateGame(state, [], FIXED_DT);
    expect(state.autopilot.tactic).toBe('exfil');
    expect(state.autopilot.phase).not.toBe('breakaway');
    expect(state.autopilot.phaseTimer).toBeGreaterThan(1);
    expect(state.autopilot.emergency).toBe(true);
    expect(distanceToBase(state)).toBeLessThan(start);
  });

  it('reaches the empty-ocean base within 180s or reports it cannot', () => {
    let state = damagedExfil();
    const steps = Math.ceil(HORIZON / FIXED_DT);
    for (let index = 0; index < steps; index += 1) {
      const arrived = distanceToBase(state) <= state.base.radius && state.submarine.hp > 0;
      if (arrived || cannotReach(state) || state.submarine.hp <= 0) break;
      state = updateGame(state, [], FIXED_DT);
    }
    const arrived = distanceToBase(state) <= state.base.radius && state.submarine.hp > 0;
    expect(arrived || cannotReach(state)).toBe(true);
  }, 60_000);

  for (const seed of [1, 7, 19, 42, 91] as const) {
    it(`exfil on seed ${seed} reaches base, reports blocked, or dies to weapons`, () => {
      const state = runDoctrine(seed, 'exfil', (current) => {
        const reached = distanceToBase(current) <= current.base.radius;
        if (seed === 19) return reached || current.submarine.hp <= 0;
        return reached || current.submarine.hp <= 0 || cannotReach(current);
      });
      const distance = distanceToBase(state);
      const terrain = getTerrain(state.terrainSeed);
      const crushed = isCrushedBySeamount(
        terrain,
        state.submarine.x,
        state.submarine.y,
        state.submarine.z,
      );
      if (seed === 19) {
        expect(state.submarine.hp, `seed ${seed}`).toBeGreaterThan(0);
        expect(distance, `seed ${seed}`).toBeLessThanOrEqual(state.base.radius);
        expect(state.time, `seed ${seed}`).toBeLessThan(HORIZON);
        return;
      }
      const aliveInside = state.submarine.hp > 0 && distance <= state.base.radius;
      const aliveCannot = state.submarine.hp > 0 && cannotReach(state);
      const weaponKill = state.submarine.hp === 0 && !crushed;
      expect(
        aliveInside || aliveCannot || weaponKill,
        `seed ${seed} hp ${state.submarine.hp} crushed ${crushed} dist ${distance}`,
      ).toBe(true);
      if (state.submarine.hp === 0) expect(crushed, `seed ${seed}`).toBe(false);
    }, 60_000);
  }
});
