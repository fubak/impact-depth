import * as THREE from 'three';
import { ATLAS } from './particle-system';
import type { VfxPool } from '../vfx';

/**
 * Persistent per-ship emitters driven by snapshot state (fire, flooding,
 * sinkProgress) plus the pooled oil-slick decals left when a hull goes down.
 * All jitter is a per-ship seeded LCG — never Math.random.
 */

const MAX_SLICKS = 6;
const SLICK_LIFE_S = 40;
const FIRE_PARTICLE_RATE = 7; // per second at fire = 1
const SMOKE_PARTICLE_RATE = 5;
const SINK_FOAM_RATE = 5;
const AIR_BURST_INTERVAL = 0.9;
const WRECK_BUBBLE_INTERVAL = 0.45;

export interface EmitterShipView {
  id: string;
  /** World metres. */
  x: number;
  z: number;
  /** Deck/smoke anchor height above the waterline, world metres. */
  deckY: number;
  /** Beam radius used to spread emitters across the hull. */
  spread: number;
  fire: number;
  flooding: number;
  sinkProgress: number;
}

export interface WreckTrickle {
  id: string;
  x: number;
  y: number;
  z: number;
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Accumulator = {
  rand: () => number;
  fire: number;
  smoke: number;
  foam: number;
  air: number;
};

function newAccumulator(id: string): Accumulator {
  return { rand: lcg(hashId(id)), fire: 0, smoke: 0, foam: 0, air: 0 };
}

/** Translucent dark disc with an iridescent rim — the oil slick texture. */
function createSlickTexture(): THREE.Texture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const angle = Math.atan2(v, u);
      const i = (y * size + x) * 4;
      if (r > 1) continue;
      const rim = Math.max(0, (r - 0.62) / 0.38);
      const fade = Math.max(0, 1 - Math.pow(r, 3));
      // Thin-film hue drift around the rim, dark diesel centre.
      const shimmer = Math.sin(angle * 3 + r * 9) * 0.5 + 0.5;
      data[i] = Math.round(14 + rim * (40 + shimmer * 90));
      data[i + 1] = Math.round(18 + rim * (55 + (1 - shimmer) * 80));
      data[i + 2] = Math.round(22 + rim * (60 + shimmer * 60));
      data[i + 3] = Math.round(140 * fade + 30 * rim);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export class ShipEmitters {
  readonly group = new THREE.Group();
  private readonly accumulators = new Map<string, Accumulator>();
  private readonly slicks: { mesh: THREE.Mesh; born: number }[] = [];
  private slickCursor = 0;

  constructor(private readonly vfx: VfxPool) {
    this.group.name = 'ship-emitters';
    const texture = createSlickTexture();
    for (let i = 0; i < MAX_SLICKS; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 30), material);
      mesh.name = 'oil-slick';
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.16;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.slicks.push({ mesh, born: 0 });
    }
  }

  /** Every frame: feed emitters from the ship snapshot, prune vanished ships. */
  update(
    ships: readonly EmitterShipView[],
    now: number,
    dt: number,
    wrecks: readonly WreckTrickle[] = [],
  ): void {
    const live = new Set<string>();
    for (const ship of ships) {
      live.add(ship.id);
      const acc =
        this.accumulators.get(ship.id) ??
        this.accumulators.set(ship.id, newAccumulator(ship.id)).get(ship.id)!;
      const rand = acc.rand;
      if (ship.fire > 0.02) {
        acc.fire += ship.fire * FIRE_PARTICLE_RATE * dt;
        acc.smoke += ship.fire * SMOKE_PARTICLE_RATE * dt;
        while (acc.fire >= 1) {
          acc.fire -= 1;
          this.vfx.emitSpec(
            {
              kind: 'fireball',
              x: ship.x + (rand() - 0.5) * ship.spread,
              y: ship.deckY + rand() * 0.8,
              z: ship.z + (rand() - 0.5) * ship.spread * 0.5,
              vy: 2 + rand() * 2.5,
              vx: (rand() - 0.5) * 0.8,
              vz: (rand() - 0.5) * 0.8,
              size0: 1.6 + rand() * 2.2,
              size1: 3.5 + rand() * 2.5,
              ttl: 0.5 + rand() * 0.4,
              frame: ATLAS.fireA + Math.floor(rand() * 3),
              color0: [1, 0.85, 0.45, 0.9],
              colorMid: [1, 0.45, 0.12, 0.7],
              color1: [0.3, 0.1, 0.05, 0],
              additive: true,
              priority: 3,
            },
            now,
          );
        }
        while (acc.smoke >= 1) {
          acc.smoke -= 1;
          this.vfx.emitSpec(
            {
              kind: 'smoke',
              x: ship.x + (rand() - 0.5) * ship.spread,
              y: ship.deckY + 1.5,
              z: ship.z + (rand() - 0.5) * ship.spread * 0.5,
              vy: 3 + rand() * 2.5,
              vx: (rand() - 0.5) * 0.6,
              vz: (rand() - 0.5) * 0.6,
              size0: 3 + rand() * 3,
              size1: 13 + rand() * 10,
              ttl: 5.5 + rand() * 3,
              drag: 0.1,
              rotSpeed: (rand() - 0.5) * 0.5,
              frame: ATLAS.smokeA + Math.floor(rand() * 3),
              color0: [0.16, 0.16, 0.17, 0.75],
              color1: [0.3, 0.3, 0.31, 0],
              additive: false,
              priority: 2,
            },
            now,
          );
        }
      }
      if (ship.sinkProgress > 0.02 && ship.sinkProgress < 1) {
        acc.foam += ship.sinkProgress * SINK_FOAM_RATE * dt;
        acc.air += dt;
        while (acc.foam >= 1) {
          acc.foam -= 1;
          this.vfx.emitSpec(
            {
              kind: 'steam',
              x: ship.x + (rand() - 0.5) * ship.spread * 1.4,
              y: 0.4,
              z: ship.z + (rand() - 0.5) * ship.spread,
              vy: 1 + rand() * 1.6,
              vx: (rand() - 0.5) * 1.4,
              vz: (rand() - 0.5) * 1.4,
              size0: 1.5 + rand() * 2,
              size1: 5 + rand() * 3,
              ttl: 1.4 + rand() * 0.8,
              frame: ATLAS.foam,
              color0: [0.9, 0.96, 1, 0.6],
              color1: [0.9, 0.96, 1, 0],
              additive: false,
              priority: 2,
            },
            now,
          );
        }
        // Escaping air: periodic bubble clusters as the hull goes under.
        if (acc.air >= AIR_BURST_INTERVAL) {
          acc.air = 0;
          const count = 4 + Math.floor(rand() * 4);
          for (let i = 0; i < count; i += 1) {
            this.vfx.emitSpec(
              {
                kind: 'bubbles',
                x: ship.x + (rand() - 0.5) * ship.spread,
                y: -0.8 - rand() * 2.5 - ship.sinkProgress * 3,
                z: ship.z + (rand() - 0.5) * ship.spread,
                vy: 0.5 + rand(),
                size0: 0.4 + rand() * 1.2,
                size1: 0.7 + rand() * 1.6,
                ttl: 6 + rand() * 4,
                terminal: 3.5 + rand() * 2.5,
                wobble: 0.4 + rand() * 0.5,
                frame: ATLAS.bubble,
                color0: [0.8, 0.93, 0.97, 0.7],
                color1: [0.85, 0.95, 1, 0.45],
                additive: false,
                surfaceDeath: 'bubble',
                priority: 1,
              },
              now,
            );
          }
        }
      }
    }
    for (const wreck of wrecks) {
      if (wreck.y >= -0.5) continue;
      live.add(wreck.id);
      const acc =
        this.accumulators.get(wreck.id) ??
        this.accumulators.set(wreck.id, newAccumulator(wreck.id)).get(wreck.id)!;
      acc.air += dt;
      if (acc.air >= WRECK_BUBBLE_INTERVAL) {
        acc.air = 0;
        const rand = acc.rand;
        this.vfx.emitSpec(
          {
            kind: 'bubbles',
            x: wreck.x + (rand() - 0.5) * 2,
            y: wreck.y + rand(),
            z: wreck.z + (rand() - 0.5) * 2,
            vy: 0.4 + rand() * 0.6,
            size0: 0.3 + rand() * 0.7,
            size1: 0.6 + rand(),
            ttl: 5 + rand() * 3,
            terminal: 3 + rand() * 2,
            wobble: 0.4,
            frame: ATLAS.bubble,
            color0: [0.8, 0.93, 0.97, 0.6],
            color1: [0.85, 0.95, 1, 0.4],
            additive: false,
            surfaceDeath: 'bubble',
            priority: 1,
          },
          now,
        );
      }
    }
    for (const id of this.accumulators.keys()) {
      if (!live.has(id)) this.accumulators.delete(id);
    }
    this.updateSlicks(now);
  }

  /** Oil left on the water when a hull disappears beneath it. */
  spawnSlick(x: number, z: number, now: number): void {
    const slot = this.slicks[this.slickCursor % this.slicks.length]!;
    this.slickCursor += 1;
    slot.born = now;
    slot.mesh.position.x = x;
    slot.mesh.position.z = z;
    slot.mesh.visible = true;
  }

  private updateSlicks(now: number): void {
    for (const slot of this.slicks) {
      if (!slot.mesh.visible) continue;
      const age = now - slot.born;
      if (age >= SLICK_LIFE_S) {
        slot.mesh.visible = false;
        continue;
      }
      const grow = Math.min(1, age / 12);
      const radius = 6 + grow * 9;
      slot.mesh.scale.setScalar(radius);
      (slot.mesh.material as THREE.MeshBasicMaterial).opacity =
        0.55 * Math.min(1, age / 2) * Math.max(0, 1 - age / SLICK_LIFE_S);
    }
  }

  reset(): void {
    this.accumulators.clear();
    for (const slot of this.slicks) {
      slot.mesh.visible = false;
      slot.born = 0;
    }
  }

  getDiagnostics(): { emitters: number; slicks: number } {
    return {
      emitters: this.accumulators.size,
      slicks: this.slicks.filter((slot) => slot.mesh.visible).length,
    };
  }

  dispose(): void {
    this.accumulators.clear();
    for (const slot of this.slicks) {
      slot.mesh.geometry.dispose();
      (slot.mesh.material as THREE.Material).dispose();
      this.group.remove(slot.mesh);
    }
  }
}
