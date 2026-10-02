/** Horizontal falloff times a separate depth window. A miss on either axis is a dud. */
export function blastDamage(args: {
  damage: number;
  horizontal: number;
  radius: number;
  depthDelta: number;
  vertical: number;
}): number {
  const { damage, horizontal, radius, depthDelta, vertical } = args;
  if (radius <= 0 || vertical <= 0) return 0;
  if (horizontal >= radius || depthDelta >= vertical) return 0;
  return damage * (1 - horizontal / radius) * (1 - depthDelta / vertical);
}
