import type { LookDevSettings, ViewMode } from '../../core/types';

export type GamePhase = 'menu' | 'playing' | 'paused' | 'gameover' | 'victory';
export type WeaponMode = 'torpedo' | 'seeker' | 'decoy';
export type DepthOrder = 'surface' | 'periscope' | 'attack' | 'deep';
export type SpeedOrder = 'stop' | 'oneThird' | 'twoThirds' | 'flank';
export type ShipKind = 'destroyer' | 'merchant' | 'battleship' | 'sub' | 'patrol' | 'cruiser';
export type PowerupKind = 'health' | 'ammo' | 'hull' | 'weapon' | 'speed' | 'counter';
export type ThreatKind = 'torpedo' | 'depthCharge' | 'hedgehog' | 'shell' | 'bomb';

export interface Submarine {
  x: number; y: number; z: number; heading: number; displayHeading: number; bank: number;
  speed: number; targetSpeed: number; speedOrder: SpeedOrder; maxSpeed: number;
  hp: number; maxHp: number; torpedoes: number; maxTorpedoes: number; seekers: number;
  maxSeekers: number; reload: number; reloadMk14: number; reloadMk18: number;
  reloadMk14Max: number; reloadMk18Max: number; decoys: number; cmCharges: number;
  maxCmCharges: number; cmCooldown: number; noise: number; waypoint: Point | null;
  targetDepth: number; ballast: number; invuln: number; trailTimer: number;
  hullTier: number; weaponTier: number; speedTier: number; docked: boolean;
  battery: number; maxBattery: number; silentRunning: boolean; scopeUp: boolean;
  snorkel: boolean; sysSonar: number; sysPropulsion: number; sysTubes: number;
  sysFlood: number; crewStress: number;
}
export interface Point { x: number; y: number }
export interface Ship { id: string; kind: ShipKind; name: string; x: number; y: number; heading: number; speed: number; hp: number; maxHp: number; alert: number; sinking?: number }
export interface Torpedo { id: string; owner: 'player' | 'enemy'; kind: 'mk14' | 'mk18' | 'enemy'; x: number; y: number; z: number; heading: number; speed: number; life: number; armDelay: number; damage: number; targetId: string | null; sourceId: string; turnRate: number }
export interface DepthCharge { id: string; kind: 'depthCharge' | 'hedgehog' | 'shell' | 'bomb'; sourceId: string; x: number; y: number; z: number; vz: number; fuse: number; damage: number; radius: number; targetDepth: number }
export interface Aircraft { id: string; x: number; y: number; active: boolean }
export interface Countermeasure { id: string; kind: 'bubble' | 'foxer'; x: number; y: number; z: number; life: number; radius: number }
export interface Powerup { id: string; kind: PowerupKind; x: number; y: number; life: number }
export interface Base { x: number; y: number; radius: number }
export interface SonarContact { id: string; x: number; y: number; strength: number; age: number }
export interface Autopilot { enabled: boolean; waypoint: Point | null; targetId: string | null }
export interface GameStats { score: number; shipsSunk: number; torpedoesFired: number; damageDealt: number; timeSurvived: number; wave: number; powerupsTaken: number; repairs: number }
export interface GameMessage { id: string; text: string; ttl: number }
export interface GameState {
  phase: GamePhase; tick: number; time: number; seed: number; rngState: number;
  submarine: Submarine; ships: Ship[]; torpedoes: Torpedo[]; depthCharges: DepthCharge[];
  aircraft: Aircraft[]; countermeasures: Countermeasure[]; powerups: Powerup[]; base: Base;
  terrainSeed: number; sonarContacts: SonarContact[]; autopilot: Autopilot; stats: GameStats;
  weaponMode: WeaponMode; torpedoSpread: boolean; viewMode: ViewMode; missionFlavor: string; selectedTargetId: string | null;
  messages: GameMessage[]; settings: LookDevSettings | null; debugFacing: boolean; dockHold: number; pickupRespawn: number;
}

export type ApiResult<T = GameState> = { ok: true; state: T } | { ok: false; reason: 'not_implemented' | 'invalid' | 'rejected' };
