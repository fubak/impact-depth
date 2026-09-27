import type { CombatEvent } from '../../game/adapt/combat-events';
import type { ShipKind } from '../../game/sim/types';

export interface Wreck {
  id: string;
  x: number;
  y: number;
  age: number;
  kind: ShipKind;
}

export const WRECK_LIFE_S = 6;

/** Presentation-only wrecks. The sim has already dropped the ship. */
export function advanceWrecks(
  wrecks: readonly Wreck[],
  events: readonly CombatEvent[],
  dt: number,
): Wreck[] {
  const spawned = events
    .filter(
      (event): event is Extract<CombatEvent, { type: 'shipSunk' }> => event.type === 'shipSunk',
    )
    .map((event) => ({ id: event.id, x: event.x, y: event.y, kind: event.kind, age: 0 }));
  return [...wrecks, ...spawned]
    .map((wreck) => ({ ...wreck, age: wreck.age + dt }))
    .filter((wreck) => wreck.age < WRECK_LIFE_S);
}

/**
 * Surface hulls roll and settle. A submarine pitches down and leaves the layer.
 * Default arguments keep the original six-second surface curve.
 */
export function wreckPose(
  age: number,
  kind: ShipKind = 'merchant',
): { list: number; sink: number; pitch: number } {
  const t = Math.max(0, Math.min(1, age / WRECK_LIFE_S));
  if (kind === 'sub') return { list: 1.15 * t, sink: 22 * t, pitch: 0.9 * t };
  return { list: 0.4 * t, sink: 8 * t, pitch: 0.2 * t };
}
