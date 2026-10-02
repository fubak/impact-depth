import { describe, expect, it } from 'vitest';
import { createGame, startMission } from '../../src/game/sim/api';
import { bottomClearanceText, fireStatus, objectiveText } from '../../src/ui/hud';
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

describe('tube status', () => {
  it('names depth, reload, and the bow arc without refusing an edge shot', () => {
    let state = startMission(createGame(19));
    const sub = state.submarine;
    const ship = state.ships[0]!;
    const ahead = {
      ...ship,
      x: sub.x + Math.cos(sub.heading) * 8,
      y: sub.y + Math.sin(sub.heading) * 8,
    };
    const abeam = {
      ...ship,
      x: sub.x + Math.cos(sub.heading + Math.PI / 2) * 8,
      y: sub.y + Math.sin(sub.heading + Math.PI / 2) * 8,
    };
    const armed = {
      ...sub,
      z: 0.5,
      reloadMk14: 0,
      torpedoes: 4,
      sysTubes: 1,
    };
    state = { ...state, submarine: armed, ships: [ahead], selectedTargetId: ahead.id };
    expect(fireStatus(state).label).toBe('MK-14 READY');
    expect(fireStatus({ ...state, ships: [abeam] }).label).toBe('ARC LIMIT');
    expect(fireStatus({ ...state, ships: [abeam] }).ready).toBe(true);
    expect(fireStatus({ ...state, submarine: { ...armed, z: 0.9 } }).label).toBe('TOO DEEP');
    expect(fireStatus({ ...state, submarine: { ...armed, reloadMk14: 2 } }).label).toBe(
      'RELOAD 2s',
    );
    expect(fireStatus({ ...state, submarine: { ...armed, torpedoes: 0 } }).label).toBe('NO MK-14');
    expect(fireStatus({ ...state, submarine: { ...armed, sysTubes: 0.2 } }).label).toBe(
      'TUBES DAMAGED',
    );
  });
});
