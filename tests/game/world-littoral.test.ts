import { describe, expect, it } from 'vitest';
import { ISLAND_SPECS, sampleIslandHeight, sampleSeabedY } from '../../src/core/terrain';
import { FIXED_DT } from '../../src/core/sim';
import {
  applyHostSeed,
  createGame,
  restartGame,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import { DEPTH_TARGET, SEAMOUNT_CRUSH_DPS, WORLD_SIZE } from '../../src/game/sim/constants';
import { simToWorldMeters, worldMetersToSim } from '../../src/game/sim/coords';
import { findWorldPath, shipClearRadius } from '../../src/game/sim/pathfinding';
import {
  applyChannelDeepening,
  CHANNEL_MAX_WATER_M,
  createLittoralWorld,
  enemySubNavProfile,
  isNavigable,
  KEEL_CLEARANCE_M,
  littoralIsLand,
  littoralWaterDepthSim,
  LITTORAL_SPACING_M,
  missionBaseSim,
  missionConvoyApproachSim,
  missionStartSim,
  playerNavProfile,
  RENDERER_HULL_CLAMP_REMAINS,
  sampleLittoralBedMetres,
  sampleSignedTerrainMetres,
  SNAP_MAX_RADIUS_SIM,
  snapWorld,
  segmentNavigable,
  surfaceShipNavProfile,
} from '../../src/game/world/littoral';
import { getWorld } from '../../src/game/world/queries';

const ROUTE_ORDERS = ['surface', 'periscope', 'attack'] as const;

function assertTraversed(
  world: ReturnType<typeof getWorld>,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  profile: ReturnType<typeof playerNavProfile>,
): { x: number; y: number }[] {
  const path = findWorldPath(world, start, goal, profile, 1600);
  expect(path.length, `no route ${start.x},${start.y} -> ${goal.x},${goal.y}`).toBeGreaterThan(0);
  expect(path.length).toBeLessThan(201);
  let from = start;
  for (const waypoint of path) {
    expect(segmentNavigable(world, from, waypoint, profile, 0.35)).toBe(true);
    from = waypoint;
  }
  return path;
}

describe('littoral-v2 CPU world', () => {
  it('selects a distinct cached version and leaves createGame on legacy-v1', () => {
    const v2 = getWorld('littoral-v2', 19);
    const again = getWorld('littoral-v2', 19);
    const v1 = getWorld('legacy-v1', 19);
    expect(v2.version).toBe('littoral-v2');
    expect(v2).toBe(again);
    expect(v2).not.toBe(v1);
    expect(createGame(19).worldVersion).toBe('legacy-v1');
    expect(LITTORAL_SPACING_M).toBe(1);
    expect(RENDERER_HULL_CLAMP_REMAINS).toBe(true);
  });

  it('propagates an explicit v2 world through construction, start, restart, and host seed changes', () => {
    const created = createGame(19, 'littoral-v2');
    expect(created.worldVersion).toBe('littoral-v2');
    expect(startMission(created).worldVersion).toBe('littoral-v2');
    expect(restartGame(created).worldVersion).toBe('littoral-v2');
    const reseeded = applyHostSeed(created, 77);
    expect(reseeded.worldVersion).toBe('littoral-v2');
    expect(reseeded.seed).toBe(77);
    expect(reseeded.terrainSeed).toBe(77);
    const world = getWorld('littoral-v2', 77);
    expect(
      isNavigable(
        world,
        reseeded.submarine.x,
        reseeded.submarine.y,
        playerNavProfile(reseeded.submarine.z),
      ),
    ).toBe(true);
    expect(
      isNavigable(world, reseeded.base.x, reseeded.base.y, playerNavProfile(DEPTH_TARGET.attack)),
    ).toBe(true);

    const active = applyHostSeed(startMission(created), 42);
    const activeWorld = getWorld('littoral-v2', 42);
    expect(active.phase).toBe('playing');
    expect(active.worldVersion).toBe('littoral-v2');
    expect(
      active.ships.every((ship) =>
        isNavigable(
          activeWorld,
          ship.x,
          ship.y,
          ship.kind === 'sub'
            ? enemySubNavProfile()
            : surfaceShipNavProfile(shipClearRadius(ship.kind)),
        ),
      ),
    ).toBe(true);

    const ended = applyHostSeed({ ...created, phase: 'gameover' }, 42);
    expect(ended.phase).toBe('gameover');
    expect(ended.ships.some((ship) => ship.id.startsWith('wave-'))).toBe(false);
  });

  it('places representative v2 waves and pickups using their navigation profiles', () => {
    for (const seed of [0, 1, 7, 19, 42, 77, 99]) {
      const state = startMission(createGame(seed, 'littoral-v2'));
      const world = getWorld('littoral-v2', seed);
      expect(
        isNavigable(
          world,
          state.submarine.x,
          state.submarine.y,
          playerNavProfile(state.submarine.z),
        ),
      ).toBe(true);
      expect(
        isNavigable(world, state.base.x, state.base.y, playerNavProfile(DEPTH_TARGET.attack)),
      ).toBe(true);
      for (const pickup of state.powerups) {
        expect(
          isNavigable(world, pickup.x, pickup.y, playerNavProfile(DEPTH_TARGET.periscope)),
        ).toBe(true);
      }
      for (const ship of state.ships) {
        const profile =
          ship.kind === 'sub'
            ? enemySubNavProfile()
            : surfaceShipNavProfile(shipClearRadius(ship.kind));
        expect(isNavigable(world, ship.x, ship.y, profile), `${seed}:${ship.id}`).toBe(true);
        for (const waypoint of ship.path) {
          expect(
            isNavigable(world, waypoint.x, waypoint.y, profile),
            `${seed}:${ship.id}:path`,
          ).toBe(true);
        }
      }
    }
  });

  it('defines land as signed bed at or above mean sea level and preserves dry island footprints', () => {
    const world = createLittoralWorld(0);
    for (const island of ISLAND_SPECS) {
      const sim = worldMetersToSim(island.cx, island.cz);
      expect(sampleIslandHeight(0, 0, island)).toBeGreaterThan(0);
      expect(sampleLittoralBedMetres(world, island.cx, island.cz)).toBeGreaterThanOrEqual(0);
      expect(littoralIsLand(world, sim.x, sim.y)).toBe(true);
      expect(
        Math.abs(
          sampleLittoralBedMetres(world, island.cx, island.cz) -
            sampleSignedTerrainMetres(island.cx, island.cz),
        ),
      ).toBeLessThanOrEqual(LITTORAL_SPACING_M);
    }
    const open = worldMetersToSim(0, 0);
    expect(littoralIsLand(world, open.x, open.y)).toBe(false);
    expect(world.seaLevelNormalized).toBeGreaterThan(0);
  });

  it('deepens only underwater corridor cells up to 28 m without raising land', () => {
    const world = createLittoralWorld(0);
    const start = simToWorldMeters(WORLD_SIZE / 2, WORLD_SIZE / 2);
    const originalStart = sampleSeabedY(start.x, start.z);
    const afterStart = sampleLittoralBedMetres(world, start.x, start.z);
    expect(originalStart).toBeLessThan(0);
    expect(afterStart).toBeLessThan(0);
    expect(-afterStart).toBeGreaterThanOrEqual(depthToRequired(DEPTH_TARGET.deep));
    expect(-afterStart).toBeLessThanOrEqual(CHANNEL_MAX_WATER_M);
    const fob = simToWorldMeters(WORLD_SIZE * 0.08, WORLD_SIZE * 0.08);
    expect(-sampleLittoralBedMetres(world, fob.x, fob.z)).toBeGreaterThanOrEqual(
      depthToRequired(DEPTH_TARGET.attack),
    );
    for (const island of ISLAND_SPECS) {
      expect(applyChannelDeepening(4, island.cx, island.cz)).toBe(4);
    }
  });

  it('snaps starts and bases for seeds 0-99 without unbounded search', () => {
    const world = getWorld('littoral-v2', 0);
    const attack = playerNavProfile(DEPTH_TARGET.attack);
    const dock = surfaceShipNavProfile(shipClearRadius('merchant'));
    expect(SNAP_MAX_RADIUS_SIM).toBe(WORLD_SIZE);
    for (let seed = 0; seed < 100; seed++) {
      const start = snapWorld(world, missionStartSim(seed).x, missionStartSim(seed).y, attack);
      const base = snapWorld(world, missionBaseSim().x, missionBaseSim().y, attack);
      expect(isNavigable(world, start.x, start.y, attack)).toBe(true);
      expect(isNavigable(world, base.x, base.y, attack)).toBe(true);
      expect(isNavigable(world, start.x, start.y, dock)).toBe(true);
      expect(littoralIsLand(world, start.x, start.y)).toBe(false);
      expect(littoralIsLand(world, base.x, base.y)).toBe(false);
    }
    const cay = worldMetersToSim(ISLAND_SPECS[0]!.cx, ISLAND_SPECS[0]!.cz);
    const escaped = snapWorld(world, cay.x, cay.y, playerNavProfile(DEPTH_TARGET.surface));
    expect(isNavigable(world, escaped.x, escaped.y, playerNavProfile(DEPTH_TARGET.surface))).toBe(
      true,
    );
    expect(littoralIsLand(world, escaped.x, escaped.y)).toBe(false);
  });

  it('has start-to-FOB and convoy-approach routes at surface, periscope, and attack depth', () => {
    const failures: string[] = [];
    const world = getWorld('littoral-v2', 0);
    for (let seed = 0; seed < 100; seed++) {
      const start = snapWorld(
        world,
        missionStartSim(seed).x,
        missionStartSim(seed).y,
        playerNavProfile(DEPTH_TARGET.attack),
      );
      const base = snapWorld(
        world,
        missionBaseSim().x,
        missionBaseSim().y,
        playerNavProfile(DEPTH_TARGET.attack),
      );
      const convoy = snapWorld(
        world,
        missionConvoyApproachSim(seed).x,
        missionConvoyApproachSim(seed).y,
        surfaceShipNavProfile(shipClearRadius('merchant')),
      );
      for (const order of ROUTE_ORDERS) {
        const profile = playerNavProfile(DEPTH_TARGET[order]);
        try {
          assertTraversed(world, start, base, profile);
          const approach = snapWorld(world, convoy.x, convoy.y, profile);
          assertTraversed(world, start, approach, profile);
        } catch (error) {
          failures.push(`seed ${seed} ${order}: ${(error as Error).message}`);
        }
      }
      const attack = playerNavProfile(DEPTH_TARGET.attack);
      const deep = playerNavProfile(DEPTH_TARGET.deep);
      expect(isNavigable(world, start.x, start.y, deep)).toBe(true);
      const refuge = snapWorld(world, start.x + 3, start.y - 2, deep);
      expect(isNavigable(world, refuge.x, refuge.y, deep)).toBe(true);
      assertTraversed(world, start, refuge, attack);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, 120_000);

  it('blocks thin land: coarse cells and swept motion cannot tunnel a cay', () => {
    const world = getWorld('littoral-v2', 19);
    const island = ISLAND_SPECS[0]!;
    const center = worldMetersToSim(island.cx, island.cz);
    const west = { x: center.x - island.radius / 5 - 2, y: center.y };
    const east = { x: center.x + island.radius / 5 + 2, y: center.y };
    const surface = playerNavProfile(DEPTH_TARGET.surface);
    expect(littoralIsLand(world, center.x, center.y)).toBe(true);
    expect(segmentNavigable(world, west, east, surface, 0.2)).toBe(false);
    const crossed = findWorldPath(world, west, east, surface, 900);
    for (const point of crossed) {
      expect(littoralIsLand(world, point.x, point.y)).toBe(false);
    }
    let state = startMission(createGame(19));
    state = {
      ...state,
      worldVersion: 'littoral-v2',
      submarine: {
        ...state.submarine,
        x: west.x,
        y: west.y,
        z: DEPTH_TARGET.surface,
        targetDepth: DEPTH_TARGET.surface,
        heading: 0,
        speed: 2.4,
        targetSpeed: 2.4,
        invuln: 0,
      },
    };
    for (let i = 0; i < 900; i++) state = updateGame(state, [], FIXED_DT);
    expect(littoralIsLand(world, state.submarine.x, state.submarine.y)).toBe(false);
    expect(state.submarine.x).toBeLessThan(center.x);
  });

  it('clamps depth, damages inward grounding once, and ignores dt=0 / invulnerable contact', () => {
    const world = getWorld('littoral-v2', 19);
    const probe = worldMetersToSim(170, 0);
    const water = littoralWaterDepthSim(world, probe.x, probe.y);
    expect(littoralIsLand(world, probe.x, probe.y)).toBe(false);
    expect(water).toBeGreaterThan(8);
    expect(water).toBeLessThan(depthToRequired(DEPTH_TARGET.deep));
    const safeZ = Math.max(0, (water - KEEL_CLEARANCE_M) / 24);
    let state = createGame(19);
    const hull = {
      ...state.submarine,
      x: probe.x,
      y: probe.y,
      z: DEPTH_TARGET.deep,
      targetDepth: DEPTH_TARGET.deep,
      speed: 0,
      targetSpeed: 0,
      invuln: 0,
      hp: 100,
    };
    state = { ...state, phase: 'playing', worldVersion: 'littoral-v2', submarine: hull };
    const zero = updateGame(state, [], 0);
    expect(zero.submarine.hp).toBe(100);
    expect(zero.submarine.targetDepth).toBe(DEPTH_TARGET.deep);
    expect(zero.submarine.z).toBeLessThanOrEqual(safeZ + 1e-6);
    state = updateGame(state, [], FIXED_DT);
    expect(state.submarine.z).toBeLessThanOrEqual(safeZ + 1e-6);
    expect(state.submarine.targetDepth).toBe(DEPTH_TARGET.deep);
    expect(state.submarine.hp).toBeLessThan(100);
    expect(100 - state.submarine.hp).toBeCloseTo(SEAMOUNT_CRUSH_DPS * FIXED_DT, 5);
    const inv = updateGame(
      {
        ...state,
        submarine: {
          ...state.submarine,
          hp: 100,
          invuln: 8,
          z: safeZ,
          targetDepth: DEPTH_TARGET.deep,
        },
      },
      [],
      FIXED_DT,
    );
    expect(inv.submarine.hp).toBe(100);
    expect(inv.submarine.z).toBeLessThanOrEqual(safeZ + 1e-6);
  });
});

function depthToRequired(depth: number): number {
  return depth * 24 + KEEL_CLEARANCE_M;
}
