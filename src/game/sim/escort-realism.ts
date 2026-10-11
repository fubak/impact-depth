/**
 * Real-world escort habits layered over the doctrine state machine
 * (escort-doctrine.ts), applied to the intent it returns:
 *
 *  1. Creeping attack roles (creeping-attack.ts).
 *  2. Post-attack listening: after a pattern or hedgehog release the escort
 *     slows for LISTEN_INTERVAL so its sonar can recover. The unchanged state
 *     machine then re-attacks if the fix came back, else falls to the
 *     expanding-square search, else returns to the screen on its give-up timer.
 *  3. Torpedo evasion: an escort with a player torpedo running at it turns
 *     bow-on or stern-on to the bearing (smaller turn) and runs.
 *
 * Priority: torpedo evasion over listening over creeping over plain doctrine.
 * All behaviour is gated by its own trigger, so an escort outside all three
 * is returned exactly as `escortIntent` produced it.
 */
import {
  CREEPER_SPEED_FRAC,
  creeperIntent,
  holderIntent,
  type CreepAssignment,
} from './creeping-attack';
import type { EscortIntent } from './escort-doctrine';
import { nearestTorpedoThreat } from './torpedo-threat';
import type { GameState, Ship } from './types';

/** Seconds an escort listens, slowly, after releasing ordnance. */
export const LISTEN_INTERVAL = 8;
export const LISTEN_SPEED_FRAC = 0.3;
/** A player torpedo running at an escort inside this range triggers evasion. */
export const THREAT_RANGE = 16;
const THREAT_HALF_WIDTH = 6;
/** The evasion lasts this long after the torpedo was last seen on a threatening track. */
export const THREAT_HOLD = 1;
export const THREAT_SPEED_FRAC = 0.95;

const normalize = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Bow-on or stern-on to `bearing`, whichever needs the smaller turn from `heading`. */
export function combHeading(heading: number, bearing: number): number {
  const bow = normalize(bearing);
  const stern = normalize(bearing + Math.PI);
  return Math.abs(normalize(bow - heading)) <= Math.abs(normalize(stern - heading)) ? bow : stern;
}

const capSpeed = (intent: EscortIntent, cap: number): EscortIntent => ({
  ...intent,
  speedFrac: intent.speedFrac === null ? cap : Math.min(intent.speedFrac, cap),
});

export interface ShapeContext {
  /** The hull as it was at the start of the step. */
  before: Ship;
  assignment: CreepAssignment | undefined;
  /** The other half of the creeping pair, from the previous step. */
  partner: Ship | undefined;
  /** When the holder took the fix handed to this creeper this step, if one was. */
  fedFixTime?: number;
  state: GameState;
  dt: number;
}

export interface ShapedEscort {
  intent: EscortIntent;
  /** Fields to merge onto the hull for the next step. */
  fields: Partial<Ship>;
}

export function shapeEscortIntent(input: EscortIntent, ctx: ShapeContext): ShapedEscort {
  let base = input;
  const { before, assignment, partner, state, dt } = ctx;
  let intent = base;
  // A fed fix is the holder's fix: the creeper's track ages from the holder's clock.
  if (ctx.fedFixTime !== undefined) {
    intent = { ...intent, ship: { ...intent.ship, lastFixTime: ctx.fedFixTime } };
    base = intent;
  }
  const fields: Partial<Ship> = {};

  // 1. Creeping attack — only while the pair is still prosecuting.
  const doctrine = base.ship.doctrine;
  // The creeper stays in the pair while it runs out and listens after a drop.
  const role =
    assignment &&
    (doctrine === 'prosecute' || (assignment.role === 'creeper' && doctrine === 'reattack'))
      ? assignment.role
      : undefined;
  if (role === 'holder') intent = holderIntent(base, state);
  if (role === 'creeper' && doctrine === 'prosecute') {
    intent = creeperIntent(base, before, partner, state);
  }
  // Run-out and listening after the creeper's drop stay slow and quiet too.
  if (role === 'creeper' && doctrine === 'reattack') intent = capSpeed(intent, CREEPER_SPEED_FRAC);
  if (role !== before.role) fields.role = role;
  const partnerId = role ? assignment!.partnerId : undefined;
  if (partnerId !== before.creepPartnerId) fields.creepPartnerId = partnerId;
  const pinging = role === 'holder' ? true : undefined;
  if (pinging !== before.pinging) fields.pinging = pinging;

  // 2. Listening after a release.
  if (before.listenTimer !== undefined) {
    const left = Math.max(0, before.listenTimer - dt);
    fields.listenTimer = left;
    if (left > 0) intent = capSpeed(intent, LISTEN_SPEED_FRAC);
  }

  // 3. Torpedo evasion.
  const threat = nearestTorpedoThreat(before, state.torpedoes, THREAT_RANGE, THREAT_HALF_WIDTH);
  const held = Math.max(0, (before.threatTimer ?? 0) - dt);
  const threatTimer = threat ? THREAT_HOLD : held;
  const bearing = threat ? threat.bearing : before.threatBearing;
  if (threatTimer > 0 && bearing !== undefined) {
    intent = {
      ...intent,
      heading: combHeading(before.heading, bearing),
      speedFrac: Math.max(intent.speedFrac ?? 0, THREAT_SPEED_FRAC),
    };
    fields.threatTimer = threatTimer;
    fields.threatBearing = bearing;
  } else if (before.threatTimer !== undefined) {
    fields.threatTimer = 0;
    fields.threatBearing = undefined;
  }
  return { intent, fields };
}
