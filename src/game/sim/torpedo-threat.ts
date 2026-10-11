import type { Torpedo } from './types';

export interface TorpedoThreat {
  torpedo: Torpedo;
  /** Direction from the threatened hull toward the torpedo (rad). */
  bearing: number;
  distance: number;
}

/**
 * The nearest player torpedo that is running at a hull: inside `range`, ahead
 * of its own nose, and on a track that passes within `trackHalfWidth` of the
 * hull. Pure geometry, no RNG, ties broken by torpedo id.
 */
export function nearestTorpedoThreat(
  at: { x: number; y: number },
  torpedoes: readonly Torpedo[],
  range: number,
  trackHalfWidth: number,
): TorpedoThreat | null {
  let best: TorpedoThreat | null = null;
  for (const torpedo of torpedoes) {
    if (torpedo.owner !== 'player') continue;
    const dx = torpedo.x - at.x;
    const dy = torpedo.y - at.y;
    const distance = Math.hypot(dx, dy);
    if (distance > range) continue;
    // Torpedo-to-hull vector against the torpedo's nose.
    const along = -dx * Math.cos(torpedo.heading) - dy * Math.sin(torpedo.heading);
    if (along <= 0) continue;
    const cross = Math.abs(-dx * Math.sin(torpedo.heading) + dy * Math.cos(torpedo.heading));
    if (cross > trackHalfWidth) continue;
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && torpedo.id < best.torpedo.id)
    ) {
      best = { torpedo, bearing: Math.atan2(dy, dx), distance };
    }
  }
  return best;
}
