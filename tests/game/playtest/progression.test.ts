import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import { createGame, startMission, updateGame } from '../../../src/game/sim/api';
import { WAVE_BREATHER } from '../../../src/game/sim/constants';
import type { GameState, Powerup } from '../../../src/game/sim/types';

function stoppedAt(state: GameState, x: number, y: number, hp: number): GameState {
  return {
    ...state,
    submarine: {
      ...state.submarine,
      x,
      y,
      speed: 0,
      targetSpeed: 0,
      speedOrder: 'stop',
      hp,
    },
  };
}

describe('playtest progression', () => {
  it('clearing wave 1 starts wave 2 with a battleship and three new pickups', () => {
    let state = startMission(createGame(16));
    expect(state.ships.some((ship) => ship.kind === 'battleship')).toBe(false);
    const pickupsBefore = state.powerups.length;
    state = {
      ...state,
      ships: state.ships.map((ship) => ({ ...ship, sinking: 0 })),
      submarine: { ...state.submarine, speed: 0, targetSpeed: 0 },
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.phase).toBe('playing');
    // OD6 breather is 20s (plans/022). The board stays empty until it elapses.
    expect(state.stats.wave).toBe(1);
    expect(state.messages.some((message) => message.text === 'WAVE 2 INBOUND')).toBe(true);
    const ticks = Math.round((WAVE_BREATHER + 1) / FIXED_DT);
    for (let index = 0; index < ticks && state.stats.wave < 2; index += 1) {
      state = updateGame(state, [], FIXED_DT);
    }
    expect(state.stats.wave).toBe(2);
    expect(state.time).toBeGreaterThanOrEqual(WAVE_BREATHER - FIXED_DT);
    expect(state.time).toBeLessThan(WAVE_BREATHER + 1);
    expect(state.ships.filter((ship) => ship.kind === 'battleship')).toHaveLength(1);
    expect(state.ships.every((ship) => ship.alert === 0.2)).toBe(true);
    expect(state.powerups).toHaveLength(pickupsBefore + 3);
  });

  it('eight sinks on a cleared wave give victory', () => {
    let state = startMission(createGame(21));
    const last = state.ships[0]!;
    state = {
      ...state,
      ships: [{ ...last, sinking: 0 }],
      stats: { ...state.stats, shipsSunk: 7 },
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.stats.shipsSunk).toBe(8);
    expect(state.phase).toBe('victory');
  });

  it('zero hull ends the patrol and createGame(seed) starts a fresh boat', () => {
    const seed = 20;
    let state = startMission(createGame(seed));
    state = { ...state, submarine: { ...state.submarine, hp: 0 } };
    state = updateGame(state, [], FIXED_DT);
    expect(state.phase).toBe('gameover');
    expect(state.submarine.hp).toBe(0);

    const fresh = createGame(seed);
    expect(fresh.phase).toBe('menu');
    expect(fresh.seed).toBe(seed);
    expect(fresh.time).toBe(0);
    expect(fresh.stats.shipsSunk).toBe(0);
    expect(fresh.stats.wave).toBe(1);
    expect(fresh.submarine.hp).toBe(fresh.submarine.maxHp);
  });

  it('holding still inside the FOB repairs the hull and restocks magazines', () => {
    let state = startMission(createGame(12));
    state = stoppedAt(state, state.base.x, state.base.y, 40);
    state = {
      ...state,
      time: 0,
      submarine: { ...state.submarine, torpedoes: 0, seekers: 0, cmCharges: 0, decoys: 0 },
    };
    state = updateGame(state, [], 2);
    expect(state.submarine.docked).toBe(true);
    expect(state.submarine.hp).toBeGreaterThan(40);
    expect(state.submarine.torpedoes).toBeGreaterThan(0);
    expect(state.submarine.cmCharges).toBe(1);
    expect(state.submarine.decoys).toBe(1);
  });

  it.each(['health', 'ammo', 'hull', 'weapon', 'speed', 'counter'] as const)(
    'collecting a %s pickup applies that bonus',
    (kind: Powerup['kind']) => {
      let state = startMission(createGame(16));
      const beforeSpeed = 2.4;
      state = {
        ...state,
        submarine: {
          ...state.submarine,
          hp: 20,
          maxHp: 100,
          torpedoes: 0,
          seekers: 0,
          cmCharges: 0,
          decoys: 0,
          hullTier: 0,
          weaponTier: 0,
          speedTier: 0,
          maxSpeed: beforeSpeed,
        },
        powerups: [
          { id: kind, kind, x: state.submarine.x, y: state.submarine.y, life: 90 },
        ],
      };
      state = updateGame(state, [], FIXED_DT);
      expect(state.stats.powerupsTaken).toBe(1);
      if (kind === 'health') expect(state.submarine.hp).toBeGreaterThan(20);
      if (kind === 'ammo') {
        expect(state.submarine.torpedoes).toBe(state.submarine.maxTorpedoes);
        expect(state.submarine.seekers).toBe(2);
      }
      if (kind === 'hull') {
        expect(state.submarine.hullTier).toBe(1);
        expect(state.submarine.maxHp).toBe(120);
      }
      if (kind === 'weapon') expect(state.submarine.weaponTier).toBe(1);
      if (kind === 'speed') expect(state.submarine.maxSpeed).toBeCloseTo(beforeSpeed + 0.18, 5);
      if (kind === 'counter') {
        expect(state.submarine.cmCharges).toBe(state.submarine.maxCmCharges);
        expect(state.submarine.decoys).toBe(3);
      }
    },
  );
});
