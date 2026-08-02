import { DEFAULT_CRUISE, FOB_RADIUS } from './constants';
import type { GameState, Powerup, Ship, ShipKind, Submarine } from './types';
import { createTerrain, snapToNavigable } from './world';

function createSubmarine(x = 48, y = 51.6, heading = -Math.PI / 2): Submarine {
  return {
    x, y, z: 0.45, heading, displayHeading: heading, bank: 0,
    speed: DEFAULT_CRUISE, targetSpeed: DEFAULT_CRUISE, speedOrder: 'twoThirds', maxSpeed: 2.4,
    hp: 100, maxHp: 100, torpedoes: 8, maxTorpedoes: 8, seekers: 4, maxSeekers: 4,
    reload: 0, reloadMk14: 0, reloadMk18: 0, reloadMk14Max: 2.5, reloadMk18Max: 3.4,
    decoys: 3, cmCharges: 3, maxCmCharges: 3, cmCooldown: 0, noise: 0.22, waypoint: null,
    targetDepth: 0.5, ballast: 0, invuln: 0, trailTimer: 0, hullTier: 0, weaponTier: 0,
    speedTier: 0, docked: false, battery: 100, maxBattery: 100, silentRunning: false,
    scopeUp: false, snorkel: false, sysSonar: 1, sysPropulsion: 1, sysTubes: 1, sysFlood: 0,
    crewStress: 0,
  };
}

const shipStats: Record<ShipKind, { hp: number; speed: number; name: string }> = {
  merchant: { hp: 95, speed: 1.15, name: 'FREIGHTER' },
  destroyer: { hp: 120, speed: 2.35, name: 'DESTROYER' },
  patrol: { hp: 50, speed: 2.6, name: 'PATROL' },
  cruiser: { hp: 165, speed: 2.1, name: 'CRUISER' },
  battleship: { hp: 280, speed: 1.65, name: 'BATTLESHIP' },
  sub: { hp: 85, speed: 1.7, name: 'U-BOAT' },
};
const powerupKinds: Powerup['kind'][] = ['health', 'ammo', 'hull', 'weapon', 'speed', 'counter'];

/** Deterministic wave data; doctrine is intentionally left to Plan 005. */
export function seedWave(seed: number, wave: number, firstFreighter?: Ship): Ship[] {
  const terrain = createTerrain(seed);
  const kinds: ShipKind[] = [
    ...Array<ShipKind>(2 + Math.min(3, wave)).fill('merchant'),
    ...Array<ShipKind>(2 + Math.min(3, wave)).fill('destroyer'),
    ...(wave >= 2 ? ['battleship' as const] : []),
    ...Array<ShipKind>(wave >= 3 ? 2 : 1).fill('sub'),
  ];
  return kinds.map((kind, index) => {
    if (index === 0 && firstFreighter) return firstFreighter;
    const angle = ((seed + wave * 29 + index * 47) % 360) * (Math.PI / 180);
    const point = snapToNavigable(terrain, 50 + Math.cos(angle) * (12 + (index % 3) * 4), 48 + Math.sin(angle) * (12 + (index % 3) * 4), 0.2);
    const stats = shipStats[kind];
    return { id: `wave-${wave}-${kind}-${index}`, kind, name: stats.name, x: point.x, y: point.y, heading: angle + Math.PI / 2, speed: stats.speed, hp: stats.hp, maxHp: stats.hp, alert: 0 };
  });
}

export function seedPowerups(seed: number, count = 7): Powerup[] {
  const terrain = createTerrain(seed);
  return Array.from({ length: count }, (_, index) => {
    const angle = ((seed * 13 + index * 53) % 360) * (Math.PI / 180);
    const point = snapToNavigable(terrain, 48 + Math.cos(angle) * (7 + index * 2), 48 + Math.sin(angle) * (7 + index * 2), 0.4);
    return { id: `pickup-${index}`, kind: powerupKinds[index % powerupKinds.length]!, x: point.x, y: point.y, life: 90 + ((seed + index * 17) % 41) };
  });
}
export function createGame(seed = 1): GameState {
  const terrain = createTerrain(seed);
  const player = snapToNavigable(terrain, 42 + (seed % 7), 48, 0.45);
  const freighter = snapToNavigable(terrain, 57 + ((seed >>> 3) % 9), 48 + ((seed >>> 6) % 7), 0.1);
  const base = snapToNavigable(terrain, 8, 8, 0.2);
  const heading = Math.atan2(freighter.y - player.y, freighter.x - player.x);
  return {
    phase: 'menu', tick: 0, time: 0, seed, rngState: seed >>> 0, submarine: createSubmarine(player.x, player.y, heading),
    ships: [
      { id: 'freighter-1', kind: 'merchant', name: 'LONE FREIGHTER', x: freighter.x, y: freighter.y, heading: 0, speed: 0, hp: 48, maxHp: 48, alert: 0 },
    ],
    torpedoes: [], depthCharges: [], aircraft: [], countermeasures: [], powerups: [],
    base: { x: base.x, y: base.y, radius: FOB_RADIUS }, terrainSeed: seed >>> 0, sonarContacts: [],
    autopilot: { enabled: false, waypoint: null, targetId: null },
    stats: { score: 0, shipsSunk: 0, torpedoesFired: 0, damageDealt: 0, timeSurvived: 0, wave: 1, powerupsTaken: 0, repairs: 0 },
    weaponMode: 'torpedo', torpedoSpread: false, viewMode: 'tactical', selectedTargetId: null,
    missionFlavor: 'SHADOW CONVOY · REMAIN UNDETECTED', messages: [], settings: null, debugFacing: false,
    dockHold: 0, pickupRespawn: 19,
  };
}
