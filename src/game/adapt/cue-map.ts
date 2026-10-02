/** An enemy torpedo that expires inside 3 units without a hit. */
export function nearMissCue(range: number): 'incoming' | null {
  return range <= 3 ? 'incoming' : null;
}

/**
 * A charge that deals no damage but detonates within 8 units is a vertical miss.
 * Farther blasts stay silent so the sea is not a constant boom.
 */
export function verticalMissCue(horizontal: number, damaged: boolean): 'distantBoom' | null {
  if (damaged || horizontal > 8) return null;
  return 'distantBoom';
}
