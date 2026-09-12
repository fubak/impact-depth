import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  setAutopilot,
  setDepthOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';

describe('engagement stand-down after kill', () => {
  it('Ambush does not retask other ships after the selected contact sinks', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 30; i++) state = updateGame(state, [], FIXED_DT);

    const merchant = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
    const others = state.ships.filter((s) => s.id !== merchant.id);
    expect(others.length).toBeGreaterThan(0);

    state = {
      ...state,
      selectedTargetId: merchant.id,
      ships: state.ships.map((s) =>
        s.id === merchant.id
          ? { ...s, hp: 1, alert: 0, holdContact: 0, weaponCooldown: 99 }
          : { ...s, alert: 0, holdContact: 0, weaponCooldown: 99 },
      ),
      submarine: {
        ...state.submarine,
        x: merchant.x - 7,
        y: merchant.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
        invuln: 600,
        hp: 100,
        sysFlood: 0,
        torpedoes: 8,
        seekers: 4,
        reloadMk14: 0,
        reloadMk18: 0,
      },
    };

    state = setAutopilot(state, 'ambush', merchant.id);

    let sawKill = false;
    for (let i = 0; i < Math.ceil(90 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      const live = state.ships.find((s) => s.id === merchant.id && s.sinking === undefined);
      if (!live) {
        sawKill = true;
        // Give AP one more tick to react to the missing preferred lock.
        state = updateGame(state, [], FIXED_DT);
        break;
      }
    }

    expect(sawKill || state.stats.shipsSunk > 0).toBe(true);
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');
    expect(state.autopilot.targetId).toBeNull();
    expect(state.selectedTargetId).toBeNull();
    expect(state.messages.some((m) => m.text.includes('CONTACT DESTROYED'))).toBe(true);
    // Other contacts remain — Ambush must not have locked them.
    expect(state.ships.some((s) => s.sinking === undefined && s.id !== merchant.id)).toBe(true);
  });

  for (const tactic of ['stalk', 'intercept'] as const) {
    it(`${tactic} also stands down after the locked contact is gone`, () => {
      let state = startMission(createGame(21));
      for (let i = 0; i < 20; i++) state = updateGame(state, [], FIXED_DT);
      const merchant = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
      const remaining = state.ships.filter((s) => s.id !== merchant.id);

      state = {
        ...state,
        selectedTargetId: merchant.id,
        ships: remaining,
        submarine: { ...state.submarine, invuln: 200, hp: 100, sysFlood: 0 },
        autopilot: {
          enabled: true,
          tactic,
          targetId: merchant.id,
          phase: 'approach',
          phaseTimer: 1,
          shotTimer: 0,
          waypoint: null,
          path: [],
          repathTimer: 0,
        },
      };

      state = updateGame(state, [], FIXED_DT);
      expect(state.autopilot.enabled).toBe(false);
      expect(state.autopilot.tactic).toBe('manual');
      expect(state.selectedTargetId).toBeNull();
      expect(state.messages.some((m) => m.text.includes('CONTACT DESTROYED'))).toBe(true);
    });
  }
});
