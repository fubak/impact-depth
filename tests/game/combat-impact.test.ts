import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  fireWeapon,
  selectTarget,
  setAutopilot,
  setDepthOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';

describe('torpedo impact and tactics', () => {
  it('hits a nearby locked target and reports HIT', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 180; i++) state = updateGame(state, [], FIXED_DT);
    const ship = state.ships[0]!;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 2.4,
        y: ship.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
      },
    };
    const hpBefore = ship.hp;
    state = fireWeapon(state);
    expect(state.torpedoes.length).toBe(1);
    for (let i = 0; i < 300; i++) {
      state = updateGame(state, [], FIXED_DT);
      if (state.torpedoes.length === 0) break;
    }
    const after = state.ships.find((s) => s.id === ship.id);
    expect(state.torpedoes.length).toBe(0);
    expect(after ? after.hp : 0).toBeLessThan(hpBefore);
    expect(state.messages.some((m) => /HIT/.test(m.text))).toBe(true);
  });

  it('ambush autopilot closes range and can fire a shot', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    const targetId = state.ships[0]!.id;
    state = selectTarget(state, targetId);
    state = {
      ...state,
      submarine: { ...state.submarine, invuln: 120, hp: 100, sysFlood: 0 },
    };
    state = setAutopilot(state, 'ambush', targetId);
    let fired = 0;
    const start = { x: state.submarine.x, y: state.submarine.y };
    const startHp = state.ships[0]!.hp;
    const startDist = Math.hypot(state.submarine.x - state.ships[0]!.x, state.submarine.y - state.ships[0]!.y);
    for (let i = 0; i < Math.ceil(90 / FIXED_DT); i++) {
      const before = state.torpedoes.length;
      state = updateGame(state, [], FIXED_DT);
      if (state.torpedoes.length > before) fired += 1;
      if (fired > 0 && (state.stats.damageDealt > 0 || state.messages.some((m) => /HIT/.test(m.text)))) break;
    }
    const moved = Math.hypot(state.submarine.x - start.x, state.submarine.y - start.y);
    const live = state.ships.find((s) => s.id === targetId);
    const endDist = live
      ? Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y)
      : 0;
    const endHp = live?.hp ?? 0;
    expect(state.autopilot.enabled).toBe(true);
    expect(['ambush', 'manual'].includes(state.autopilot.tactic) || state.autopilot.phase === 'breakaway').toBe(true);
    expect(moved).toBeGreaterThan(5);
    expect(endDist === 0 || endDist < startDist - 2).toBe(true);
    expect(fired).toBeGreaterThan(0);
    expect(endHp < startHp || state.messages.some((m) => /HIT/.test(m.text))).toBe(true);
  });
});
