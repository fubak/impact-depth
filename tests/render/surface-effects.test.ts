import { describe, expect, it } from 'vitest';
import {
  canEmitSurfaceWake,
  createPresentationRng,
  SURFACE_EFFECTS_PROFILES,
  SURFACE_EFFECTS_SEED,
  SURFACE_WAKE_DEPTH_METRES,
  SurfaceEffects,
  type SurfaceEffectsFrame,
} from '../../src/render/ocean/surface-effects';
import { DEFAULT_SPECTRUM_SEED } from '../../src/render/ocean/spectrum';

function frame(overrides: Partial<SurfaceEffectsFrame> = {}): SurfaceEffectsFrame {
  return {
    time: 1,
    dt: 1 / 30,
    followX: 0,
    followZ: 0,
    cameraY: 8,
    seaState: 0.35,
    ...overrides,
  };
}

describe('presentation RNG isolation', () => {
  it('is deterministic and distinct from the spectrum seed', () => {
    const a = createPresentationRng(SURFACE_EFFECTS_SEED);
    const b = createPresentationRng(SURFACE_EFFECTS_SEED);
    expect(Array.from({ length: 6 }, () => a())).toEqual(Array.from({ length: 6 }, () => b()));
    expect(SURFACE_EFFECTS_SEED).not.toBe(DEFAULT_SPECTRUM_SEED);
  });

  it('blocks surface wakes for underwater submarines', () => {
    expect(canEmitSurfaceWake(0.4, 2)).toBe(true);
    expect(canEmitSurfaceWake(SURFACE_WAKE_DEPTH_METRES, 8)).toBe(false);
    expect(canEmitSurfaceWake(8, 6)).toBe(false);
    expect(canEmitSurfaceWake(0.2, 0.1)).toBe(false);
  });
});

describe('SurfaceEffects construction and quality', () => {
  it('constructs preallocated layers at the high slot capacity', () => {
    const fx = new SurfaceEffects({ seed: 19, quality: 'high' });
    const diag = fx.getDiagnostics();
    expect(diag.ownedMeshes).toBe(4);
    expect(diag.slotCapacity).toBe(
      SURFACE_EFFECTS_PROFILES.high.sprayCap +
        SURFACE_EFFECTS_PROFILES.high.splashCap +
        SURFACE_EFFECTS_PROFILES.high.bubbleCap +
        SURFACE_EFFECTS_PROFILES.high.particulateCap,
    );
    expect(diag.sprayAlive).toBe(0);
    fx.dispose();
  });

  it('tightens live caps on quality resize without growing slot storage', () => {
    const fx = new SurfaceEffects({ seed: 19, quality: 'high' });
    const before = fx.getDiagnostics().slotCapacity;
    for (let i = 0; i < 40; i++) {
      fx.emitImpact({ x: i, z: i * 0.5, strength: 1.2, kind: 'burst' });
    }
    expect(fx.getDiagnostics().splashAlive).toBeGreaterThan(0);
    fx.setQuality('low');
    const after = fx.getDiagnostics();
    expect(after.quality).toBe('low');
    expect(after.splashCap).toBe(SURFACE_EFFECTS_PROFILES.low.splashCap);
    expect(after.splashAlive).toBeLessThanOrEqual(after.splashCap);
    expect(after.slotCapacity).toBe(before);
    fx.dispose();
  });
});

describe('SurfaceEffects pause, reset, and reduced motion', () => {
  it('expires impacts and freezes ages while paused', () => {
    const fx = new SurfaceEffects({ seed: 77, quality: 'medium' });
    fx.emitImpact({ x: 2, z: 3, strength: 1 });
    fx.update(frame({ time: 0, dt: 0 }));
    const born = fx.getDiagnostics().splashAlive;
    expect(born).toBeGreaterThan(0);
    fx.update(frame({ paused: true, dt: 4 }));
    expect(fx.getDiagnostics().historyTime).toBe(0);
    expect(fx.getDiagnostics().splashAlive).toBe(born);
    fx.update(frame({ dt: 2 }));
    expect(fx.getDiagnostics().splashAlive).toBe(0);
    fx.dispose();
  });

  it('clears emitters on mission reset and dispose twice', () => {
    const fx = new SurfaceEffects({ seed: 11 });
    fx.emitImpact({ x: 0, z: 0, kind: 'burst' });
    fx.update(frame());
    expect(fx.getDiagnostics().sprayAlive).toBeGreaterThan(0);
    fx.reset(3);
    const cleared = fx.getDiagnostics();
    expect(cleared.missionGeneration).toBe(3);
    expect(cleared.historyTime).toBe(0);
    expect(cleared.sprayAlive + cleared.splashAlive + cleared.bubbleAlive).toBe(0);
    fx.dispose();
    fx.dispose();
    expect(fx.getDiagnostics().ownedMeshes).toBe(4);
  });

  it('respects reduced motion by suppressing and clearing effects', () => {
    const fx = new SurfaceEffects({ seed: 5 });
    fx.emitImpact({ x: 1, z: 1 });
    fx.setReducedMotion(true);
    expect(fx.getDiagnostics().splashAlive).toBe(0);
    fx.emitImpact({ x: 2, z: 2, kind: 'burst' });
    fx.update(frame({ reducedMotion: true, dt: 0.1 }));
    expect(fx.getDiagnostics().sprayAlive).toBe(0);
    fx.dispose();
  });
});

describe('SurfaceEffects wake and allocation bounds', () => {
  it('does not spawn surface wakes for a deep submarine', () => {
    const fx = new SurfaceEffects({ seed: 19, quality: 'high' });
    fx.update(
      frame({
        dt: 0.12,
        wakes: [
          { x: 0, z: 0, heading: 0, speed: 8, depth: 8, stern: 5 },
          { x: 4, z: 2, heading: 0.4, speed: 6, depth: 0.2, stern: 7 },
        ],
      }),
    );
    const withSurface = fx.getDiagnostics().sprayAlive;
    expect(withSurface).toBeGreaterThan(0);

    const deepOnly = new SurfaceEffects({ seed: 19, quality: 'high' });
    deepOnly.update(
      frame({
        dt: 0.12,
        wakes: [{ x: 0, z: 0, heading: 0, speed: 8, depth: 8, stern: 5 }],
      }),
    );
    expect(deepOnly.getDiagnostics().sprayAlive).toBe(0);
    fx.dispose();
    deepOnly.dispose();
  });

  it('keeps owned slot counts stable across repeated engagements', () => {
    const fx = new SurfaceEffects({ seed: 42, quality: 'high' });
    const baseline = fx.getDiagnostics().slotCapacity;
    for (let mission = 1; mission <= 20; mission++) {
      fx.reset(mission);
      for (let i = 0; i < 30; i++) {
        fx.emitImpact({ x: i * 0.3, z: i * 0.2, strength: 1.4, kind: 'impact' });
        fx.update(
          frame({
            time: mission + i * 0.05,
            dt: 1 / 30,
            crests: [{ x: i, z: -i, energy: 0.8 }],
            wakes: [
              { x: i, z: 0, heading: 0.2, speed: 5, depth: 0.3, stern: 6 },
              { x: 0, z: i, heading: 1.1, speed: 4, depth: 9, stern: 5 },
            ],
            submerged: [{ x: 1, y: -6, z: 2, speed: 2 }],
            cameraY: -3,
          }),
        );
      }
    }
    expect(fx.getDiagnostics().slotCapacity).toBe(baseline);
    expect(fx.getDiagnostics().ownedMeshes).toBe(4);
    expect(fx.getDiagnostics().sprayAlive).toBeLessThanOrEqual(
      SURFACE_EFFECTS_PROFILES.high.sprayCap,
    );
    fx.dispose();
  });

  it('same seed produces the same alive counts after identical events', () => {
    const run = (): number[] => {
      const fx = new SurfaceEffects({ seed: 91, quality: 'medium' });
      fx.emitImpact({ x: 3, z: -1, strength: 1.1, kind: 'burst' });
      fx.update(
        frame({
          dt: 0.12,
          crests: [{ x: 2, z: 2, energy: 0.9 }],
          wakes: [{ x: 0, z: 0, heading: 0, speed: 4, depth: 0.1, stern: 5 }],
        }),
      );
      const diag = fx.getDiagnostics();
      fx.dispose();
      return [diag.sprayAlive, diag.splashAlive, diag.bubbleAlive];
    };
    expect(run()).toEqual(run());
  });
});
