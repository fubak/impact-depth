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
