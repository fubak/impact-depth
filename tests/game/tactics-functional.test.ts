import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  setAutopilot,
  setDepthOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import type { AutopilotTactic } from '../../src/game/sim/types';

const distTo = (state: { submarine: { x: number; y: number } }, point: { x: number; y: number }) =>
  Math.hypot(point.x - state.submarine.x, point.y - state.submarine.y);

function prep(seed = 19) {
  let state = startMission(createGame(seed));
  for (let i = 0; i < 90; i++) state = updateGame(state, [], FIXED_DT);
  const ship = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
  return { state, ship };
}

describe('all tactics functional', () => {
  it('selecting ambush inside fire range does not instantly breakaway or flee', () => {
    const { ship, state: initialState } = prep();
    let state = initialState;
    state = setDepthOrder(state, 'periscope');
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 6,
        y: ship.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
        invuln: 120,
        hp: 100,
        sysFlood: 0,
        reloadMk14: 0,
        torpedoes: 6,
      },
    };
    state = setAutopilot(state, 'ambush', ship.id);
    expect(['approach', 'setup']).toContain(state.autopilot.phase);
    expect(state.autopilot.shotTimer).toBeGreaterThan(2);
    expect(state.stats.torpedoesFired).toBe(0);

    const startDist = distTo(state, ship);
    let maxDist = startDist;
    for (let i = 0; i < Math.ceil(2.8 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      expect(state.autopilot.phase).not.toBe('breakaway');
      const live = state.ships.find((s) => s.id === ship.id)!;
      maxDist = Math.max(maxDist, distTo(state, live));
    }
    expect(state.stats.torpedoesFired).toBe(0);
    expect(maxDist).toBeLessThan(startDist + 2.5);
  });

  it('ambush pointed away turns and closes without a long reverse', () => {
    const { ship, state: initialState } = prep();
    let state = initialState;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 18,
        y: ship.y,
        heading: Math.PI,
        speed: state.submarine.maxSpeed * 0.85,
        targetSpeed: state.submarine.maxSpeed * 0.85,
        invuln: 200,
        hp: 100,
        sysFlood: 0,
        torpedoes: 0,
      },
    };
    const startDist = distTo(state, ship);
    state = setAutopilot(state, 'ambush', ship.id);
    for (let i = 0; i < Math.ceil(14 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const live = state.ships.find((s) => s.id === ship.id)!;
    expect(distTo(state, live)).toBeLessThan(startDist - 4);
  });

  it('stalk closes from long range toward a trail station', () => {
    const { ship, state: initialState } = prep(21);
    let state = initialState;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 20,
        y: ship.y + 2,
        heading: Math.PI,
        invuln: 200,
        hp: 100,
        sysFlood: 0,
        torpedoes: 0,
      },
    };
    const startDist = distTo(state, ship);
    state = setAutopilot(state, 'stalk', ship.id);
    for (let i = 0; i < Math.ceil(18 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const live = state.ships.find((s) => s.id === ship.id)!;
    expect(distTo(state, live)).toBeLessThan(startDist - 3);
  });

  it('intercept sprints closed and is not silent at long range', () => {
    const { ship, state: initialState } = prep(22);
    let state = initialState;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 20,
        y: ship.y,
        heading: 0,
        invuln: 200,
        hp: 100,
        sysFlood: 0,
        torpedoes: 0,
        seekers: 0,
      },
    };
    state = setAutopilot(state, 'intercept', ship.id);
    state = updateGame(state, [], FIXED_DT);
    expect(state.submarine.silentRunning).toBe(false);
    const startDist = distTo(state, ship);
    for (let i = 0; i < Math.ceil(14 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const live = state.ships.find((s) => s.id === ship.id)!;
    expect(distTo(state, live)).toBeLessThan(startDist - 4);
  });

  it('evade opens range from the nearest combat threat', () => {
    const { ship, state: initialState } = prep(23);
    let state = initialState;
    const escort = state.ships.find((s) => s.kind === 'destroyer' || s.kind === 'patrol') ?? ship;
    state = {
      ...state,
      selectedTargetId: escort.id,
      submarine: {
        ...state.submarine,
        x: escort.x - 5,
        y: escort.y,
        heading: 0,
        invuln: 200,
        hp: 100,
        sysFlood: 0,
      },
    };
    const startDist = distTo(state, escort);
    state = setAutopilot(state, 'evade', escort.id);
    for (let i = 0; i < Math.ceil(8 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const live = state.ships.find((s) => s.id === escort.id) ?? escort;
    expect(distTo(state, live)).toBeGreaterThan(startDist + 2);
  });

  it('exfil / RTB closes on FOB Argus', () => {
    let { state } = prep(24);
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: state.base.x + 30,
        y: state.base.y + 10,
        heading: Math.PI,
        invuln: 200,
        hp: 100,
        sysFlood: 0,
      },
    };
    const startDist = distTo(state, state.base);
    state = setAutopilot(state, 'exfil');
    for (let i = 0; i < Math.ceil(16 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    expect(distTo(state, state.base)).toBeLessThan(startDist - 5);
    expect(state.autopilot.tactic).toBe('exfil');
  });

  for (const tactic of ['ambush', 'stalk', 'intercept'] as AutopilotTactic[]) {
    it(`${tactic} eventually fires after grace when in the pocket`, () => {
      const { ship, state: initialState } = prep(30);
      let state = initialState;
      state = setDepthOrder(state, 'periscope');
      state = {
        ...state,
        selectedTargetId: ship.id,
        submarine: {
          ...state.submarine,
          x: ship.x - 7,
          y: ship.y,
          z: 0.28,
          targetDepth: 0.28,
          heading: 0,
          invuln: 200,
          hp: 100,
          sysFlood: 0,
          reloadMk14: 0,
          reloadMk18: 0,
          torpedoes: 6,
          seekers: 4,
        },
      };
      state = setAutopilot(state, tactic, ship.id);
      let fired = 0;
      for (let i = 0; i < Math.ceil(25 / FIXED_DT); i++) {
        const before = state.torpedoes.length;
        state = updateGame(state, [], FIXED_DT);
        if (state.torpedoes.length > before) fired += 1;
        if (fired > 0) break;
      }
      expect(fired).toBeGreaterThan(0);
    });
  }
});
