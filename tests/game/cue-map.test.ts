import { describe, expect, it } from 'vitest';
import { nearMissCue, verticalMissCue } from '../../src/game/adapt/cue-map';

describe('combat cue map', () => {
  it('calls incoming only for a torpedo that expires inside 3 units', () => {
    expect(nearMissCue(2.9)).toBe('incoming');
    expect(nearMissCue(3)).toBe('incoming');
    expect(nearMissCue(3.1)).toBeNull();
  });

  it('calls a distant boom for a vertical miss inside 8 units', () => {
    expect(verticalMissCue(7.5, false)).toBe('distantBoom');
    expect(verticalMissCue(8, false)).toBe('distantBoom');
    expect(verticalMissCue(8.1, false)).toBeNull();
    expect(verticalMissCue(4, true)).toBeNull();
  });
});
