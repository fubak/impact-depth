import {
  DEFAULT_CRUISE,
  FOB_RADIUS,
  WAVE_SPAWN_INNER,
  WAVE_SPAWN_STEP,
  WORLD_CENTER,
  WORLD_SIZE,
} from './constants';
import { WAVE1_SPAWN_RADIUS } from './action-feel';
import { SINK_DURATION } from './ship-damage';
import type { FormationRole, GameState, Point, Powerup, Ship, ShipKind, Submarine } from './types';
import { createTerrain, snapToNavigable, type Terrain } from './world';
import type { WorldVersion } from '../world/definition';
import {
  enemySubNavProfile,
  missionBaseSim,
  missionConvoyApproachSim,
  missionStartSim,
  playerNavProfile,
  snapWorld,
  surfaceShipNavProfile,
} from '../world/littoral';
import { getWorld } from '../world/queries';
import { shipClearRadius } from './pathfinding';

const escortKinds: ReadonlySet<ShipKind> = new Set(['destroyer', 'patrol', 'cruiser']);
const formationRoleCycle: readonly FormationRole[] = ['lead', 'wing', 'trail'];

/** OD6: wave 1 stays cold. Later waves arrive already nervous, capped at 0.5. */
function startingAlert(wave: number): number {
  if (wave <= 1) return 0;
  return Math.min(0.2 * (wave - 1), 0.5);
}

function createSubmarine(
  x = WORLD_CENTER,
  y = WORLD_CENTER + 3.6,
  heading = -Math.PI / 2,
): Submarine {
  return {
    x,
    y,
    z: 0.5,
    heading,
    displayHeading: heading,
    bank: 0,
    yawRate: 0,
    depthRate: 0,
    blowTimer: 0,
    speed: DEFAULT_CRUISE,
    targetSpeed: DEFAULT_CRUISE,
    speedOrder: 'oneThird',
    maxSpeed: 2.4,
    hp: 100,
    maxHp: 100,
    torpedoes: 8,
    maxTorpedoes: 8,
    seekers: 4,
    maxSeekers: 4,
    reload: 0,
    reloadMk14: 0,
    reloadMk18: 0,
    reloadMk14Max: 2.5,
    reloadMk18Max: 3.4,
    decoys: 3,
    cmCharges: 3,
    maxCmCharges: 3,
    cmCooldown: 0,
    noise: 0.22,
    waypoint: null,
    targetDepth: 0.5,
    ballast: 0,
    invuln: 0,
    trailTimer: 0,
    hullTier: 0,
    weaponTier: 0,
    speedTier: 0,
    docked: false,
    battery: 100,
    maxBattery: 100,
    silentRunning: true,
    scopeUp: false,
    snorkel: false,
    sysSonar: 1,
    sysPropulsion: 1,
    sysTubes: 1,
    sysFlood: 0,
    crewStress: 0,
    lastDamage: null,
  };
}

const shipStats: Record<ShipKind, { hp: number; speed: number; name: string }> = {
  merchant: { hp: 95, speed: 1.15, name: 'FREIGHTER' },
  destroyer: { hp: 120, speed: 2.35, name: 'DESTROYER' },
  patrol: { hp: 50, speed: 2.6, name: 'PATROL' },
  cruiser: { hp: 200, speed: 1.9, name: 'CRUISER' },
  battleship: { hp: 420, speed: 1.35, name: 'BATTLESHIP' },
  sub: { hp: 351, speed: 1.7, name: 'U-BOAT' },
};
const powerupKinds: Powerup['kind'][] = ['health', 'ammo', 'hull', 'weapon', 'speed', 'counter'];

function snapSpawn(
  seed: number,
  worldVersion: WorldVersion,
  x: number,
  y: number,
  profile: ReturnType<typeof playerNavProfile>,
  legacyDepth: number,
): Point {
  if (worldVersion === 'legacy-v1') {
    return snapToNavigable(createTerrain(seed), x, y, legacyDepth);
  }
  return snapWorld(getWorld(worldVersion, seed), x, y, profile);
}

function shipProfile(kind: ShipKind) {
  return kind === 'sub' ? enemySubNavProfile() : surfaceShipNavProfile(shipClearRadius(kind));
}

/** Deterministic closed patrol loop around a spawn cell. */
function seedPatrolPath(
  terrain: Terrain | null,
  cx: number,
  cy: number,
  radius: number,
  count: number,
  seed: number,
  index: number,
  worldVersion: WorldVersion,
  kind: ShipKind,
): Point[] {
  const points: Point[] = [];
  for (let step = 0; step < count; step++) {
    const angle = (((seed + index * 41 + step * Math.floor(360 / count)) % 360) * Math.PI) / 180;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const point =
      worldVersion === 'legacy-v1'
        ? snapToNavigable(terrain!, x, y, 0.2)
        : snapWorld(getWorld(worldVersion, seed), x, y, shipProfile(kind));
    points.push(point);
  }
  return points;
}

/**
 * Radius of the wave-1 escort's opening sweep loop around the player's start
 * area — inside the quiet-sweep pulse reach (3.2 × jitter), so the boat is
 * found once the escort arrives and loiters, but never immediately.
 */
const WAVE1_SWEEP_DIST = 3.0;

/** Deterministic wave data; doctrine is intentionally left to Plan 005. */
export function seedWave(
  seed: number,
  wave: number,
  firstFreighter?: Ship,
  worldVersion: WorldVersion = 'legacy-v1',
  player?: Point,
): Ship[] {
  const terrain = worldVersion === 'legacy-v1' ? createTerrain(seed) : null;
  // Wave 1: fewer escorts so the opening patrol is tense but fair.
  const escortCount = wave === 1 ? 1 : 2 + Math.min(3, wave);
  const merchantCount = 2 + Math.min(3, wave);
  const kinds: ShipKind[] = [
    ...Array<ShipKind>(merchantCount).fill('merchant'),
    ...Array.from(
      { length: escortCount },
      (_, index) => (['destroyer', 'patrol', 'cruiser'] as const)[(seed + wave + index) % 3]!,
    ),
    ...(wave >= 2 ? ['battleship' as const] : []),
    ...Array<ShipKind>(wave >= 3 ? 2 : 1).fill('sub'),
  ];
  const ships = kinds.map((kind, index) => {
    const angle = ((seed * 17 + wave * 29 + index * 137) % 360) * (Math.PI / 180);
    // Later waves spread across three staggered rings so a big wave fills the
    // circle instead of marching a single hull ever farther out. The wave-1
    // escort spawns close to the player's lane: it walks an independent sweep
    // leg instead of screening the convoy, and its route must reach hearing
    // range inside the opening minute.
    const radius =
      wave === 1
        ? escortKinds.has(kind)
          ? WAVE1_SPAWN_RADIUS + 8
          : WAVE1_SPAWN_RADIUS + index * 7
        : WAVE_SPAWN_INNER + (index % 3) * WAVE_SPAWN_STEP;
    const spawnX = WORLD_CENTER + 2 + Math.cos(angle) * radius;
    const spawnY = WORLD_CENTER + Math.sin(angle) * radius;
    const point =
      worldVersion === 'legacy-v1'
        ? snapToNavigable(terrain!, spawnX, spawnY, 0.2)
        : snapWorld(getWorld(worldVersion, seed), spawnX, spawnY, shipProfile(kind));
    const stats = shipStats[kind];
    // Wave-1 weapon grace: escorts/subs cannot fire in the first seconds.
    const weaponCooldown = wave === 1 ? 5 + (index % 4) * 0.8 : 0;
    const patrolRadius =
      wave === 1 && kind !== 'merchant' ? 8 : kind === 'merchant' ? 14 : kind === 'sub' ? 11 : 16;
    let path = seedPatrolPath(
      terrain,
      point.x,
      point.y,
      patrolRadius,
      kind === 'merchant' ? 4 : 5,
      seed,
      index,
      worldVersion,
      kind,
    );
    // Wave 1: the escort's roving patrol opens with a tight sweep loop around
    // the player's start waters — roughly one sweep period of loiter inside
    // pulse reach — so a quiet boat is found by the next sweep pulse once the
    // escort arrives, instead of the screen orbiting the convoy forever at
    // standoff range.
    if (wave === 1 && escortKinds.has(kind) && player) {
      const b0 = Math.atan2(point.y - player.y, point.x - player.x);
      const loop = Array.from({ length: 8 }, (_, k) => {
        const lx = player.x + Math.cos(b0 + (k * Math.PI) / 4) * WAVE1_SWEEP_DIST;
        const ly = player.y + Math.sin(b0 + (k * Math.PI) / 4) * WAVE1_SWEEP_DIST;
        const sx = Math.min(WORLD_SIZE - 2, Math.max(2, lx));
        const sy = Math.min(WORLD_SIZE - 2, Math.max(2, ly));
        return worldVersion === 'legacy-v1'
          ? snapToNavigable(terrain!, sx, sy, 0.1)
          : snapWorld(getWorld(worldVersion, seed), sx, sy, shipProfile(kind));
      });
      path = [...loop, ...path];
    }
    if (index === 0 && firstFreighter) {
      return {
        ...firstFreighter,
        x: point.x,
        y: point.y,
        heading: angle + Math.PI / 2,
        speed: stats.speed,
        weaponCooldown,
        patrolIndex: index % 4,
        path,
        repathTimer: 0,
        alert: startingAlert(wave),
      };
    }
    return {
      id: `wave-${wave}-${kind}-${index}`,
      kind,
      name: stats.name,
      x: point.x,
      y: point.y,
      heading: angle + Math.PI / 2,
      speed: stats.speed,
      hp: stats.hp,
      maxHp: stats.hp,
      flooding: 0,
      fire: 0,
      speedFactor: 1,
      sinkDuration: SINK_DURATION[kind],
      listSide: 1,
      alert: startingAlert(wave),
      holdContact: 0,
      weaponCooldown,
      patrolIndex: index % 4,
      path,
      repathTimer: 0,
    };
  });
  // Second pass: assign convoy/escort formation slots relative to the lead
  // merchant (kinds[0]), using pure index arithmetic so results stay
  // deterministic across identical seed/wave inputs.
  const anchorId = ships[0]?.id ?? null;
  let escortCycleIndex = 0;
  let wingSideIndex = 0;
  return ships.map((ship, index) => {
    if (index === 0) return ship;
    // Wave-1 escorts run a roving patrol (biased path above) rather than
    // screening the convoy — the opening is a stalk, not a formed escort.
    if (escortKinds.has(ship.kind) && wave !== 1) {
      const role = formationRoleCycle[escortCycleIndex % formationRoleCycle.length]!;
      escortCycleIndex += 1;
      const along = role === 'lead' ? 12 : role === 'trail' ? -12 : 0;
      const lateral = role === 'wing' ? (wingSideIndex++ % 2 === 0 ? 10 : -10) : 0;
      return {
        ...ship,
        formationAnchorId: anchorId,
        formationRole: role,
        formationAlong: along,
        formationLateral: lateral,
        path: [],
      };
    }
    if (ship.kind === 'merchant') {
      return {
        ...ship,
        formationAnchorId: anchorId,
        formationRole: null,
        formationAlong: -index * 8,
        formationLateral: (index % 2 ? 1 : -1) * 6,
        path: [],
      };
    }
    return ship;
  });
}

export function seedPowerups(
  seed: number,
  count = 7,
  worldVersion: WorldVersion = 'legacy-v1',
): Powerup[] {
  const terrain = worldVersion === 'legacy-v1' ? createTerrain(seed) : null;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((seed * 13 + index * 53) % 360) * (Math.PI / 180);
    const x = WORLD_CENTER + Math.cos(angle) * (9 + index * 2.5);
    const y = WORLD_CENTER + Math.sin(angle) * (9 + index * 2.5);
    const point =
      worldVersion === 'legacy-v1'
        ? snapToNavigable(terrain!, x, y, 0.4)
        : snapWorld(getWorld(worldVersion, seed), x, y, playerNavProfile(0.28));
    return {
      id: `pickup-${index}`,
      kind: powerupKinds[index % powerupKinds.length]!,
      x: point.x,
      y: point.y,
      life: 90 + ((seed + index * 17) % 41),
    };
  });
}
export function createGame(seed = 1, worldVersion: WorldVersion = 'legacy-v1'): GameState {
  const terrain = worldVersion === 'legacy-v1' ? createTerrain(seed) : null;
  const playerStart = missionStartSim(seed);
  const convoyStart = missionConvoyApproachSim(seed);
  const baseStart = missionBaseSim();
  const player = snapSpawn(
    seed,
    worldVersion,
    playerStart.x,
    playerStart.y,
    playerNavProfile(0.28),
    0.45,
  );
  const freighter =
    worldVersion === 'legacy-v1'
      ? snapToNavigable(terrain!, convoyStart.x, convoyStart.y, 0.1)
      : snapWorld(
          getWorld(worldVersion, seed),
          convoyStart.x,
          convoyStart.y,
          surfaceShipNavProfile(shipClearRadius('merchant')),
        );
  const base = snapSpawn(seed, worldVersion, baseStart.x, baseStart.y, playerNavProfile(0.5), 0.2);
  const heading = Math.atan2(freighter.y - player.y, freighter.x - player.x);
  return {
    phase: 'menu',
    tick: 0,
    time: 0,
    seed,
    rngState: seed >>> 0,
    submarine: createSubmarine(player.x, player.y, heading),
    ships: [
      {
        id: 'freighter-1',
        kind: 'merchant',
        name: 'LONE FREIGHTER',
        x: freighter.x,
        y: freighter.y,
        heading: 0,
        speed: 0,
        hp: 48,
        maxHp: 48,
        flooding: 0,
        fire: 0,
        speedFactor: 1,
        sinkDuration: SINK_DURATION.merchant,
        listSide: 1,
        alert: 0,
        holdContact: 0,
        weaponCooldown: 0,
        patrolIndex: 0,
        path: [],
        repathTimer: 0,
      },
    ],
    torpedoes: [],
    depthCharges: [],
    shells: [],
    detonations: [],
    aircraft: [],
    countermeasures: [],
    powerups: [],
    base: { x: base.x, y: base.y, radius: FOB_RADIUS },
    terrainSeed: seed >>> 0,
    worldVersion,
    sonarContacts: [],
    autopilot: {
      enabled: false,
      waypoint: null,
      targetId: null,
      tactic: 'manual',
      phase: 'idle',
      phaseTimer: 0,
      shotTimer: 0,
      path: [],
      repathTimer: 0,
      emergency: false,
    },
    stats: {
      score: 0,
      shipsSunk: 0,
      torpedoesFired: 0,
      damageDealt: 0,
      timeSurvived: 0,
      wave: 1,
      powerupsTaken: 0,
      repairs: 0,
    },
    weaponMode: 'torpedo',
    torpedoSpread: false,
    viewMode: 'chase',
    selectedTargetId: null,
    aimPoint: null,
    missionFlavor: 'SHADOW CONVOY · REMAIN UNDETECTED',
    messages: [],
    settings: null,
    debugFacing: false,
    dockHold: 0,
    pickupRespawn: 19,
    sonarPing: 0,
    sonarCooldown: 0,
    aircraftCooldown: 55 + (seed % 41),
    scenario: 'patrol',
    assistanceAutoFire: true,
    compressEnabled: true,
    strikeExit: null,
  };
}
