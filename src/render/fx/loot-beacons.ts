/**
 * Loot beacons: a light beam and a pulsing ground ring over each rare or epic
 * crate, plus a tint and size bump on the crate mesh itself. Presentation only.
 *
 * `LootBeacons` shares one beam and one ring geometry and four materials (beam
 * and ring for rare and epic), so an existing id allocates nothing per frame.
 * No `THREE.Light` is added: a light-count change would recompile every lit
 * material. Common entries get no beacon and their crate is left as it is.
 *
 * Style numbers come from `RARITY_STYLES` (`src/game/adapt/loot-style.ts`).
 */
import * as THREE from 'three';
import {
  pulseScale,
  rarityStyle,
  RARITY_STYLES,
  type RarityStyle,
} from '../../game/adapt/loot-style';
import type { PowerupRarity } from '../../game/sim/types';

export interface LootBeaconEntry {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rarity?: PowerupRarity;
}

type BeaconRarity = Exclude<PowerupRarity, 'common'>;

interface StyleMaterials {
  readonly beam: THREE.MeshBasicMaterial;
  readonly ring: THREE.MeshBasicMaterial;
}

interface BeaconItem {
  readonly group: THREE.Group;
  readonly rarity: BeaconRarity;
  readonly ring: THREE.Mesh;
  /** Generation of the last `sync` that listed this id. */
  seen: number;
}

const RING_OPACITY = 0.7;
const BEAM_RADIUS = 0.22;
const BEAM_SEGMENTS = 10;
const RING_INNER_RADIUS = 0.85;
const RING_SEGMENTS = 32;

function makeMaterials(style: RarityStyle): StyleMaterials {
  const shared = {
    color: style.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  };
  return {
    beam: new THREE.MeshBasicMaterial({ ...shared, opacity: style.beamOpacity }),
    ring: new THREE.MeshBasicMaterial({ ...shared, opacity: RING_OPACITY }),
  };
}

/** Tints one mesh's standard materials. Returns true when at least one material was tinted. */
function glowMesh(mesh: THREE.Mesh, style: RarityStyle): boolean {
  // glTF clones share their template's materials; tint a copy so common crates stay dark.
  const copyFirst = mesh.userData.fromGltf === true;
  let styled = false;
  const glow = (material: THREE.Material): THREE.Material => {
    if (!(material instanceof THREE.MeshStandardMaterial)) return material;
    const target = copyFirst ? material.clone() : material;
    target.emissive.setHex(style.color);
    target.emissiveIntensity = style.emissive;
    styled = true;
    return target;
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(glow) : glow(mesh.material);
  return styled;
}

/**
 * Scales the crate by its rarity and pulse every frame. On first sight of a rare or
 * epic crate, tints its standard materials with the rarity emissive (once, flagged
 * in `userData.rarityStyled`). Common crates end at scale 1 with untouched materials.
 */
export function styleCrate(
  crate: THREE.Object3D,
  rarity: PowerupRarity | undefined,
  timeS: number,
  reducedMotion: boolean,
): void {
  const style = rarityStyle(rarity);
  crate.scale.setScalar(style.crateScale * pulseScale(style, timeS, reducedMotion));
  if (style.emissive === 0 || crate.userData.rarityStyled === true) return;
  let styled = false;
  crate.traverse((object) => {
    if (object instanceof THREE.Mesh && glowMesh(object, style)) styled = true;
  });
  if (styled) crate.userData.rarityStyled = true;
}

export class LootBeacons {
  readonly group = new THREE.Group();
  private readonly items = new Map<string, BeaconItem>();
  private readonly beamGeometry = new THREE.CylinderGeometry(
    BEAM_RADIUS,
    BEAM_RADIUS,
    1,
    BEAM_SEGMENTS,
    1,
    true,
  ).translate(0, 0.5, 0);
  private readonly ringGeometry = new THREE.RingGeometry(
    RING_INNER_RADIUS,
    1,
    RING_SEGMENTS,
  ).rotateX(-Math.PI / 2);
  private readonly materials: Readonly<Record<BeaconRarity, StyleMaterials>> = {
    rare: makeMaterials(RARITY_STYLES.rare),
    epic: makeMaterials(RARITY_STYLES.epic),
  };
  private generation = 0;

  constructor() {
    this.group.name = 'loot-beacons';
  }

  get count(): number {
    return this.items.size;
  }

  /** One beam and ring per rare/epic entry, keyed by id; stale ids are removed. Common entries get nothing. */
  sync(entries: readonly LootBeaconEntry[], timeS: number, reducedMotion: boolean): void {
    this.generation += 1;
    for (const entry of entries) {
      const rarity = entry.rarity ?? 'common';
      if (rarity === 'common') continue;
      let item = this.items.get(entry.id);
      if (item && item.rarity !== rarity) {
        this.remove(entry.id, item);
        item = undefined;
      }
      if (!item) {
        item = this.createItem(entry.id, rarity);
        this.items.set(entry.id, item);
      }
      item.seen = this.generation;
      item.group.position.set(entry.x, entry.y, entry.z);
      const style = RARITY_STYLES[rarity];
      item.ring.scale.setScalar(style.ringRadius * pulseScale(style, timeS, reducedMotion));
    }
    for (const [id, item] of this.items) {
      if (item.seen !== this.generation) this.remove(id, item);
    }
  }

  dispose(): void {
    this.group.clear();
    this.items.clear();
    this.beamGeometry.dispose();
    this.ringGeometry.dispose();
    for (const pair of Object.values(this.materials)) {
      pair.beam.dispose();
      pair.ring.dispose();
    }
  }

  private createItem(id: string, rarity: BeaconRarity): BeaconItem {
    const style = RARITY_STYLES[rarity];
    const materials = this.materials[rarity];
    const group = new THREE.Group();
    group.name = `loot-beacon:${id}`;
    const beam = new THREE.Mesh(this.beamGeometry, materials.beam);
    beam.name = 'beam';
    beam.scale.set(1, style.beamHeight, 1);
    const ring = new THREE.Mesh(this.ringGeometry, materials.ring);
    ring.name = 'ring';
    group.add(beam, ring);
    this.group.add(group);
    return { group, rarity, ring, seen: 0 };
  }

  private remove(id: string, item: BeaconItem): void {
    this.group.remove(item.group);
    this.items.delete(id);
  }
}
