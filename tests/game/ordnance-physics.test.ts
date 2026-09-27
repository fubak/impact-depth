import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { createGame, fireWeapon, startMission, updateGame } from '../../src/game/sim/api';
import { getTerrain, isLand } from '../../src/game/sim/world';
import {
  ENEMY_ACQUIRE_BASE,
  TORPEDO_ACCEL,
  TORPEDO_BOW_OFFSET,
} from '../../src/game/sim/ordnance-physics';
import type { DepthCharge, Detonation, GameState, Ship, Torpedo } from '../../src/game/sim/types';

function mission(seed = 19): GameState {
  return startMission(createGame(seed));
}

/** Step the fixed sim, collecting every per-step detonation event. */
function simulate(state: GameState, seconds: number): { state: GameState; detonations: Detonation[] } {
  const detonations: Detonation[] = [];
  let next = state;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) {
    next = updateGame(next, [], FIXED_DT);
    detonations.push(...next.detonations);
  }
  return { state: next, detonations };
}

/** A lone boat in open water, holding still — no contacts, no interference. */
function loneBoat(state: GameState, z = 0.5): GameState {
  return {
    ...state,
    ships: [],
    aircraft: [],
    depthCharges: [],
    torpedoes: [],
    shells: [],
    countermeasures: [],
    autopilot: { ...state.autopilot, enabled: false },
    submarine: {
      ...state.submarine,
      z,
      targetDepth: z,
      speed: 0,
      targetSpeed: 0,
      heading: 0,
      invuln: 0,
      silentRunning: false,
    },
  };
}

function chargeFixture(partial: Partial<DepthCharge>): DepthCharge {
  return {
    id: 'dc-test',
    kind: 'depthCharge',
    sourceId: 'escort-test',
    x: 0,
    y: 0,
    z: 0.05,
    vx: 0,
    vy: 0,
    vz: 0.12,
    fuse: 60,
    damage: 45,
    radius: 2.2,
    targetDepth: 0.5,
    ...partial,
  };
}

function torpedoFixture(partial: Partial<Torpedo>): Torpedo {
  return {
    id: 'fish-test',
    owner: 'enemy',
    kind: 'enemy',
    x: 0,
    y: 0,
    z: 0.5,
    heading: 0,
    speed: 7.5,
    runSpeed: 7.5,
    lockId: null,
    life: 9,
    armDelay: 0.05,
    damage: 42,
    targetId: 'player',
    sourceId: 'sub-enemy',
    turnRate: 2.4,
    run: 2,
    ...partial,
  };
}

function shipFixture(template: Ship, partial: Partial<Ship>): Ship {
  return {
    ...template,
    heading: 0,
    speed: 0,
    path: [],
    alert: 0,
    holdContact: 0,
    weaponCooldown: 99,
    formationAnchorId: null,
    sinking: undefined,
    ...partial,
  };
}

describe('torpedo launch', () => {
  it('leaves from the bow, not the hull centre, and spools up to run speed', () => {
    let state = loneBoat(mission());
    state = {
      ...state,
      weaponMode: 'torpedo',
      selectedTargetId: null,
      aimPoint: null,
      submarine: {
        ...state.submarine,
        reloadMk14: 0,
        torpedoes: 4,
        sysTubes: 1,
      },
    };
    const sub = state.submarine;
    const fired = fireWeapon(state);
    const fish = fired.torpedoes.find((t) => t.owner === 'player');
    expect(fish).toBeDefined();
    // Spawn sits one bow offset ahead on the boat's heading.
    expect(fish!.x).toBeCloseTo(sub.x + Math.cos(sub.heading) * TORPEDO_BOW_OFFSET, 5);
    expect(fish!.y).toBeCloseTo(sub.y + Math.sin(sub.heading) * TORPEDO_BOW_OFFSET, 5);
    expect(fish!.speed).toBeLessThan(fish!.runSpeed);

    // The motor accelerates the fish — speed rises each step until run speed.
    const speeds: number[] = [];
    let next = fired;
    for (let i = 0; i < Math.ceil(1.5 / FIXED_DT); i++) {
      next = updateGame(next, [], FIXED_DT);
      const live = next.torpedoes.find((t) => t.id === fish!.id);
      if (live) speeds.push(live.speed);
    }
    expect(speeds.length).toBeGreaterThan(0);
    for (let i = 1; i < speeds.length && speeds[i]! < fish!.runSpeed; i++) {
      expect(speeds[i]).toBeGreaterThanOrEqual(speeds[i - 1]!);
    }
    expect(Math.max(...speeds)).toBeCloseTo(fish!.runSpeed, 5);
    // Acceleration rate is physical, not instant.
    expect(speeds[1]! - speeds[0]!).toBeLessThanOrEqual(TORPEDO_ACCEL * FIXED_DT + 1e-9);
  });
});

describe('Mk-18 seeker', () => {
  function seekerMission(): GameState {
    const state = loneBoat(mission());
    return {
      ...state,
      weaponMode: 'seeker',
      selectedTargetId: null,
      aimPoint: null,
      submarine: {
        ...state.submarine,
        reloadMk18: 0,
        seekers: 2,
        sysTubes: 1,
      },
    };
  }

  it('runs straight when nothing is in its cone', () => {
    const fired = fireWeapon(seekerMission());
    const fish = fired.torpedoes.find((t) => t.kind === 'mk18')!;
    expect(fish).toBeDefined();
    const { state: later, detonations } = simulate(fired, 1.5);
    const live = later.torpedoes.find((t) => t.id === fish.id);
    expect(live).toBeDefined();
    expect(live!.lockId).toBeNull();
    expect(live!.heading).toBeCloseTo(fish.heading, 5);
    expect(detonations.some((d) => d.id === fish.id)).toBe(false);
  });

  it('leaves its designated track for a louder ship inside the cone', () => {
    const template = mission().ships[0]!;
    let state = seekerMission();
    const sub = state.submarine;
    // Designated target: too far out for the seeker to hear.
    const assigned = shipFixture(template, {
      id: 'assigned',
      kind: 'merchant',
      x: sub.x + 40,
      y: sub.y,
    });
    // In-cone contacts: a loud merchant and a quiet boat astern of it.
    const loud = shipFixture(template, {
      id: 'loud',
      kind: 'merchant',
      x: sub.x + Math.cos(0.25) * 7,
      y: sub.y + Math.sin(0.25) * 7,
      speed: 1.15,
    });
    const quiet = shipFixture(template, {
      id: 'quiet',
      kind: 'sub',
      x: sub.x + Math.cos(-0.25) * 7,
      y: sub.y + Math.sin(-0.25) * 7,
      speed: 0,
    });
    state = { ...state, ships: [assigned, loud, quiet], selectedTargetId: 'assigned' };
    const fired = fireWeapon(state);
    const fish = fired.torpedoes.find((t) => t.kind === 'mk18')!;
    expect(fish.targetId).toBe('assigned');
    let sawLock = false;
    let hitLoud = false;
    let next = fired;
    let last = fish;
    for (let i = 0; i < Math.ceil(2 / FIXED_DT); i++) {
      next = updateGame(next, [], FIXED_DT);
      hitLoud ||= next.detonations.some((d) => d.hitId === 'loud');
      const live = next.torpedoes.find((t) => t.id === fish.id);
      if (live) {
        last = live;
        sawLock ||= live.lockId === 'loud';
      }
    }
    expect(sawLock).toBe(true);
    expect(last.lockId === 'loud' || hitLoud).toBe(true);
    // The seeker actually bent toward the loud contact before reaching it.
    const desired = Math.atan2(loud.y - last.y, loud.x - last.x);
    const err = Math.atan2(Math.sin(desired - last.heading), Math.cos(desired - last.heading));
    expect(Math.abs(err)).toBeLessThan(0.7);
  });
});

describe('enemy fish acquisition', () => {
  it('cannot hear a quiet boat outside its acquisition range', () => {
    let state = loneBoat(mission());
    const sub = state.submarine;
    // Fish heading straight at the boat, but 10u out: a quiet boat is only
    // audible inside ENEMY_ACQUIRE_BASE + noise*ENEMY_ACQUIRE_NOISE (~6u at
    // the 0.08 idle-noise floor), so the seeker stays dark the whole window.
    const fish = torpedoFixture({
      x: sub.x - 10,
      y: sub.y,
      heading: 0,
    });
    state = {
      ...state,
      submarine: { ...sub, noise: 0, silentRunning: true },
      torpedoes: [fish],
    };
    let next = state;
    for (let i = 0; i < Math.ceil(0.3 / FIXED_DT); i++) {
      next = updateGame(next, [], FIXED_DT);
      const live = next.torpedoes[0];
      expect(live).toBeDefined();
      const distance = Math.hypot(next.submarine.x - live!.x, next.submarine.y - live!.y);
      const range = ENEMY_ACQUIRE_BASE + 12 * next.submarine.noise;
      // While outside hearing, the seeker must not light up.
      if (distance > range) expect(live!.lockId).toBeNull();
    }
    const live = next.torpedoes[0];
    expect(live!.lockId).toBeNull();
    expect(live!.heading).toBeCloseTo(0, 3); // ran blind and straight
  });

  it('locks a loud boat it can hear inside its cone', () => {
    let state = loneBoat(mission());
    const sub = state.submarine;
    const fish = torpedoFixture({ x: sub.x - 8, y: sub.y, heading: 0 });
    state = {
      ...state,
      submarine: { ...sub, noise: 1, speed: 0, targetSpeed: 0 },
      torpedoes: [fish],
    };
    let next = state;
    let locked = false;
    for (let i = 0; i < Math.ceil(1 / FIXED_DT); i++) {
      next = updateGame(next, [], FIXED_DT);
      const live = next.torpedoes[0];
      if (!live) break;
      if (live.lockId === 'player') {
        locked = true;
        break;
      }
    }
    expect(locked).toBe(true);
  });
});

describe('terrain kills torpedoes', () => {
  it('detonates on an island with hitId null — land is not a victim', () => {
    const state = loneBoat(mission());
    const terrain = getTerrain(state.terrainSeed);
    // Find a shoreline: a water cell one step from land.
    let launch: { x: number; y: number; heading: number } | null = null;
    outer: for (let x = 4; x < 124; x += 0.5) {
      for (let y = 4; y < 124; y += 0.5) {
        if (!isLand(terrain, x, y)) continue;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const wx = x + Math.cos(a) * 0.6;
          const wy = y + Math.sin(a) * 0.6;
          if (!isLand(terrain, wx, wy)) {
            launch = { x: wx, y: wy, heading: Math.atan2(y - wy, x - wx) };
            break outer;
          }
        }
      }
    }
    expect(launch).not.toBeNull();
    const fish = torpedoFixture({
      owner: 'player',
      kind: 'mk14',
      x: launch!.x,
      y: launch!.y,
      heading: launch!.heading,
      z: 0.3,
      targetId: null,
      armDelay: 0,
      run: 0,
    });
    const { detonations } = simulate({ ...state, torpedoes: [fish] }, 2);
    const boom = detonations.find((d) => d.id === fish.id);
    expect(boom).toBeDefined();
    expect(boom!.kind).toBe('torpedo');
    expect(boom!.hitId).toBeNull();
  });
});

describe('depth-charge hydrostatic pistol', () => {
  it('detonates at its pistol depth — and a boat 0.3 units off takes no damage', () => {
    const state = loneBoat(mission(), 0.5);
    const sub = state.submarine;
    const charge = chargeFixture({
      x: sub.x,
      y: sub.y,
      z: 0.05,
      targetDepth: 0.8, // set deep — 0.3 below the boat
    });
    const { state: after, detonations } = simulate(
      { ...state, depthCharges: [charge] },
      8,
    );
    const boom = detonations.find((d) => d.id === charge.id);
    expect(boom).toBeDefined();
    expect(boom!.kind).toBe('depthCharge');
    expect(boom!.z).toBeGreaterThanOrEqual(0.8);
    expect(boom!.z).toBeLessThan(0.85);
    // A perfect horizontal drop still misses on the wrong depth.
    expect(after.submarine.hp).toBe(100);
    expect(boom!.hitId).toBeNull();
  });

  it('hurts the boat when the pistol matches its depth', () => {
    const state = loneBoat(mission(), 0.5);
    const sub = state.submarine;
    const charge = chargeFixture({ x: sub.x, y: sub.y, z: 0.05, targetDepth: 0.5 });
    const { state: after, detonations } = simulate({ ...state, depthCharges: [charge] }, 5);
    const boom = detonations.find((d) => d.id === charge.id);
    expect(boom).toBeDefined();
    expect(after.submarine.hp).toBeLessThan(100);
    expect(boom!.hitId).toBe('player');
  });
});

describe('hedgehog contact fuse', () => {
  it('a miss sinks silently — no detonation, no damage', () => {
    const state = loneBoat(mission(), 0.5);
    const sub = state.submarine;
    const hedgehog = chargeFixture({
      id: 'hog-miss',
      kind: 'hedgehog',
      x: sub.x + 1.0,
      y: sub.y,
      vz: 0.22,
      fuse: 25,
      damage: 34,
      radius: 0.45,
      targetDepth: sub.z,
    });
    const { state: after, detonations } = simulate({ ...state, depthCharges: [hedgehog] }, 6);
    expect(after.depthCharges.some((c) => c.id === 'hog-miss')).toBe(false);
    expect(detonations.some((d) => d.id === 'hog-miss')).toBe(false);
    expect(after.submarine.hp).toBe(100);
  });

  it('a contact detonates on the boat and damages it', () => {
    const state = loneBoat(mission(), 0.5);
    const sub = state.submarine;
    const hedgehog = chargeFixture({
      id: 'hog-hit',
      kind: 'hedgehog',
      x: sub.x,
      y: sub.y,
      vz: 0.22,
      fuse: 25,
      damage: 34,
      radius: 0.45,
      targetDepth: sub.z,
    });
    const { state: after, detonations } = simulate({ ...state, depthCharges: [hedgehog] }, 4);
    const boom = detonations.find((d) => d.id === 'hog-hit');
    expect(boom).toBeDefined();
    expect(boom!.kind).toBe('hedgehog');
    expect(boom!.hitId).toBe('player');
    expect(after.submarine.hp).toBeLessThan(100);
  });
});

describe('shell splash', () => {
  function splash(subZ: number) {
    const state = loneBoat(mission(), subZ);
    const sub = state.submarine;
    const shell = {
      id: 'shell-test',
      owner: 'enemy' as const,
      sourceId: 'bb-test',
      x: sub.x,
      y: sub.y,
      alt: 0.02,
      vx: 0,
      vy: 0,
      valt: -1,
      damage: 22,
      radius: 0.8,
    };
    return simulate({ ...state, shells: [shell] }, 0.5);
  }

  it('hurts a boat on the surface', () => {
    const { state, detonations } = splash(0.08);
    const boom = detonations.find((d) => d.id === 'shell-test');
    expect(boom).toBeDefined();
    expect(boom!.kind).toBe('shell');
    expect(boom!.hitId).toBe('player');
    expect(state.submarine.hp).toBeLessThan(100);
  });

  it('is wasted against a boat at attack depth', () => {
    const { state, detonations } = splash(0.5);
    const boom = detonations.find((d) => d.id === 'shell-test');
    expect(boom).toBeDefined();
    expect(boom!.hitId).toBeNull();
    expect(state.submarine.hp).toBe(100);
  });
});
