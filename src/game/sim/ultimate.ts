import { makeTorpedo } from './ordnance-physics';
import type { GameState, Ship, ShipKind, Torpedo } from './types';

/* Tuning. */
/** A full meter. */
export const ULTIMATE_MAX = 100;
/** Damage dealt per point of charge. */
export const DAMAGE_PER_CHARGE = 3;
/** Charge gained per ship sunk. */
export const KILL_CHARGE = 15;
/** Most fish one Broadside launches. */
export const BROADSIDE_SALVO = 4;
const BROADSIDE_TTL = 3;

/** Hulls a Broadside may lock: warships only, never merchants. */
const HUNTER_KINDS: ReadonlySet<ShipKind> = new Set<ShipKind>([
  'destroyer',
  'patrol',
  'cruiser',
  'battleship',
  'sub',
]);

const clampCharge = (charge: number): number => Math.min(ULTIMATE_MAX, Math.max(0, charge));

/** Charge earned by `damage` points dealt and `kills` ships sunk. */
export const chargeFor = (damage: number, kills: number): number =>
  Math.max(0, damage) / DAMAGE_PER_CHARGE + Math.max(0, kills) * KILL_CHARGE;

/** True when the meter is full. Phase is checked by the command, not here. */
export const isBroadsideReady = (state: GameState): boolean =>
  state.ultimateCharge >= ULTIMATE_MAX;

/**
 * Add the charge earned between `prev` and `next` (the stats delta of one step).
 * Pure: reads only the two states' stats, so nothing here advances `rngState`.
 */
export function accrueUltimate(prev: GameState, next: GameState): GameState {
  const gained = chargeFor(
    next.stats.damageDealt - prev.stats.damageDealt,
    next.stats.shipsSunk - prev.stats.shipsSunk,
  );
  if (gained <= 0) return next;
  const charge = clampCharge(next.ultimateCharge + gained);
  return charge === next.ultimateCharge ? next : { ...next, ultimateCharge: charge };
}

/** The nearest live hunters, closest first (ties break by id), up to the salvo size. */
export function broadsideTargets(state: GameState): Ship[] {
  const { x, y } = state.submarine;
  return state.ships
    .filter((ship) => HUNTER_KINDS.has(ship.kind) && ship.hp > 0 && ship.sinking === undefined)
    .map((ship) => ({ ship, range: Math.hypot(ship.x - x, ship.y - y) }))
    .sort((a, b) => a.range - b.range || (a.ship.id < b.ship.id ? -1 : a.ship.id > b.ship.id ? 1 : 0))
    .slice(0, BROADSIDE_SALVO)
    .map((entry) => entry.ship);
}

/** One Mk-14 locked on `target`, built by the normal launcher so damage and perks match. */
function broadsideFish(state: GameState, target: Ship, index: number): Torpedo {
  const fish = makeTorpedo(state, 'mk14', target.id, 0, null, true);
  return { ...fish, id: `mk14-${state.tick}-broadside-${index}`, lockId: target.id };
}

/**
 * Spend a full meter on up to four homing Mk-14 at the nearest hunters. Needs a
 * playing game, a full meter and at least one target; otherwise returns the state
 * untouched (the charge is kept). Costs no ammo and ignores tube reload and arc.
 */
export function launchBroadside(state: GameState): GameState {
  if (state.phase !== 'playing' || !isBroadsideReady(state)) return state;
  const targets = broadsideTargets(state);
  if (targets.length === 0) return state;
  const fish = targets.map((target, index) => broadsideFish(state, target, index));
  return {
    ...state,
    ultimateCharge: 0,
    torpedoes: [...state.torpedoes, ...fish],
    stats: { ...state.stats, torpedoesFired: state.stats.torpedoesFired + fish.length },
    messages: [
      ...state.messages,
      { id: `broadside-${state.tick}`, text: 'BROADSIDE!', ttl: BROADSIDE_TTL },
    ],
  };
}
