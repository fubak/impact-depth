import { describe, expect, it } from 'vitest';
import { canonicalSnapshot } from '../../src/game/replay';
import {
  createGame,
  fireWeapon,
  selectTarget,
  setAimPoint,
  setWeapon,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import type { GameState, Point } from '../../src/game/sim/types';

function playing(seed = 19): GameState {
  return startMission(createGame(seed));
}

function fireReady(state: GameState): GameState {
  return {
    ...state,
    weaponMode: 'torpedo',
    submarine: {
      ...state.submarine,
      z: 0.28,
      targetDepth: 0.28,
      reloadMk14: 0,
      reloadMk18: 0,
      torpedoes: 8,
      seekers: 4,
      sysTubes: 1,
    },
  };
}

function headingToward(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

describe('clicked-target and point aim', () => {
  it('selects the clicked ship and fires at it in the same command batch', () => {
    let state = fireReady(playing());
    const ship = state.ships[0]!;
    state = {
      ...state,
      aimPoint: { x: ship.x + 20, y: ship.y + 20 },
      selectedTargetId: null,
    };
    state = updateGame(
      state,
      [{ type: 'selectTarget', id: ship.id }, { type: 'fireWeapon' }],
      0,
    );
    expect(state.selectedTargetId).toBe(ship.id);
    expect(state.aimPoint).toBeNull();
    expect(state.torpedoes).toHaveLength(1);
    expect(state.torpedoes[0]!.targetId).toBe(ship.id);
    expect(state.submarine.torpedoes).toBe(7);
    expect(state.messages.some((message) => message.text.includes(ship.name))).toBe(true);
  });

  it('fires an unguided Mk-14 at an explicit water aim point, not a stale lock', () => {
    let state = fireReady(playing());
    const stale = state.ships[0]!;
    state = selectTarget(state, stale.id);
    const aim = { x: state.submarine.x + 7, y: state.submarine.y - 3 };
    state = updateGame(state, [{ type: 'setAimPoint', point: aim }, { type: 'fireWeapon' }], 0);
    expect(state.selectedTargetId).toBeNull();
    expect(state.aimPoint).toEqual(aim);
    expect(state.torpedoes).toHaveLength(1);
    expect(state.torpedoes[0]!.targetId).toBeNull();
    expect(state.torpedoes[0]!.heading).toBeCloseTo(
      headingToward({ x: state.submarine.x, y: state.submarine.y }, aim),
      5,
    );
    expect(state.messages.some((message) => message.text === 'MK-14 AWAY')).toBe(true);
    expect(state.messages.some((message) => message.text.includes(stale.name))).toBe(false);
  });

  it('rejects seeker fire at empty water instead of using a stale selected target', () => {
    let state = fireReady(playing());
    const stale = state.ships[0]!;
    state = selectTarget(state, stale.id);
    state = setWeapon(state, 'seeker');
    const aim = { x: state.submarine.x + 5, y: state.submarine.y + 4 };
    const seekersBefore = state.submarine.seekers;
    state = updateGame(state, [{ type: 'setAimPoint', point: aim }, { type: 'fireWeapon' }], 0);
    expect(state.torpedoes).toHaveLength(0);
    expect(state.submarine.seekers).toBe(seekersBefore);
    expect(state.selectedTargetId).toBeNull();
    expect(state.aimPoint).toEqual(aim);
    expect(state.messages.some((message) => message.text === 'PICK TARGET')).toBe(true);
  });

  it('clears stale point aim when an entity is selected and vice versa', () => {
    let state = fireReady(playing());
    const ship = state.ships[0]!;
    const aim = { x: state.submarine.x + 4, y: state.submarine.y + 4 };
    state = selectTarget(state, ship.id);
    expect(state.selectedTargetId).toBe(ship.id);
    expect(state.aimPoint).toBeNull();
    state = setAimPoint(state, aim);
    expect(state.selectedTargetId).toBeNull();
    expect(state.aimPoint).toEqual(aim);
    state = selectTarget(state, ship.id);
    expect(state.selectedTargetId).toBe(ship.id);
    expect(state.aimPoint).toBeNull();
  });

  it('does not auto-lock a nearby ship when firing with an explicit aim point', () => {
    let state = fireReady(playing());
    const ship = state.ships[0]!;
    state = {
      ...state,
      selectedTargetId: ship.id,
      submarine: { ...state.submarine, x: ship.x - 3, y: ship.y, z: 0.28 },
    };
    const aim = { x: ship.x + 12, y: ship.y + 9 };
    state = fireWeapon(state, aim);
    expect(state.selectedTargetId).toBeNull();
    expect(state.torpedoes[0]!.targetId).toBeNull();
    expect(state.torpedoes[0]!.heading).toBeCloseTo(
      headingToward({ x: state.submarine.x, y: state.submarine.y }, aim),
      5,
    );
  });

  it('includes aim state in replay hashes', () => {
    const run = (aim: Point) => {
      let state = fireReady(playing(42));
      state = updateGame(state, [{ type: 'setAimPoint', point: aim }, { type: 'fireWeapon' }], 0);
      return canonicalSnapshot(state);
    };
    const aimA = { x: 70, y: 64 };
    const aimB = { x: 71, y: 64 };
    expect(run(aimA)).toBe(run(aimA));
    expect(run(aimA)).not.toBe(run(aimB));
    expect(JSON.parse(run(aimA)).aimPoint).toEqual(aimA);
  });
});
