// @ts-expect-error node builtin; the game tsconfig only loads vite/client
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createConvoyStrike, createGame, startMission, updateGame } from '../../src/game/sim/api';
import { STRIKE_MERCHANT_ID } from '../../src/game/sim/scenarios/convoy-strike';

describe('convoy strike', () => {
  it('keeps the patrol on a five-ship first wave', () => {
    const state = startMission(createGame(19));
    expect(state.scenario).toBe('patrol');
    expect(state.ships).toHaveLength(5);
    expect(state.stats.wave).toBe(1);
  });

  it('spawns three ships and does not advance the wave', () => {
    let state = startMission(createConvoyStrike(19));
    expect(state.ships).toHaveLength(3);
    expect(state.assistanceAutoFire).toBe(false);
    expect(state.ships.map((ship) => ship.kind).sort()).toEqual([
      'destroyer',
      'merchant',
      'patrol',
    ]);
    state = {
      ...state,
      ships: [],
      stats: { ...state.stats, shipsSunk: 3 },
    };
    const steps = Math.ceil(25 / FIXED_DT);
    for (let index = 0; index < steps; index += 1) state = updateGame(state, [], FIXED_DT);
    expect(state.stats.wave).toBe(1);
    expect(state.ships).toHaveLength(0);
    expect(state.phase).toBe('playing');
  });

  it('does not win by sinking only the escorts', () => {
    let state = startMission(createConvoyStrike(19));
    state = {
      ...state,
      ships: state.ships.map((ship) =>
        ship.id === STRIKE_MERCHANT_ID ? ship : { ...ship, sinking: 0 },
      ),
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.phase).toBe('playing');
    expect(state.ships.some((ship) => ship.id === STRIKE_MERCHANT_ID)).toBe(true);
  });

  it('wins when the merchant is gone and the boat is in the exit', () => {
    let state = startMission(createConvoyStrike(19));
    const exit = state.strikeExit;
    expect(exit).not.toBeNull();
    state = {
      ...state,
      ships: state.ships.filter((ship) => ship.id !== STRIKE_MERCHANT_ID),
      stats: { ...state.stats, shipsSunk: 1 },
      submarine: { ...state.submarine, x: exit!.x, y: exit!.y, speed: 0, targetSpeed: 0 },
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.phase).toBe('victory');
  });

  it('ends the strike when the hull reaches zero', () => {
    let state = startMission(createConvoyStrike(19));
    state = { ...state, submarine: { ...state.submarine, hp: 0 } };
    state = updateGame(state, [], FIXED_DT);
    expect(state.phase).toBe('gameover');
  });

  it('scripted strike sinks the merchant and reaches the exit', () => {
    let state = startMission(createConvoyStrike(19));
    const started = state.time;
    const steps = Math.ceil(180 / FIXED_DT);
    let shots = 0;
    for (let index = 0; index < steps && state.phase === 'playing'; index += 1) {
      const merchant = state.ships.find((ship) => ship.id === STRIKE_MERCHANT_ID);
      const sub = state.submarine;
      const canFire =
        merchant !== undefined &&
        sub.z <= 0.8 &&
        sub.z >= 0.04 &&
        sub.reloadMk14 <= 0 &&
        sub.torpedoes >= 1 &&
        sub.sysTubes >= 0.35;
      if (!merchant && state.strikeExit) {
        state = {
          ...state,
          submarine: {
            ...sub,
            x: state.strikeExit.x,
            y: state.strikeExit.y,
            speed: 0,
            targetSpeed: 0,
          },
        };
      }
      state = updateGame(state, canFire ? [{ type: 'fireWeapon' }] : [], FIXED_DT);
      if (canFire) shots += 1;
    }
    const report = {
      phase: state.phase,
      time: state.time - started,
      shots,
      hp: state.submarine.hp,
      sunk: state.stats.shipsSunk,
      lastDamage: state.submarine.lastDamage,
    };
    mkdirSync('artifacts/plan-024/strike', { recursive: true });
    writeFileSync('artifacts/plan-024/strike/report.json', JSON.stringify(report, null, 2));
    expect(state.phase).toBe('victory');
    expect(state.time - started).toBeLessThan(180);
  }, 60_000);

  it('picks a new patrol seed in the menu handler, not in the simulation', () => {
    const app = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    const sim = readFileSync(new URL('../../src/game/sim/create.ts', import.meta.url), 'utf8');
    expect(app).toContain('Date.now() % 9000');
    expect(sim).not.toContain('Date.now');
  });
});
