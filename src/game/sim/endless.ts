import { seedWave, shipStats } from './create';
import { makeElite } from './elites';
import { hashUnit } from './loot';
import { SINK_DURATION } from './ship-damage';
import type { GameState, Ship, ShipKind } from './types';

/* Tuning. Plan 030: "Keep hunting" escalates every wave after the first endless one. */
export const ENDLESS_FIRST_WAVE = 3;
export const ENDLESS_HP_STEP = 0.15;
export const ENDLESS_HP_MAX_MULT = 2.5;
export const ENDLESS_MAX_CONVERSIONS = 3;
export const ENDLESS_MAX_ELITES = 3;
export const ENDLESS_ALERT_BASE = 0.5;
export const ENDLESS_ALERT_STEP = 0.1;
export const ENDLESS_ALERT_MAX = 0.85;
export const ENDLESS_MESSAGE = 'ENDLESS HUNT';

const SALT_ENDLESS_ELITE = 21;
const ESCORT_KINDS: ReadonlySet<ShipKind> = new Set(['destroyer', 'patrol', 'cruiser']);

/** 0 before the first endless wave, then 1, 2, … */
export const endlessTier = (wave: number): number =>
  Number.isFinite(wave) ? Math.max(0, wave - (ENDLESS_FIRST_WAVE - 1)) : 0;

export const endlessHpMultiplier = (tier: number): number =>
  Math.min(ENDLESS_HP_MAX_MULT, 1 + ENDLESS_HP_STEP * Math.max(0, tier));

export const endlessConversions = (tier: number): number =>
  tier <= 0 ? 0 : Math.min(ENDLESS_MAX_CONVERSIONS, Math.ceil(tier / 2));

export const endlessEliteTarget = (tier: number): number =>
  tier <= 0 ? 0 : Math.min(ENDLESS_MAX_ELITES, 1 + Math.floor(tier / 2));

export const endlessAlert = (tier: number): number =>
  Math.min(ENDLESS_ALERT_MAX, ENDLESS_ALERT_BASE + ENDLESS_ALERT_STEP * Math.max(0, tier - 1));

/** Only a finished patrol can be continued, and only once. */
export function canContinueEndless(
  state: Pick<GameState, 'phase' | 'scenario' | 'endless'>,
): boolean {
  return state.phase === 'victory' && state.scenario === 'patrol' && state.endless !== true;
}

/** Returns `state` itself when the command does not apply. */
export function continueEndless(state: GameState): GameState {
  if (!canContinueEndless(state)) return state;
  return {
    ...state,
    endless: true,
    phase: 'playing',
    messages: [...state.messages, { id: `endless-${state.tick}`, text: ENDLESS_MESSAGE, ttl: 3 }],
  };
}

/** Turn a merchant into a warship. k = 0 is a destroyer on the starboard wing, k = 1 a patrol on port. */
function convertToWarship(ship: Ship, k: number): Ship {
  const kind: ShipKind = k % 2 === 0 ? 'destroyer' : 'patrol';
  const stats = shipStats[kind];
  return {
    ...ship,
    kind,
    name: stats.name,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    sinkDuration: SINK_DURATION[kind],
    formationRole: 'wing',
    formationAlong: 0,
    formationLateral: k % 2 === 0 ? 12 : -12,
  };
}

/** Converts the last `count` merchants, counting from the end and never index 0 (the convoy anchor). */
function convertMerchants(ships: readonly Ship[], count: number): Ship[] {
  const targets: number[] = [];
  for (let i = ships.length - 1; i >= 1 && targets.length < count; i--) {
    if (ships[i]!.kind === 'merchant') targets.push(i);
  }
  return ships.map((ship, index) => {
    const k = targets.indexOf(index);
    return k < 0 ? ship : convertToWarship(ship, k);
  });
}

/** Warships get `multiplier` times their base hull points, at full health. Merchants are untouched. */
function scaleHull(ship: Ship, multiplier: number): Ship {
  if (ship.kind === 'merchant') return ship;
  const hp = Math.round(ship.maxHp * multiplier);
  return { ...ship, hp, maxHp: hp };
}

/** Promotes the lowest-ranked escorts (seeded hash, ties by index) until the elite target is met. */
function promoteElites(seed: number, wave: number, ships: readonly Ship[], target: number): Ship[] {
  const have = ships.filter((ship) => ship.elite === true).length;
  const need = Math.max(0, target - have);
  const ranked = ships
    .map((ship, index) => ({ ship, index }))
    .filter(({ ship }) => ESCORT_KINDS.has(ship.kind) && ship.elite !== true)
    .map(({ ship, index }) => ({
      index,
      rank: hashUnit(seed, wave, ship.id, SALT_ENDLESS_ELITE),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const picks = new Set(ranked.slice(0, need).map((entry) => entry.index));
  return ships.map((ship, index) => (picks.has(index) ? makeElite(ship) : ship));
}

/**
 * Escalates a wave for endless play. Order: convert merchants, scale warship HP, raise alert, then
 * promote elites. Pure: never mutates `ships`. Before the first endless wave it returns `ships` itself.
 */
export function escalateWave(seed: number, wave: number, ships: readonly Ship[]): Ship[] {
  const tier = endlessTier(wave);
  if (tier <= 0) return ships as Ship[];
  const multiplier = endlessHpMultiplier(tier);
  const alert = endlessAlert(tier);
  const converted = convertMerchants(ships, endlessConversions(tier));
  const scaled = converted.map((ship) => {
    const hulled = scaleHull(ship, multiplier);
    return { ...hulled, alert: Math.max(hulled.alert, alert) };
  });
  return promoteElites(seed, wave, scaled, endlessEliteTarget(tier));
}

/** Next wave's ships: exactly seedWave(...) on a normal patrol; escalated in endless mode. */
export function seedNextWave(
  state: Pick<GameState, 'seed' | 'worldVersion' | 'endless'>,
  wave: number,
): Ship[] {
  const ships = seedWave(state.seed, wave, undefined, state.worldVersion);
  return state.endless === true ? escalateWave(state.seed, wave, ships) : ships;
}
