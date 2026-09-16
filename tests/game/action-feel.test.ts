import { describe, expect, it } from 'vitest';
import {
  actionTimeScale,
  emergencySurface,
  shouldTimeCompress,
} from '../../src/game/sim/action-feel';
import { createGame, fireWeapon, startMission } from '../../src/game/sim/api';
import { WORLD_CENTER } from '../../src/game/sim/constants';

describe('action feel', () => {
  it('compresses time only when the plot is empty', () => {
    const idle = startMission(createGame(19));
    const far = {
      ...idle,
      ships: idle.ships.map((ship) => ({ ...ship, x: WORLD_CENTER + 80, y: WORLD_CENTER + 80 })),
    };
    expect(shouldTimeCompress(far)).toBe(true);
    expect(actionTimeScale(far)).toBe(4);
    const loud = { ...far, sonarPing: 2 };
    expect(shouldTimeCompress(loud)).toBe(false);
  });

  it('spawns wave-1 contacts inside the close-stalk radius', () => {
    const state = startMission(createGame(19));
    const sub = state.submarine;
    const nearest = Math.min(
      ...state.ships.map((ship) => Math.hypot(ship.x - sub.x, ship.y - sub.y)),
    );
    expect(nearest).toBeLessThan(40);
    expect(state.viewMode).toBe('chase');
  });

  it('emergency surface orders shallow and makes noise', () => {
    let state = startMission(createGame(19));
    state = {
      ...state,
      submarine: { ...state.submarine, z: 0.7, targetDepth: 0.7, noise: 0.1 },
    };
    const next = emergencySurface(state);
    expect(next.submarine.targetDepth).toBeCloseTo(0.06, 5);
    expect(next.submarine.noise).toBeGreaterThan(state.submarine.noise);
  });

  it('deck gun fires a shell when surfaced and close', () => {
    let state = startMission(createGame(19));
    const prey = state.ships.find((ship) => ship.kind === 'merchant')!;
    state = {
      ...state,
      selectedTargetId: prey.id,
      submarine: {
        ...state.submarine,
        x: prey.x + 2,
        y: prey.y,
        z: 0.08,
        targetDepth: 0.08,
      },
    };
    const fired = fireWeapon(state);
    expect(fired.messages.some((m) => m.text.startsWith('DECK GUN'))).toBe(true);
    const after = fired.ships.find((ship) => ship.id === prey.id)!;
    expect(after.hp).toBeLessThan(prey.hp);
  });
});
