import type { TimeOfDayId, WeatherKind } from '../sim/environment';
import type {
  AutopilotTactic,
  DepthOrder,
  Point,
  SpeedOrder,
  ThreatKind,
  WeaponMode,
} from '../sim/types';

export type GameCommand =
  | { type: 'helm'; surge: number; yaw: number; depth: number }
  | { type: 'setDepthOrder'; order: DepthOrder }
  | { type: 'setSpeedOrder'; order: SpeedOrder }
  | { type: 'setPhase'; phase: 'menu' | 'playing' | 'paused' | 'gameover' | 'victory' }
  | { type: 'setWeapon'; weapon: WeaponMode }
  | {
      type: 'setViewMode';
      viewMode: 'tactical' | 'chase' | 'bridge' | 'periscope' | 'free' | 'map' | 'sonar';
    }
  | { type: 'setAutopilot'; waypoint?: Point; tactic?: AutopilotTactic; targetId?: string | null }
  | { type: 'cancelAutopilot' }
  | { type: 'sonarPulse' }
  | { type: 'selectTarget'; id: string | null }
  | { type: 'setAimPoint'; point: Point | null }
  | { type: 'fireWeapon' }
  | { type: 'deployBubble' }
  | { type: 'spawnThreat'; threat: ThreatKind; sourceId: string; targetId?: string }
  | { type: 'toggleSilentRunning' }
  /** Change weather and/or time of day; an omitted field keeps its current value. */
  | { type: 'setEnvironment'; weather?: WeatherKind; timeOfDay?: TimeOfDayId }
  | { type: 'emergencySurface' }
  /** Pick one of the open level-up offers by 0-based index. Ignored when nothing is pending. */
  | { type: 'choosePerk'; index: number }
  /** Spend a full Broadside charge: up to four homing Mk-14 at the nearest hunters. */
  | { type: 'ultimate' };
