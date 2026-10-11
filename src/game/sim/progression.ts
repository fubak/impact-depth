import { applyChosenPerk, PERKS, PERK_IDS } from './perks';
import type { GameState, PerkId, Ship, ShipKind } from './types';

/** XP per sunk hull, by class. */
export const XP_PER_KILL: Record<ShipKind, number> = {
  merchant: 40,
  patrol: 60,
  destroyer: 100,
  cruiser: 160,
  sub: 140,
  battleship: 300,
};

/** Perks offered per level-up. */
export const OFFER_SIZE = 3;

/** XP needed to leave level `level`: 80 + 60 * (level - 1). */
export const xpToNext = (level: number): number => 80 + 60 * (level - 1);

export const xpForKill = (ship: Pick<Ship, 'kind'>): number => XP_PER_KILL[ship.kind];

/** Integer hash (murmur-style finalizer) so offers depend on inputs, not on call order. */
function mix(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Small seeded stream for one offer; local, so game `rngState` is never advanced. */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let r = Math.imul(state ^ (state >>> 15), state | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic draft: up to OFFER_SIZE distinct perks from the pool of perks
 * the captain may still take. Reads `rngState` but does not advance it, so a
 * level-up never shifts the random stream the rest of the sim depends on.
 */
export function offerPerks(
  seed: number,
  level: number,
  rngState: number,
  owned: readonly PerkId[],
): PerkId[] {
  const pool = PERK_IDS.filter((id) => PERKS[id].stackable || !owned.includes(id));
  const next = stream(mix(seed, level, rngState, owned.length));
  const picks: PerkId[] = [];
  const left = [...pool];
  while (picks.length < OFFER_SIZE && left.length > 0) {
    const index = Math.floor(next() * left.length);
    picks.push(left[index]!);
    left.splice(index, 1);
  }
  return picks;
}

const offerFor = (state: GameState, level: number): PerkId[] =>
  offerPerks(state.seed, level, state.rngState, state.perks);

/**
 * Add XP, roll level-ups, and open a perk offer. A level-up while an offer is
 * open queues behind it. Never blocks: the sim keeps stepping with a pending offer.
 */
export function awardXp(state: GameState, amount: number): GameState {
  if (!(amount > 0)) return state;
  let xp = state.stats.xp + amount;
  let level = state.stats.level;
  let pendingPerks = state.pendingPerks;
  let perkQueue = state.perkQueue;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    if (pendingPerks.length === 0) pendingPerks = offerFor(state, level);
    else perkQueue += 1;
  }
  const leveled = level > state.stats.level;
  return {
    ...state,
    stats: { ...state.stats, xp, level },
    pendingPerks,
    perkQueue,
    messages: leveled
      ? [...state.messages, { id: `level-${state.tick}-${level}`, text: `LEVEL ${level}`, ttl: 4 }]
      : state.messages,
  };
}

/**
 * Take the offered perk at `index` (0-based). Applies it exactly once, closes
 * the offer, and opens the next queued one. Anything invalid is a no-op.
 */
export function choosePerk(state: GameState, index: number): GameState {
  const id = Number.isInteger(index) ? state.pendingPerks[index] : undefined;
  if (id === undefined) return state;
  const owned: GameState = {
    ...applyChosenPerk(state, id),
    perks: [...state.perks, id],
    pendingPerks: [],
    messages: [
      ...state.messages,
      { id: `perk-${state.tick}-${id}`, text: `PERK · ${PERKS[id].name.toUpperCase()}`, ttl: 4 },
    ],
  };
  if (owned.perkQueue <= 0) return owned;
  return {
    ...owned,
    perkQueue: owned.perkQueue - 1,
    pendingPerks: offerFor(owned, owned.stats.level),
  };
}
