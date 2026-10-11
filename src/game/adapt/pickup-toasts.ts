import { PICKUP_RADIUS } from '../sim/constants';
import { rarityOf } from '../sim/loot';
import type { GameState, Powerup, PowerupRarity } from '../sim/types';
import { pickupToastText } from './loot-style';

export interface PickupToast {
  readonly id: string;
  readonly rarity: PowerupRarity;
  readonly text: string;
}

/** Toasts for crates collected this fixed step. Mirrors `collectedPickups` in combat-events.ts. */
export function derivePickupToasts(prev: GameState, next: GameState): PickupToast[] {
  const taken = next.stats.powerupsTaken - prev.stats.powerupsTaken;
  if (taken <= 0) return [];
  const remaining = new Set(next.powerups.map((pickup) => pickup.id));
  const sub = next.submarine;
  return prev.powerups
    .filter((pickup) => !remaining.has(pickup.id))
    .map((pickup) => ({ pickup, distance: Math.hypot(pickup.x - sub.x, pickup.y - sub.y) }))
    .filter((item) => item.distance <= PICKUP_RADIUS)
    .sort(
      (left, right) =>
        left.distance - right.distance || left.pickup.id.localeCompare(right.pickup.id),
    )
    .slice(0, taken)
    .map(({ pickup }) => toast(pickup));
}

function toast(pickup: Powerup): PickupToast {
  const rarity = rarityOf(pickup);
  return {
    id: `pickup-${pickup.id}`,
    rarity,
    text: pickupToastText(pickup.kind, rarity),
  };
}
