import type { DepthOrder, Point, SpeedOrder, ThreatKind, WeaponMode } from '../sim/types';

export type GameCommand =
  | { type: 'helm'; surge: number; yaw: number; depth: number }
  | { type: 'setDepthOrder'; order: DepthOrder }
  | { type: 'setSpeedOrder'; order: SpeedOrder }
  | { type: 'setPhase'; phase: 'menu' | 'playing' | 'paused' | 'gameover' | 'victory' }
  | { type: 'setWeapon'; weapon: WeaponMode }
  | { type: 'setViewMode'; viewMode: 'tactical' | 'periscope' | 'sonar' }
  | { type: 'setAutopilot'; waypoint: Point }
  | { type: 'cancelAutopilot' }
  | { type: 'selectTarget'; id: string | null }
  | { type: 'fireWeapon' }
  | { type: 'deployBubble' }
  | { type: 'spawnThreat'; threat: ThreatKind; sourceId: string; targetId?: string }
  | { type: 'toggleSilentRunning' };
