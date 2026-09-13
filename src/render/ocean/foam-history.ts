/** CPU twin of world-space foam persistence (inject, advect/decay, drain). */

export interface FoamHistoryStep {
  readonly previous: number;
  readonly inject: number;
  readonly decay: number;
  readonly drain: number;
}

export function stepFoamHistory(step: FoamHistoryStep): number {
  const persist = Math.max(0, step.previous) * Math.max(0, Math.min(1, step.decay));
  const drained = persist * (1 - Math.max(0, Math.min(1, step.drain)));
  return Math.max(0, Math.min(1, Math.max(drained, step.inject)));
}
