import { describe, expect, it } from 'vitest';
import { createGame, fireWeapon, startMission, updateGame } from '../../src/game/sim/api';
import { createTerrain } from '../../src/game/sim/world';

describe('patrol vertical slice', () => {
  it('uses identical terrain and spawns for the same seed', () => {
    const a = createGame(77);
    const b = createGame(77);
    expect(createTerrain(a.terrainSeed).heights).toEqual(createTerrain(b.terrainSeed).heights);
    expect(a.submarine.x).toBe(b.submarine.x);
    expect(a.submarine.y).toBe(b.submarine.y);
    expect(a.ships[0]?.x).toBe(b.ships[0]?.x);
    expect(a.ships[0]?.y).toBe(b.ships[0]?.y);
  });

  it('sinks the freighter with a deterministic Mk-14 command stream', () => {
    let state = startMission(createGame(19));
    const freighterId = state.ships[0]!.id;
    const target = state.ships[0]!;
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: target.x - 6,
        y: target.y,
        heading: 0,
        speed: 0,
        targetSpeed: 0,
        z: 0.5,
        targetDepth: 0.5,
      },
      selectedTargetId: freighterId,
    };
    state = fireWeapon(state);
    expect(state.torpedoes.length).toBe(1);
    expect(state.submarine.torpedoes).toBe(7);

    for (let i = 0; i < 600 && state.phase === 'playing'; i++) {
      state = updateGame(state, [], 1 / 60);
    }
    expect(state.phase).toBe('victory');
    expect(state.stats.shipsSunk).toBeGreaterThanOrEqual(1);
    expect(state.stats.score).toBeGreaterThanOrEqual(150);
  });
});
