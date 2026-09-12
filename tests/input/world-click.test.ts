import { describe, expect, it } from 'vitest';
import { shouldDispatchWorldInteract } from '../../src/input/controls';
import {
  clientToNdc,
  findPixelProximateContact,
  findScreenProximateContact,
  resolveWorldClick,
} from '../../src/input/world-click';

describe('world click targeting', () => {
  it('selects an actual ray hit even if nothing is screen-proximate', () => {
    expect(resolveWorldClick('escort-1', null)).toEqual({
      action: 'select',
      id: 'escort-1',
    });
  });

  it('selects a screen-proximate contact when the ray misses', () => {
    expect(resolveWorldClick(null, 'tiny-hull')).toEqual({
      action: 'select',
      id: 'tiny-hull',
    });
  });

  it('plots a waypoint on empty water even when a ship is close in world space', () => {
    expect(resolveWorldClick(null, null)).toEqual({ action: 'plot' });
  });

  it('finds a contact only inside the screen-pixel radius', () => {
    const hit = findScreenProximateContact(
      0,
      0,
      [{ id: 'near', ndcX: 0.02, ndcY: 0, clipW: 1 }],
      800,
      600,
      28,
    );
    expect(hit).toBe('near');
    const miss = findScreenProximateContact(
      0,
      0,
      [{ id: 'far', ndcX: 0.4, ndcY: 0.4, clipW: 1 }],
      800,
      600,
      28,
    );
    expect(miss).toBeNull();
    expect(
      findScreenProximateContact(0, 0, [{ id: 'behind', ndcX: 0, ndcY: 0, clipW: -1 }], 800, 600),
    ).toBeNull();
  });

  it('keeps tactical-map empty water as a plot unless the icon is pixel-proximate', () => {
    expect(
      findPixelProximateContact(100, 80, [{ id: 'ship', x: 104, y: 82 }], 14),
    ).toBe('ship');
    expect(
      findPixelProximateContact(100, 80, [{ id: 'ship', x: 140, y: 80 }], 14),
    ).toBeNull();
  });

  it('converts client pixels to NDC for the same pick ray the camera uses', () => {
    const ndc = clientToNdc(400, 300, { left: 0, top: 0, width: 800, height: 600 });
    expect(ndc.x).toBeCloseTo(0);
    expect(ndc.y).toBeCloseTo(0);
  });

  it('preserves HUD-origin gating so chrome clicks never become world plots', () => {
    expect(shouldDispatchWorldInteract(false, false, 0)).toBe(false);
    expect(shouldDispatchWorldInteract(true, false, 0)).toBe(true);
  });
});
