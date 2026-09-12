import { describe, expect, it } from 'vitest';
import { shouldDispatchWorldInteract } from '../../src/input/controls';

describe('input world-click gating', () => {
  it('ignores HUD-style pointerups that never started a canvas drag', () => {
    // Ambush/Stalk: button pointerdown → window pointerup with dragging=false.
    expect(shouldDispatchWorldInteract(false, false, 0)).toBe(false);
  });

  it('dispatches a canvas click without drag', () => {
    expect(shouldDispatchWorldInteract(true, false, 0)).toBe(true);
    expect(shouldDispatchWorldInteract(true, false, 2)).toBe(true);
  });

  it('does not dispatch after a drag/orbit', () => {
    expect(shouldDispatchWorldInteract(true, true, 0)).toBe(false);
  });
});
