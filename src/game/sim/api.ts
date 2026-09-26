import type { GameCommand } from '../commands/types';
import type { WorldVersion } from '../world/definition';
import { playerNavProfile, snapWorld } from '../world/littoral';
import { getWorld } from '../world/queries';
import { createGame as makeGame, seedPowerups, seedWave } from './create';
import { createConvoyStrike } from './scenarios/convoy-strike';
import { stepGame } from './step';
import type {
  ApiResult,
  DepthOrder,
  GamePhase,
  GameState,
  Point,
  SpeedOrder,
  AutopilotTactic,
  WeaponMode,
} from './types';
import { snapToNavigable as snap, getTerrain } from './world';

export const createGame = (seed?: number, worldVersion?: WorldVersion): GameState =>
  makeGame(seed, worldVersion);
export { createConvoyStrike };
export const startMission = (state: GameState): GameState => {
  if (state.scenario === 'convoy-strike') {
    return {
      ...state,
      phase: 'playing',
      viewMode: 'chase',
      submarine: { ...state.submarine, invuln: 8 },
    };
  }
  return {
    ...state,
    phase: 'playing',
    viewMode: 'chase',
    ships: seedWave(state.seed, 1, state.ships[0], state.worldVersion),
    powerups: seedPowerups(state.seed, 7, state.worldVersion),
    submarine: { ...state.submarine, invuln: 8 },
  };
};
export const restartGame = (state: GameState): GameState =>
  makeGame(state.seed, state.worldVersion);
export const setPhase = (state: GameState, phase: GamePhase): GameState => ({ ...state, phase });
export const setWeapon = (state: GameState, weapon: WeaponMode): GameState => ({
  ...state,
  weaponMode: weapon,
});
export const toggleDebugFacing = (state: GameState): GameState => ({
  ...state,
  debugFacing: !state.debugFacing,
});
export const setDepthOrder = (state: GameState, order: DepthOrder): GameState =>
  stepGame(state, [{ type: 'setDepthOrder', order }], 0);
export const setSpeedOrder = (state: GameState, order: SpeedOrder): GameState =>
  stepGame(state, [{ type: 'setSpeedOrder', order }], 0);
export const toggleSilentRunning = (state: GameState): GameState =>
  stepGame(state, [{ type: 'toggleSilentRunning' }], 0);
export const toggleScope = (state: GameState): GameState => ({
  ...state,
  submarine: { ...state.submarine, scopeUp: !state.submarine.scopeUp },
});
export const toggleSnorkel = (state: GameState): GameState => ({
  ...state,
  submarine: { ...state.submarine, snorkel: !state.submarine.snorkel },
});
export const toggleTorpedoSpread = (state: GameState): GameState => ({
  ...state,
  torpedoSpread: !state.torpedoSpread,
});
export function setAutopilot(
  state: GameState,
  tactic: AutopilotTactic,
  targetId?: string | null,
): GameState;
export function setAutopilot(state: GameState, waypoint: Point): GameState;
export function setAutopilot(
  state: GameState,
  tacticOrWaypoint: AutopilotTactic | Point,
  targetId?: string | null,
): GameState {
  if (typeof tacticOrWaypoint === 'string') {
    return stepGame(state, [{ type: 'setAutopilot', tactic: tacticOrWaypoint, targetId }], 0);
  }

  return stepGame(state, [{ type: 'setAutopilot', waypoint: tacticOrWaypoint }], 0);
}
export const cancelAutopilot = (state: GameState): GameState =>
  stepGame(state, [{ type: 'cancelAutopilot' }], 0);
export const orderMove = (state: GameState, waypoint: Point): GameState =>
  setAutopilot(state, waypoint);
export const selectTarget = (state: GameState, id: string): GameState =>
  state.ships.some((ship) => ship.id === id)
    ? stepGame(state, [{ type: 'selectTarget', id }], 0)
    : state;
export const clearEngagement = (state: GameState): GameState =>
  stepGame(state, [{ type: 'selectTarget', id: null }], 0);
export const setAimPoint = (state: GameState, point: Point | null): GameState =>
  stepGame(state, [{ type: 'setAimPoint', point }], 0);
export const detachCamera = (): ApiResult => ({ ok: false, reason: 'not_implemented' });
export const deployCountermeasure = (state: GameState): GameState =>
  stepGame(state, [{ type: 'deployBubble' }], 0);
export const fireWeapon = (state: GameState, aimPoint?: Point): GameState =>
  aimPoint
    ? stepGame(state, [{ type: 'setAimPoint', point: aimPoint }, { type: 'fireWeapon' }], 0)
    : stepGame(state, [{ type: 'fireWeapon' }], 0);
export const sonarPulse = (state: GameState): GameState =>
  stepGame(state, [{ type: 'sonarPulse' }], 0);
export const blowTanks = (state: GameState): GameState =>
  stepGame(state, [{ type: 'emergencySurface' }], 0);
export const updateGame = (
  state: GameState,
  commands: GameCommand[] = [],
  dt = 1 / 60,
): GameState => stepGame(state, commands, dt);
export const findShip = (state: GameState, id: string) =>
  state.ships.find((ship) => ship.id === id) ?? null;
export const pickShipAt = (state: GameState, point: Point, radius = 1) =>
  state.ships.find((ship) => Math.hypot(ship.x - point.x, ship.y - point.y) <= radius) ?? null;
export const pickShipAtScreen = (): ApiResult => ({ ok: false, reason: 'not_implemented' });
export const snapToNavigable = (state: GameState, point: Point): Point =>
  state.worldVersion === 'littoral-v2'
    ? snapWorld(
        getWorld(state.worldVersion, state.terrainSeed),
        point.x,
        point.y,
        playerNavProfile(state.submarine.z),
      )
    : snap(getTerrain(state.terrainSeed), point.x, point.y, state.submarine.z);
export function applyHostSeed(state: GameState, seed: number): GameState {
  const worldVersion = state.worldVersion ?? 'legacy-v1';
  const created = makeGame(seed, worldVersion);
  // Only active patrols re-seed waves/pickups. Menu and terminal phases keep an empty registry.
  const populate = state.phase === 'playing' || state.phase === 'paused';
  const populated = populate ? startMission({ ...created, phase: state.phase }) : created;
  return {
    ...populated,
    phase: state.phase,
    settings: state.settings,
    viewMode: state.viewMode,
  };
}
