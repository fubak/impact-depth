import { describe, expect, it } from 'vitest';
import {
  FIXED_DT,
  createControlIntent,
  createInitialSim,
  setViewMode,
  stepSim,
  type ControlIntent,
} from '../src/core/sim';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { SimState, ViewMode } from '../src/core/types';

/** Timestamped (fixed-step index) command applied before that step runs. */
export type ReplayCommand = {
  atStep: number;
  intent?: Partial<ControlIntent>;
  viewMode?: ViewMode;
};

/** Stable movement-focused snapshot for deterministic comparison. */
export function serializeSnapshot(state: SimState): string {
  const vessel = {
    x: state.vessel.x,
    z: state.vessel.z,
    depth: state.vessel.depth,
    heading: state.vessel.heading,
    speed: state.vessel.speed,
    targetSpeed: state.vessel.targetSpeed,
    engineOrder: state.vessel.engineOrder,
    battery: state.vessel.battery,
    noise: state.vessel.noise,
    heave: state.vessel.heave,
    pitch: state.vessel.pitch,
    roll: state.vessel.roll,
  };
  const ships = state.ships.map((s) => ({
    id: s.id,
    kind: s.kind,
    x: s.x,
    z: s.z,
    heading: s.heading,
    speed: s.speed,
    heave: s.heave,
    pitch: s.pitch,
    roll: s.roll,
  }));
  return JSON.stringify({
    time: state.time,
    paused: state.paused,
    viewMode: state.viewMode,
    vessel,
    ships,
  });
}

/** Apply a command stream for `stepCount` fixed steps; return per-step snapshots. */
export function runReplay(commands: ReplayCommand[], stepCount: number): string[] {
  let state = createInitialSim();
  let intent = createControlIntent();
  const byStep = new Map<number, ReplayCommand[]>();
  for (const cmd of commands) {
    const list = byStep.get(cmd.atStep) ?? [];
    list.push(cmd);
    byStep.set(cmd.atStep, list);
  }

  const snapshots: string[] = [];
  for (let step = 0; step < stepCount; step++) {
    const pending = byStep.get(step);
    if (pending) {
      for (const cmd of pending) {
        if (cmd.intent) intent = { ...intent, ...cmd.intent };
        if (cmd.viewMode) state = setViewMode(state, cmd.viewMode);
      }
    }
    state = stepSim(state, intent, DEFAULT_SETTINGS, FIXED_DT);
    snapshots.push(serializeSnapshot(state));
  }
  return snapshots;
}

/** Canonical fixture: helm + depth + mode changes over 600 fixed steps (~10s). */
export const REPLAY_FIXTURE: ReplayCommand[] = [
  { atStep: 0, intent: { surge: 1, yaw: 0, depth: 0 } },
  { atStep: 60, intent: { yaw: -1 } },
  { atStep: 120, intent: { yaw: 0, depth: 1 } },
  { atStep: 180, viewMode: 'periscope' },
  { atStep: 240, intent: { surge: 0, depth: -1 } },
  { atStep: 300, viewMode: 'sonar' },
  { atStep: 360, intent: { surge: 1, yaw: 1, depth: 0 } },
  { atStep: 420, viewMode: 'tactical' },
  { atStep: 480, intent: { surge: 0, yaw: 0, depth: 0 } },
];

const REPLAY_STEPS = 600;

describe('deterministic replay', () => {
  it('reproduces identical snapshots for the same command stream over 600 steps', () => {
    const a = runReplay(REPLAY_FIXTURE, REPLAY_STEPS);
    const b = runReplay(REPLAY_FIXTURE, REPLAY_STEPS);
    expect(a).toHaveLength(REPLAY_STEPS);
    expect(b).toHaveLength(REPLAY_STEPS);
    expect(a).toEqual(b);
    // Final movement state should have advanced
    const final = JSON.parse(a[REPLAY_STEPS - 1]!) as { time: number; vessel: { x: number } };
    expect(final.time).toBeCloseTo(REPLAY_STEPS * FIXED_DT, 8);
    expect(Math.abs(final.vessel.x)).toBeGreaterThan(1);
  });

  it('diverges when one input command differs', () => {
    const altered: ReplayCommand[] = [...REPLAY_FIXTURE, { atStep: 90, intent: { yaw: 1 } }];
    const baseline = runReplay(REPLAY_FIXTURE, REPLAY_STEPS);
    const other = runReplay(altered, REPLAY_STEPS);
    expect(baseline).not.toEqual(other);
    const firstDiff = baseline.findIndex((snap, i) => snap !== other[i]);
    expect(firstDiff).toBeGreaterThanOrEqual(90);
  });
});
