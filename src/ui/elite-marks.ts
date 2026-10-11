import '../styles/loot-elite.css';
import { ELITE_STYLE, isElite, isEliteName } from '../game/adapt/loot-style';
import type { PowerupRarity, ShipKind } from '../game/sim/types';

/** Class for the order-row target value: none, engaged, or engaged elite. */
export function targetCardClass(ship: { elite?: boolean } | undefined): string {
  if (!ship) return '';
  return isElite(ship) ? 'engaged elite' : 'engaged';
}

/** Prefixes the target card text with the elite star. */
export function eliteTargetText(ship: { elite?: boolean }, text: string): string {
  return isElite(ship) ? `${ELITE_STYLE.star} ${text}` : text;
}

/** Map ship circle class: 'ship', then selected, sub, elite in that order. */
export function mapShipClass(
  ship: { id: string; kind: ShipKind; elite?: boolean },
  selectedId: string | null,
): string {
  const selected = ship.id === selectedId ? ' selected' : '';
  const sub = ship.kind === 'sub' ? ' sub' : '';
  const elite = isElite(ship) ? ' elite' : '';
  return `ship${selected}${sub}${elite}`;
}

/** Map ship circle radius: sub 1.7 (checked first), elite 2.0, otherwise 1.4. */
export function mapShipRadius(ship: { kind: ShipKind; elite?: boolean }): number {
  if (ship.kind === 'sub') return 1.7;
  if (isElite(ship)) return 2.0;
  return 1.4;
}

/** Map crate class by rarity: 'crate', 'crate rare' or 'crate epic'. */
export function crateClass(pickup: { rarity?: PowerupRarity }): string {
  const rarity = pickup.rarity ?? 'common';
  return rarity === 'common' ? 'crate' : `crate ${rarity}`;
}

/** Contact button class: contact, then active (selected), then elite (by name prefix). */
export function contactClass(
  contact: { id: string; name: string },
  selectedId: string | null,
): string {
  const active = contact.id === selectedId ? ' active' : '';
  const elite = isEliteName(contact.name) ? ' elite' : '';
  return `contact${active}${elite}`;
}
