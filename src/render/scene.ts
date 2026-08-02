import * as THREE from 'three';
import type { LookDevSettings, SimState } from '../core/types';
import { Atmosphere } from './atmosphere';
import { IslandField } from './islands';
import { Ocean } from './ocean';
import { Seabed } from './seabed';
import {
  createDestroyer,
  createMerchant,
  createSubmarine,
  createWakeRibbon,
} from './vessels';

type LabelKind = 'own' | 'contact';

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly ocean: Ocean;
  readonly seabed: Seabed;
  readonly atmosphere: Atmosphere;
  readonly islands: IslandField;
  readonly sub: THREE.Group;
  private readonly shipEntities = new Map<string, { mesh: THREE.Group; wake: THREE.Mesh }>();
  readonly rangeRings: THREE.Group;
  readonly labelsRoot = new THREE.Group();
  readonly tacticalGrid: THREE.GridHelper;
  private readonly labelSprites = new Map<string, THREE.Sprite>();

  constructor() {
    this.scene.background = new THREE.Color(0xd5efff);

    this.atmosphere = new Atmosphere();
    this.scene.add(this.atmosphere.group);

    this.seabed = new Seabed(440, 100);
    this.seabed.mesh.frustumCulled = false;
    this.scene.add(this.seabed.mesh);

    this.islands = new IslandField();
    this.scene.add(this.islands.group);

    this.sub = createSubmarine();
    this.sub.renderOrder = 1;
    this.scene.add(this.sub);

    // Transparent water after opaque littoral + vessels
    this.ocean = new Ocean(560, 200);
    this.scene.add(this.ocean.mesh);


    this.rangeRings = new THREE.Group();
    this.rangeRings.name = 'rangeRings';
    for (const r of [30, 60, 100]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.06, r + 0.06, 128),
        new THREE.MeshBasicMaterial({
          color: 0x4a6a72,
          transparent: true,
          opacity: 0.055,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08;
      ring.renderOrder = 5;
      this.rangeRings.add(ring);
    }
    this.scene.add(this.rangeRings);

    this.tacticalGrid = new THREE.GridHelper(240, 24, 0x5a8a92, 0x3a6068);
    this.tacticalGrid.position.y = 0.04;
    const mats = this.tacticalGrid.material;
    if (Array.isArray(mats)) {
      mats.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.07;
      });
    } else {
      mats.transparent = true;
      mats.opacity = 0.07;
    }
    this.scene.add(this.tacticalGrid);
    this.scene.add(this.labelsRoot);
  }

  private ensureLabel(id: string, text: string, kind: LabelKind): THREE.Sprite {
    let sprite = this.labelSprites.get(id);
    if (!sprite) {
      const canvas = document.createElement('canvas');
      canvas.width = 220;
      canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 220, 32);
      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(7,11,12,0.65)';
      ctx.fillText(text, 111, 17);
      ctx.fillStyle = kind === 'own' ? '#bd8b4e' : '#8f9a94';
      ctx.fillText(text, 110, 16);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      sprite = new THREE.Sprite(mat);
      sprite.scale.set(6.2, 0.9, 1);
      sprite.renderOrder = 6;
      this.labelSprites.set(id, sprite);
      this.labelsRoot.add(sprite);
    }
    return sprite;
  }

  sync(sim: SimState, settings: LookDevSettings): void {
    const atmo = this.atmosphere.apply(settings.atmosphere, this.scene);
    this.ocean.update(
      sim.time,
      settings.ocean,
      settings.atmosphere.fogDensity,
      atmo.fogColor,
      atmo.sunDir,
      atmo.sunColor,
      atmo.skyTop,
    );
    this.ocean.mesh.visible = true;
    this.seabed.follow(sim.vessel.x, sim.vessel.z, settings.environment);
    this.islands.applyEnvironment(settings.environment);

    const v = sim.vessel;
    const subY = -v.depth + v.heave * (v.depth < 3 ? 0.35 : 0.08);
    this.sub.position.set(v.x, subY, v.z);
    this.sub.rotation.order = 'YXZ';
    this.sub.rotation.y = -v.heading;
    this.sub.rotation.x = v.pitch * (v.depth < 4 ? 1 : 0.35);
    this.sub.rotation.z = v.roll * (v.depth < 4 ? 1 : 0.35);

    const peri = sim.viewMode === 'periscope';
    this.sub.visible = !peri;

    const active = new Set(sim.ships.map((ship) => ship.id));
    for (const [id, entity] of this.shipEntities) {
      if (!active.has(id)) {
        this.scene.remove(entity.mesh, entity.wake);
        entity.mesh.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            (object.material as THREE.Material).dispose();
          }
        });
        entity.wake.geometry.dispose();
        (entity.wake.material as THREE.Material).dispose();
        this.shipEntities.delete(id);
      }
    }
    const bodies = [{ mesh: this.sub, heading: v.heading, speed: v.speed, length: 7, yLift: 0.05, own: true }];
    for (const ship of sim.ships) {
      let entity = this.shipEntities.get(ship.id);
      if (!entity) {
        const mesh = ship.kind === 'destroyer' ? createDestroyer() : createMerchant();
        const wake = createWakeRibbon();
        mesh.renderOrder = 3;
        wake.renderOrder = 4;
        this.scene.add(mesh, wake);
        entity = { mesh, wake };
        this.shipEntities.set(ship.id, entity);
      }
      entity.mesh.position.set(ship.x, ship.heave * 0.9 + 0.5, ship.z);
      entity.mesh.rotation.order = 'YXZ';
      entity.mesh.rotation.set(ship.pitch, -ship.heading, ship.roll);
      bodies.push({ mesh: entity.mesh, heading: ship.heading, speed: ship.speed, length: ship.kind === 'merchant' ? 12 : 10, yLift: 0.06, own: false });
    }
    bodies.forEach((b) => {
      const wake = b.own ? undefined : [...this.shipEntities.values()].find((entity) => entity.mesh === b.mesh)?.wake;
      if (!b.own && !wake) return;
      const actualWake = wake ?? new THREE.Mesh();
      if (b.own) return;
      const stern = b.length * 0.55;
      const wx = b.mesh.position.x - Math.cos(b.heading) * stern;
      const wz = b.mesh.position.z - Math.sin(b.heading) * stern;
      const wy = Math.max(0.05, b.yLift + (b.own ? 0 : Math.max(0, b.mesh.position.y) * 0.02));
      actualWake.position.set(wx, wy, wz);
      actualWake.rotation.y = -b.heading;
      const mat = actualWake.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(0.26, 0.05 + b.speed * 0.025);
      const stretch = 0.75 + b.speed * 0.05;
      actualWake.scale.set(stretch, 1, 0.85 + b.speed * 0.03);
      const ownWakeOk = !peri && v.depth < 2.5;
      actualWake.visible = b.speed > 0.4 && (b.own ? ownWakeOk : true);
    });

    this.ocean.follow(v.x, v.z);
    this.atmosphere.follow(v.x, v.z);
    this.rangeRings.position.set(v.x, 0, v.z);
    this.tacticalGrid.position.set(v.x, 0.04, v.z);

    const tactical = sim.viewMode === 'tactical';
    this.rangeRings.visible = tactical;
    this.tacticalGrid.visible = tactical && settings.presentation.tacticalGrid;
    this.labelsRoot.visible = tactical && settings.presentation.labelDensity > 0.15;

    if (this.labelsRoot.visible) {
      const dens = settings.presentation.labelDensity;
      const ownOffX = -Math.sin(v.heading) * 6 - Math.cos(v.heading) * 4;
      const ownOffZ = Math.cos(v.heading) * 6 - Math.sin(v.heading) * 4;
      const entries: Array<{
        id: string;
        text: string;
        kind: LabelKind;
        x: number;
        y: number;
        z: number;
        show: boolean;
      }> = [
        {
          id: 'own',
          text: 'NAUTILUS',
          kind: 'own',
          x: v.x + ownOffX,
          y: Math.max(subY + 4, 2.5),
          z: v.z + ownOffZ,
          show: dens > 0.12,
        },
      ];
      sim.ships.forEach((s, i) => {
        entries.push({
          id: s.id,
          text: s.name,
          kind: 'contact',
          x: s.x,
          y: 8.5,
          z: s.z,
          show: dens > 0.5 || (dens > 0.38 && i === 0),
        });
      });
      for (const e of entries) {
        const spr = this.ensureLabel(e.id, e.text, e.kind);
        spr.visible = e.show;
        spr.position.set(e.x, e.y, e.z);
        (spr.material as THREE.SpriteMaterial).opacity = 0.5 + dens * 0.35;
      }
    }
  }

  dispose(): void {
    this.ocean.dispose();
    this.seabed.dispose();
    this.islands.dispose();
    this.atmosphere.dispose();
    for (const entity of this.shipEntities.values()) {
      entity.mesh.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      entity.wake.geometry.dispose();
      (entity.wake.material as THREE.Material).dispose();
    }
    this.rangeRings.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    for (const spr of this.labelSprites.values()) {
      const mat = spr.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  }
}
