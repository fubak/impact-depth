import { describe, expect, it } from 'vitest';
import { ShipEmitters, type EmitterShipView } from '../../src/render/fx/ship-emitters';
import { VfxPool } from '../../src/render/vfx';

function burning(id: string, fire: number, sinkProgress = 0): EmitterShipView {
  return { id, x: 10, z: 20, deckY: 2.5, spread: 5, fire, flooding: 0.4, sinkProgress };
}

describe('ship emitters', () => {
  it('a burning ship emits fire and smoke from deck height', () => {
    const vfx = new VfxPool(500);
    const emitters = new ShipEmitters(vfx);
    for (let i = 0; i < 30; i += 1) {
      emitters.update([burning('s-1', 0.8)], i / 60, 1 / 60);
    }
    const particles = vfx.debugParticles();
    expect(particles.some((p) => p.kind === 'fireball' && p.y > 2)).toBe(true);
    expect(particles.some((p) => p.kind === 'smoke' && p.y > 2)).toBe(true);
    vfx.dispose();
    emitters.dispose();
  });

  it('a sinking ship vents air bubbles and waterline foam', () => {
    const vfx = new VfxPool(500);
    const emitters = new ShipEmitters(vfx);
    for (let i = 0; i < 120; i += 1) {
      emitters.update([burning('s-2', 0, 0.5)], i / 60, 1 / 60);
    }
    const particles = vfx.debugParticles();
    expect(particles.some((p) => p.kind === 'steam')).toBe(true);
    expect(particles.some((p) => p.kind === 'bubbles' && p.y < 0)).toBe(true);
    vfx.dispose();
    emitters.dispose();
  });

  it('emitters stop when a ship disappears from the snapshot', () => {
    const vfx = new VfxPool(500);
    const emitters = new ShipEmitters(vfx);
    for (let i = 0; i < 10; i += 1) {
      emitters.update([burning('s-3', 1)], i / 60, 1 / 60);
    }
    expect(emitters.getDiagnostics().emitters).toBe(1);
    // Ship removed: its accumulator is dropped and nothing new is emitted.
    emitters.update([], 10 / 60, 1 / 60);
    emitters.update([], 11 / 60, 1 / 60);
    expect(emitters.getDiagnostics().emitters).toBe(0);
    const alive = vfx.getDiagnostics().alive;
    emitters.update([], 13 / 60, 1 / 60);
    expect(vfx.getDiagnostics().alive).toBe(alive);
    vfx.dispose();
    emitters.dispose();
  });

  it('oil slicks pool at six, fade over ~40 s, and never grow the pool', () => {
    const vfx = new VfxPool(100);
    const emitters = new ShipEmitters(vfx);
    for (let i = 0; i < 9; i += 1) emitters.spawnSlick(i * 10, 0, 0);
    emitters.update([], 0.1, 1 / 60);
    expect(emitters.getDiagnostics().slicks).toBe(6);
    expect(emitters.group.children).toHaveLength(6);
    // Past the life window they all retire.
    emitters.update([], 45, 1 / 60);
    expect(emitters.getDiagnostics().slicks).toBe(0);
    vfx.dispose();
    emitters.dispose();
  });
});
