import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { seedWave } from '../../src/game/sim/create';
import type { Ship } from '../../src/game/sim/types';

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function slotPosition(anchor: Ship, escort: Ship): { x: number; y: number } {
  const along = escort.formationAlong ?? 0;
  const lateral = escort.formationLateral ?? 0;
  const cos = Math.cos(anchor.heading);
  const sin = Math.sin(anchor.heading);
  return { x: anchor.x + cos * along - sin * lateral, y: anchor.y + sin * along + cos * lateral };
}

describe('convoy/escort formation seeding', () => {
  it('produces identical formation fields for the same seed and wave', () => {
    const a = seedWave(7, 4);
    const b = seedWave(7, 4);
    expect(a).toEqual(b);
  });

  it('anchors every escort and trailing merchant to the lead merchant with expected role offsets', () => {
    const ships = seedWave(7, 4);
    const anchor = ships[0]!;
    const escorts = ships.filter(
      (ship) => ship.kind === 'destroyer' || ship.kind === 'patrol' || ship.kind === 'cruiser',
    );
    expect(escorts.length).toBeGreaterThan(1);

    const roleCycle = ['lead', 'wing', 'trail'];
    let wingSide = 10;
    escorts.forEach((escort, index) => {
      expect(escort.formationAnchorId).toBe(anchor.id);
      const expectedRole = roleCycle[index % 3];
      expect(escort.formationRole).toBe(expectedRole);
      if (expectedRole === 'lead') {
        expect(escort.formationAlong).toBe(12);
        expect(escort.formationLateral).toBe(0);
      } else if (expectedRole === 'trail') {
        expect(escort.formationAlong).toBe(-12);
        expect(escort.formationLateral).toBe(0);
      } else {
        expect(escort.formationAlong).toBe(0);
        expect(escort.formationLateral).toBe(wingSide);
        wingSide = wingSide === 10 ? -10 : 10;
      }
    });

    const trailingMerchants = ships.filter((ship, index) => index > 0 && ship.kind === 'merchant');
    expect(trailingMerchants.length).toBeGreaterThan(0);
    trailingMerchants.forEach((merchant) => {
      const index = ships.indexOf(merchant);
      expect(merchant.formationAnchorId).toBe(anchor.id);
      expect(merchant.formationRole).toBeNull();
      expect(merchant.formationAlong).toBe(-index * 8);
      expect(merchant.formationLateral).toBe((index % 2 ? 1 : -1) * 6);
    });

    for (let i = 0; i < ships.length; i += 1) {
      for (let j = i + 1; j < ships.length; j += 1) {
        const gap = distance(ships[i]!.x, ships[i]!.y, ships[j]!.x, ships[j]!.y);
        expect(gap).toBeGreaterThan(6);
      }
    }
  });

  it('does not use randomness: two seeds produce different but each internally-stable formations', () => {
    const wave1 = seedWave(3, 2);
    const wave2 = seedWave(3, 2);
    expect(wave1).toEqual(wave2);
    const otherSeed = seedWave(99, 2);
    expect(otherSeed).not.toEqual(wave1);
  });
});

describe('convoy/escort formation seeking behavior', () => {
  it('steers escorts toward their formation slot when the player is undetected', () => {
    let state = startMission(createGame(7));
    // Wave 1's escort is an unanchored roving patrol by design; later convoy
    // waves still carry formation escorts, so exercise the doctrine on one.
    state = { ...state, ships: seedWave(7, 2) };
    const isolatePlayer = (input: typeof state) => ({
      ...input,
      submarine: { ...input.submarine, x: 1, y: 1, noise: 0.05, silentRunning: true },
      sonarPing: 0,
      countermeasures: [],
    });
    state = isolatePlayer(state);

    const escort = state.ships.find((ship) => ship.formationRole);
    expect(escort).toBeTruthy();
    const escortId = escort!.id;
    const anchorId = escort!.formationAnchorId!;
    expect(anchorId).toBeTruthy();

    const findEscort = (input: typeof state) => input.ships.find((ship) => ship.id === escortId)!;
    const findAnchor = (input: typeof state) => input.ships.find((ship) => ship.id === anchorId)!;

    const initialSlot = slotPosition(findAnchor(state), findEscort(state));
    const initialDistance = distance(
      findEscort(state).x,
      findEscort(state).y,
      initialSlot.x,
      initialSlot.y,
    );

    const ticks = Math.ceil(120 / FIXED_DT);
    for (let i = 0; i < ticks; i++) {
      state = updateGame(state, [], FIXED_DT);
      // Keep the player out of every ship's passive detection envelope so escorts
      // stay on the idle/formation-seeking branch for the whole run.
      state = isolatePlayer(state);
    }

    const finalEscort = findEscort(state);
    const finalAnchor = findAnchor(state);
    const finalSlot = slotPosition(finalAnchor, finalEscort);
    const finalDistance = distance(finalEscort.x, finalEscort.y, finalSlot.x, finalSlot.y);

    const headingToSlot = Math.atan2(finalSlot.y - finalEscort.y, finalSlot.x - finalEscort.x);
    const headingDelta = Math.abs(
      Math.atan2(
        Math.sin(headingToSlot - finalEscort.heading),
        Math.cos(headingToSlot - finalEscort.heading),
      ),
    );

    expect(finalDistance < initialDistance || headingDelta < 0.3).toBe(true);
  }, 30_000);

  it('falls back to wander when the formation anchor is missing (e.g. sunk)', () => {
    let state = startMission(createGame(11));
    // Same wave-1 roving-patrol caveat: use a convoy wave with real formation.
    state = { ...state, ships: seedWave(11, 2) };
    const escort = state.ships.find((ship) => ship.formationRole);
    expect(escort).toBeTruthy();
    // Remove the anchor entirely to simulate it having sunk/despawned.
    state = {
      ...state,
      ships: state.ships.filter((ship) => ship.id !== escort!.formationAnchorId),
    };
    state = {
      ...state,
      submarine: { ...state.submarine, x: 1, y: 1, noise: 0.05, silentRunning: true },
      sonarPing: 0,
    };
    // Should not throw and should keep producing finite headings/positions.
    for (let i = 0; i < 300; i++) {
      state = updateGame(state, [], FIXED_DT);
    }
    const survivor = state.ships.find((ship) => ship.id === escort!.id);
    if (survivor) {
      expect(Number.isFinite(survivor.x)).toBe(true);
      expect(Number.isFinite(survivor.y)).toBe(true);
      expect(Number.isFinite(survivor.heading)).toBe(true);
    }
  });
});
