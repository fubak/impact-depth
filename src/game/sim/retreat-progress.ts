import type { RetreatProgress } from './types';

/** Closing this much on the base counts as progress (sim units). */
export const RETREAT_PROGRESS_EPS = 0.5;
/** Unthreatened seconds without progress before the route is rebuilt once. */
export const RETREAT_STALL_REPLAN_S = 20;
/** Unthreatened seconds without progress, after a replan, before the route is called blocked. */
export const RETREAT_STALL_BLOCKED_S = 45;
/** A warship this close means the retreat is contested, not stalled. */
export const RETREAT_THREAT_RANGE = 14;

export type RetreatAction = 'none' | 'replan' | 'blocked';

export interface RetreatStep {
  readonly progress: RetreatProgress;
  readonly action: RetreatAction;
  /** True on the tick the route became contested, for a one-shot callout. */
  readonly startedContested: boolean;
}

export function startRetreat(time: number, distance: number): RetreatProgress {
  return {
    startedAt: time,
    bestDistance: distance,
    lastProgressAt: time,
    replans: 0,
    status: 'approaching',
  };
}

/**
 * Advance the retreat tracker by one tick of simulation time. The stall clock is measured from
 * the last measured progress, not from mission time, and it is paused while a warship is
 * contesting the route so a warship nearby is never reported as a broken route.
 */
export function advanceRetreat(
  previous: RetreatProgress,
  time: number,
  distance: number,
  threatened: boolean,
  dt: number,
): RetreatStep {
  const improved = distance < previous.bestDistance - RETREAT_PROGRESS_EPS;
  const bestDistance = improved ? distance : previous.bestDistance;
  const base = { ...previous, bestDistance };

  if (improved) {
    return {
      progress: { ...base, lastProgressAt: time, status: threatened ? 'contested' : 'approaching' },
      action: 'none',
      startedContested: threatened && previous.status !== 'contested',
    };
  }
  if (threatened) {
    return {
      progress: { ...base, lastProgressAt: previous.lastProgressAt + dt, status: 'contested' },
      action: 'none',
      startedContested: previous.status !== 'contested',
    };
  }

  const stalled = time - previous.lastProgressAt;
  if (stalled >= RETREAT_STALL_BLOCKED_S && previous.replans > 0) {
    return { progress: { ...base, status: 'blocked' }, action: 'blocked', startedContested: false };
  }
  if (stalled >= RETREAT_STALL_REPLAN_S && previous.replans === 0) {
    return {
      progress: { ...base, replans: 1, status: 'replanning' },
      action: 'replan',
      startedContested: false,
    };
  }
  const status = previous.status === 'replanning' ? 'replanning' : 'approaching';
  return { progress: { ...base, status }, action: 'none', startedContested: false };
}
