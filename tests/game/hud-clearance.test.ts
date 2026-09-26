import { describe, expect, it } from 'vitest';
import { bottomClearanceText, objectiveText } from '../../src/ui/hud';
import { FULL_TOUR } from '../../src/ui/tutorial';

describe('bottom clearance label', () => {
  it('shows BOTTOM when the hull is within 0.08 of the depth limit', () => {
    expect(bottomClearanceText(0.62, 0.6)).toBe('BOTTOM');
    expect(bottomClearanceText(0.9, 0.5)).toBeNull();
  });
});

describe('clear two waves copy', () => {
  it('states the objective on the HUD and in the full tour', () => {
    expect(objectiveText()).toBe('Clear two waves');
    expect(FULL_TOUR.some((step) => step.body.includes('Clear two waves'))).toBe(true);
  });
});
