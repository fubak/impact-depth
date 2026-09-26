export const WORLD_SIZE = 128;
export const WORLD_CENTER = WORLD_SIZE / 2;
export const LAND_LEVEL = 0.78;
export const FOB_RADIUS = 4.8;
export const VICTORY_TARGET = 8;
export const DEFAULT_CRUISE = 0.85;
export const DC_ENGAGE_RANGE = 4.2;
export const THERMOCLINE = 0.48;
export const ACTIVE_PING_RANGE = 22;
export const ACTIVE_PING_DURATION = 4.8;
export const ACTIVE_COOLDOWN = 6.5;
export const DAY_LENGTH = 480;
export const SEAMOUNT_CRUSH_DPS = 18;
export const METERS_PER_UNIT = 5;
export const MAX_DEPTH = 0.95;
export const MAX_TIER = 3;
/** Surface runs are still fireable; deep attack stays tube-locked. */
export const FIRE_MIN_DEPTH = 0.04;
export const FIRE_MAX_DEPTH = 0.85;
/** Shared depth orders so HUD active-state matches integration targets. */
export const DEPTH_TARGET = {
  surface: 0.06,
  periscope: 0.28,
  attack: 0.5,
  deep: 0.82,
} as const;
export const BUBBLE_LIFE = 10;
export const FOXER_LIFE = 14;
export const BUBBLE_RADIUS = 4.5;
export const FOXER_RADIUS = 3.5;
export const PICKUP_RADIUS = 1.3;
export const PICKUP_MAX = 10;
export const PICKUP_LIFE = 110;
export const PICKUP_RESPAWN = 19;
export const DOCK_SPEED_MAX = 0.6;
export const DOCK_HOLD = 0.5;
/** Escorts pulse an active sweep on this cadence. The roll comes from rngState. */
export const ESCORT_SWEEP_PERIOD = 8;
/** Noisy or flank boats are caught out to this radius. */
export const ESCORT_LOUD_SWEEP_RADIUS = 36;
/** Silent, non-flank boats inside the layer. Stays inside the opening acoustic miss. */
export const ESCORT_QUIET_SWEEP_RADIUS = 3.2;
/** OD6: passive hunt opens after the stealth minute. */
export const ESCORT_QUIET_HUNT_AFTER = 62;
export const ESCORT_QUIET_SWEEP_GROWTH = 1.15;
/** Lateral weave so the escort screen walks across the convoy's bow. */
export const ESCORT_SCREEN_OFFSET = 3.5;
/** A merchant or escort above the pursuit threshold wakes warships inside this range. */
export const ALERT_SPREAD_RADIUS = 30;
/** Deep enough that a silent, non-flank boat is under the sweep. */
export const DEEP_SAFE_DEPTH = 0.6;
/** Bubble screen drains an escort's contact this many times faster. */
export const BUBBLE_HOLD_DRAIN = 3;
/** Homing torpedoes can be pulled onto a foxer from this far out. */
export const FOXER_SEDUCE_RANGE = 12;
/** Fraction of seeds whose Mk-18 is seduced. The rest press the attack. */
export const FOXER_SEDUCE_ODDS = 0.7;
/** OD6: quiet seconds between a cleared wave and the next spawn. */
export const WAVE_BREATHER = 20;
/** Wave 2+ spawn ring, sim units from the map centre. */
export const WAVE_SPAWN_INNER = 34;
export const WAVE_SPAWN_STEP = 8;
