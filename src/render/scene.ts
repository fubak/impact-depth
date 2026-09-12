import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { LookDevSettings, SimState } from '../core/types';
import { sampleSeabedY } from '../core/terrain';
import type { GameState } from '../game/sim/types';
import { getWorld } from '../game/world/queries';
import { worldCacheKey } from '../game/world/definition';
import { packWorldHeightTexture } from './environment/terrain-texture';
import {
  entityDepthY,
  metersToEntityY,
  simToWorldMeters,
  SURFACE_SPLASH_Y,
} from './presentation/coordinates';
import { Atmosphere } from './atmosphere';
import {
  AssetRegistry,
  fleetClassScale,
  simKindToAssetEntity,
  type AssetEntity,
  type AssetMeshSource,
} from './assets';
import { IslandField } from './islands';
import { updateEntityLods, wrapWithLod } from './lod';
import { EnvironmentController } from './environment/controller';
import { WeatherController, presentationOcean } from './environment/weather';
import { Ocean } from './ocean';
import { GerstnerBackend } from './ocean/gerstner-backend';
import { createSpectralBackend, SpectralBackend } from './ocean/spectral-backend';
import { Seabed } from './seabed';
import {
  createDestroyer,
  createMerchant,
  createPatrolBoat,
  createCruiser,
  createBattleship,
  createUboat,
  createAircraft,
  createFob,
  createTorpedo,
  createCrate,
  createSubmarine,
  createWakeRibbon,
} from './vessels';
import { VfxPool } from './vfx';
import type { QualityProfile } from './quality';

type LabelKind = 'own' | 'contact';

type ShipVisual = { mesh: THREE.Group; wake: THREE.Mesh; beacon: THREE.Mesh; hit: THREE.Mesh };

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly ocean: Ocean;
  readonly environment: EnvironmentController;
  readonly seabed: Seabed;
  readonly atmosphere: Atmosphere;
  readonly islands: IslandField;
  readonly sub: THREE.Group;
  private readonly shipEntities = new Map<string, ShipVisual>();
  private readonly entities = new Map<string, THREE.Group>();
  private readonly assets = new AssetRegistry();
  private readonly vfx = new VfxPool(120);
  readonly rangeRings: THREE.Group;
  readonly labelsRoot = new THREE.Group();
  readonly tacticalGrid: THREE.GridHelper;
  private readonly labelSprites = new Map<string, THREE.Sprite>();
  private envMap: THREE.Texture | null = null;
  private readonly subHit: THREE.Mesh;
  private readonly subBeacon: THREE.Mesh;
  private heightFieldKey = '';
  private glRenderer: THREE.WebGLRenderer | null = null;
  private envQuality: QualityProfile['name'] = 'high';
  private reducedMotion = false;
  private readonly weather = new WeatherController();

  constructor() {
    this.scene.background = new THREE.Color(0xd5efff);

    this.atmosphere = new Atmosphere();
    this.scene.add(this.atmosphere.group);

    this.seabed = new Seabed(440, 100);
    this.seabed.mesh.frustumCulled = false;
    this.scene.add(this.seabed.mesh);

    this.islands = new IslandField();
    this.scene.add(this.islands.group);

    // Stable transform shell; mesh children appear only after asset preload settles
    // so there is no procedural → glTF flash on the player boat.
    this.sub = new THREE.Group();
    this.sub.name = 'player-submarine';
    this.sub.userData.pickId = 'player';
    this.sub.userData.assetKind = 'sub_nautilus';
    this.sub.userData.assetSource = 'pending';
    this.sub.renderOrder = 1;
    this.sub.visible = false;
    this.scene.add(this.sub);

    this.subHit = this.createPickVolume('player', 4.5);
    this.subBeacon = this.createBeacon(0xbd8b4e);
    this.scene.add(this.subHit, this.subBeacon);

    // Transparent water after opaque littoral + vessels
    this.ocean = new Ocean(720, 220);
    this.scene.add(this.ocean.mesh);
    const gerstner = new GerstnerBackend(this.ocean);
    this.environment = new EnvironmentController({
      backend: gerstner,
      requestedBackend: 'gerstner',
      factory: async (name, signal) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (name === 'spectral') {
          if (!this.glRenderer) {
            throw new Error('spectral backend requires an injected WebGLRenderer');
          }
          return createSpectralBackend(
            {
              renderer: this.glRenderer,
              ocean: this.ocean,
              quality: this.envQuality,
              worldVersion: this.environment.getDiagnostics().worldVersion,
              requestedBackend: 'spectral',
              seed: 19,
            },
            signal,
          );
        }
        return new GerstnerBackend(this.ocean, {
          requestedBackend: 'gerstner',
          worldVersion: this.environment.getDiagnostics().worldVersion,
        });
      },
    });

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
    this.scene.add(this.vfx.group);
    void this.assets.preload().then(() => {
      this.mountPlayerMesh();
      this.refreshShipMeshesFromAssets();
    });
  }

  /** Settles when the asset registry has finished the first preload pass. */
  whenAssetsReady(): Promise<void> {
    return this.assets.whenReady;
  }

  getAssetLicenses(): ReadonlyArray<{
    id: string;
    source: string;
    license: string;
    usage: string;
  }> {
    return this.assets.licenses;
  }

  private mountPlayerMesh(): void {
    const gltf = this.assets.clone('sub_nautilus');
    const detail = gltf ?? createSubmarine();
    if (!gltf) {
      detail.userData.assetKind = 'sub_nautilus';
      detail.userData.assetSource = 'procedural';
    }
    detail.scale.setScalar(1);
    detail.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.metalness = Math.min(material.metalness, 0.2);
          material.roughness = Math.max(material.roughness, 0.55);
          material.envMapIntensity = 0.7;
          if (material.emissiveIntensity < 0.2) {
            material.emissive.copy(material.color).multiplyScalar(0.4);
            material.emissiveIntensity = 0.28;
          }
        }
      });
    });
    const playerSub = wrapWithLod(detail, this.assets.getLodDistances());
    playerSub.userData.pickId = 'player';
    this.sub.clear();
    this.sub.add(playerSub);
    this.sub.userData.pickId = 'player';
    this.sub.userData.assetKind = 'sub_nautilus';
    this.sub.userData.assetSource = gltf ? 'gltf' : 'procedural';
    this.sub.userData.hasLod = true;
    this.sub.visible = true;
  }

  /** After preload, rebuild contact meshes that had to use procedural fall-through. */
  private refreshShipMeshesFromAssets(): void {
    for (const [id, entity] of this.shipEntities) {
      if (entity.mesh.userData.assetSource === 'gltf') continue;
      const kind = entity.mesh.userData.assetKind as AssetEntity | undefined;
      if (!kind || !this.assets.hasGltf(kind)) continue;
      const scale = (entity.mesh.userData.classScale as number) || 1;
      const next = this.resolveEntityMesh(kind, scale);
      this.tagPickId(next, id);
      next.position.copy(entity.mesh.position);
      next.rotation.copy(entity.mesh.rotation);
      next.renderOrder = entity.mesh.renderOrder;
      this.scene.remove(entity.mesh);
      this.disposeGroup(entity.mesh);
      this.scene.add(next);
      entity.mesh = next;
    }
  }

  private createBeacon(color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.55, 28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 20;
    mesh.frustumCulled = false;
    return mesh;
  }

  private createPickVolume(pickId: string, radius: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    mesh.userData.pickId = pickId;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Raycast pick against player + contact hulls / pick volumes. */
  pickShipId(raycaster: THREE.Raycaster): string | null {
    const roots: THREE.Object3D[] = [this.sub, this.subHit];
    for (const entity of this.shipEntities.values()) {
      roots.push(entity.mesh, entity.hit);
    }
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const id = object.userData.pickId as string | undefined;
        if (id && id !== 'player') return id;
        object = object.parent;
      }
    }
    return null;
  }

  private tagPickId(root: THREE.Object3D, pickId: string): void {
    root.userData.pickId = pickId;
    root.traverse((object) => {
      object.userData.pickId = pickId;
      if (object instanceof THREE.Mesh) {
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (
            material instanceof THREE.MeshStandardMaterial ||
            material instanceof THREE.MeshPhysicalMaterial
          ) {
            // Soft underlight so surface hulls still read through water from depth.
            if (material.emissiveIntensity < 0.2) {
              material.emissive.setHex(0x1c3038);
              material.emissiveIntensity = 0.28;
            }
          }
        }
      }
    });
  }

  /** Dense volume fog when the eye is below the sea plane. */
  applyImmersion(camera: THREE.Camera): void {
    const y = camera.position.y;
    if (y >= 0.85) return;
    const t = THREE.MathUtils.clamp((0.85 - y) / 12, 0, 1);
    const fog = new THREE.Color().setRGB(0.02, 0.1, 0.13);
    this.scene.background = fog;
    this.scene.fog = new THREE.FogExp2(fog.getHex(), 0.02 + t * 0.065);
    this.atmosphere.hemi.groundColor.setRGB(0.03, 0.1, 0.11);
    this.atmosphere.hemi.intensity *= 1 - t * 0.5;
    this.atmosphere.ambient.intensity *= 1 - t * 0.35;
  }

  /** Soft studio IBL so MeshStandard hulls/land respond without going black. */
  bindEnvironment(renderer: THREE.WebGLRenderer): void {
    this.glRenderer = renderer;
    if (this.envMap) return;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.95;
    pmrem.dispose();
  }

  setQuality(profile: QualityProfile): void {
    this.envQuality = profile.name;
    this.environment.setQuality(profile.name);
    this.vfx.setCap(profile.particleCap);
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  get weatherLightning(): number {
    return this.weather.lastLightning;
  }

  resetEnvironment(missionGeneration: number): void {
    this.weather.reset();
    this.atmosphere.reset();
    this.environment.reset(missionGeneration);
  }

  resize(width: number, height: number, dpr = 1): void {
    this.environment.resize(width, height, dpr);
  }

  /** CheapWater ripple normals — must run with the same camera as the main pass. */
  preRenderWater(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const backend = this.environment.current;
    if (backend instanceof GerstnerBackend || backend instanceof SpectralBackend) {
      backend.bindPassTargets(renderer, camera);
    }
    this.environment.renderPasses();
    updateEntityLods(this.sub, camera);
    for (const entity of this.shipEntities.values()) {
      updateEntityLods(entity.mesh, camera);
    }
    for (const entity of this.entities.values()) {
      updateEntityLods(entity, camera);
    }
  }

  private bindWorldHeight(game: GameState): void {
    const world = getWorld(game.worldVersion, game.terrainSeed);
    const key = worldCacheKey(world.version, world.seed, world.size);
    if (key === this.heightFieldKey) return;
    this.heightFieldKey = key;
    const packed = packWorldHeightTexture(world);
    const backend = this.environment.current;
    if (backend instanceof GerstnerBackend) backend.bindHeightField(packed);
    else this.ocean.bindHeightField(packed);
  }

  /** Full game registry projection. IDs determine lifetime; no visual object feeds game state. */
  syncGame(game: GameState, sim: SimState, settings: LookDevSettings, dt = 1 / 60): void {
    this.bindWorldHeight(game);
    // Advance from look-dev phase (default ~Caribbean noon), not midnight at t=0.
    const dayPhase = (settings.atmosphere.timeOfDay + (game.time % 480) / 480) % 1;
    this.sync(sim, settings, dayPhase, game.selectedTargetId, dt);
    const active = new Set<string>();
    const add = (
      id: string,
      kind: AssetEntity,
      x: number,
      y: number,
      z: number,
      heading = 0,
    ): void => {
      active.add(id);
      let entity = this.entities.get(id);
      if (!entity) {
        entity = this.resolveEntityMesh(kind);
        this.entities.set(id, entity);
        this.scene.add(entity);
      }
      entity.position.set(x, y, z);
      entity.rotation.y = -heading;
    };
    for (const torpedo of game.torpedoes) {
      const p = simToWorldMeters(torpedo.x, torpedo.y);
      add(`torpedo:${torpedo.id}`, 'torpedo', p.x, entityDepthY(torpedo.z), p.z, torpedo.heading);
      this.vfx.emit(
        'wake',
        new THREE.Vector3(
          p.x - Math.cos(torpedo.heading),
          SURFACE_SPLASH_Y,
          p.z - Math.sin(torpedo.heading),
        ),
        game.time,
      );
    }
    for (const charge of game.depthCharges) {
      const p = simToWorldMeters(charge.x, charge.y);
      add(`charge:${charge.id}`, 'torpedo', p.x, entityDepthY(charge.z), p.z);
      if (charge.fuse < 0.35)
        this.vfx.emit('plume', new THREE.Vector3(p.x, entityDepthY(charge.z), p.z), game.time);
    }
    for (const aircraft of game.aircraft.filter((a) => a.active)) {
      const p = simToWorldMeters(aircraft.x, aircraft.y);
      add(`aircraft:${aircraft.id}`, 'aircraft', p.x, 18, p.z, aircraft.heading);
    }
    for (const powerup of game.powerups) {
      const p = simToWorldMeters(powerup.x, powerup.y);
      add(`powerup:${powerup.id}`, 'crate', p.x, SURFACE_SPLASH_Y, p.z);
    }
    const base = simToWorldMeters(game.base.x, game.base.y);
    add('fob:argus', 'fob_argus', base.x, 0.5, base.z);
    for (const [id, entity] of this.entities) {
      if (!active.has(id)) {
        this.scene.remove(entity);
        this.disposeGroup(entity);
        this.entities.delete(id);
      }
    }
    this.vfx.update(game.time);
  }

  private createFallback(kind: AssetEntity): THREE.Group {
    let mesh: THREE.Group;
    switch (kind) {
      case 'patrol':
        mesh = createPatrolBoat();
        break;
      case 'destroyer':
        mesh = createDestroyer();
        break;
      case 'freighter':
        mesh = createMerchant();
        break;
      case 'cruiser':
        mesh = createCruiser();
        break;
      case 'battleship':
        mesh = createBattleship();
        break;
      case 'uboat':
        mesh = createUboat();
        break;
      case 'aircraft':
        mesh = createAircraft();
        break;
      case 'fob_argus':
        mesh = createFob();
        break;
      case 'torpedo':
        mesh = createTorpedo();
        break;
      case 'crate':
        mesh = createCrate();
        break;
      case 'sub_nautilus':
      default:
        mesh = createSubmarine();
        break;
    }
    mesh.userData.assetKind = kind;
    mesh.userData.assetSource = 'procedural';
    return mesh;
  }

  private resolveEntityMesh(kind: AssetEntity, classScale = 1): THREE.Group {
    const gltf = this.assets.clone(kind);
    const detail = gltf ?? this.createFallback(kind);
    const mesh = wrapWithLod(detail, this.assets.getLodDistances());
    mesh.scale.setScalar(classScale);
    mesh.userData.classScale = classScale;
    mesh.userData.assetKind = kind;
    mesh.userData.assetSource = gltf ? 'gltf' : 'procedural';
    return mesh;
  }

  /** Dev probe: registry load report + live contact mesh sources. */
  getAssetProbe(simShips?: Array<{ id: string; kind: string }>) {
    const contacts = [...this.shipEntities.entries()].map(([id, entity]) => ({
      id,
      assetKind: (entity.mesh.userData.assetKind as string) ?? null,
      assetSource: (entity.mesh.userData.assetSource as AssetMeshSource | undefined) ?? 'missing',
      classScale: (entity.mesh.userData.classScale as number | undefined) ?? null,
      hasLod: Boolean(entity.mesh.userData.hasLod ?? entity.mesh.userData.lod),
    }));
    const expected = (simShips ?? []).map((ship) => {
      const assetKind = simKindToAssetEntity(
        ship.kind as
          'sub' | 'uboat' | 'merchant' | 'patrol' | 'destroyer' | 'cruiser' | 'battleship',
      );
      return {
        id: ship.id,
        simKind: ship.kind,
        assetKind,
        registry: this.assets.hasGltf(assetKind) ? 'gltf' : 'missing',
      };
    });
    return {
      loaded: this.assets.getLoadReport(),
      lodDistancesM: this.assets.getLodDistances(),
      licenses: this.assets.licenses.map((entry) => ({
        id: entry.id,
        license: entry.license,
        usage: entry.usage,
      })),
      player: {
        assetKind: (this.sub.userData.assetKind as string) ?? 'sub_nautilus',
        assetSource: (this.sub.userData.assetSource as AssetMeshSource | undefined) ?? 'procedural',
        hasLod: Boolean(this.sub.userData.hasLod),
        visible: this.sub.visible,
      },
      contacts,
      expected,
    };
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

  sync(
    sim: SimState,
    settings: LookDevSettings,
    timeOfDay = (settings.atmosphere.timeOfDay + (sim.time % 480) / 480) % 1,
    selectedTargetId: string | null = null,
    dt = 1 / 60,
  ): void {
    const historyDt = sim.paused ? 0 : dt;
    const weather = this.weather.step({
      dt: historyDt,
      paused: sim.paused,
      reducedMotion: this.reducedMotion,
      ocean: settings.ocean,
      atmosphere: settings.atmosphere,
    });
    const atmo = this.atmosphere.apply(
      { ...settings.atmosphere, timeOfDay },
      this.scene,
      historyDt,
      {
        cloudCoverage: weather.gains.cloudCoverage,
        lightning: this.reducedMotion ? 0 : weather.lightning,
        fogDensity: weather.gains.fogDensity,
      },
    );
    // Soften world fog while deep so surface contacts stay readable from below.
    if (this.scene.fog instanceof THREE.FogExp2 && sim.vessel.depth > 2.5) {
      const punch = Math.min(0.78, (sim.vessel.depth - 2.5) / 14);
      this.scene.fog.density = weather.gains.fogDensity * (1 - punch * 0.72);
    }
    const seeHull = sim.vessel.depth > 3 ? Math.min(0.55, (sim.vessel.depth - 3) / 18) : 0;
    this.seabed.follow(sim.vessel.x, sim.vessel.z, settings.environment);
    this.islands.applyEnvironment(settings.environment);

    const v = sim.vessel;
    const selectedId = selectedTargetId;
    const spectralBoost = this.environment.getDiagnostics().backend === 'spectral' ? 1.28 : 1;
    const seabedY = sampleSeabedY(v.x, v.z);
    const rawSubY = metersToEntityY(v.depth) + v.heave * spectralBoost;
    // Keep the hull above the bathymetry mesh at every depth order.
    const subY = Math.max(rawSubY, seabedY + 1.6);
    this.sub.position.set(v.x, subY, v.z);
    this.sub.rotation.order = 'YXZ';
    this.sub.rotation.y = -v.heading;
    this.sub.rotation.x = v.pitch * (v.depth < 4 ? 1 : 0.35);
    this.sub.rotation.z = v.roll * (v.depth < 4 ? 1 : 0.35);

    const peri = sim.viewMode === 'periscope';
    // Hide the shell until preload mounts a mesh (avoids empty shell + procedural flash).
    this.sub.visible = this.sub.userData.assetSource !== 'pending';
    this.sub.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshBasicMaterial
        ) {
          material.transparent = peri || v.depth > 4;
          material.opacity = peri ? 0.35 : 1;
          material.depthWrite = !peri;
          if ('emissiveIntensity' in material) {
            const depthGlow = 0.4 + Math.min(0.9, Math.max(0, v.depth - 1) * 0.055);
            material.emissiveIntensity = Math.max(material.emissiveIntensity, depthGlow);
            if (material instanceof THREE.MeshStandardMaterial && v.depth > 6) {
              material.emissive.setHex(0x2a6a78);
            }
          }
        }
      }
    });
    this.subHit.position.copy(this.sub.position);
    // Dual cue: surface ring always, plus a hull-tied ring so deep boats stay locatable.
    this.subBeacon.position.set(v.x, Math.max(subY + 3.5, 1.2), v.z);
    this.subBeacon.visible = true;
    const deep = Math.max(0, v.depth - 2);
    const beaconScale = 1.15 + Math.min(2.2, deep * 0.1);
    this.subBeacon.scale.setScalar(beaconScale);
    (this.subBeacon.material as THREE.MeshBasicMaterial).opacity =
      0.65 + Math.min(0.35, deep * 0.04);

    const active = new Set(sim.ships.map((ship) => ship.id));
    for (const [id, entity] of this.shipEntities) {
      if (!active.has(id)) {
        this.scene.remove(entity.mesh, entity.wake, entity.beacon, entity.hit);
        this.disposeGroup(entity.mesh);
        entity.wake.geometry.dispose();
        (entity.wake.material as THREE.Material).dispose();
        entity.beacon.geometry.dispose();
        (entity.beacon.material as THREE.Material).dispose();
        entity.hit.geometry.dispose();
        (entity.hit.material as THREE.Material).dispose();
        this.shipEntities.delete(id);
      }
    }
    const bodies = [
      { mesh: this.sub, heading: v.heading, speed: v.speed, length: 7, yLift: 0.05, own: true },
    ];
    for (const ship of sim.ships) {
      let entity = this.shipEntities.get(ship.id);
      if (!entity) {
        const assetKind = simKindToAssetEntity(ship.kind);
        const scale = fleetClassScale(ship.kind);
        const mesh = this.resolveEntityMesh(assetKind, scale);
        this.tagPickId(mesh, ship.id);
        const wake = createWakeRibbon();
        const beacon = this.createBeacon(0x8f9a94);
        const hit = this.createPickVolume(ship.id, ship.kind === 'merchant' ? 7 : 5.5 * scale);
        mesh.renderOrder = 3;
        wake.renderOrder = 4;
        this.scene.add(mesh, wake, beacon, hit);
        entity = { mesh, wake, beacon, hit };
        this.shipEntities.set(ship.id, entity);
      }
      const selected = ship.id === selectedId;
      // Look-dev projects game `sub` → visual `uboat` with a submerged depth.
      const submerged = ship.kind === 'uboat' ? Math.max(ship.depth, 8) : 0;
      const shipY =
        submerged > 0 ? -submerged + ship.heave * 0.12 * spectralBoost : ship.heave * spectralBoost;
      entity.mesh.position.set(ship.x, shipY, ship.z);
      entity.mesh.rotation.order = 'YXZ';
      entity.mesh.rotation.set(ship.pitch, -ship.heading, ship.roll);
      entity.mesh.visible = true;
      entity.mesh.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial && submerged > 0) {
            material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.45);
            material.emissive.setHex(0x3a6a78);
          }
        }
      });
      entity.hit.position.copy(entity.mesh.position);
      // Keep pick volume tall enough to catch clicks from submerged cameras.
      entity.hit.scale.set(1, 1 + Math.min(2.5, deep * 0.12 + submerged * 0.04), 1);
      entity.beacon.position.set(
        ship.x,
        Math.max(entity.mesh.position.y + (submerged > 0 ? 4 : 6), submerged > 0 ? 0.8 : 4),
        ship.z,
      );
      entity.beacon.visible = true;
      entity.beacon.scale.setScalar(beaconScale * (selected ? 1.25 : submerged > 0 ? 1.15 : 1));
      (entity.beacon.material as THREE.MeshBasicMaterial).color.setHex(
        selected ? 0xbd8b4e : submerged > 0 ? 0x5ec4c8 : 0x8f9a94,
      );
      (entity.beacon.material as THREE.MeshBasicMaterial).opacity = selected
        ? 0.98
        : submerged > 0
          ? 0.72
          : 0.5 + Math.min(0.4, deep * 0.035);
      bodies.push({
        mesh: entity.mesh,
        heading: ship.heading,
        speed: ship.speed,
        length: ship.kind === 'merchant' ? 12 : 10,
        yLift: 0.06,
        own: false,
      });
    }
    bodies.forEach((b) => {
      const wake = b.own
        ? undefined
        : [...this.shipEntities.values()].find((entity) => entity.mesh === b.mesh)?.wake;
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

    this.atmosphere.follow(v.x, v.z);
    this.rangeRings.position.set(v.x, 0, v.z);
    this.tacticalGrid.position.set(v.x, 0.04, v.z);

    // Interactive wake ripples (CheapWater) from own boat + contacts.
    this.environment.prepare({
      time: sim.time,
      dt: historyDt,
      paused: sim.paused,
      reducedMotion: this.reducedMotion,
      ocean: presentationOcean(settings.ocean, weather.preset),
      fogDensity: weather.gains.fogDensity,
      fogColor: { r: atmo.fogColor.r, g: atmo.fogColor.g, b: atmo.fogColor.b },
      sunDir: { x: atmo.sunDir.x, y: atmo.sunDir.y, z: atmo.sunDir.z },
      sunColor: { r: atmo.sunColor.r, g: atmo.sunColor.g, b: atmo.sunColor.b },
      skyColor: { r: atmo.skyTop.r, g: atmo.skyTop.g, b: atmo.skyTop.b },
      sandColorHex: settings.environment.sandColor,
      followX: v.x,
      followZ: v.z,
      readability: {
        clarity: Math.min(1, settings.ocean.clarity + seeHull * 0.45),
        absorption: Math.max(0.12, settings.ocean.absorption * (1 - seeHull * 0.55)),
      },
      wakes: [
        {
          x: v.x,
          z: v.z,
          heading: v.heading,
          speed: v.depth < 2.8 ? v.speed : 0,
          stern: 5,
        },
        ...sim.ships.map((ship) => ({
          x: ship.x,
          z: ship.z,
          heading: ship.heading,
          speed: ship.speed,
          stern: ship.kind === 'merchant' ? 9 : 7,
        })),
      ],
    });

    this.rangeRings.visible = sim.viewMode === 'tactical';
    this.tacticalGrid.visible = sim.viewMode === 'tactical' && settings.presentation.tacticalGrid;
    // Contact labels stay on in every non-periscope view so ships remain identifiable at depth.
    this.labelsRoot.visible = !peri && settings.presentation.labelDensity > 0.08;

    if (this.labelsRoot.visible) {
      const dens = Math.max(0.35, settings.presentation.labelDensity);
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
          y: Math.max(subY + 5, subY + 2.5),
          z: v.z + ownOffZ,
          show: dens > 0.12,
        },
      ];
      for (const s of sim.ships) {
        entries.push({
          id: s.id,
          text: s.name,
          kind: 'contact',
          x: s.x,
          y: Math.max(9.5, 6 + deep * 0.15),
          z: s.z,
          show: true,
        });
      }
      for (const e of entries) {
        const spr = this.ensureLabel(e.id, e.text, e.kind);
        spr.visible = e.show;
        spr.position.set(e.x, e.y, e.z);
        (spr.material as THREE.SpriteMaterial).opacity = 0.55 + dens * 0.35;
        (spr.material as THREE.SpriteMaterial).depthTest = false;
      }
    }
  }

  dispose(): void {
    this.weather.reset();
    this.environment.dispose();
    this.ocean.dispose();
    this.seabed.dispose();
    this.islands.dispose();
    this.atmosphere.dispose();
    this.envMap?.dispose();
    this.envMap = null;
    this.scene.environment = null;
    this.disposeGroup(this.sub);
    for (const entity of this.shipEntities.values()) {
      this.disposeGroup(entity.mesh);
      entity.wake.geometry.dispose();
      (entity.wake.material as THREE.Material).dispose();
      entity.beacon.geometry.dispose();
      (entity.beacon.material as THREE.Material).dispose();
      entity.hit.geometry.dispose();
      (entity.hit.material as THREE.Material).dispose();
    }
    for (const entity of this.entities.values()) this.disposeGroup(entity);
    this.vfx.dispose();
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

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.userData.fromGltf) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}
