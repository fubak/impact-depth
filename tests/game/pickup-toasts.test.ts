import { describe, expect, it } from 'vitest';
import { derivePickupToasts } from '../../src/game/adapt/pickup-toasts';
import { createGame, startMission } from '../../src/game/sim/api';
import type { GameState, Powerup } from '../../src/game/sim/types';

function setup(): GameState {
  return startMission(createGame(7));
}

function crate(s: GameState, overrides: Partial<Powerup> = {}): Powerup {
  return {
    id: 'loot-1',
    kind: 'health',
    x: s.submarine.x,
    y: s.submarine.y,
    life: 30,
    rarity: 'rare',
    ...overrides,
  };
}

describe('derivePickupToasts', () => {
  it('toasts a collected rare health crate', () => {
    const s = setup();
    const prev: GameState = { ...s, powerups: [crate(s)] };
    const next: GameState = {
      ...s,
      powerups: [],
      stats: { ...s.stats, powerupsTaken: s.stats.powerupsTaken + 1 },
    };
    expect(derivePickupToasts(prev, next)).toEqual([
      { id: 'pickup-loot-1', rarity: 'rare', text: 'RARE CRATE: +60 hull' },
    ]);
  });

  it('returns nothing when the taken counter did not move', () => {
    const s = setup();
    const prev: GameState = { ...s, powerups: [crate(s)] };
    const next: GameState = { ...s, powerups: [] };
    expect(derivePickupToasts(prev, next)).toEqual([]);
  });

  it('ignores a far crate that vanished without being taken nearby (expired)', () => {
    const s = setup();
    const far = crate(s, { x: s.submarine.x + 500, y: s.submarine.y + 500 });
    const prev: GameState = { ...s, powerups: [far] };
    const next: GameState = {
      ...s,
      powerups: [],
      stats: { ...s.stats, powerupsTaken: s.stats.powerupsTaken + 1 },
    };
    expect(derivePickupToasts(prev, next)).toEqual([]);
  });
});
