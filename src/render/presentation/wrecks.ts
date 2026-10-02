import type { CombatEvent } from '../../game/adapt/combat-events';
import type { ShipKind, SinkStyle } from '../../game/sim/types';

export type SinkPoseStyle = SinkStyle;

export interface Wreck {
  id: string;
  x: number;
  y: number;
  age: number;
  kind: ShipKind;
  style: SinkPoseStyle;
  listSide: number;
}

export const WRECK_LIFE_S = 6;

const KIND_SCALE: Record<string, number> = {
  merchant: 1.35,
  destroyer: 1.0,
  cruiser: 1.15,
  battleship: 1.5,
  patrol: 0.8,
  sub: 0.9,
  uboat: 0.9,
};

export interface SinkPose {
  /** Meters below the normal waterline attitude. */
  sink: number;
  /** Heel/roll (rad); sign follows listSide. */
  list: number;
  /** Bow-down positive pitch (rad). */
  pitch: number;
}

const isBoat = (kind: string) => kind === 'sub' || kind === 'uboat';

/**
 * Where a dying hull is at `progress` 0..1 of its sink. Shared by the live-hull
 * sinking pose and the wreck adoption so the handoff at progress=1 is seamless.
 */
export function sinkingPose(
  progress: number,
  style: SinkPoseStyle,
  listSide: number,
  kind: string,
): SinkPose {
  const p = Math.min(1, Math.max(0, progress));
  const scale = KIND_SCALE[kind] ?? 1;
  if (isBoat(kind)) {
    // Submarines pitch down and leave the surface layer.
    return { sink: 20 * p * p * scale, list: 0.6 * p * listSide, pitch: 0.9 * p };
  }
  switch (style) {
    case 'bow':
      // Bow dips first, then the hull slides under.
      return { sink: 9 * p * p * scale, list: 0.1 * p * listSide, pitch: 0.5 * Math.min(1, p * 1.6) };
    case 'stern':
      // Stern squats; bow rises as the sea floods aft.
      return { sink: 8.5 * p * p * scale, list: 0.08 * p * listSide, pitch: -0.45 * Math.min(1, p * 1.5) };
    case 'list':
      // Capsize: heel dominates, hull rolls onto the wounded side.
      return { sink: 7 * p * p * scale, list: 1.2 * p * listSide, pitch: 0.12 * p };
    case 'break':
      // Hull sags in the middle and founders fast.
      return { sink: 10 * p * p * scale, list: 0.25 * p * listSide, pitch: 0.3 * p };
    default:
      return { sink: 8 * p * p * scale, list: 0, pitch: 0.2 * p };
  }
}

/** Presentation-only wrecks. The sim has already dropped the ship. */
export function advanceWrecks(
  wrecks: readonly Wreck[],
  events: readonly CombatEvent[],
  dt: number,
): Wreck[] {
  const spawned = events
    .filter(
      (event): event is Extract<CombatEvent, { type: 'shipSunk' }> => event.type === 'shipSunk',
    )
    .map((event) => ({
      id: event.id,
      x: event.x,
      y: event.y,
      kind: event.kind,
      style: event.sinkStyle ?? 'bow',
      listSide: event.listSide ?? 1,
      age: 0,
    }));
  return [...wrecks, ...spawned]
    .map((wreck) => ({ ...wreck, age: wreck.age + dt }))
    .filter((wreck) => wreck.age < WRECK_LIFE_S);
}

/**
 * The wreck continues from the live hull's progress=1 sinking pose and settles
 * the rest of the way down over its short on-screen life.
 */
export function wreckPose(
  age: number,
  kind: ShipKind = 'merchant',
  style: SinkPoseStyle = 'bow',
  listSide = 1,
): SinkPose {
  const t = Math.max(0, Math.min(1, age / WRECK_LIFE_S));
  const eased = t * t * (3 - 2 * t);
  const at1 = sinkingPose(1, style, listSide, kind);
  return {
    sink: at1.sink + eased * 14,
    list: at1.list + eased * 0.3 * listSide,
    pitch: at1.pitch + (style === 'stern' ? -eased * 0.2 : eased * 0.25),
  };
}
