import { describe, expect, it } from 'vitest';
import {
  ATTITUDE_MAX_LATENCY,
  VesselAttitudeSmoother,
  attitudeFromFootprint,
  footprintPoints,
  presentationHeave,
  probeFreshness,
  submergenceAttenuation,
} from '../../src/render/presentation/vessel-attitude';

function footprint(center: number, bow: number, stern: number, port: number, starboard: number) {
  return { center, bow, stern, port, starboard, span: 8 };
}

describe('vessel attitude from footprint', () => {
  it('derives bow-up pitch and starboard-down roll from the five-point hull', () => {
    const pose = attitudeFromFootprint(footprint(1, 2, 0, 0.5, 1.5));
    expect(pose.heave).toBe(1);
    expect(pose.pitch).toBeGreaterThan(0.05);
    expect(pose.roll).toBeGreaterThan(0.05);
  });

  it('places footprint sites along heading without shifting the center', () => {
    const points = footprintPoints(10, 4, 0, 8);
    expect(points.center).toEqual({ x: 10, z: 4 });
    expect(points.bow.x).toBeCloseTo(18);
    expect(points.stern.x).toBeCloseTo(2);
    expect(points.port.z).toBeCloseTo(4 + 4.8);
    expect(points.starboard.z).toBeCloseTo(4 - 4.8);
  });

  it('attenuates surface motion with submergence and keeps the fitted waterline offset', () => {
    expect(submergenceAttenuation(0)).toBe(1);
    expect(submergenceAttenuation(9)).toBe(0);
    expect(submergenceAttenuation(4.5)).toBeCloseTo(0.5);
    expect(presentationHeave(2, 0.4, 0)).toBeCloseTo(2.4);
    expect(presentationHeave(2, 0.4, 9)).toBeCloseTo(0.4);
  });
});

describe('vessel attitude smoother', () => {
  const fallback = { heave: 0.2, pitch: 0.01, roll: -0.02 };

  it('uses look-dev fallback when the footprint is incomplete or stale', () => {
    const smoother = new VesselAttitudeSmoother();
    const missing = smoother.update({
      entityId: 'a',
      heading: 0,
      depth: 0,
      waterlineOffset: 0.3,
      fallback,
      footprint: { center: { site: 'center', height: 4, x: 0, z: 0 } },
      probeTime: 1,
      now: 1,
      dt: 1 / 60,
    });
    expect(missing.source).toBe('fallback');
    expect(missing.presentationY).toBeCloseTo(0.5);
    expect(missing.heave).toBeCloseTo(0.2);

    const stale = smoother.update({
      entityId: 'a',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: {
        center: { site: 'center', height: 3, x: 0, z: 0 },
        bow: { site: 'bow', height: 3, x: 8, z: 0 },
        stern: { site: 'stern', height: 3, x: -8, z: 0 },
        port: { site: 'port', height: 3, x: 0, z: 5 },
        starboard: { site: 'starboard', height: 3, x: 0, z: -5 },
      },
      probeTime: 1,
      now: 1 + ATTITUDE_MAX_LATENCY + 0.05,
      dt: 1 / 60,
    });
    expect(stale.source).toBe('fallback');
  });

  it('damps toward a fresh probe and never claims GameState ownership', () => {
    const smoother = new VesselAttitudeSmoother();
    const footprint = {
      center: { site: 'center' as const, height: 2, x: 0, z: 0 },
      bow: { site: 'bow' as const, height: 2.4, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: 1.6, x: -8, z: 0 },
      port: { site: 'port' as const, height: 1.8, x: 0, z: 5 },
      starboard: { site: 'starboard' as const, height: 2.2, x: 0, z: -5 },
    };
    const first = smoother.update({
      entityId: 'hull',
      heading: 0,
      depth: 0,
      waterlineOffset: 0.15,
      fallback,
      footprint,
      probeTime: 4,
      now: 4,
      dt: 1 / 60,
    });
    expect(first.source).toBe('probe');
    expect(first.heave).toBeCloseTo(2);
    expect(first.presentationY).toBeCloseTo(2.15);

    const mid = smoother.update({
      entityId: 'hull',
      heading: 0,
      depth: 0,
      waterlineOffset: 0.15,
      fallback,
      footprint: {
        ...footprint,
        center: { ...footprint.center, height: 0 },
        bow: { ...footprint.bow, height: 0 },
        stern: { ...footprint.stern, height: 0 },
        port: { ...footprint.port, height: 0 },
        starboard: { ...footprint.starboard, height: 0 },
      },
      probeTime: 4.016,
      now: 4.016,
      dt: 1 / 60,
    });
    expect(mid.source).toBe('probe');
    expect(mid.heave).toBeGreaterThan(0);
    expect(mid.heave).toBeLessThan(2);
    expect(mid.presentationY).toBeCloseTo(0.15 + mid.heave);
  });

  it('treats a slightly late probe as usable and a late probe as expired', () => {
    expect(probeFreshness(1, 1.05).usable).toBe(true);
    expect(probeFreshness(1, 1.05).extrapolate).toBeGreaterThan(0);
    expect(probeFreshness(1, 1 + ATTITUDE_MAX_LATENCY + 0.2).usable).toBe(false);
    expect(probeFreshness(null, 2).usable).toBe(false);
  });

  it('drops despawned smoothers on retain/reset', () => {
    const smoother = new VesselAttitudeSmoother();
    smoother.update({
      entityId: 'gone',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: null,
      probeTime: null,
      now: 0,
      dt: 1 / 60,
    });
    smoother.retain(new Set(['keep']));
    smoother.reset();
    const next = smoother.update({
      entityId: 'keep',
      heading: 0,
      depth: 4.5,
      waterlineOffset: 0,
      fallback: { heave: 1, pitch: 0, roll: 0 },
      footprint: null,
      probeTime: null,
      now: 1,
      dt: 1 / 60,
    });
    expect(next.source).toBe('fallback');
    expect(next.heave).toBe(1);
  });
});
