import { describe, expect, it } from 'vitest';
import {
  ATTITUDE_MAX_HEAVE,
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
    expect(first.heave).toBeCloseTo(2, 2);
    expect(first.pitch).toBeGreaterThan(0.02);
    expect(first.presentationY).toBeCloseTo(2.15, 2);

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
    expect(mid.heave).toBeLessThan(first.heave);
    expect(mid.pitch).toBeGreaterThan(0);
    expect(mid.pitch).toBeLessThan(first.pitch);
    expect(mid.presentationY).toBeCloseTo(0.15 + mid.heave);
  });

  it('holds last GPU pitch/roll instead of snapping to Gerstner when readback goes stale', () => {
    const smoother = new VesselAttitudeSmoother();
    const footprint = {
      center: { site: 'center' as const, height: 0.4, x: 0, z: 0 },
      bow: { site: 'bow' as const, height: 2.2, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: 0.2, x: -8, z: 0 },
      port: { site: 'port' as const, height: 0.4, x: 0, z: 5 },
      starboard: { site: 'starboard' as const, height: 0.4, x: 0, z: -5 },
    };
    const first = smoother.update({
      entityId: 'player',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback: { heave: 0.2, pitch: 0.2, roll: -0.2 },
      footprint,
      probeTime: 2,
      now: 2,
      dt: 1 / 60,
    });
    expect(first.source).toBe('probe');
    expect(first.heave).toBeCloseTo(0.4);
    expect(first.pitch).toBeGreaterThan(0.05);

    const held = smoother.update({
      entityId: 'player',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback: { heave: 0.2, pitch: 0.2, roll: -0.2 },
      footprint,
      probeTime: 2,
      now: 2 + ATTITUDE_MAX_LATENCY + 0.1,
      dt: 1 / 60,
    });
    expect(held.source).toBe('probe');
    expect(held.heave).toBeCloseTo(first.heave, 2);
    expect(held.pitch).toBeCloseTo(first.pitch, 2);
    expect(held.pitch).toBeLessThan(0.18);
  });

  it('clamps a wild probe heave so the hull cannot jump metres', () => {
    const pose = attitudeFromFootprint(footprint(12, 12, 12, 12, 12));
    expect(pose.heave).toBe(ATTITUDE_MAX_HEAVE);
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

  it('applies a negative waterline offset so the keel sits in the water', () => {
    const smoother = new VesselAttitudeSmoother();
    const pose = smoother.update({
      entityId: 'freighter',
      heading: 0,
      depth: 0,
      waterlineOffset: -1.2,
      fallback,
      footprint: {
        center: { site: 'center', height: 0.4, x: 0, z: 0 },
        bow: { site: 'bow', height: 0.4, x: 8, z: 0 },
        stern: { site: 'stern', height: 0.4, x: -8, z: 0 },
        port: { site: 'port', height: 0.4, x: 0, z: 5 },
        starboard: { site: 'starboard', height: 0.4, x: 0, z: -5 },
      },
      probeTime: 1,
      now: 1,
      dt: 1 / 60,
    });
    expect(pose.presentationY).toBeCloseTo(-1.2 + 0.4, 2);
    expect(pose.presentationY).toBeLessThan(0);
  });

  it('uses probe heave instead of CPU look-dev heave when the footprint is fresh', () => {
    const smoother = new VesselAttitudeSmoother();
    const pose = smoother.update({
      entityId: 'escort',
      heading: 0,
      depth: 0,
      waterlineOffset: 0.15,
      fallback: { heave: 0.2, pitch: 0.01, roll: -0.02 },
      footprint: {
        center: { site: 'center', height: 1.1, x: 0, z: 0 },
        bow: { site: 'bow', height: 1.4, x: 8, z: 0 },
        stern: { site: 'stern', height: 0.8, x: -8, z: 0 },
        port: { site: 'port', height: 1.0, x: 0, z: 5 },
        starboard: { site: 'starboard', height: 1.2, x: 0, z: -5 },
      },
      probeTime: 3,
      now: 3,
      dt: 1 / 60,
    });
    expect(pose.source).toBe('probe');
    expect(pose.heave).toBeCloseTo(1.1, 2);
    expect(pose.presentationY).toBeCloseTo(1.25, 2);
    expect(pose.pitch).toBeGreaterThan(0.02);
  });

  it('does not accumulate pitch from delayed samples at 30, 60, or 120 FPS', () => {
    const footprint = {
      center: { site: 'center' as const, height: 0.4, x: 0, z: 0 },
      bow: { site: 'bow' as const, height: 1.2, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: 0.2, x: -8, z: 0 },
      port: { site: 'port' as const, height: 0.4, x: 0, z: 5 },
      starboard: { site: 'starboard' as const, height: 0.4, x: 0, z: -5 },
    };
    const target = attitudeFromFootprint({
      center: 0.4,
      bow: 1.2,
      stern: 0.2,
      port: 0.4,
      starboard: 0.4,
      span: 8,
    });
    for (const fps of [30, 60, 120]) {
      const smoother = new VesselAttitudeSmoother();
      const dt = 1 / fps;
      let now = 0;
      smoother.update({
        entityId: 'hull',
        heading: 0,
        depth: 0,
        waterlineOffset: 0,
        fallback,
        footprint,
        probeTime: 0,
        now,
        dt,
      });
      let maxPitch = 0;
      for (let i = 0; i < fps * 2; i++) {
        now += dt;
        const pose = smoother.update({
          entityId: 'hull',
          heading: 0,
          depth: 0,
          waterlineOffset: 0,
          fallback,
          footprint,
          probeTime: now - 0.05,
          now,
          dt,
        });
        maxPitch = Math.max(maxPitch, Math.abs(pose.pitch));
        expect(Number.isFinite(pose.pitch)).toBe(true);
      }
      expect(maxPitch, `${fps} fps accumulated`).toBeLessThan(Math.abs(target.pitch) + 0.08);
    }
  });

  it('converges after an initial pitch perturbation toward a constant flat target', () => {
    const smoother = new VesselAttitudeSmoother();
    const steep = {
      center: { site: 'center' as const, height: 0.2, x: 0, z: 0 },
      bow: { site: 'bow' as const, height: 2.2, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: -0.6, x: -8, z: 0 },
      port: { site: 'port' as const, height: 0.2, x: 0, z: 5 },
      starboard: { site: 'starboard' as const, height: 0.2, x: 0, z: -5 },
    };
    const flat = {
      center: { site: 'center' as const, height: 0.2, x: 0, z: 0 },
      bow: { site: 'bow' as const, height: 0.2, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: 0.2, x: -8, z: 0 },
      port: { site: 'port' as const, height: 0.2, x: 0, z: 5 },
      starboard: { site: 'starboard' as const, height: 0.2, x: 0, z: -5 },
    };
    smoother.update({
      entityId: 'hull',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: steep,
      probeTime: 0,
      now: 0,
      dt: 1 / 60,
    });
    let pose = smoother.update({
      entityId: 'hull',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: flat,
      probeTime: 0.02,
      now: 0.02,
      dt: 1 / 60,
    });
    for (let i = 0; i < 180; i++) {
      const now = 0.02 + (i + 1) / 60;
      pose = smoother.update({
        entityId: 'hull',
        heading: 0,
        depth: 0,
        waterlineOffset: 0,
        fallback,
        footprint: flat,
        probeTime: now,
        now,
        dt: 1 / 60,
      });
    }
    expect(pose.source).toBe('probe');
    expect(Math.abs(pose.pitch)).toBeLessThan(0.02);
    expect(Math.abs(pose.roll)).toBeLessThan(0.02);
  });

  it('derives velocity from accepted probe samples, not from rendered extrapolation', () => {
    const smoother = new VesselAttitudeSmoother();
    const firstFoot = {
      center: { site: 'center' as const, height: 0.2, x: 0, z: 0 },
      bow: { site: 'bow' as const, height: 0.4, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: 0.0, x: -8, z: 0 },
      port: { site: 'port' as const, height: 0.2, x: 0, z: 5 },
      starboard: { site: 'starboard' as const, height: 0.2, x: 0, z: -5 },
    };
    const secondFoot = {
      ...firstFoot,
      bow: { site: 'bow' as const, height: 0.8, x: 8, z: 0 },
      stern: { site: 'stern' as const, height: -0.4, x: -8, z: 0 },
    };
    smoother.update({
      entityId: 'hull',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: firstFoot,
      probeTime: 1,
      now: 1,
      dt: 1 / 60,
    });
    const second = smoother.update({
      entityId: 'hull',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: secondFoot,
      probeTime: 1.1,
      now: 1.12,
      dt: 1 / 60,
    });
    const firstPitch = attitudeFromFootprint({
      center: 0.2,
      bow: 0.4,
      stern: 0,
      port: 0.2,
      starboard: 0.2,
      span: 8,
    }).pitch;
    const secondPitch = attitudeFromFootprint({
      center: 0.2,
      bow: 0.8,
      stern: -0.4,
      port: 0.2,
      starboard: 0.2,
      span: 8,
    }).pitch;
    expect(second.pitch).toBeGreaterThan(firstPitch);
    expect(second.pitch).toBeLessThanOrEqual(secondPitch + 0.05);
  });

  it('drops non-finite probe heights instead of poisoning hull Y', () => {
    const smoother = new VesselAttitudeSmoother();
    const pose = smoother.update({
      entityId: 'player',
      heading: 0,
      depth: 0,
      waterlineOffset: 0,
      fallback,
      footprint: {
        center: { site: 'center', height: Number.NaN, x: 0, z: 0 },
        bow: { site: 'bow', height: 1, x: 8, z: 0 },
        stern: { site: 'stern', height: 1, x: -8, z: 0 },
        port: { site: 'port', height: 1, x: 0, z: 5 },
        starboard: { site: 'starboard', height: 1, x: 0, z: -5 },
      },
      probeTime: 1,
      now: 1,
      dt: 1 / 60,
    });
    expect(pose.source).toBe('fallback');
    expect(Number.isFinite(pose.presentationY)).toBe(true);
    expect(Number.isFinite(pose.pitch)).toBe(true);
  });
});
