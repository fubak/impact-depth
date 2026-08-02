import type { SimState } from '../../core/types';
import { depthToMeters, simToWorldMeters } from '../sim/coords';
import type { GameState } from '../sim/types';

/** Projection only: render state is derived from authoritative GameState. */
export function adaptToLookDevSim(game: GameState): SimState {
  const vesselPosition = simToWorldMeters(game.submarine.x, game.submarine.y);
  return {
    paused: game.phase === 'paused', time: game.time, viewMode: game.viewMode,
    mission: game.missionFlavor,
    vessel: {
      x: vesselPosition.x, z: vesselPosition.z, depth: depthToMeters(game.submarine.z),
      heading: game.submarine.heading, speed: game.submarine.speed * 5,
      targetSpeed: game.submarine.targetSpeed * 5,
      engineOrder: game.submarine.speedOrder === 'stop' ? 'stop' : game.submarine.speedOrder === 'oneThird' ? 'slow' : game.submarine.speedOrder === 'twoThirds' ? 'half' : 'flank',
      battery: game.submarine.battery, noise: game.submarine.noise, heave: 0, pitch: 0, roll: game.submarine.bank,
    },
    ships: game.ships.map((ship) => {
      const position = simToWorldMeters(ship.x, ship.y);
      const kind =
        ship.kind === 'sub'
          ? 'uboat'
          : ship.kind === 'merchant'
            ? 'merchant'
            : ship.kind;
      return {
        id: ship.id,
        kind,
        name: ship.name,
        x: position.x,
        z: position.z,
        heading: ship.heading,
        speed: ship.speed * 5,
        heave: 0,
        pitch: 0,
        roll: ship.sinking ? -Math.min(1.1, ship.sinking * 0.45) : 0,
      };
    }),
  };
}
