import { clampDepth } from './coords';
import type { Submarine } from './types';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Rudder bite grows with flow over the planes: dead slow, the boat barely turns. */
export function rudderAuthority(sub: Pick<Submarine, 'speed' | 'maxSpeed'>): number {
  return 0.25 + 0.75 * clamp(sub.speed / (0.5 * sub.maxSpeed), 0, 1);
}

/**
 * Apply a heading change limited by rudder authority. Returns the new heading
 * and the realized yaw rate so the submarine system can bank the boat.
 */
export function turnBoat(
  sub: Pick<Submarine, 'speed' | 'maxSpeed'>,
  heading: number,
  desired: number,
  maxRate: number,
  dt: number,
): { heading: number; yawRate: number } {
  const rate = maxRate * rudderAuthority(sub);
  const applied = clamp(normalizeAngle(desired - heading), -rate * dt, rate * dt);
  return { heading: heading + applied, yawRate: dt > 0 ? applied / dt : 0 };
}

/** Manual helm nudge — one command per fixed step carries a per-frame yaw. */
export function helmYawDelta(
  sub: Pick<Submarine, 'speed' | 'maxSpeed'>,
  yaw: number,
): number {
  return (yaw * 0.85 * rudderAuthority(sub)) / 60;
}

/** Engine telegraph: spool-up is brisker than coast-down. */
export const SUB_ACCEL_RATE = 0.55;
export const SUB_DECEL_RATE = 0.35;
export function approachSpeed(speed: number, wanted: number, dt: number): number {
  const diff = wanted - speed;
  const rate = diff > 0 ? SUB_ACCEL_RATE : SUB_DECEL_RATE;
  return speed + clamp(diff, -rate * dt, rate * dt);
}

/* ------------------------------------------------------------------ *
 * Depth control — planes need way on; the blow wins over everything.
 * ------------------------------------------------------------------ */

/** Vertical acceleration toward the commanded depth rate (u/s²). */
export const DEPTH_RATE_ACCEL = 0.08;
/** Emergency-blow ascent while the blow timer runs (u/s). */
export const BLOW_ASCENT_RATE = 0.16;
export const BLOW_DURATION = 6;
/** Flooding drags the boat down regardless of ordered depth. */
export const FLOOD_DEPTH_BIAS = 0.03;
/** Below this normalized depth the hull takes stress damage. */
export const HULL_STRESS_DEPTH = 0.9;
export const HULL_STRESS_BAND = 0.05;
export const HULL_STRESS_DPS = 6;

function speedRatioOf(sub: Pick<Submarine, 'speed' | 'maxSpeed'>): number {
  return sub.speed / Math.max(0.01, sub.maxSpeed);
}

/** Planes stall at the stop order; flank gives real rates. */
export function maxDepthRate(sub: Pick<Submarine, 'speed' | 'maxSpeed'>): number {
  return 0.035 + 0.075 * speedRatioOf(sub);
}

/**
 * One depth step: depthRate is a real vertical rate that lags the commanded
 * rate. The emergency blow overrides the command outright.
 */
export function advanceDepth(
  sub: Pick<Submarine, 'z' | 'targetDepth' | 'speed' | 'maxSpeed' | 'sysFlood' | 'depthRate' | 'blowTimer'>,
  dt: number,
): { z: number; depthRate: number; blowTimer: number } {
  const maxRate = maxDepthRate(sub);
  const error = sub.targetDepth - sub.z;
  let commanded = clamp(error * 1.2, -maxRate, maxRate) + FLOOD_DEPTH_BIAS * sub.sysFlood;
  if (sub.blowTimer > 0) commanded = -BLOW_ASCENT_RATE;
  const depthRate =
    sub.depthRate + clamp(commanded - sub.depthRate, -DEPTH_RATE_ACCEL * dt, DEPTH_RATE_ACCEL * dt);
  return {
    z: clampDepth(sub.z + depthRate * dt),
    depthRate,
    blowTimer: Math.max(0, sub.blowTimer - dt),
  };
}

/** Hull stress past the deep limit — scales with how far past the mark. */
export function hullStressDamage(z: number, dt: number): number {
  return z > HULL_STRESS_DEPTH ? (HULL_STRESS_DPS * (z - HULL_STRESS_DEPTH) * dt) / HULL_STRESS_BAND : 0;
}

/**
 * Heel into the turn, scaled by way on. `yawRate` is written by whichever
 * system steered this step (helm, waypoint, autopilot).
 */
export function advanceBank(
  sub: Pick<Submarine, 'bank' | 'yawRate' | 'speed' | 'maxSpeed'>,
  dt: number,
): number {
  const target =
    -clamp(sub.yawRate / 0.9, -1, 1) * speedRatioOf(sub) * 0.6;
  return sub.bank + (target - sub.bank) * (1 - Math.exp(-3 * dt));
}
