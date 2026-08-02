import { DEFAULT_CRUISE, FOB_RADIUS } from './constants';
import type { GameState, Submarine } from './types';

function createSubmarine(): Submarine {
  return {
    x: 48, y: 51.6, z: 0.45, heading: -Math.PI / 2, displayHeading: -Math.PI / 2, bank: 0,
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
  return {
    phase: 'menu', tick: 0, time: 0, seed, rngState: seed >>> 0, submarine: createSubmarine(),
    ships: [
      { id: 'dd-42', kind: 'destroyer', name: 'DD ESCORT', x: 57.6, y: 49.2, heading: 0.05, speed: 1.2, hp: 100, maxHp: 100, alert: 0 },
      { id: 'ss-11', kind: 'merchant', name: 'MERCHANT A', x: 61.6, y: 52, heading: 0.02, speed: 1.02, hp: 100, maxHp: 100, alert: 0 },
      { id: 'ss-12', kind: 'merchant', name: 'MERCHANT B', x: 65.6, y: 49.6, heading: -0.03, speed: 1, hp: 100, maxHp: 100, alert: 0 },
    ],
    torpedoes: [], depthCharges: [], aircraft: [], countermeasures: [], powerups: [],
    base: { x: 8, y: 8, radius: FOB_RADIUS }, terrainSeed: seed >>> 0, sonarContacts: [],
    autopilot: { enabled: false, waypoint: null, targetId: null },
    stats: { score: 0, shipsSunk: 0, torpedoesFired: 0, damageDealt: 0, timeSurvived: 0, wave: 1, powerupsTaken: 0, repairs: 0 },
    weaponMode: 'torpedo', torpedoSpread: false, viewMode: 'tactical',
    missionFlavor: 'SHADOW CONVOY · REMAIN UNDETECTED', messages: [], settings: null, debugFacing: false,
  };
}
