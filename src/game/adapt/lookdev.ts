import { DEFAULT_SETTINGS } from '../../core/settings';
import type { SimState } from '../../core/types';
import { sampleAttitude, scaledWaves } from '../../core/waves';
import { depthToMeters, simToWorldMeters } from '../sim/coords';
import type { GameState, ShipKind } from '../sim/types';

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function attitudeSpan(kind: ShipKind | 'uboat' | 'merchant'): number {
  if (kind === 'battleship') return 14;
  if (kind === 'cruiser' || kind === 'merchant') return 11;
  if (kind === 'patrol') return 5;
  if (kind === 'sub' || kind === 'uboat') return 7;
  return 8;
}

/** Look-dev snapshot plus presentation-only lock id (never fed back into commands). */
export type LookDevSim = SimState & { selectedTargetId: string | null };

/**
 * Projection only: render state is derived from authoritative GameState.
 * GPU surface probes must never write back into GameState — they overlay this
 * CPU Gerstner fallback in `vessel-attitude.ts` only.
 */
export function adaptToLookDevSim(game: GameState): LookDevSim {
  const vesselPosition = simToWorldMeters(game.submarine.x, game.submarine.y);
  const ocean = game.settings?.ocean ?? DEFAULT_SETTINGS.ocean;
  const waves = scaledWaves(ocean.waveHeight, ocean.choppiness, ocean.seaState);
  const depthM = depthToMeters(game.submarine.z);
  const surfaceBlend = clamp(1 - depthM / 9, 0, 1);
  const own = sampleAttitude(
    vesselPosition.x,
    vesselPosition.z,
    game.time,
    waves,
    game.submarine.heading,
    8,
  );
  return {
    paused: game.phase === 'paused',
    time: game.time,
    viewMode: game.viewMode,
    mission: game.missionFlavor,
    selectedTargetId: game.selectedTargetId,
    vessel: {
      x: vesselPosition.x,
      z: vesselPosition.z,
      depth: depthM,
      heading: game.submarine.heading,
      speed: game.submarine.speed * 5,
      targetSpeed: game.submarine.targetSpeed * 5,
      engineOrder:
        game.submarine.speedOrder === 'stop'
          ? 'stop'
          : game.submarine.speedOrder === 'oneThird'
            ? 'slow'
            : game.submarine.speedOrder === 'twoThirds'
              ? 'half'
              : 'flank',
      battery: game.submarine.battery,
      noise: game.submarine.noise,
      heave: own.heave * surfaceBlend,
      pitch: clamp(own.pitch * surfaceBlend * 0.9, -0.4, 0.4),
      roll: clamp(game.submarine.bank * 0.35 + own.roll * surfaceBlend * 0.75, -0.45, 0.45),
    },
    ships: game.ships.map((ship) => {
      const position = simToWorldMeters(ship.x, ship.y);
      const kind =
        ship.kind === 'sub' ? 'uboat' : ship.kind === 'merchant' ? 'merchant' : ship.kind;
      const depth = ship.kind === 'sub' ? depthToMeters(0.32) : 0;
      const blend = ship.kind === 'sub' ? clamp(1 - depth / 9, 0, 1) : 1;
      const att = sampleAttitude(
        position.x,
        position.z,
        game.time,
        waves,
        ship.heading,
        attitudeSpan(ship.kind),
      );
      return {
        id: ship.id,
        kind,
        name: ship.name,
        x: position.x,
        z: position.z,
        depth,
        heading: ship.heading,
        speed: ship.speed * 5,
        heave: att.heave * blend,
        pitch: clamp(att.pitch * blend * 0.85, -0.38, 0.38),
        roll: ship.sinking
          ? -Math.min(1.1, ship.sinking * 0.45)
          : clamp(att.roll * blend * 0.7, -0.4, 0.4),
      };
    }),
  };
}
