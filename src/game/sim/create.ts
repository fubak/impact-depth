import { DEFAULT_CRUISE, FOB_RADIUS } from './constants';
import type { GameState, Submarine } from './types';
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
export function createGame(seed = 1): GameState {
  const terrain = createTerrain(seed);
  const player = snapToNavigable(terrain, 42 + (seed % 7), 48, 0.45);
  const freighter = snapToNavigable(terrain, 57 + ((seed >>> 3) % 9), 48 + ((seed >>> 6) % 7), 0.1);
  const heading = Math.atan2(freighter.y - player.y, freighter.x - player.x);
  return {
    phase: 'menu', tick: 0, time: 0, seed, rngState: seed >>> 0, submarine: createSubmarine(player.x, player.y, heading),
    ships: [
      { id: 'freighter-1', kind: 'merchant', name: 'LONE FREIGHTER', x: freighter.x, y: freighter.y, heading: 0, speed: 0, hp: 48, maxHp: 48, alert: 0 },
    ],
    torpedoes: [], depthCharges: [], aircraft: [], countermeasures: [], powerups: [],
    base: { x: 8, y: 8, radius: FOB_RADIUS }, terrainSeed: seed >>> 0, sonarContacts: [],
    autopilot: { enabled: false, waypoint: null, targetId: null },
    stats: { score: 0, shipsSunk: 0, torpedoesFired: 0, damageDealt: 0, timeSurvived: 0, wave: 1, powerupsTaken: 0, repairs: 0 },
    weaponMode: 'torpedo', torpedoSpread: false, viewMode: 'tactical', selectedTargetId: null,
    missionFlavor: 'SHADOW CONVOY · REMAIN UNDETECTED', messages: [], settings: null, debugFacing: false,
  };
}
