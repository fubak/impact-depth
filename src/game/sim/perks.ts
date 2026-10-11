import { applyShellHit } from './ship-damage';
import type { GameState, PerkId, Ship } from './types';

export interface PerkDef {
  id: PerkId;
  name: string;
  /** Plain-language effect shown on the level-up card. */
  description: string;
  /** A stackable perk may be offered again after it is owned. */
  stackable: boolean;
}

/** Stable order: offers index into this list, so never reorder casually. */
export const PERK_IDS: readonly PerkId[] = [
  'hotTubes',
  'heavyWarheads',
  'ironHull',
  'salvage',
  'quietProp',
  'predator',
  'chainReaction',
  'ghost',
];

export const PERKS: Record<PerkId, PerkDef> = {
  hotTubes: {
    id: 'hotTubes',
    name: 'Hot Tubes',
    description: 'Torpedo tubes reload 20% faster.',
    stackable: false,
  },
  heavyWarheads: {
    id: 'heavyWarheads',
    name: 'Heavy Warheads',
    description: 'Your torpedoes hit 25% harder.',
    stackable: false,
  },
  ironHull: {
    id: 'ironHull',
    name: 'Iron Hull',
    description: 'Gain 25 max hull and repair 25 right now.',
    stackable: true,
  },
  salvage: {
    id: 'salvage',
    name: 'Salvage',
    description: 'Each sunk ship gives back one extra torpedo.',
    stackable: false,
  },
  quietProp: {
    id: 'quietProp',
    name: 'Quiet Prop',
    description: 'Your boat makes 25% less noise.',
    stackable: false,
  },
  predator: {
    id: 'predator',
    name: 'Predator',
    description: 'Torpedoes have a 15% chance to crit for double damage.',
    stackable: false,
  },
  chainReaction: {
    id: 'chainReaction',
    name: 'Chain Reaction',
    description: 'A sinking ship damages every hull within 6 units.',
    stackable: false,
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    description: 'Silent running costs no battery.',
    stackable: false,
  },
};

/* Tuning. Each perk reads its constant at exactly one site (noted per line). */
/** submarine system: reload timers count down this many times faster (1 / 0.8 = -20% time). */
export const HOT_TUBES_RELOAD_RATE = 1.25;
/** makeTorpedo: player torpedo damage multiplier. */
export const HEAVY_WARHEADS_DAMAGE = 1.25;
/** choose time: max hull gained and hull repaired. */
export const IRON_HULL_BONUS = 25;
/** damage system: extra Mk-14 refunded per kill. */
export const SALVAGE_BONUS = 1;
/** submarine system: boat noise multiplier. */
export const QUIET_PROP_NOISE = 0.75;
/** choose time: stored on the boat for combo.ts to roll later. */
export const PREDATOR_CRIT_CHANCE = 0.15;
/** damage system: hull damage dealt to nearby ships when one sinks. */
export const CHAIN_REACTION_DAMAGE = 30;
export const CHAIN_REACTION_RADIUS = 6;

export const hasPerk = (state: Pick<GameState, 'perks'>, id: PerkId): boolean =>
  state.perks.includes(id);

/** Reload countdown multiplier (submarine system). */
export const reloadRate = (state: GameState): number =>
  hasPerk(state, 'hotTubes') ? HOT_TUBES_RELOAD_RATE : 1;

/** Player torpedo damage multiplier (makeTorpedo). */
export const torpedoDamageScale = (state: GameState): number =>
  hasPerk(state, 'heavyWarheads') ? HEAVY_WARHEADS_DAMAGE : 1;

/** Boat noise multiplier (submarine system). */
export const noiseScale = (state: GameState): number =>
  hasPerk(state, 'quietProp') ? QUIET_PROP_NOISE : 1;

/** Torpedoes returned for `kills` sinkings (damage system). */
export const salvageRefund = (state: GameState, kills: number): number =>
  hasPerk(state, 'salvage') ? kills * (1 + SALVAGE_BONUS) : kills;

/** True when silent running should not draw the battery (submarine system). */
export const silentRunningIsFree = (state: GameState): boolean =>
  hasPerk(state, 'ghost') && state.submarine.silentRunning;

/**
 * One-shot effects that change stored numbers rather than a per-step rule.
 * Called once by choosePerk after the perk is appended to `state.perks`.
 */
export function applyChosenPerk(state: GameState, id: PerkId): GameState {
  const sub = state.submarine;
  if (id === 'ironHull') {
    const maxHp = sub.maxHp + IRON_HULL_BONUS;
    const hp = Math.min(maxHp, sub.hp + IRON_HULL_BONUS);
    return { ...state, submarine: { ...sub, maxHp, hp } };
  }
  if (id === 'predator') {
    const critChance = Math.min(1, sub.critChance + PREDATOR_CRIT_CHANCE);
    return { ...state, submarine: { ...sub, critChance } };
  }
  return state;
}

/**
 * Hulls inside the blast radius of each wreck take hull damage; a lethal hit
 * starts the usual sinking countdown and pays its own kill later.
 * Wrecks are the ships that just went under, so they are no longer in `ships`.
 */
export function chainReaction(
  ships: Ship[],
  wrecks: readonly Pick<Ship, 'x' | 'y'>[],
): { ships: Ship[]; hits: number } {
  let hits = 0;
  const next = ships.map((ship) => {
    if (ship.sinking !== undefined) return ship;
    let hurt = ship;
    for (const wreck of wrecks) {
      if (hurt.sinking !== undefined) break;
      if (Math.hypot(hurt.x - wreck.x, hurt.y - wreck.y) > CHAIN_REACTION_RADIUS) continue;
      hurt = applyShellHit(hurt, CHAIN_REACTION_DAMAGE, 1).ship;
      hits++;
    }
    return hurt;
  });
  return { ships: hits > 0 ? next : ships, hits };
}
