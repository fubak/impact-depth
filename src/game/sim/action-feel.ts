import type { GameState } from './types';

/** Wave-1 spawn radius (sim units). Opening stalk should be under a minute. */
export const WAVE1_SPAWN_RADIUS = 20;
export const WAVE1_SPAWN_SPREAD = 5;
/** Time compression while the plot is empty. */
export const ACTION_TIME_SCALE = 4;
/** Passive/visual envelope — drop compression inside this range. */
export const ACTION_CONTACT_RANGE = 22;

export function shouldTimeCompress(state: GameState): boolean {
  if (!state.compressEnabled) return false;
  if (state.phase !== 'playing') return false;
  if (state.torpedoes.length > 0 || state.depthCharges.length > 0) return false;
  if (state.sonarPing > 0) return false;
  if (state.ships.some((ship) => ship.alert > 0.35 || ship.holdContact > 0.4)) return false;
  const sub = state.submarine;
  for (const ship of state.ships) {
    if (Math.hypot(ship.x - sub.x, ship.y - sub.y) < ACTION_CONTACT_RANGE) return false;
  }
  return true;
}

export function actionTimeScale(state: GameState): number {
  return shouldTimeCompress(state) ? ACTION_TIME_SCALE : 1;
}

export function emergencySurface(state: GameState): GameState {
  const sub = state.submarine;
  return {
    ...state,
    submarine: {
      ...sub,
      targetDepth: 0.06,
      silentRunning: false,
      scopeUp: false,
      snorkel: false,
      noise: Math.min(1, sub.noise + 0.55),
      speed: Math.min(sub.maxSpeed * 1.05, sub.speed + 0.35),
    },
    messages: [
      ...state.messages,
      { id: `blow-${state.tick}`, text: 'EMERGENCY SURFACE', ttl: 2.2 },
    ],
  };
}
