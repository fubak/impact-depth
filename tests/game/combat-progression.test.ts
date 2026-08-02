import { describe, expect, it } from 'vitest';
import {
  createGame, deployCountermeasure, fireWeapon, setWeapon, startMission, updateGame,
} from '../../src/game/sim/api';
import type { Powerup } from '../../src/game/sim/types';

const step = (state: ReturnType<typeof createGame>, seconds = 1 / 60) => updateGame(state, [], seconds);

describe('combat and progression', () => {
  it('fires spread Mk-14s and Mk-18s with independent magazines and reloads', () => {
    let state = startMission(createGame(4));
    state = { ...state, torpedoSpread: true, selectedTargetId: state.ships[0]!.id };
    state = fireWeapon(state);
    expect(state.torpedoes).toHaveLength(3);
    expect(state.submarine.torpedoes).toBe(5);
    expect(state.submarine.reloadMk14).toBeCloseTo(3.8);

    state = step(state, 4);
    state = setWeapon(state, 'seeker');
    state = fireWeapon(state);
    expect(state.torpedoes.some((torpedo) => torpedo.kind === 'mk18')).toBe(true);
    expect(state.submarine.seekers).toBe(3);
    expect(state.submarine.reloadMk18).toBeCloseTo(3.4);
  });

  it('rejects invalid threat sources and expires countermeasures', () => {
    let state = startMission(createGame(8));
    state = updateGame(state, [{ type: 'spawnThreat', threat: 'depthCharge', sourceId: 'missing' }], 0);
    expect(state.depthCharges).toHaveLength(0);
    state = updateGame(state, [{ type: 'spawnThreat', threat: 'depthCharge', sourceId: state.ships[1]!.id }], 0);
    expect(state.depthCharges).toHaveLength(1);

    state = deployCountermeasure(state);
    expect(state.countermeasures[0]?.kind).toBe('bubble');
    state = step(state, 10.1);
    expect(state.countermeasures).toHaveLength(0);
  });

  it('docks at FOB to repair, restock, and protect the player', () => {
    let state = startMission(createGame(12));
    state = {
      ...state,
      submarine: { ...state.submarine, x: state.base.x, y: state.base.y, speed: 0, targetSpeed: 0, speedOrder: 'stop', hp: 40, torpedoes: 0, seekers: 0 },
    };
    state = step(state, 1);
    expect(state.submarine.docked).toBe(true);
    expect(state.submarine.hp).toBeGreaterThan(40);
    expect(state.submarine.torpedoes).toBeGreaterThan(0);
    state = updateGame(state, [{ type: 'spawnThreat', threat: 'torpedo', sourceId: state.ships[0]!.id }], 0);
    expect(state.torpedoes.every((torpedo) => torpedo.owner === 'player')).toBe(true);
  });

  it('applies every capped powerup and only wins after an eight-sink cleared wave', () => {
    let state = startMission(createGame(16));
    const kinds: Powerup['kind'][] = ['health', 'ammo', 'hull', 'weapon', 'speed', 'counter'];
    state = {
      ...state,
      submarine: { ...state.submarine, hp: 20, torpedoes: 0, seekers: 0, cmCharges: 0, decoys: 0 },
      powerups: kinds.map((kind, index) => ({ id: kind, kind, x: state.submarine.x + index * 0.1, y: state.submarine.y, life: 90 })),
    };
    state = step(state);
    expect(state.submarine.hp).toBeGreaterThan(20);
    expect(state.submarine.torpedoes).toBe(state.submarine.maxTorpedoes);
    expect(state.submarine.hullTier).toBe(1);
    expect(state.submarine.weaponTier).toBe(1);
    expect(state.submarine.speedTier).toBe(1);
    expect(state.submarine.cmCharges).toBe(state.submarine.maxCmCharges);

    state = { ...state, ships: state.ships.map((ship) => ({ ...ship, sinking: 0 })), stats: { ...state.stats, shipsSunk: 7 } };
    state = step(state, 1 / 60);
    expect(state.phase).toBe('victory');
    expect(state.stats.score).toBeGreaterThanOrEqual(1000);
  });

  it('ends the patrol when submarine HP reaches zero', () => {
    let state = startMission(createGame(20));
    state = { ...state, submarine: { ...state.submarine, hp: 0 } };
    state = step(state);
    expect(state.phase).toBe('gameover');
  });
});
