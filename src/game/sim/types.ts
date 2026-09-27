import type { LookDevSettings, ViewMode } from '../../core/types';

export type GamePhase = 'menu' | 'playing' | 'paused' | 'gameover' | 'victory';
export type ScenarioId = 'patrol' | 'convoy-strike';
export type WeaponMode = 'torpedo' | 'seeker' | 'decoy';
export type DepthOrder = 'surface' | 'periscope' | 'attack' | 'deep';
export type SpeedOrder = 'stop' | 'oneThird' | 'twoThirds' | 'flank';
export type ShipKind = 'destroyer' | 'merchant' | 'battleship' | 'sub' | 'patrol' | 'cruiser';
export type AutopilotTactic = 'manual' | 'ambush' | 'stalk' | 'intercept' | 'evade' | 'exfil';
export type AutopilotPhase = 'idle' | 'approach' | 'setup' | 'attack' | 'breakaway' | 'dock';
export type PowerupKind = 'health' | 'ammo' | 'hull' | 'weapon' | 'speed' | 'counter';
export type ThreatKind = 'torpedo' | 'depthCharge' | 'hedgehog' | 'shell' | 'bomb';

export interface Submarine {
  x: number;
  y: number;
  z: number;
  heading: number;
  displayHeading: number;
  bank: number;
  /** Heading rate applied this step (rad/s); consumed by the submarine system for bank. */
  yawRate: number;
  /** Actual vertical rate (u/s); accelerates toward the commanded rate. */
  depthRate: number;
  /** Seconds of emergency-blow ascent remaining. */
  blowTimer: number;
  speed: number;
  targetSpeed: number;
  speedOrder: SpeedOrder;
  maxSpeed: number;
  hp: number;
  maxHp: number;
  torpedoes: number;
  maxTorpedoes: number;
  seekers: number;
  maxSeekers: number;
  reload: number;
  reloadMk14: number;
  reloadMk18: number;
  reloadMk14Max: number;
  reloadMk18Max: number;
  decoys: number;
  cmCharges: number;
  maxCmCharges: number;
  cmCooldown: number;
  noise: number;
  waypoint: Point | null;
  targetDepth: number;
  ballast: number;
  invuln: number;
  trailTimer: number;
  hullTier: number;
  weaponTier: number;
  speedTier: number;
  docked: boolean;
  battery: number;
  maxBattery: number;
  silentRunning: boolean;
  scopeUp: boolean;
  snorkel: boolean;
  sysSonar: number;
  sysPropulsion: number;
  sysTubes: number;
  sysFlood: number;
  crewStress: number;
  /** Last thing that took hull points. Presentation reads this on the result card. */
  lastDamage: 'weapon' | 'ground' | null;
}
export interface Point {
  x: number;
  y: number;
}
export type FormationRole = 'lead' | 'wing' | 'trail';
/** How a fatally-hit hull goes under — drives the sinking pose. */
export type SinkStyle = 'bow' | 'stern' | 'list' | 'break';
export interface Ship {
  id: string;
  kind: ShipKind;
  name: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  /** Fraction of the hull taking water (0..1); worsens unless damage control wins. */
  flooding: number;
  /** On-fire intensity (0..1); set by surface hits. */
  fire: number;
  /** Propulsion factor — stern hits wreck the screws. */
  speedFactor: number;
  /** Seconds the hull stays afloat once lethally hit. */
  sinkDuration: number;
  /** Chosen when the lethal hit lands; 'list' when flooding alone does it. */
  sinkStyle?: SinkStyle;
  /** Which hull side took the last hit: +1 starboard, -1 port (hull frame). */
  listSide: number;
  alert: number;
  holdContact: number;
  weaponCooldown: number;
  patrolIndex: number;
  path: Point[];
  repathTimer: number;
  /** Seconds of flotation remaining once lethal damage is taken. */
  sinking?: number;
  formationAnchorId?: string | null;
  formationRole?: FormationRole | null;
  formationAlong?: number;
  formationLateral?: number;
  /** Last place this hull had a visual or acoustic fix. Hunt this, not live coords. */
  lastKnownX?: number;
  lastKnownY?: number;
  /** Encounter-local hunt pressure. Quiet sweep radius grows from this, not mission time. */
  suspicion?: number;
  /** Escort state machine; absent means screen/patrol. */
  doctrine?: 'screen' | 'prosecute' | 'attackRun' | 'reattack' | 'search';
  /** Last confirmed fix position the doctrine is hunting. */
  datumX?: number;
  datumY?: number;
  /** Smoothed boat velocity estimate from successive fixes (u/s). */
  datumVx?: number;
  datumVy?: number;
  /** Seconds in the current doctrine state (search growth, reattack run-out). */
  doctrineTimer?: number;
  /** state.time of the most recent fix — drives prediction and search timeout. */
  lastFixTime?: number;
  /** Merchant evasion: seconds left running directly away from `scatterX/Y`. */
  scatterTimer?: number;
  scatterX?: number;
  scatterY?: number;
  /** Last torpedo impact on this hull — nearby merchants read it and scatter. */
  lastHitX?: number;
  lastHitY?: number;
  lastHitTime?: number;
}
export interface Torpedo {
  id: string;
  owner: 'player' | 'enemy';
  kind: 'mk14' | 'mk18' | 'enemy';
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Current speed — launches slow and accelerates to `runSpeed`. */
  speed: number;
  /** Top run speed once the motor is up to power. */
  runSpeed: number;
  /** Seeker lock: a ship id, 'player', or null while running blind. */
  lockId: string | null;
  life: number;
  armDelay: number;
  damage: number;
  /** Fire-control assignment from launch; seekers confirm their own lock. */
  targetId: string | null;
  sourceId: string;
  turnRate: number;
  run: number;
}
export interface DepthCharge {
  id: string;
  kind: 'depthCharge' | 'hedgehog' | 'shell' | 'bomb';
  sourceId: string;
  x: number;
  y: number;
  z: number;
  /** Horizontal throw velocity; water drag decays it. */
  vx: number;
  vy: number;
  /** Downward sink rate, set at release. */
  vz: number;
  /** Safety life — detonation normally comes from the pistol depth or seabed. */
  fuse: number;
  damage: number;
  radius: number;
  /** Hydrostatic pistol setting: the attacker's estimate of boat depth. */
  targetDepth: number;
}
/** A ballistic shell: rises on `valt`, falls under gravity, splashes at alt 0. */
export interface Shell {
  id: string;
  owner: 'player' | 'enemy';
  sourceId: string;
  x: number;
  y: number;
  /** Height above the surface in normalized depth units (positive up). */
  alt: number;
  vx: number;
  vy: number;
  valt: number;
  damage: number;
  radius: number;
}
/** One explosion this step — consumed by presentation, then cleared. */
export interface Detonation {
  id: string;
  kind: 'torpedo' | 'depthCharge' | 'hedgehog' | 'shell' | 'bomb';
  owner: 'player' | 'enemy';
  x: number;
  y: number;
  z: number;
  /** Payload size — the damage number of the munition that went off. */
  yield: number;
  /** Ship id or 'player' that took the blast; null for terrain and misses. */
  hitId: string | null;
  /** True when the burst is at or near the surface. */
  surface: boolean;
}
export interface Aircraft {
  id: string;
  x: number;
  y: number;
  heading: number;
  life: number;
  cooldown: number;
  active: boolean;
  /** Last place the plane saw the boat — it orbits this once the boat is deep. */
  datumX?: number;
  datumY?: number;
  /** Seconds until the plane next cues nearby ships to its datum. */
  cueTimer?: number;
}
export interface Countermeasure {
  id: string;
  kind: 'bubble' | 'foxer';
  x: number;
  y: number;
  z: number;
  life: number;
  radius: number;
}
export interface Powerup {
  id: string;
  kind: PowerupKind;
  x: number;
  y: number;
  life: number;
}
export interface Base {
  x: number;
  y: number;
  radius: number;
}
export interface SonarContact {
  id: string;
  targetId: string | null;
  x: number;
  y: number;
  bearing: number;
  range: number;
  strength: number;
  label: string;
  source: 'passive' | 'active';
  age: number;
  maxAge: number;
}
export interface Autopilot {
  enabled: boolean;
  waypoint: Point | null;
  targetId: string | null;
  tactic: AutopilotTactic;
  phase: AutopilotPhase;
  phaseTimer: number;
  shotTimer: number;
  path: Point[];
  repathTimer: number;
  /** Damaged-boat exfil. Once set, low HP must not reset the breakaway clock. */
  emergency: boolean;
}
export interface GameStats {
  score: number;
  shipsSunk: number;
  torpedoesFired: number;
  damageDealt: number;
  timeSurvived: number;
  wave: number;
  powerupsTaken: number;
  repairs: number;
}
export interface GameMessage {
  id: string;
  text: string;
  ttl: number;
}
export interface GameState {
  phase: GamePhase;
  tick: number;
  time: number;
  seed: number;
  rngState: number;
  submarine: Submarine;
  ships: Ship[];
  torpedoes: Torpedo[];
  depthCharges: DepthCharge[];
  shells: Shell[];
  /** Explosions produced by this step only; presentation consumes them. */
  detonations: Detonation[];
  aircraft: Aircraft[];
  countermeasures: Countermeasure[];
  powerups: Powerup[];
  base: Base;
  terrainSeed: number;
  worldVersion: 'legacy-v1' | 'littoral-v2';
  sonarContacts: SonarContact[];
  autopilot: Autopilot;
  stats: GameStats;
  weaponMode: WeaponMode;
  torpedoSpread: boolean;
  viewMode: ViewMode;
  missionFlavor: string;
  selectedTargetId: string | null;
  /** Explicit water aim in sim coords. Mutually exclusive with selectedTargetId. */
  aimPoint: Point | null;
  messages: GameMessage[];
  settings: LookDevSettings | null;
  debugFacing: boolean;
  dockHold: number;
  pickupRespawn: number;
  sonarPing: number;
  sonarCooldown: number;
  aircraftCooldown: number;
  scenario: ScenarioId;
  /** Patrol doctrines may shoot. The strike scenario leaves this off. */
  assistanceAutoFire: boolean;
  /** Empty-plot 4× time scale. Key M toggles it. V stays Deep. */
  compressEnabled: boolean;
  /** Convoy-strike exit. Null on a patrol. */
  strikeExit: Point | null;
}

export type ApiResult<T = GameState> =
  { ok: true; state: T } | { ok: false; reason: 'not_implemented' | 'invalid' | 'rejected' };
