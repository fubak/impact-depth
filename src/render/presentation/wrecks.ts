import type { CombatEvent } from '../../game/adapt/combat-events';

export interface Wreck {
  id: string;
  x: number;
  y: number;
  age: number;
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
    .map((event) => ({ id: event.id, x: event.x, y: event.y, age: 0 }));
  return [...wrecks, ...spawned]
    .map((wreck) => ({ ...wreck, age: wreck.age + dt }))
    .filter((wreck) => wreck.age < WRECK_LIFE_S);
}

/** List 0.4 rad and sink 8 m across the six-second life. */
export function wreckPose(age: number): { list: number; sink: number } {
  const t = Math.max(0, Math.min(1, age / WRECK_LIFE_S));
  return { list: 0.4 * t, sink: 8 * t };
}
