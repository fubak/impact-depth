import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { LookDevSettings } from '../../src/core/types';
import { adaptToLookDevSim } from '../../src/game/adapt/lookdev';
import type { CombatEvent } from '../../src/game/adapt/combat-events';
import { createGame } from '../../src/game/sim/create';
import type { Torpedo } from '../../src/game/sim/types';
import { burstParticles } from '../../src/render/presentation/combat-fx';
import {
  combatEventBursts,
  combatEventHitLight,
  combatEventMeshFx,
  HIT_LIGHT_PULSE_S,
  torpedoTrailMarks,
} from '../../src/render/presentation/combat-event-fx';
import {
  entityDepthY,
  simToWorldMeters,
  SURFACE_SPLASH_Y,
} from '../../src/render/presentation/coordinates';
import { GameScene } from '../../src/render/scene';

function hitAt(z: number): CombatEvent {
  // Bursts ride the detonation event, not the torpedoHit audio/HUD cue.
  return {
    type: 'detonation',
    id: 't1',
    kind: 'torpedo',
    owner: 'player',
    x: 40,
    y: 55,
    z,
    yield: 48,
    hitId: 'ship-1',
    surface: z <= 0.15,
  };
}

function directLights(scene: THREE.Scene): THREE.Light[] {
  return scene.children.filter(
    (child): child is THREE.Light => (child as THREE.Light).isLight === true,
  );
}

function particlesOf(scene: GameScene): ReturnType<GameScene['debugVfxParticles']> {
  return scene.debugVfxParticles();
}

function fish(z: number): Torpedo {
  return {
    id: 'fish-1',
    owner: 'player',
    kind: 'mk14',
    x: 48,
    y: 48,
    z,
    heading: 0,
    speed: 8,
    runSpeed: 8,
    lockId: null,
    life: 20,
    armDelay: 0,
    damage: 40,
    targetId: null,
    sourceId: 'player',
    turnRate: 0,
    run: 1,
  };
}

describe('combat event fx mapping', () => {
  it('places a detonation burst at the entity depth for sim z', () => {
    const z = 0.62;
    const [burst] = combatEventBursts(hitAt(z));
    const world = simToWorldMeters(40, 55);
    expect(burst).toMatchObject({
      preset: 'chargeBlast',
      x: world.x,
      y: entityDepthY(z),
      z: world.z,
    });
    expect(burst?.y).toBeLessThan(-10);
    expect(burst?.y).not.toBeCloseTo(SURFACE_SPLASH_Y, 1);
  });

  it('emits no burst for torpedoHit or chargeBlast cues — only detonations explode', () => {
    expect(
      combatEventBursts({ type: 'torpedoHit', id: 't', targetId: 's', x: 1, y: 2, z: 0.5 }),
    ).toEqual([]);
    expect(
      combatEventBursts({ type: 'chargeBlast', x: 1, y: 2, z: 0.5, near: true }),
    ).toEqual([]);
  });

  it('uses a stronger charge blast when the detonation hit the boat', () => {
    const detonation = (hitId: string | null): CombatEvent => ({
      type: 'detonation',
      id: `dc-${hitId ?? 'miss'}`,
      kind: 'depthCharge',
      owner: 'enemy',
      x: 10,
      y: 12,
      z: 0.4,
      yield: 45,
      hitId,
      surface: false,
    });
    const near = combatEventBursts(detonation('player'))[0];
    const far = combatEventBursts(detonation(null))[0];
    expect(near?.y).toBe(entityDepthY(0.4));
    expect(far?.y).toBe(entityDepthY(0.4));
    expect(near?.intensity).toBeGreaterThan(far?.intensity ?? 0);
  });

  it('draws a bubble trail underwater and a surface wake line when shallow', () => {
    const deepY = entityDepthY(0.7);
    const deep = torpedoTrailMarks({ id: 'a', x: 0, y: deepY, z: 4, heading: 0 });
    expect(deep.length).toBeGreaterThanOrEqual(4);
    expect(deep.every((mark) => mark.kind === 'bubbles' && mark.y === deepY)).toBe(true);
    expect(new Set(deep.map((mark) => mark.x)).size).toBe(deep.length);

    const shallowY = entityDepthY(0.04);
    const shallow = torpedoTrailMarks({ id: 'b', x: 10, y: shallowY, z: 4, heading: 0 });
    expect(shallow.length).toBeGreaterThanOrEqual(3);
    expect(shallow.every((mark) => mark.kind === 'wake')).toBe(true);
    expect(shallow.every((mark) => mark.y === Math.max(SURFACE_SPLASH_Y, shallowY))).toBe(true);
    expect(new Set(shallow.map((mark) => mark.z)).size).toBe(1);
    expect(new Set(shallow.map((mark) => mark.x)).size).toBe(shallow.length);
  });

  it('an underwater detonation produces no surface fireball', () => {
    const burst = combatEventBursts(hitAt(0.6))[0]!;
    expect(burst.y).toBeLessThan(0);
    const specs = burstParticles(burst);
    // Underwater: flash + bubbles + silt only — no fire or sparks above the sea.
    expect(specs.every((p) => p.kind !== 'fireball' && p.kind !== 'spark')).toBe(true);
    expect(specs.some((p) => p.kind === 'bubbles')).toBe(true);
    const cues = combatEventMeshFx(hitAt(0.6));
    expect(cues.some((cue) => cue.type === 'gasBubbles')).toBe(true);
    expect(cues.some((cue) => cue.type === 'ring')).toBe(false);
  });

  it('a shallow detonation gets a dome and plume, a deep one only a dome', () => {
    const shallow = combatEventMeshFx(hitAt(0.2));
    const deep = combatEventMeshFx(hitAt(0.9));
    const veryDeep = combatEventMeshFx(hitAt(1.7));
    const shallowPlume = shallow.find((cue) => cue.type === 'plume');
    const deepPlume = deep.find((cue) => cue.type === 'plume');
    expect(shallow.some((cue) => cue.type === 'dome')).toBe(true);
    expect(deep.some((cue) => cue.type === 'dome')).toBe(true);
    expect(veryDeep.some((cue) => cue.type === 'dome')).toBe(true);
    expect(shallowPlume && shallowPlume.type === 'plume' ? shallowPlume.height : 0).toBeGreaterThan(
      25,
    );
    // The plume shrinks with depth and vanishes entirely below PLUME_DEPTH_M.
    expect(deepPlume && deepPlume.type === 'plume' ? deepPlume.height : 0).toBeLessThan(
      shallowPlume && shallowPlume.type === 'plume' ? shallowPlume.height : 0,
    );
    expect(veryDeep.some((cue) => cue.type === 'plume')).toBe(false);
  });

  it('a surface torpedo detonation gets a shock ring, not a gas globe', () => {
    const cues = combatEventMeshFx(hitAt(0.05));
    expect(cues.some((cue) => cue.type === 'ring')).toBe(true);
    expect(cues.some((cue) => cue.type === 'gasBubbles')).toBe(false);
  });

  it('a sinking ship leaves an oil slick cue', () => {
    const cues = combatEventMeshFx({
      type: 'shipSunk',
      id: 'm-1',
      kind: 'merchant',
      x: 10,
      y: 12,
    });
    expect(cues.some((cue) => cue.type === 'slick')).toBe(true);
  });

  it('a shell launch produces a muzzle burst on the firing hull', () => {
    const [burst] = combatEventBursts({
      type: 'shellLaunch',
      owner: 'enemy',
      id: 's-1',
      sourceId: 'ship-9',
      x: 30,
      y: 40,
      alt: 0.2,
      heading: 1.1,
    });
    expect(burst?.preset).toBe('gunMuzzle');
    const world = simToWorldMeters(30, 40);
    expect(burst?.x).toBe(world.x);
    expect(burst?.y).toBeGreaterThan(0); // deck height, not the waterline
  });
});

/** Seabed's TextureLoader needs document.createElementNS; node has neither. */
function installDomStub(): void {
  if (typeof document !== 'undefined') return;
  const gradient = { addColorStop: () => undefined };
  const ctx = {
    clearRect: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    createRadialGradient: () => gradient,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
  };
  const canvas = () => ({ width: 64, height: 64, getContext: () => ctx });
  const img = () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    src: '',
  });
  Object.assign(globalThis, {
    document: {
      createElement: (tag: string) => (tag === 'canvas' ? canvas() : img()),
      createElementNS: () => img(),
    },
  });
}

describe('GameScene combat presentation', () => {
  beforeAll(installDomStub);

  it('keeps the scene light count constant across 100 hit events', () => {
    const view = new GameScene();
    try {
      // Four hit lights + two fire lights are the whole preallocated pool.
      const lights = () => directLights(view.scene);
      expect(lights()).toHaveLength(6);
      expect(lights().every((light) => light.intensity === 0)).toBe(true);
      const before = lights().length;

      const z = 0.55;
      view.playCombatEvents([hitAt(z)], 2);
      const pool = particlesOf(view);
      expect(pool.some((p) => Math.abs(p.y - entityDepthY(z)) < 1e-4)).toBe(true);
      expect(combatEventHitLight(hitAt(z))?.y).toBe(entityDepthY(z));
      expect(combatEventHitLight(hitAt(z))?.underwater).toBe(true);
      expect(lights().some((light) => light.intensity > 0)).toBe(true);

      const events: CombatEvent[] = Array.from({ length: 100 }, (_, index) => ({
        type: 'detonation' as const,
        id: `t${index}`,
        kind: 'torpedo' as const,
        owner: 'player' as const,
        x: 30 + index * 0.01,
        y: 40,
        z: 0.4 + (index % 5) * 0.05,
        yield: 48,
        hitId: `ship-${index % 3}`,
        surface: false,
      }));
      view.playCombatEvents(events, 3);
      expect(lights()).toHaveLength(before);
      expect(view.scene.children.filter((child) => child.name === 'combat-hit-light')).toHaveLength(
        4,
      );

      view.playCombatEvents([], 3 + HIT_LIGHT_PULSE_S + 0.05);
      expect(lights()).toHaveLength(before);
      expect(lights().every((light) => light.intensity === 0)).toBe(true);

      const burst = view.debugBurstPresentationFx();
      expect(burst.vfx.alive).toBeGreaterThanOrEqual(3);
      expect(burst.splash).toBeGreaterThanOrEqual(1);
      expect(lights()).toHaveLength(before);
    } finally {
      view.dispose();
    }
  });

  it('emits the underwater bubble trail and the shallow wake line from the live torpedo', () => {
    const view = new GameScene();
    try {
      const game = createGame(1);
      game.ships = [];
      game.depthCharges = [];
      game.aircraft = [];
      game.powerups = [];
      game.torpedoes = [fish(0.7)];
      const settings: LookDevSettings = {
        ...DEFAULT_SETTINGS,
        presentation: { ...DEFAULT_SETTINGS.presentation, labelDensity: 0 },
      };
      const sim = adaptToLookDevSim(game);
      view.syncGame(game, sim, settings, 1 / 60);

      const bubbles = particlesOf(view).filter((p) => p.kind === 'bubbles');
      expect(bubbles.length).toBeGreaterThanOrEqual(4);
      expect(bubbles.every((p) => p.y < -1.5)).toBe(true);
      expect(particlesOf(view).some((p) => p.kind === 'plume')).toBe(false);
      expect(new Set(bubbles.map((p) => p.x.toFixed(2))).size).toBeGreaterThanOrEqual(4);

      game.torpedoes = [fish(0.04)];
      game.time += 0.25;
      view.syncGame(game, adaptToLookDevSim(game), settings, 1 / 60);
      const wakes = particlesOf(view).filter((p) => p.kind === 'wake');
      expect(wakes.length).toBeGreaterThanOrEqual(3);
      expect(new Set(wakes.map((p) => p.z.toFixed(3))).size).toBe(1);
      expect(new Set(wakes.map((p) => p.x.toFixed(2))).size).toBeGreaterThanOrEqual(3);
    } finally {
      view.dispose();
    }
  }, 60_000);

  it('keeps a wreck for six simulation seconds, including a one-second step', () => {
    const view = new GameScene();
    try {
      const sunk: CombatEvent = { type: 'shipSunk', id: 'hull', kind: 'merchant', x: 20, y: 30 };
      // Age follows simulation seconds, one presentation step at a time.
      // At 4× compression those six seconds take 1.5s of wall clock.
      let time = 0;
      view.playCombatEvents([sunk], time);
      expect(view.wreckCount()).toBe(1);
      for (let step = 0; step < 5; step += 1) {
        time += 1;
        view.playCombatEvents([], time);
      }
      expect(view.wreckCount()).toBe(1);
      view.playCombatEvents([], time + 1);
      expect(view.wreckCount()).toBe(0);
    } finally {
      view.dispose();
    }
  });
});
