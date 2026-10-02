import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { canHearSubmarine, canSeeSubmarine, hasContact } from '../../src/game/sim/contact';
import { WORLD_CENTER } from '../../src/game/sim/constants';
import type { GameState, Ship } from '../../src/game/sim/types';

function isolate(state: GameState, ship: Ship, sub: Partial<GameState['submarine']>): GameState {
  return {
    ...state,
    sonarPing: 4,
    countermeasures: [],
    submarine: {
      ...state.submarine,
      silentRunning: true,
      snorkel: false,
      scopeUp: false,
      invuln: 0,
      ...sub,
    },
    ships: [ship],
  };
}

describe('escort contact is visual or acoustic, never GPS', () => {
  it('a player ping does not hand escorts the boat when they cannot see or hear it', () => {
    const state = startMission(createGame(21));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    const next = isolate(state, escort, {
      x: WORLD_CENTER,
      y: WORLD_CENTER,
      z: 0.82,
      noise: 0.05,
      silentRunning: true,
    });
    const far = {
      ...next,
      ships: [{ ...escort, x: WORLD_CENTER + 40, y: WORLD_CENTER + 40 }],
    };
    const ship = far.ships[0]!;
    expect(canSeeSubmarine(ship, far)).toBe(false);
    expect(canHearSubmarine(ship, far)).toBe(false);
    expect(hasContact(ship, far)).toBe(false);
  });

  it('a surfaced boat in visual range is seen', () => {
    const state = startMission(createGame(21));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    const next = isolate(
      state,
      { ...escort, x: WORLD_CENTER, y: WORLD_CENTER },
      {
        x: WORLD_CENTER + 4,
        y: WORLD_CENTER,
        z: 0.06,
        noise: 0.05,
      },
    );
    expect(canSeeSubmarine(next.ships[0]!, next)).toBe(true);
    expect(hasContact(next.ships[0]!, next)).toBe(true);
  });

  it('a deep silent boat is invisible even at point-blank', () => {
    const state = startMission(createGame(21));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    const next = isolate(
      state,
      { ...escort, x: WORLD_CENTER, y: WORLD_CENTER },
      {
        x: WORLD_CENTER + 1.5,
        y: WORLD_CENTER,
        z: 0.82,
        noise: 0.05,
        silentRunning: true,
      },
    );
    expect(canSeeSubmarine(next.ships[0]!, next)).toBe(false);
  });

  it('escorts hunt the last datum, not the live boat, after they lose the fix', () => {
    let state = startMission(createGame(21));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    const originX = WORLD_CENTER;
    const originY = WORLD_CENTER;
    const datumX = originX + 8;
    const datumY = originY;
    state = {
      ...state,
      sonarPing: 0,
      base: { ...state.base, x: -200, y: -200 },
      submarine: {
        ...state.submarine,
        x: originX,
        y: originY + 22,
        z: 0.82,
        targetDepth: 0.82,
        noise: 0.05,
        silentRunning: true,
        snorkel: false,
        scopeUp: false,
        invuln: 0,
      },
      ships: state.ships.map((s) =>
        s.id === escort.id
          ? {
              ...s,
              x: originX,
              y: originY,
              heading: Math.PI / 2,
              alert: 0.9,
              holdContact: 4,
              lastKnownX: datumX,
              lastKnownY: datumY,
              path: [],
              formationAnchorId: null,
              speed: 2,
            }
          : {
              ...s,
              x: originX - 30,
              y: originY - 30,
              alert: 0,
              holdContact: 0,
              speed: 0,
              path: [],
            },
      ),
    };
    for (let i = 0; i < Math.ceil(2 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const hunter = state.ships.find((s) => s.id === escort.id)!;
    const toDatum = Math.atan2(datumY - hunter.y, datumX - hunter.x);
    const toLive = Math.atan2(state.submarine.y - hunter.y, state.submarine.x - hunter.x);
    const delta = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    expect(delta(hunter.heading, toDatum)).toBeLessThan(0.5);
    expect(delta(hunter.heading, toLive)).toBeGreaterThan(0.7);
  });

  it('without a last datum, an alerted escort does not turn toward the hidden boat', () => {
    let state = startMission(createGame(21));
    const escort = state.ships.find(
      (s) => s.kind === 'destroyer' || s.kind === 'patrol' || s.kind === 'cruiser',
    )!;
    const originX = WORLD_CENTER + 8;
    const originY = WORLD_CENTER + 8;
    state = {
      ...state,
      sonarPing: 4,
      submarine: {
        ...state.submarine,
        x: originX,
        y: originY + 40,
        z: 0.85,
        targetDepth: 0.85,
        speed: 0,
        targetSpeed: 0,
        speedOrder: 'stop',
        noise: 0.05,
        silentRunning: true,
        snorkel: false,
        scopeUp: false,
      },
      ships: state.ships.map((s) =>
        s.id === escort.id
          ? {
              ...s,
              x: originX,
              y: originY,
              heading: 0,
              alert: 0.9,
              holdContact: 4,
              lastKnownX: undefined,
              lastKnownY: undefined,
              path: [],
              formationAnchorId: null,
              speed: 0,
            }
          : { ...s, x: originX - 40, y: originY - 40, speed: 0, path: [] },
      ),
    };
    const startDist = Math.hypot(40, 0);
    for (let i = 0; i < Math.ceil(1.2 / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const hunter = state.ships.find((s) => s.id === escort.id)!;
    expect(hunter.lastKnownX).toBeUndefined();
    expect(hunter.lastKnownY).toBeUndefined();
    expect(hunter.holdContact).toBeLessThan(4);
    expect(Math.hypot(state.submarine.x - hunter.x, state.submarine.y - hunter.y)).toBeGreaterThan(
      startDist - 1,
    );
  });
});
