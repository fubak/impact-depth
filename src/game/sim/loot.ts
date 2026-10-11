import { PICKUP_LIFE, PICKUP_MAX } from './constants';
import type { GameState, Powerup, PowerupKind, PowerupRarity, Ship, ShipKind } from './types';

/** Kinds a wreck can drop: the same set the map seeds. Kept here so create.ts can import elites.ts without a cycle. */
const LOOT_KINDS: readonly PowerupKind[] = ['health', 'ammo', 'hull', 'weapon', 'speed', 'counter'];

/* Tuning. */
/** Chance a sunk hull leaves a crate. Merchants are the modest base; escorts and capitals pay more. */
export const LOOT_DROP_CHANCE: Readonly<Record<ShipKind, number>> = {
  merchant: 0.3,
  patrol: 0.4,
  destroyer: 0.45,
  cruiser: 0.55,
  sub: 0.5,
  battleship: 0.9,
};

/** Rarity odds once a crate drops. Each row sums to 1; bigger hulls skew better. */
export const LOOT_RARITY_WEIGHTS: Readonly<
  Record<ShipKind, Readonly<Record<PowerupRarity, number>>>
> = {
  merchant: { common: 0.8, rare: 0.18, epic: 0.02 },
  patrol: { common: 0.75, rare: 0.22, epic: 0.03 },
  destroyer: { common: 0.65, rare: 0.28, epic: 0.07 },
  cruiser: { common: 0.55, rare: 0.33, epic: 0.12 },
  sub: { common: 0.55, rare: 0.33, epic: 0.12 },
  battleship: { common: 0.3, rare: 0.45, epic: 0.25 },
};

/** applyPickup: hull restored by a health crate. Common matches the original +35. */
export const HEALTH_BY_RARITY: Readonly<Record<PowerupRarity, number>> = {
  common: 35,
  rare: 60,
  epic: 100,
};

/** applyPickup: seekers granted by an ammo crate. Common matches the original +2. */
export const SEEKERS_BY_RARITY: Readonly<Record<PowerupRarity, number>> = {
  common: 2,
  rare: 3,
  epic: 4,
};

/** Seeded-stream salts: keep the drop, rarity and kind rolls independent of each other. */
const SALT_DROP = 1;
const SALT_RARITY = 2;
const SALT_KIND = 3;

/** Seeded roll in [0, 1) from (seed, tick, key, salt). A pure hash: it never touches `rngState`. */
export function hashUnit(seed: number, tick: number, key: string, salt: number): number {
  let hash =
    Math.imul(seed | 0, 0x9e3779b1) ^
    Math.imul(tick | 0, 0x85ebca6b) ^
    Math.imul(salt | 0, 0xc2b2ae35);
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export const rarityOf = (pickup: Pick<Powerup, 'rarity'>): PowerupRarity =>
  pickup.rarity ?? 'common';

function pickRarity(
  weights: Readonly<Record<PowerupRarity, number>>,
  roll: number,
  floor: boolean,
): PowerupRarity {
  // `floor` drops the common band and renormalises, so an elite is rare-or-epic with the class's own skew.
  const common = floor ? 0 : weights.common;
  const total = common + weights.rare + weights.epic;
  const point = roll * total;
  if (point < common) return 'common';
  return point < common + weights.rare ? 'rare' : 'epic';
}

/**
 * Seeded loot outcome for one wreck, or null for no drop. Elites always drop
 * and never roll common. Reads only (seed, tick, ship id): replay-safe.
 */
export function rollLoot(
  seed: number,
  tick: number,
  ship: Pick<Ship, 'id' | 'kind' | 'elite'>,
): { kind: PowerupKind; rarity: PowerupRarity } | null {
  const elite = ship.elite === true;
  if (!elite && hashUnit(seed, tick, ship.id, SALT_DROP) >= LOOT_DROP_CHANCE[ship.kind])
    return null;
  const rarity = pickRarity(
    LOOT_RARITY_WEIGHTS[ship.kind],
    hashUnit(seed, tick, ship.id, SALT_RARITY),
    elite,
  );
  const kind =
    LOOT_KINDS[Math.floor(hashUnit(seed, tick, ship.id, SALT_KIND) * LOOT_KINDS.length)]!;
  return { kind, rarity };
}

/**
 * Drop a crate at each wreck that rolls loot. Capped by PICKUP_MAX: a wreck that
 * finds the board full simply drops nothing. Returns the same state when nothing drops.
 */
export function dropLoot(state: GameState, wrecks: readonly Ship[]): GameState {
  const crates: Powerup[] = [];
  for (const wreck of wrecks) {
    if (state.powerups.length + crates.length >= PICKUP_MAX) break;
    const loot = rollLoot(state.seed, state.tick, wreck);
    if (loot === null) continue;
    crates.push({
      id: `loot-${state.tick}-${wreck.id}`,
      kind: loot.kind,
      x: wreck.x,
      y: wreck.y,
      life: PICKUP_LIFE,
      rarity: loot.rarity,
    });
  }
  return crates.length === 0 ? state : { ...state, powerups: [...state.powerups, ...crates] };
}
