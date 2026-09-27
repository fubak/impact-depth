import { describe, expect, it } from 'vitest';
import { detonationShake } from '../../src/game/adapt/combat-feel';

describe('detonation camera shake', () => {
  it('is zero under reduced motion', () => {
    expect(
      detonationShake({ yieldPower: 60, distanceMeters: 0, shakeScale: 0 }),
    ).toBe(0);
  });

  it('falls off with distance to the camera', () => {
    const near = detonationShake({ yieldPower: 50, distanceMeters: 20, shakeScale: 1 });
    const far = detonationShake({ yieldPower: 50, distanceMeters: 200, shakeScale: 1 });
    const beyond = detonationShake({ yieldPower: 50, distanceMeters: 500, shakeScale: 1 });
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(beyond).toBe(0);
  });

  it('scales with yield — a shell splashes less than a torpedo', () => {
    const small = detonationShake({ yieldPower: 22, distanceMeters: 50, shakeScale: 1 });
    const big = detonationShake({ yieldPower: 58, distanceMeters: 50, shakeScale: 1 });
    expect(big).toBeGreaterThan(small);
  });
});
