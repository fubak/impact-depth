import { describe, expect, it } from 'vitest';
import {
  CINEMA_FOLLOW_MS,
  CINEMA_LINGER_MS,
  idleTrack,
  startTrack,
  stepTrack,
  type CinemaPoint,
} from '../../src/render/presentation/cinema-follow';

const fish = (x: number): CinemaPoint => ({ x, y: -10, z: 0, heading: 0 });

describe('cinema follow', () => {
  it('follows a torpedo for several seconds, long enough to reach a target 20 units away', () => {
    expect(CINEMA_FOLLOW_MS).toBeGreaterThanOrEqual(3000);
    const step = stepTrack(startTrack('t1', 0), fish(5), false, CINEMA_FOLLOW_MS - 1);
    expect(step.cinema?.x).toBe(5);
    expect(step.snapToTarget).toBeUndefined();
  });

  it('lingers on the impact point after the torpedo disappears, then snaps back', () => {
    const flying = stepTrack(startTrack('t1', 0), fish(9), false, 1000);
    const hit = stepTrack(flying.track, undefined, false, 2000);
    expect(hit.cinema?.x).toBe(9);
    expect(hit.snapToTarget).toBeUndefined();
    const still = stepTrack(hit.track, undefined, false, 2000 + CINEMA_LINGER_MS - 1);
    expect(still.cinema?.x).toBe(9);
    const done = stepTrack(still.track, undefined, false, 2000 + CINEMA_LINGER_MS);
    expect(done.cinema).toBeUndefined();
    expect(done.snapToTarget).toBe(true);
    expect(done.track).toEqual(idleTrack());
  });

  it('cancels immediately when an escort gets a fix, even while lingering', () => {
    const flying = stepTrack(startTrack('t1', 0), fish(9), false, 1000);
    const cancelled = stepTrack(flying.track, fish(10), true, 1100);
    expect(cancelled.cinema).toBeUndefined();
    expect(cancelled.snapToTarget).toBe(true);
    const hit = stepTrack(flying.track, undefined, false, 2000);
    expect(stepTrack(hit.track, undefined, true, 2100).cinema).toBeUndefined();
  });

  it('releases on timeout and does nothing when idle', () => {
    const late = stepTrack(startTrack('t1', 0), fish(1), false, CINEMA_FOLLOW_MS + 1);
    expect(late.cinema).toBeUndefined();
    expect(late.snapToTarget).toBe(true);
    const idle = stepTrack(idleTrack(), undefined, false, 5000);
    expect(idle.cinema).toBeUndefined();
    expect(idle.snapToTarget).toBeUndefined();
  });
});
