import type { GameCommand } from '../commands/types';
import { SYSTEM_ORDER, systems } from './systems';
import type { GameState } from './types';

/** Advances the authoritative simulation by one deterministic fixed or variable step. */
export function stepGame(state: GameState, commands: GameCommand[] = [], dt: number): GameState {
  let next = systems.applyCommands(state, commands, dt);
  if (next.phase !== 'playing') return next;
  for (const name of SYSTEM_ORDER.slice(1)) next = systems[name](next, commands, dt);
  return { ...next, tick: next.tick + 1, time: next.time + dt, stats: { ...next.stats, timeSurvived: next.stats.timeSurvived + dt } };
}
