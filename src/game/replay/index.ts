import type { GameCommand } from '../commands/types';
import type { GameState } from '../sim/types';

/** Stable JSON snapshot suitable for replay fixtures and host comparisons. */
export function canonicalSnapshot(state: GameState): string {
  return JSON.stringify(state);
}
export interface ReplayFrame { tick: number; commands: GameCommand[] }
