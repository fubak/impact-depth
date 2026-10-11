import { hashUnit } from './loot';
import type { Ship, ShipKind } from './types';

/* Tuning. */
/** Elites start here. Wave 1 never has one, so the opening and its balance sweep stay as shipped. */
export const ELITE_MIN_WAVE = 2;
/** Chance a given wave (2+) carries one elite escort. Seeded by (seed, wave). */
export const ELITE_CHANCE = 0.5;
export const ELITE_HP_MULT = 1.6;
/** progression.xpForKill: elite kill XP multiplier. */
export const ELITE_XP_MULT = 3;
export const ELITE_NAME_PREFIX = 'ELITE ';

const ESCORT_KINDS: ReadonlySet<ShipKind> = new Set(['destroyer', 'patrol', 'cruiser']);

const SALT_PRESENT = 11;
const SALT_PICK = 12;

/**
 * Index of the escort promoted to elite this wave, or -1. A pure hash of
 * (seed, wave): `rngState` is never read or advanced.
 */
export function eliteIndex(seed: number, wave: number, ships: readonly Ship[]): number {
  if (wave < ELITE_MIN_WAVE) return -1;
  if (hashUnit(seed, wave, 'elite', SALT_PRESENT) >= ELITE_CHANCE) return -1;
  const escorts = ships.flatMap((ship, index) => (ESCORT_KINDS.has(ship.kind) ? [index] : []));
  if (escorts.length === 0) return -1;
  return escorts[Math.floor(hashUnit(seed, wave, 'elite', SALT_PICK) * escorts.length)]!;
}

/** Promote one hull: x1.6 hull points, ELITE name. */
export const makeElite = (ship: Ship): Ship => {
  const hp = Math.round(ship.maxHp * ELITE_HP_MULT);
  return { ...ship, elite: true, hp, maxHp: hp, name: `${ELITE_NAME_PREFIX}${ship.name}` };
};

/**
 * Wave seeding hook: returns `ships` itself before ELITE_MIN_WAVE (so wave-1
 * output is untouched), otherwise a copy with at most one escort promoted.
 */
export function applyElites(seed: number, wave: number, ships: Ship[]): Ship[] {
  const index = eliteIndex(seed, wave, ships);
  if (index < 0) return ships;
  return ships.map((ship, at) => (at === index ? makeElite(ship) : ship));
}
