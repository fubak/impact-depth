import { describe, expect, it } from 'vitest';
import { shouldRebuildSeabedFollow } from '../../src/render/seabed';

describe('seabed follow', () => {
  it('keeps the floor world-locked until the player drifts a large fraction of the patch', () => {
    expect(shouldRebuildSeabedFollow(0, 0, 12, 8, 440, false)).toBe(false);
    expect(shouldRebuildSeabedFollow(0, 0, 18, 11, 440, false)).toBe(false);
    expect(shouldRebuildSeabedFollow(0, 0, 120, 20, 440, false)).toBe(true);
    expect(shouldRebuildSeabedFollow(0, 0, 12, 8, 440, true)).toBe(true);
    expect(shouldRebuildSeabedFollow(Number.NaN, 0, 0, 0, 440, false)).toBe(true);
  });
});
