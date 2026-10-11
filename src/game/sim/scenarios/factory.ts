import type { WorldVersion } from '../../world/definition';
import { createGame } from '../create';
import type { GameState, ScenarioId } from '../types';
import { createConvoyStrike } from './convoy-strike';

export interface ScenarioRequest {
  readonly scenario: ScenarioId;
  readonly seed: number;
  /** Product default stays `legacy-v1`; callers pass the runtime world explicitly. */
  readonly worldVersion?: WorldVersion;
}

/**
 * Single entry point that builds terrain, base, spawns and routes for the requested world.
 * Never build in one world and relabel `worldVersion` afterwards.
 */
export function createScenario({
  scenario,
  seed,
  worldVersion = 'legacy-v1',
}: ScenarioRequest): GameState {
  return scenario === 'convoy-strike'
    ? createConvoyStrike(seed, worldVersion)
    : createGame(seed, worldVersion);
}

/**
 * Retry (no seed) or new seed (seed given) for the scenario and world the state is in.
 * Settings, view mode and other session-level fields are the caller's to carry over.
 */
export function rerunScenario(state: GameState, seed: number = state.seed): GameState {
  // Weather is the captain's choice, not the seed's: a retry keeps it.
  return {
    ...createScenario({ scenario: state.scenario, seed, worldVersion: state.worldVersion }),
    environment: state.environment,
  };
}
