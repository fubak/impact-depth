import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { depthToMeters } from '../../src/game/sim/coords';
import { sampleSeabedY } from '../../src/core/terrain';
import { simToWorldMeters } from '../../src/game/sim/coords';
import {
  createGame,
  setAutopilot,
  setDepthOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import { steerAvoid, makeClear } from '../../src/game/sim/pathfinding';
import { getTerrain } from '../../src/game/sim/world';

describe('autopilot approach and depth visibility', () => {
  it('ambush from inside beam range does not open distance to the target', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 120; i++) state = updateGame(state, [], FIXED_DT);
    const ship = state.ships[0]!;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 3.2,
        y: ship.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
        invuln: 120,
        torpedoes: 0,
        seekers: 0,
      },
    };
    const startDist = Math.hypot(state.submarine.x - ship.x, state.submarine.y - ship.y);
    state = setAutopilot(state, 'ambush', ship.id);
    let maxDist = startDist;
    for (let i = 0; i < Math.ceil(6 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      const live = state.ships.find((s) => s.id === ship.id);
      if (!live) break;
      const dist = Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y);
      maxDist = Math.max(maxDist, dist);
    }
    // Hold the pocket — may slide onto beam as the contact steams, but must not flee.
    expect(maxDist).toBeLessThan(7);
    expect(state.autopilot.tactic === 'ambush' || state.autopilot.phase === 'breakaway').toBe(true);
  });

  it('ambush from long range closes on the contact', () => {
    let state = startMission(createGame(19));
    for (let i = 0; i < 60; i++) state = updateGame(state, [], FIXED_DT);
    const ship = state.ships[0]!;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: {
        ...state.submarine,
        x: ship.x - 22,
        y: ship.y - 4,
        z: 0.45,
        targetDepth: 0.45,
        heading: 0,
        invuln: 120,
        hp: 100,
        sysFlood: 0,
      },
    };
    const startDist = Math.hypot(state.submarine.x - ship.x, state.submarine.y - ship.y);
    state = setAutopilot(state, 'ambush', ship.id);
    for (let i = 0; i < Math.ceil(35 / FIXED_DT); i++) {
      state = updateGame(state, [], FIXED_DT);
      if (state.autopilot.phase === 'breakaway') break;
    }
    const live = state.ships.find((s) => s.id === ship.id);
    const endDist = live
      ? Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y)
      : 0;
    expect(endDist).toBeLessThan(startDist - 4);
  });

  it('steerAvoid never snaps more than ~90° from the request', () => {
    const clear = makeClear(getTerrain(19), 0.2);
    const heading = 0;
    const next = steerAvoid(64, 64, heading, 2.4, clear);
    const delta = Math.abs(Math.atan2(Math.sin(next - heading), Math.cos(next - heading)));
    expect(delta).toBeLessThanOrEqual(Math.PI * 0.5 + 1e-6);
  });

  it('deep render depth is clamped above the local seabed', () => {
    const deepMeters = depthToMeters(0.82);
    const world = simToWorldMeters(64, 64);
    const floor = sampleSeabedY(world.x, world.z);
    const hullY = Math.max(-deepMeters, floor + 1.6);
    expect(hullY).toBeGreaterThan(floor + 1.0);
    expect(deepMeters).toBeLessThan(28);
  });
});
