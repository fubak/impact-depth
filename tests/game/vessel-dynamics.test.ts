import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { BLOW_DURATION, advanceDepth, maxDepthRate } from '../../src/game/sim/vessel-dynamics';
import type { GameState } from '../../src/game/sim/types';
import type { GameCommand } from '../../src/game/commands/types';

function mission(seed = 19): GameState {
  return startMission(createGame(seed));
}

/** A lone boat in open water — no contacts, no terrain interference. */
function loneBoat(state: GameState, partial: Partial<GameState['submarine']> = {}): GameState {
  return {
    ...state,
    ships: [],
    aircraft: [],
    depthCharges: [],
    torpedoes: [],
    shells: [],
    countermeasures: [],
    autopilot: { ...state.autopilot, enabled: false },
    submarine: {
      ...state.submarine,
      x: 0,
      y: 0,
      z: 0.4,
      targetDepth: 0.4,
      heading: 0,
      yawRate: 0,
      depthRate: 0,
      invuln: 0,
      silentRunning: false,
      ...partial,
    },
  };
}

function run(
  state: GameState,
  seconds: number,
  command?: () => GameCommand[],
): GameState {
  let next = state;
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    next = updateGame(next, command?.() ?? [], FIXED_DT);
  }
  return next;
}

describe('vessel dynamics', () => {
  it('a dead-in-the-water boat turns far slower than one making way', () => {
    // Rudder authority scales with flow over the planes — this is why the
    // helm feels "weighty" at the dock but responsive at speed.
    const helm: GameCommand[] = [{ type: 'helm', surge: 0, yaw: 1, depth: 0 }];
    const stopped = loneBoat(mission(), { speed: 0, targetSpeed: 0 });
    const making = loneBoat(mission(), {
      speed: 1.6, // ~2/3 of maxSpeed 2.4
      targetSpeed: 1.6,
    });
    const turnedStopped = run(stopped, 1, () => helm).submarine;
    const turnedMaking = run(making, 1, () => helm).submarine;
    expect(turnedMaking.heading).toBeGreaterThan(turnedStopped.heading * 1.5);
    expect(turnedStopped.heading).toBeGreaterThan(0); // still answers, weakly
  });

  it('banks into the turn so the sail leans inward', () => {
    const helm: GameCommand[] = [{ type: 'helm', surge: 0, yaw: 1, depth: 0 }];
    const state = run(
      loneBoat(mission(), { speed: 1.6, targetSpeed: 1.6 }),
      1.5,
      () => helm,
    ).submarine;
    // yawRate is consumed and reset inside the step; the visible truth is the
    // hull heeling inboard (heading grew, so inward is negative roll).
    expect(state.heading).toBeGreaterThan(0);
    expect(state.bank).toBeLessThan(-0.05);
  });

  it('dive planes barely bite at zero speed but run deep at flank', () => {
    // depthRate is capped by speed ratio — a stopped boat cannot crash-dive.
    const base = {
      z: 0.4,
      targetDepth: 0.9,
      sysFlood: 0,
      depthRate: 0,
      blowTimer: 0,
      maxSpeed: 2.4,
    };
    let stopped = { ...base, speed: 0 };
    let flank = { ...base, speed: 2.4 };
    for (let i = 0; i < Math.round(4 / FIXED_DT); i++) {
      stopped = { ...stopped, ...advanceDepth(stopped, FIXED_DT) };
      flank = { ...flank, ...advanceDepth(flank, FIXED_DT) };
    }
    expect(maxDepthRate(stopped)).toBeCloseTo(0.035);
    expect(flank.depthRate).toBeGreaterThan(stopped.depthRate * 2.5);
    expect(flank.z).toBeGreaterThan(stopped.z + 0.1); // real water over the planes
    expect(stopped.z - 0.4).toBeLessThan(0.15); // barely moved in 4 s
  });

  it('emergency blow surfaces a stopped, flooded boat', () => {
    // Without the blow a flooded boat at zero speed cannot overcome the
    // downward bias; with it, buoyancy wins regardless of way on.
    const state = loneBoat(mission(), {
      z: 0.6,
      targetDepth: 0.6,
      speed: 0,
      targetSpeed: 0,
      sysFlood: 0.9,
    });
    const blown = run(
      {
        ...state,
        submarine: { ...state.submarine, blowTimer: BLOW_DURATION, targetDepth: 0.06 },
      },
      4,
    ).submarine;
    expect(blown.z).toBeLessThan(0.25);
    const unblown = run(state, 4).submarine;
    expect(unblown.z).toBeGreaterThan(0.5); // stays heavy without the blow
  });
});
