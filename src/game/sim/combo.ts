import type { GameMessage, GameState } from './types';

/* Tuning. */
/** Simulation seconds a kill keeps the streak alive. */
export const COMBO_WINDOW = 12;
/** Bonus fraction of a kill's base score per streak step beyond the first. */
export const COMBO_STEP_BONUS = 0.1;
export const COMBO_BONUS_CAP = 0.5;
/** Crit damage multiplier on a player torpedo hit. */
export const CRIT_MULTIPLIER = 2;
const BANNER_TTL = 3;

const COMBO_BANNERS: Readonly<Record<number, string>> = {
  2: 'DOUBLE KILL',
  3: 'TRIPLE KILL',
  5: 'RAMPAGE',
};

/* ------------------------------------------------------------------ *
 * Crits
 * ------------------------------------------------------------------ */

/**
 * Seeded roll in [0, 1) from (seed, tick, torpedo id). A pure hash, so a crit
 * never reads or advances the game's `rngState` and replays stay identical.
 */
export function critRoll(seed: number, tick: number, torpedoId: string): number {
  let hash = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tick | 0, 0x85ebca6b);
  for (let index = 0; index < torpedoId.length; index += 1) {
    hash = Math.imul(hash ^ torpedoId.charCodeAt(index), 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** True when this hit crits. A chance of 0 or less skips the roll entirely. */
export function rollCrit(seed: number, tick: number, torpedoId: string, chance: number): boolean {
  if (!(chance > 0)) return false;
  return critRoll(seed, tick, torpedoId) < chance;
}

/* ------------------------------------------------------------------ *
 * Combo
 * ------------------------------------------------------------------ */

/** Bonus fraction of a kill's base score at streak step `streak` (1-based). */
export const comboBonusFraction = (streak: number): number =>
  Math.min(COMBO_BONUS_CAP, Math.max(0, streak - 1) * COMBO_STEP_BONUS);

/** Banner text for reaching `streak`, or null when that step has none. */
export const comboBanner = (streak: number): string | null => COMBO_BANNERS[streak] ?? null;

/**
 * Register kills made this step, one base score each, as consecutive streak
 * steps. A kill inside the window of the previous one extends the streak; the
 * bonus goes to `stats.bonusScore` so `stats.score` keeps meaning base points.
 */
export function registerKills(state: GameState, baseScores: readonly number[]): GameState {
  if (baseScores.length === 0) return state;
  let combo = state.stats.combo > 0 && state.time <= state.stats.comboExpires ? state.stats.combo : 0;
  let bonus = 0;
  const banners: GameMessage[] = [];
  for (const base of baseScores) {
    combo += 1;
    bonus += Math.round(base * comboBonusFraction(combo));
    const text = comboBanner(combo);
    if (text !== null) banners.push({ id: `combo-${state.tick}-${combo}`, text, ttl: BANNER_TTL });
  }
  return {
    ...state,
    stats: {
      ...state.stats,
      combo,
      comboExpires: state.time + COMBO_WINDOW,
      bonusScore: state.stats.bonusScore + bonus,
    },
    messages: banners.length > 0 ? [...state.messages, ...banners] : state.messages,
  };
}

/** Drop a lapsed streak. Returns the same state while there is nothing to drop. */
export function expireCombo(state: GameState): GameState {
  if (state.stats.combo === 0 || state.time <= state.stats.comboExpires) return state;
  return { ...state, stats: { ...state.stats, combo: 0 } };
}
