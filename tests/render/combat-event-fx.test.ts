import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { LookDevSettings } from '../../src/core/types';
import { adaptToLookDevSim } from '../../src/game/adapt/lookdev';
import type { CombatEvent } from '../../src/game/adapt/combat-events';
import { createGame } from '../../src/game/sim/create';
import type { Torpedo } from '../../src/game/sim/types';
import {
  combatEventBursts,
  combatEventHitLight,
  HIT_LIGHT_PULSE_S,
  torpedoTrailMarks,
} from '../../src/render/presentation/combat-event-fx';
import {
  entityDepthY,
  simToWorldMeters,
  SURFACE_SPLASH_Y,
} from '../../src/render/presentation/coordinates';
import { GameScene } from '../../src/render/scene';

const BUBBLE = 0xbfe6f0;
const WAKE = 0xe8fbff;
const PLUME = 0x9dd9df;

function hitAt(z: number): CombatEvent {
  return { type: 'torpedoHit', id: 't1', targetId: 'ship-1', x: 40, y: 55, z };
}

function directLights(scene: THREE.Scene): THREE.Light[] {
  return scene.children.filter(
    (child): child is THREE.Light => (child as THREE.Light).isLight === true,
  );
}

function spritesOf(scene: GameScene): THREE.Sprite[] {
  const pool = scene.scene.getObjectByName('vfx-pool');
  return (pool?.children ?? []).filter(
    (child): child is THREE.Sprite => child instanceof THREE.Sprite,
  );
}

function spriteHex(sprite: THREE.Sprite): number {
  return (sprite.material as THREE.SpriteMaterial).color.getHex();
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
  it('places a hit burst at the entity depth for sim z', () => {
    const z = 0.62;
    const [burst] = combatEventBursts(hitAt(z));
    const world = simToWorldMeters(40, 55);
    expect(burst).toMatchObject({
      preset: 'torpedoHit',
      x: world.x,
      y: entityDepthY(z),
      z: world.z,
    });
    expect(burst?.y).toBeLessThan(-10);
    expect(burst?.y).not.toBeCloseTo(SURFACE_SPLASH_Y, 1);
  });

  it('uses a stronger charge blast when the blast is near', () => {
    const near = combatEventBursts({ type: 'chargeBlast', x: 10, y: 12, z: 0.4, near: true })[0];
    const far = combatEventBursts({ type: 'chargeBlast', x: 10, y: 12, z: 0.4, near: false })[0];
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
      const lights = () => directLights(view.scene);
      expect(lights()).toHaveLength(2);
      expect(lights().every((light) => light.intensity === 0)).toBe(true);
      const before = lights().length;

      const z = 0.55;
      view.playCombatEvents([hitAt(z)], 2);
      const pool = spritesOf(view);
      expect(pool.some((sprite) => Math.abs(sprite.position.y - entityDepthY(z)) < 1e-4)).toBe(
        true,
      );
      expect(combatEventHitLight(hitAt(z))?.y).toBe(entityDepthY(z));
      expect(lights().some((light) => light.intensity > 0)).toBe(true);

      const events: CombatEvent[] = Array.from({ length: 100 }, (_, index) => ({
        type: 'torpedoHit',
        id: `t${index}`,
        targetId: `ship-${index % 3}`,
        x: 30 + index * 0.01,
        y: 40,
        z: 0.4 + (index % 5) * 0.05,
      }));
      view.playCombatEvents(events, 3);
      expect(lights()).toHaveLength(before);
      expect(view.scene.children.filter((child) => child.name === 'combat-hit-light')).toHaveLength(
        2,
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

      const bubbles = spritesOf(view).filter((sprite) => spriteHex(sprite) === BUBBLE);
      expect(bubbles.length).toBeGreaterThanOrEqual(4);
      expect(bubbles.every((sprite) => sprite.position.y < -1.5)).toBe(true);
      expect(spritesOf(view).some((sprite) => spriteHex(sprite) === PLUME)).toBe(false);
      expect(
        new Set(bubbles.map((sprite) => sprite.position.x.toFixed(2))).size,
      ).toBeGreaterThanOrEqual(4);

      game.torpedoes = [fish(0.04)];
      game.time += 0.25;
      view.syncGame(game, adaptToLookDevSim(game), settings, 1 / 60);
      const wakes = spritesOf(view).filter((sprite) => spriteHex(sprite) === WAKE);
      expect(wakes.length).toBeGreaterThanOrEqual(3);
      expect(new Set(wakes.map((sprite) => sprite.position.z.toFixed(3))).size).toBe(1);
      expect(
        new Set(wakes.map((sprite) => sprite.position.x.toFixed(2))).size,
      ).toBeGreaterThanOrEqual(3);
    } finally {
      view.dispose();
    }
  }, 60_000);
});
