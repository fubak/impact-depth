import { describe, expect, it } from 'vitest';
import { dropHeldKeys } from '../../src/input/controls';

describe('blur key release', () => {
  it('clears every held helm key', () => {
    const keys = new Set(['KeyW', 'KeyD']);
    dropHeldKeys(keys);
    expect(keys.size).toBe(0);
  });
});
