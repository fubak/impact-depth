import type { HitNumber } from './hit-numbers';

export const HIT_STOP_CRIT_S = 0.09;
/** Equals the existing app shipSunk freeze. */
export const HIT_STOP_KILL_S = 0.4;
export const HIT_STOP_ELITE_KILL_S = 0.55;

function baseStop(number: HitNumber): number {
  if (number.kind === 'kill') return number.elite ? HIT_STOP_ELITE_KILL_S : HIT_STOP_KILL_S;
  if (number.kind === 'crit') return HIT_STOP_CRIT_S;
  return 0;
}

/** Max (never sum) over the numbers, scaled by clamp(freezeScale, 0, 1). Damage-only gives 0. */
export function hitStopSeconds(numbers: readonly HitNumber[], freezeScale: number): number {
  const scale = Number.isFinite(freezeScale) ? Math.min(1, Math.max(0, freezeScale)) : 0;
  const longest = numbers.reduce((max, number) => Math.max(max, baseStop(number)), 0);
  return longest * scale;
}
