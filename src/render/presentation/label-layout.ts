/**
 * Pure layout math for the own-boat label. No Three.js, no DOM.
 * The scene turns these numbers into a sprite; the tests pin the numbers.
 */

export const OWN_LABEL_ASPECT = 5; // canvas 320×64
export const OWN_LABEL_SCREEN_FRACTION = 0.028; // label height ≈ 2.8% of viewport height
export const OWN_LABEL_MIN_H = 0.35; // metres
export const OWN_LABEL_MAX_H = 3.0;
export const OWN_LABEL_FALLBACK_H = 1.2; // orthographic camera or bad input
export const OWN_LABEL_CLEARANCE_M = 0.8; // gap above the sail
export const OWN_LABEL_SAFE_NDC = { xMin: -0.45, xMax: 0.45, yMin: -0.35, yMax: 0.55 } as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** World height (m) so the sprite keeps a constant screen fraction: clamp(d·2·tan(fov/2)·fraction, min, max). */
export function ownLabelWorldHeight(distanceM: number, fovDeg: number): number {
  if (!Number.isFinite(distanceM) || !Number.isFinite(fovDeg)) return OWN_LABEL_FALLBACK_H;
  if (distanceM <= 0 || fovDeg <= 0) return OWN_LABEL_FALLBACK_H;
  const halfFovRad = (fovDeg * Math.PI) / 360;
  const raw = distanceM * 2 * Math.tan(halfFovRad) * OWN_LABEL_SCREEN_FRACTION;
  if (!Number.isFinite(raw) || raw <= 0) return OWN_LABEL_FALLBACK_H;
  return clamp(raw, OWN_LABEL_MIN_H, OWN_LABEL_MAX_H);
}

/** Sprite centre Y: keel + hull height + clearance + half the label. */
export function ownLabelAnchorY(
  hullKeelY: number,
  hullHeightM: number,
  labelHeightM: number,
): number {
  return hullKeelY + hullHeightM + OWN_LABEL_CLEARANCE_M + labelHeightM / 2;
}

/** Clamp an NDC point into the HUD-safe box (HUD panels live along the screen edges). */
export function clampLabelNdc(
  x: number,
  y: number,
  box: { xMin: number; xMax: number; yMin: number; yMax: number } = OWN_LABEL_SAFE_NDC,
): { x: number; y: number } {
  return { x: clamp(x, box.xMin, box.xMax), y: clamp(y, box.yMin, box.yMax) };
}
