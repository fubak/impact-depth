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

  it('a torpedo hit alerts the victim and nearby warships so the hunt is on', () => {
    let state = startMission(createGame(19));
    for (let i = 0; i < 60; i++) state = updateGame(state, [], FIXED_DT);
    const victim = state.ships.find((s) => s.kind === 'merchant')!;
    const escort = state.ships.find((s) => s.kind !== 'merchant' && s.id !== victim.id)!;
    state = {
      ...state,
      selectedTargetId: victim.id,
      ships: state.ships.map((s) =>
        s.id === escort.id ? { ...s, x: victim.x + 8, y: victim.y, alert: 0, holdContact: 0 } : { ...s, alert: 0, holdContact: 0 },
      ),
      submarine: { ...state.submarine, x: victim.x - 2.4, y: victim.y, heading: 0, z: 0.28, targetDepth: 0.28 },
    };
    expect(state.ships.every((s) => s.alert === 0)).toBe(true);
    state = fireWeapon(state);
    for (let i = 0; i < 300 && state.torpedoes.length > 0; i++) state = updateGame(state, [], FIXED_DT);
    expect(state.messages.some((m) => /HIT/.test(m.text))).toBe(true);
    const alertedEscort = state.ships.find((s) => s.id === escort.id)!;
    // A silent, unseen shooter is only "found" because the impact gave the position away.
    expect(alertedEscort.alert).toBeGreaterThan(0.5);
    expect(alertedEscort.holdContact).toBeGreaterThan(0);
  });

  it('each sinking salvages one Mk-14 up to the magazine limit', () => {
    let state = startMission(createGame(19));
    const doomed = state.ships[0]!;
    state = {
      ...state,
      submarine: { ...state.submarine, torpedoes: 3 },
      ships: state.ships.map((s) => (s.id === doomed.id ? { ...s, sinking: 0.001 } : s)),
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.submarine.torpedoes).toBe(4);
    state = {
      ...state,
      submarine: { ...state.submarine, torpedoes: state.submarine.maxTorpedoes },
      ships: state.ships.map((s, i) => (i === 0 ? { ...s, sinking: 0.001 } : s)),
    };
    state = updateGame(state, [], FIXED_DT);
    expect(state.submarine.torpedoes).toBe(state.submarine.maxTorpedoes);
  });

  it('a fresh hull survives an escort\'s opening hedgehog volley so the player can react', () => {
    let state = startMission(createGame(19));
    const escort = state.ships.find((s) => s.kind === 'cruiser')!;
    state = {
      ...state,
      ships: state.ships.map((s) =>
        s.id === escort.id
          ? { ...s, x: state.submarine.x + 0.8, y: state.submarine.y, alert: 1, holdContact: 8, weaponCooldown: 0 }
          : { ...s, x: s.x + 200, y: s.y + 200 },
      ),
      submarine: { ...state.submarine, invuln: 0, hp: 100, noise: 0.6, silentRunning: false },
    };
    let minHp = state.submarine.hp;
    for (let i = 0; i < Math.ceil(4 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      minHp = Math.min(minHp, state.submarine.hp);
    }
    expect(minHp).toBeLessThan(100);
    expect(minHp).toBeGreaterThan(75);
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
