import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/sim';
import {
  cancelAutopilot,
  createGame,
  setAutopilot,
  startMission,
  updateGame,
} from '../../../src/game/sim/api';
import { LAND_LEVEL } from '../../../src/game/sim/constants';
import {
  advanceRetreat,
  RETREAT_STALL_BLOCKED_S,
  RETREAT_STALL_REPLAN_S,
  startRetreat,
} from '../../../src/game/sim/retreat-progress';
import type { GameState } from '../../../src/game/sim/types';
import { getTerrain } from '../../../src/game/sim/world';

const SEEDS = [1, 7, 19, 42, 91] as const;
const ARRIVAL_BUDGET_S = 180;

const distanceToBase = (s: GameState) =>
  Math.hypot(s.submarine.x - s.base.x, s.submarine.y - s.base.y);
const hasMessage = (s: GameState, text: string) => s.messages.some((m) => m.text === text);

/** Controlled reachable route: no escorts, no reinforcement wave. Navigation only. */
function emptyOcean(seed: number, hp = 100): GameState {
  const state = startMission(createGame(seed));
  return {
    ...state,
    ships: [],
    messages: [...state.messages, { id: 'wave-inbound-99', text: 'WAVE 99 INBOUND', ttl: 10_000 }],
    submarine: { ...state.submarine, hp, sysFlood: 0 },
  };
}

function runUntil(
  start: GameState,
  budgetS: number,
  done: (s: GameState) => boolean,
): { state: GameState; elapsed: number } {
  let state = start;
  const begun = start.time;
  const steps = Math.ceil(budgetS / FIXED_DT);
  for (let i = 0; i < steps && !done(state); i += 1) state = updateGame(state, [], FIXED_DT);
  return { state, elapsed: state.time - begun };
}

const arrived = (s: GameState) => distanceToBase(s) <= s.base.radius;

describe('retreat progress tracker (pure)', () => {
  const dt = 1 / 30;

  it('counts measured closing as progress and stays approaching', () => {
    const step = advanceRetreat(startRetreat(0, 50), 1, 48, false, dt);
    expect(step.action).toBe('none');
    expect(step.progress.status).toBe('approaching');
    expect(step.progress.bestDistance).toBe(48);
    expect(step.progress.lastProgressAt).toBe(1);
  });

  it('measures stall from the last progress, not from mission time', () => {
    // A retreat ordered at t=1000 must not be stalled just because the mission is old.
    const fresh = advanceRetreat(startRetreat(1000, 50), 1000 + dt, 50, false, dt);
    expect(fresh.action).toBe('none');
  });

  it('replans once, then calls the route blocked only after a further stall', () => {
    let progress = startRetreat(0, 50);
    let time = 0;
    const actions: string[] = [];
    while (time < RETREAT_STALL_BLOCKED_S + RETREAT_STALL_REPLAN_S + 5) {
      time += 1;
      const step = advanceRetreat(progress, time, 50, false, 1);
      progress = step.progress;
      if (step.action !== 'none') actions.push(`${step.action}@${time}`);
      if (step.action === 'blocked') break;
    }
    expect(actions[0]).toBe(`replan@${RETREAT_STALL_REPLAN_S}`);
    expect(actions).toHaveLength(2);
    expect(actions[1]).toBe(`blocked@${RETREAT_STALL_BLOCKED_S}`);
  });

  it('pauses the stall clock while a warship contests the route (a contested route is not blocked)', () => {
    let progress = startRetreat(0, 50);
    let contestedCallouts = 0;
    for (let time = 1; time <= 300; time += 1) {
      const step = advanceRetreat(progress, time, 50, true, 1);
      progress = step.progress;
      if (step.startedContested) contestedCallouts += 1;
      expect(step.action).toBe('none');
    }
    expect(progress.status).toBe('contested');
    expect(contestedCallouts).toBe(1);
    // Back to open water: the paused clock means a full unthreatened stall is still required.
    const after = advanceRetreat(progress, 301, 50, false, 1);
    expect(after.action).toBe('none');
  });

  it('resumes approaching after progress is made again, even post-replan', () => {
    let progress = startRetreat(0, 50);
    for (let time = 1; time <= RETREAT_STALL_REPLAN_S; time += 1) {
      progress = advanceRetreat(progress, time, 50, false, 1).progress;
    }
    expect(progress.status).toBe('replanning');
    const moved = advanceRetreat(progress, RETREAT_STALL_REPLAN_S + 1, 40, false, 1);
    expect(moved.progress.status).toBe('approaching');
    expect(moved.progress.lastProgressAt).toBe(RETREAT_STALL_REPLAN_S + 1);
  });
});

describe('return to base — navigation (controlled reachable route)', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: a damaged boat arrives within ${ARRIVAL_BUDGET_S}s of the order, no warning`, () => {
      const ordered = setAutopilot(emptyOcean(seed, 20), 'exfil');
      const { state, elapsed } = runUntil(
        ordered,
        ARRIVAL_BUDGET_S,
        (s) => arrived(s) || s.submarine.hp <= 0 || hasMessage(s, 'CANNOT REACH BASE'),
      );
      expect(state.submarine.hp, `seed ${seed} survived`).toBeGreaterThan(0);
      expect(hasMessage(state, 'CANNOT REACH BASE'), `seed ${seed} false unreachable`).toBe(false);
      expect(arrived(state), `seed ${seed} dist ${distanceToBase(state)}`).toBe(true);
      expect(elapsed).toBeLessThanOrEqual(ARRIVAL_BUDGET_S);
    }, 60_000);
  }

  it('a retreat ordered late in a long mission is not reported unreachable', () => {
    const late = { ...emptyOcean(19, 20), time: 400 };
    const { state, elapsed } = runUntil(
      setAutopilot(late, 'exfil'),
      ARRIVAL_BUDGET_S,
      (s) => arrived(s) || hasMessage(s, 'CANNOT REACH BASE'),
    );
    expect(hasMessage(state, 'CANNOT REACH BASE')).toBe(false);
    expect(arrived(state)).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(ARRIVAL_BUDGET_S);
  }, 60_000);

  it('tracks progress from the order: startedAt is the order time and bestDistance only shrinks', () => {
    const late = { ...emptyOcean(19, 20), time: 250 };
    let state = setAutopilot(late, 'exfil');
    let best = Infinity;
    for (let i = 0; i < Math.ceil(40 / FIXED_DT); i += 1) {
      state = updateGame(state, [], FIXED_DT);
      const retreat = state.autopilot.retreat;
      if (!retreat) continue;
      expect(retreat.startedAt).toBeGreaterThanOrEqual(250);
      expect(retreat.startedAt).toBeLessThan(260);
      expect(retreat.bestDistance).toBeLessThanOrEqual(best);
      best = retreat.bestDistance;
    }
    expect(state.autopilot.retreat?.status).toBe('approaching');
  }, 60_000);

  it('repeated low-hp triggers do not restart the route clock', () => {
    let state = setAutopilot(emptyOcean(19, 20), 'exfil');
    const marks = new Set<number>();
    for (let i = 0; i < Math.ceil(30 / FIXED_DT); i += 1) {
      state = updateGame(state, [], FIXED_DT);
      if (state.autopilot.retreat) marks.add(state.autopilot.retreat.startedAt);
    }
    expect(marks.size).toBe(1);
  }, 60_000);

  it('manual cancellation clears tracking and a new order starts a fresh route', () => {
    let state = setAutopilot(emptyOcean(19, 20), 'exfil');
    state = runUntil(state, 15, () => false).state;
    expect(state.autopilot.retreat).toBeTruthy();
    state = cancelAutopilot(state);
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.retreat).toBeNull();
    const before = state.time;
    state = setAutopilot(state, 'exfil');
    state = runUntil(state, 10, () => false).state;
    expect(state.autopilot.retreat?.startedAt).toBeGreaterThanOrEqual(before);
  }, 60_000);
});

describe('return to base — genuinely blocked destination', () => {
  // Dedicated seed so mutating the cached terrain cannot leak into the matrix above.
  const BLOCKED_SEED = 3;

  function wallOffBase(state: GameState): void {
    const terrain = getTerrain(state.terrainSeed);
    const heights = terrain.heights as unknown as number[];
    const cx = state.base.x;
    const cy = state.base.y;
    for (let y = 0; y < terrain.size; y += 1) {
      for (let x = 0; x < terrain.size; x += 1) {
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (r >= 7 && r <= 11) heights[y * terrain.size + x] = LAND_LEVEL + 0.2;
      }
    }
  }

  it('terminates truthfully with a reason and recovery, not an infinite approach', () => {
    const base = emptyOcean(BLOCKED_SEED, 20);
    wallOffBase(base);
    let state = setAutopilot(base, 'exfil');
    const order = state.time;
    const result = runUntil(state, 240, (s) => hasMessage(s, 'CANNOT REACH BASE'));
    state = result.state;

    expect(hasMessage(state, 'CANNOT REACH BASE')).toBe(true);
    expect(hasMessage(state, 'ROUTE BLOCKED · HELM MANUAL · ORDER HOME TO RETRY')).toBe(true);
    // Authority returns to the player; the sim does not keep driving into the wall.
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');
    // Elapsed is measured from the order and bounded by approach + replan + blocked windows.
    expect(state.time - order).toBeLessThan(240);
    expect(state.time - order).toBeGreaterThan(RETREAT_STALL_BLOCKED_S);
    expect(state.submarine.hp).toBeGreaterThan(0);
  }, 120_000);
});
