import { describe, expect, it } from 'vitest';
import {
  advanceAccumulator,
  createControlIntent,
  createInitialSim,
  engineOrderLabel,
  FIXED_DT,
  headingDegrees,
  LAB_RADIUS,
  MAX_CATCH_UP_STEPS,
  MAX_FRAME_DT,
  RECYCLE_AHEAD,
  recycleShipIfFar,
  setViewMode,
  stepSim,
  togglePause,
} from '../src/core/sim';
import { DEFAULT_SETTINGS } from '../src/core/settings';

describe('simulation helpers', () => {
  it('advances vessel with surge intent', () => {
    const intent = createControlIntent();
    intent.surge = 1;
    let state = createInitialSim();
    const startSpeed = state.vessel.speed;
    for (let i = 0; i < 120; i++) {
      state = stepSim(state, intent, DEFAULT_SETTINGS, 1 / 60);
    }
    expect(state.vessel.speed).toBeGreaterThan(startSpeed);
    expect(state.time).toBeGreaterThan(1);
  });

  it('changes depth with Q/E intent', () => {
    const intent = createControlIntent();
    intent.depth = 1;
    let state = createInitialSim();
    const start = state.vessel.depth;
    for (let i = 0; i < 60; i++) {
      state = stepSim(state, intent, DEFAULT_SETTINGS, 1 / 60);
    }
    expect(state.vessel.depth).toBeGreaterThan(start);
  });

  it('freezes when paused', () => {
    const intent = createControlIntent();
    intent.surge = 1;
    let state = togglePause(createInitialSim());
    const x = state.vessel.x;
    state = stepSim(state, intent, DEFAULT_SETTINGS, 1 / 60);
    expect(state.vessel.x).toBe(x);
  });

  it('switches view modes', () => {
    const state = setViewMode(createInitialSim(), 'sonar');
    expect(state.viewMode).toBe('sonar');
  });

  it('formats heading and engine labels', () => {
    expect(headingDegrees(0)).toBe(90);
    expect(engineOrderLabel('half')).toBe('HALF AHEAD');
  });

  it('keeps three surface contacts faster than default player half', () => {
    const state = createInitialSim();
    expect(state.ships).toHaveLength(3);
    expect(state.vessel.targetSpeed).toBe(4.5);
    for (const ship of state.ships) {
      expect(ship.speed).toBeGreaterThan(state.vessel.targetSpeed);
    }
  });

  it('applies surge to targetSpeed once per step', () => {
    const intent = createControlIntent();
    intent.surge = 1;
    const state = createInitialSim();
    const before = state.vessel.targetSpeed;
    const next = stepSim(state, intent, DEFAULT_SETTINGS, FIXED_DT);
    const expected = Math.min(9.5, before + 6 * FIXED_DT);
    expect(next.vessel.targetSpeed).toBeCloseTo(expected, 8);
  });
});

describe('fixed-step accumulator', () => {
  it('caps elapsed at MAX_FRAME_DT', () => {
    const tick = advanceAccumulator(0, 2);
    expect(tick.elapsedUsed).toBe(MAX_FRAME_DT);
    expect(tick.steps).toBe(MAX_CATCH_UP_STEPS);
    expect(tick.accum).toBeLessThan(FIXED_DT);
  });

  it('bounds catch-up and drops excess backlog', () => {
    // Start with almost a full backlog already
    const tick = advanceAccumulator(FIXED_DT * 0.9, MAX_FRAME_DT);
    expect(tick.steps).toBeLessThanOrEqual(MAX_CATCH_UP_STEPS);
    expect(tick.accum).toBeGreaterThanOrEqual(0);
    expect(tick.accum).toBeLessThan(FIXED_DT);
  });

  it('accumulates fractional remainders across frames', () => {
    const a = advanceAccumulator(0, FIXED_DT * 0.4);
    expect(a.steps).toBe(0);
    const b = advanceAccumulator(a.accum, FIXED_DT * 0.7);
    expect(b.steps).toBe(1);
    expect(b.accum).toBeCloseTo(FIXED_DT * 0.1, 8);
  });
});

describe('convoy recycling', () => {
  it('leaves ships inside the lab radius untouched', () => {
    const state = createInitialSim();
    const ship = state.ships[0]!;
    const player = state.vessel;
    const out = recycleShipIfFar(ship, player);
    expect(out).toEqual(ship);
  });

  it('recycles far ships deterministically ahead in formation', () => {
    const state = createInitialSim();
    const player = state.vessel;
    const ship = {
      ...state.ships[1]!,
      x: player.x - LAB_RADIUS - 40,
      z: player.z - LAB_RADIUS - 40,
      heading: 0,
    };
    const out = recycleShipIfFar(ship, player);
    const dist = Math.hypot(out.x - player.x, out.z - player.z);
    expect(dist).toBeGreaterThan(RECYCLE_AHEAD - 1);
    expect(dist).toBeLessThan(LAB_RADIUS);
    // Heading 0 → ahead is +X; merchant A lateral +10
    expect(out.x).toBeCloseTo(player.x + RECYCLE_AHEAD + 24, 5);
    expect(out.z).toBeCloseTo(player.z + 10, 5);

    // Deterministic: same inputs → same outputs
    expect(recycleShipIfFar(ship, player)).toEqual(out);
  });

  it('recycles through stepSim when a contact is far away', () => {
    let state = createInitialSim();
    const far = {
      ...state.ships[2]!,
      x: state.vessel.x + LAB_RADIUS + 80,
      z: state.vessel.z,
      heading: 0,
    };
    state = { ...state, ships: [state.ships[0]!, state.ships[1]!, far] };
    state = stepSim(state, createControlIntent(), DEFAULT_SETTINGS, FIXED_DT);
    const recycled = state.ships[2]!;
    expect(Math.hypot(recycled.x - state.vessel.x, recycled.z - state.vessel.z)).toBeLessThan(
      LAB_RADIUS,
    );
  });
});
