import { describe, expect, it } from 'vitest';
import { createGame, startMission, updateGame } from '../../src/game/sim/api';
import { FIXED_DT } from '../../src/core/sim';
import { ISLAND_SPECS } from '../../src/core/terrain';
import { worldMetersToSim } from '../../src/game/sim/coords';
import { getTerrain, isLand } from '../../src/game/sim/world';
import { setDepthOrder, setSpeedOrder, fireWeapon } from '../../src/game/sim/api';

describe('patrol AI and map scale', () => {
  it('seeds lead/independent ships with closed patrol loops', () => {
    const state = startMission(createGame(19));
    const lead = state.ships[0]!;
    expect(lead.path.length).toBeGreaterThanOrEqual(4);
    const loners = state.ships.filter((ship) => !ship.formationAnchorId);
    for (const ship of loners) {
      expect(ship.path.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('moves the lead merchant along its patrol over a short cruise', () => {
    let state = startMission(createGame(7));
    const lead = state.ships[0]!;
    const start = { x: lead.x, y: lead.y };
    const ticks = Math.ceil(90 / FIXED_DT);
    for (let i = 0; i < ticks; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
    }
    const moved = state.ships[0]!;
    expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(6);
  });
});

describe('player land collision', () => {
  it('treats decorative island discs as sim land', () => {
    const terrain = getTerrain(1);
    for (const island of ISLAND_SPECS) {
      const center = worldMetersToSim(island.cx, island.cz);
      expect(isLand(terrain, center.x, center.y)).toBe(true);
    }
  });

  it('keeps the player boat out of cay-near after forced drive', () => {
    let state = startMission(createGame(1));
    const cay = worldMetersToSim(ISLAND_SPECS[0]!.cx, ISLAND_SPECS[0]!.cz);
    state = {
      ...state,
      submarine: {
        ...state.submarine,
        x: cay.x - 2.5,
        y: cay.y,
        heading: 0,
        targetSpeed: 2.4,
        speed: 2.4,
        speedOrder: 'flank',
      },
    };
    for (let i = 0; i < 180; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
    }
    expect(isLand(getTerrain(state.terrainSeed), state.submarine.x, state.submarine.y)).toBe(false);
    expect(Math.hypot(state.submarine.x - cay.x, state.submarine.y - cay.y)).toBeGreaterThan(3);
  });
});

describe('helm and weapon orders', () => {
  it('keeps sticky speed orders when surge is held', () => {
    let state = startMission(createGame(19));
    state = setSpeedOrder(state, 'oneThird');
    const ordered = state.submarine.targetSpeed;
    for (let i = 0; i < 90; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 1, depth: 0 }], FIXED_DT);
    }
    expect(state.submarine.speedOrder).toBe('oneThird');
    expect(state.submarine.targetSpeed).toBeCloseTo(ordered, 5);
  });

  it('retains battery under cruise for a short transit', () => {
    let state = startMission(createGame(19));
    state = setSpeedOrder(state, 'oneThird');
    state = setDepthOrder(state, 'periscope');
    const startBat = state.submarine.battery;
    for (let i = 0; i < Math.ceil(60 / FIXED_DT); i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
    }
    expect(state.submarine.battery).toBeGreaterThan(startBat * 0.55);
    expect(state.submarine.battery).toBeGreaterThan(40);
  });

  it('applies speed and depth orders and fires from periscope depth', () => {
    let state = startMission(createGame(19));
    state = setSpeedOrder(state, 'flank');
    expect(state.submarine.speedOrder).toBe('flank');
    expect(state.submarine.targetSpeed).toBeCloseTo(2.4, 5);
    state = setDepthOrder(state, 'periscope');
    expect(state.submarine.targetDepth).toBeCloseTo(0.28, 5);
    // Settle near fire band
    for (let i = 0; i < 120; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
    }
    const before = state.torpedoes.length;
    const ammo = state.submarine.torpedoes;
    state = fireWeapon(state);
    expect(state.torpedoes.length).toBe(before + 1);
    expect(state.submarine.torpedoes).toBe(ammo - 1);
    expect(state.messages.some((m) => /MK-14/.test(m.text))).toBe(true);
  });

  it('reports a toast when firing too deep', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'deep');
    for (let i = 0; i < 240; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
    }
    // Force past the tube band so the lock message is deterministic.
    state = {
      ...state,
      submarine: { ...state.submarine, z: 0.9, targetDepth: 0.9 },
    };
    const before = state.torpedoes.length;
    state = fireWeapon(state);
    expect(state.torpedoes.length).toBe(before);
    expect(state.messages.some((m) => /TUBES LOCKED/.test(m.text))).toBe(true);
  });

  it('fires from surface when tubes are ready', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'surface');
    for (let i = 0; i < 180; i++) {
      state = updateGame(state, [{ type: 'helm', yaw: 0, surge: 0, depth: 0 }], FIXED_DT);
    }
    const before = state.torpedoes.length;
    state = fireWeapon(state);
    expect(state.torpedoes.length).toBe(before + 1);
    expect(state.messages.some((m) => /MK-14/.test(m.text))).toBe(true);
  });
});
