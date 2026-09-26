import * as THREE from 'three';
import type { LookDevSettings, SimState } from '../core/types';

import type { CombatEvent } from '../game/adapt/combat-events';
import type { GameState } from '../game/sim/types';
import { worldMetersToSim } from '../game/sim/coords';
import { getWorld, worldHeight } from '../game/world/queries';
import { sampleLittoralBedMetres } from '../game/world/littoral';
import { worldCacheKey } from '../game/world/definition';
import { normalizedBedToMetres, packWorldHeightTexture } from './environment/terrain-texture';
import {
  DEFAULT_SUB_HULL_HEIGHT_M,
  entityDepthY,
  simToWorldMeters,
  SURFACE_SPLASH_Y,
  clampSurfaceHullY,
  surfaceDraftMetres,
  visualKeelY,
} from './presentation/coordinates';
import { analyzeHullWaterline, hullHeightY } from './hull-fit';
import {
  VesselAttitudeSmoother,
  attitudeSpanForKind,
  groupFootprint,
  type VesselAttitudeResult,
} from './presentation/vessel-attitude';
import { presentHullObject } from './presentation/hull-materials';
import { clampPresentationY, presentationBedY } from './presentation/world-bed';
import {
  formatSurfaceDiagnostics,
  type SurfaceDiagnostics,
} from './presentation/surface-diagnostics';
import {
  immersionFogFactor,
  playerUnderwaterSubject,
  updateImmersion,
} from './presentation/immersion';
import {
  PROBE_CADENCE_HZ,
  PROBE_SPATIAL_TOLERANCE_M,
  SurfaceProbeQueue,
  prioritizeProbeRequests,
  shouldRequestProbes,
  type SurfaceProbeMaps,
} from './ocean/surface-probes';
import { SHORE_WET_BAND_METRES } from './environment/terrain-texture';
import { DEFAULT_CASCADES } from './ocean/spectrum';
import { excludeFromWaterCapture, WaterOptics } from './ocean/optics';
import { WorldFoamSystem } from './ocean/world-foam';
import { CrestSpraySystem } from './ocean/crest-spray';
import {
  UnderwaterCaustics,
  type CausticReceiverRole,
  type CausticSurfaceMaps,
} from './ocean/caustics';
import {
  SurfaceEffects,
  type SurfaceCrestSample,
  type SurfaceWakeBody,
  type SubmergedEmitter,
} from './ocean/surface-effects';
import { Atmosphere } from './atmosphere';
import {
  AssetRegistry,
  chooseAssetSource,
  fleetClassScale,
  prefersAuthoredGltf,
  simKindToAssetEntity,
  type AssetEntity,
  type AssetMeshSource,
} from './assets';
import { IslandField } from './islands';
import { OutdoorLighting } from './environment/outdoor-lighting';
import { updateEntityLods } from './lod';
import { EnvironmentController } from './environment/controller';
import type { WorldVersion } from './environment/types';
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
import {
  combatEventBursts,
  combatEventHitLight,
  HIT_LIGHT_PULSE_S,
  torpedoTrailMarks,
  TRAIL_INTERVAL_S,
} from './presentation/combat-event-fx';
import type { QualityProfile } from './quality';

type LabelKind = 'own' | 'contact';

type ShipVisual = { mesh: THREE.Group; wake: THREE.Mesh; beacon: THREE.Mesh; hit: THREE.Mesh };

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly ocean: Ocean;
  readonly optics: WaterOptics;
  readonly caustics: UnderwaterCaustics;
  readonly surfaceEffects: SurfaceEffects;
  private readonly worldFoam = new WorldFoamSystem();
  private readonly crestSpray = new CrestSpraySystem();
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
  private readonly outdoorLighting = new OutdoorLighting();
  private readonly subHit: THREE.Mesh;
  private readonly subBeacon: THREE.Mesh;
  private heightFieldKey = '';
  private glRenderer: THREE.WebGLRenderer | null = null;
  private envQuality: QualityProfile['name'] = 'high';
  private reducedMotion = false;
  private readonly weather = new WeatherController();
  private currentTerrainSeed = 0;
  private currentWorldVersion: WorldVersion = 'legacy-v1';
  private readonly probes = new SurfaceProbeQueue(32);
  private readonly attitudes = new VesselAttitudeSmoother();
  private missionGeneration = 0;
  private probeBackendGeneration = 0;
  private lastBackendName: string | null = null;
  private lastWaterHeight: number | null = null;
  private lastSimTime = 0;
  private lastProbeIssueTime: number | null = null;
  private lastSurfaceDiagnostics: SurfaceDiagnostics | null = null;
  private immersionUnder = false;
  private playerHullPeri = false;
  private playerHullDepth = 0;
  private readonly underwaterColor = new THREE.Color(0.02, 0.1, 0.13);
  private readonly underwaterFog = new THREE.FogExp2(0x051a21, 0.02);
  private lastProbeSubjects: Array<{
    entityId: string;
    x: number;
    z: number;
    heading: number;
    span: number;
    depth: number;
  }> = [];
  private presentationTime = 0;
  private presentationPaused = false;
  private presentationWindDetail = 0.5;
  private lastSeaState = 0.32;
  private lastWaveHeight = 0.55;
  private lastSunDir = { x: 0.4, y: 0.8, z: 0.2 };
  private lastHistoryDt = 1 / 60;
  private lastEffectWakes: SurfaceWakeBody[] = [];
  private lastEffectCrests: SurfaceCrestSample[] = [];
  private lastEffectSubmerged: SubmergedEmitter[] = [];
  private readonly splashIds = new Set<string>();
  private readonly hitLights: THREE.PointLight[];
  private readonly hitPulse = [
    { until: 0, peak: 0 },
    { until: 0, peak: 0 },
  ];
  private hitCursor = 0;
  private readonly trailAt = new Map<string, number>();

  constructor() {
    this.scene.background = new THREE.Color(0xd5efff);

    this.atmosphere = new Atmosphere();
    this.scene.add(this.atmosphere.group);

    this.seabed = new Seabed(440, 100);
    this.seabed.mesh.frustumCulled = false;
    this.scene.add(this.seabed.mesh);

    this.islands = new IslandField();
    this.islands.setQuality({
      vegetationDensity: 0.8,
      vegetationLodDistance: 120,
      vegetationShadows: true,
    });
    this.scene.add(this.islands.group);

    // Stable transform shell; procedural mesh mounts immediately, then glTF hot-swaps.
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
    this.optics = new WaterOptics();
    this.caustics = new UnderwaterCaustics(this.envQuality);
    this.surfaceEffects = new SurfaceEffects({ quality: this.envQuality });
    this.scene.add(this.surfaceEffects.group);
    this.scene.add(this.crestSpray.points);
    excludeFromWaterCapture(this.crestSpray.points);
    this.caustics.attachToObject(this.seabed.mesh, 'seabed');
    this.caustics.attachToObject(this.islands.group, 'rock');
    excludeFromWaterCapture(this.surfaceEffects.group);
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
          const bedSampler = (worldX: number, worldZ: number): number => {
            const world = getWorld(this.currentWorldVersion, this.currentTerrainSeed);
            if (world.version === 'littoral-v2') {
              return sampleLittoralBedMetres(world, worldX, worldZ);
            }
            const sim = worldMetersToSim(worldX, worldZ);
            return normalizedBedToMetres(worldHeight(world, sim.x, sim.y));
          };
          return createSpectralBackend(
            {
              renderer: this.glRenderer,
              ocean: this.ocean,
              quality: this.envQuality,
              worldVersion: this.currentWorldVersion,
              requestedBackend: 'spectral',
              seed: 19,
              bedSampler,
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
    excludeFromWaterCapture(this.rangeRings);

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
    this.hitLights = [0, 1].map(() => {
      const light = new THREE.PointLight(0xffb060, 0, 48, 2);
      light.name = 'combat-hit-light';
      light.castShadow = false;
      this.scene.add(light);
      return light;
    });
    excludeFromWaterCapture(this.tacticalGrid);
    excludeFromWaterCapture(this.labelsRoot);
    excludeFromWaterCapture(this.vfx.group);
    excludeFromWaterCapture(this.subBeacon);
    excludeFromWaterCapture(this.subHit);
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
    if (this.sub.userData.assetSource === 'gltf' && this.sub.children.length > 0) return;
    const gltf = this.assets.clone('sub_nautilus');
    const source = chooseAssetSource({
      hasGltf: Boolean(gltf),
      registryReady: this.assets.isReady,
      preferGltf: prefersAuthoredGltf('sub_nautilus'),
    });
    if (source === 'pending') return;
    const detail = gltf ?? createSubmarine();
    if (!gltf) {
      detail.userData.assetKind = 'sub_nautilus';
      detail.userData.assetSource = 'procedural';
    }
    detail.scale.setScalar(1);
    presentHullObject(detail, { peri: false, depthMetres: 0 });
    const playerSub = detail;
    playerSub.userData.pickId = 'player';
    this.sub.clear();
    this.sub.add(playerSub);
    this.sub.userData.pickId = 'player';
    this.sub.userData.assetKind = 'sub_nautilus';
    this.sub.userData.assetSource = gltf ? 'gltf' : 'procedural';
    this.sub.userData.hasLod = true;
    this.sub.visible = true;
    this.sub.userData.hullHeight = hullHeightY(this.sub);
    this.sub.userData.waterlineDraft = analyzeHullWaterline(this.sub).draft;
    this.caustics.attachToObject(this.sub, 'hull');
  }

  /** After preload, rebuild contact meshes that had to use procedural fall-through. */
  private refreshShipMeshesFromAssets(): void {
    for (const [id, entity] of this.shipEntities) {
      if (entity.mesh.userData.assetSource === 'gltf') continue;
      if (entity.mesh.children.length > 0 && entity.mesh.userData.assetSource !== 'pending')
        continue;
      const kind = entity.mesh.userData.assetKind as AssetEntity | undefined;
      if (!kind) continue;
      const source = chooseAssetSource({
        hasGltf: this.assets.hasGltf(kind),
        registryReady: this.assets.isReady,
      });
      if (source === 'pending') continue;
      if (source === 'procedural' && entity.mesh.userData.assetSource === 'procedural') continue;
      if (source === 'gltf' && !this.assets.hasGltf(kind)) continue;
      const scale = (entity.mesh.userData.classScale as number) || 1;
      const next = this.resolveEntityMesh(kind, scale);
      this.tagPickId(next, id);
      next.position.copy(entity.mesh.position);
      next.rotation.copy(entity.mesh.rotation);
      next.renderOrder = entity.mesh.renderOrder;
      this.scene.remove(entity.mesh);
      this.disposeGroup(entity.mesh);
      this.scene.add(next);
      this.caustics.attachToObject(next, 'hull');
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

  /**
   * Screen-space proximity pick for tiny distant hulls. Does not use world
   * distance — empty water next to a nearby ship must still plot a waypoint.
   */
  pickShipIdNearScreen(
    clientX: number,
    clientY: number,
    canvas: DOMRect,
    camera: THREE.Camera,
    maxPixels = 28,
  ): string | null {
    let bestId: string | null = null;
    let bestDist = maxPixels;
    const ndc = new THREE.Vector3();
    for (const [id, entity] of this.shipEntities) {
      ndc.setFromMatrixPosition(entity.mesh.matrixWorld);
      ndc.project(camera);
      if (ndc.z < -1 || ndc.z > 1) continue;
      const sx = (ndc.x * 0.5 + 0.5) * canvas.width + canvas.left;
      const sy = (-ndc.y * 0.5 + 0.5) * canvas.height + canvas.top;
      const dist = Math.hypot(sx - clientX, sy - clientY);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = id;
      }
    }
    return bestId;
  }

  private tagPickId(root: THREE.Object3D, pickId: string): void {
    root.userData.pickId = pickId;
    root.traverse((object) => {
      object.userData.pickId = pickId;
      if (object instanceof THREE.Mesh) object.frustumCulled = false;
    });
  }

  /** Latest sampled (or mean-sea) height for camera immersion. Presentation only. */
  get sampledWaterHeight(): number | null {
    return this.lastWaterHeight;
  }

  /**
   * Player hull only. Contacts stay on presentHullObject without the underwater
   * subject flag, so their caustic, emissive and fog path is unchanged.
   */
  private presentPlayerHull(): void {
    presentHullObject(this.sub, {
      peri: this.playerHullPeri,
      depthMetres: this.playerHullDepth,
      underwaterSubject: playerUnderwaterSubject(
        this.immersionUnder,
        this.playerHullDepth,
        this.playerHullPeri,
      ),
    });
  }

  /** Dense volume fog when the eye is below the sampled surface (hysteresis). */
  applyImmersion(camera: THREE.Camera): void {
    const next = updateImmersion({
      eyeY: camera.position.y,
      sampledWaterHeight: this.lastWaterHeight,
      previousUnderwater: this.immersionUnder,
    });
    this.immersionUnder = next.underwater;
    this.presentPlayerHull();
    if (!next.underwater) return;
    const t = immersionFogFactor(camera.position.y, next.waterHeight, true);
    this.scene.background = this.underwaterColor;
    this.underwaterFog.color.copy(this.underwaterColor);
    this.underwaterFog.density = 0.011 + t * 0.021;
    this.scene.fog = this.underwaterFog;
    this.atmosphere.hemi.groundColor.setRGB(0.03, 0.1, 0.11);
    this.atmosphere.hemi.intensity *= 1 - t * 0.5;
    this.atmosphere.ambient.intensity *= 1 - t * 0.35;
  }

  /** Procedural outdoor PMREM aligned with sun/sky/weather (replaces studio RoomEnvironment). */
  bindEnvironment(renderer: THREE.WebGLRenderer): void {
    this.glRenderer = renderer;
    this.outdoorLighting.bind(renderer, this.scene);
  }

  invalidateForContextLoss(): void {
    this.environment.invalidateForContextLoss();
  }

  async recoverPresentationResources(
    renderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    signal: AbortSignal,
  ): Promise<void> {
    await this.environment.recover(signal);
    if (signal.aborted) throw signal.reason;
    this.outdoorLighting.dispose();
    this.outdoorLighting.bind(renderer, this.scene);
    this.optics.reset();
    this.caustics.reset(this.missionGeneration);
    await renderer.compileAsync(this.scene, camera);
    if (signal.aborted) throw signal.reason;
  }

  setQuality(profile: QualityProfile): void {
    this.envQuality = profile.name;
    this.environment.setQuality(profile.name);
    this.islands.setQuality(profile);
    this.vfx.setCap(profile.particleCap);
    this.optics.setQuality(profile.name);
    this.caustics.setQuality(profile.name);
    this.surfaceEffects.setQuality(profile.name);
  }

  getOutdoorLightingDiagnostics() {
    return this.outdoorLighting.getDiagnostics();
  }

  getVfxDiagnostics() {
    return this.vfx.getDiagnostics();
  }

  getContactHeights(): Array<{ id: string; y: number; kind: string }> {
    const rows: Array<{ id: string; y: number; kind: string }> = [];
    for (const [id, entity] of this.shipEntities) {
      rows.push({
        id,
        y: entity.mesh.position.y,
        kind: String(entity.mesh.userData.assetKind ?? ''),
      });
    }
    return rows;
  }

  /**
   * Presentation for one batch of fixed-step combat events.
   * Hit lights are the two allocated at init; this never adds a light.
   */
  playCombatEvents(events: readonly CombatEvent[], now: number): void {
    this.decayHitLights(now);
    for (const event of events) {
      for (const burst of combatEventBursts(event)) this.vfx.emitBurst(burst, now);
      const flash = combatEventHitLight(event);
      if (flash) this.pulseHitLight(flash.x, flash.y, flash.z, flash.intensity, now);
    }
  }

  private pulseHitLight(x: number, y: number, z: number, peak: number, now: number): void {
    const index = this.hitCursor % this.hitLights.length;
    this.hitCursor += 1;
    const light = this.hitLights[index]!;
    light.position.set(x, y, z);
    this.hitPulse[index] = { until: now + HIT_LIGHT_PULSE_S, peak };
    light.intensity = peak;
  }

  private decayHitLights(now: number): void {
    for (let i = 0; i < this.hitLights.length; i += 1) {
      const pulse = this.hitPulse[i]!;
      const remain = pulse.until - now;
      this.hitLights[i]!.intensity = remain > 0 ? pulse.peak * (remain / HIT_LIGHT_PULSE_S) : 0;
    }
  }

  private emitTorpedoTrail(
    id: string,
    x: number,
    y: number,
    z: number,
    heading: number,
    now: number,
  ): void {
    const last = this.trailAt.get(id);
    if (last !== undefined && now >= last && now - last < TRAIL_INTERVAL_S) return;
    this.trailAt.set(id, now);
    for (const mark of torpedoTrailMarks({ id, x, y, z, heading })) {
      this.vfx.emit(mark.kind, new THREE.Vector3(mark.x, mark.y, mark.z), now, mark.key);
    }
  }

  private pruneTorpedoTrails(liveIds: readonly string[]): void {
    const live = new Set(liveIds);
    for (const id of this.trailAt.keys()) {
      if (!live.has(id)) this.trailAt.delete(id);
    }
  }

  /** Test/gauntlet: spawn visible combat VFX + splash without advancing GameState. */
  debugBurstPresentationFx(): { vfx: ReturnType<VfxPool['getDiagnostics']>; splash: number } {
    const origin = this.sub.position;
    this.vfx.emit('explosion', origin.clone().add(new THREE.Vector3(4, 1, 2)), this.lastSimTime);
    this.vfx.emit('plume', origin.clone().add(new THREE.Vector3(-3, 0.5, 1)), this.lastSimTime);
    this.vfx.emit('pickup', origin.clone().add(new THREE.Vector3(1, 2, -2)), this.lastSimTime);
    this.surfaceEffects.emitImpact({
      x: origin.x + 6,
      y: 0.2,
      z: origin.z,
      strength: 1.4,
      kind: 'burst',
    });
    return {
      vfx: this.vfx.getDiagnostics(),
      splash: this.surfaceEffects.getDiagnostics().splashAlive,
    };
  }

  getSurfaceDiagnostics(): SurfaceDiagnostics | null {
    return this.lastSurfaceDiagnostics;
  }

  formatSurfaceDiagnostics(): string | null {
    return this.lastSurfaceDiagnostics
      ? formatSurfaceDiagnostics(this.lastSurfaceDiagnostics)
      : null;
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    this.surfaceEffects.setReducedMotion(value);
  }

  /** Apply URL/runtime world before spectral backend activation. */
  setPresentationWorld(version: WorldVersion, terrainSeed = 0): void {
    this.currentWorldVersion = version;
    this.currentTerrainSeed = terrainSeed;
    this.environment.setWorldVersion(version);
    if (version === 'littoral-v2') {
      const world = getWorld(version, terrainSeed);
      this.seabed.setHeightSampler((wx, wz) => sampleLittoralBedMetres(world, wx, wz));
    } else {
      this.seabed.setHeightSampler(null);
    }
  }

  get weatherLightning(): number {
    return this.weather.lastLightning;
  }

  resetEnvironment(missionGeneration: number): void {
    this.missionGeneration = missionGeneration;
    this.probeBackendGeneration += 1;
    this.probes.reset();
    this.attitudes.reset();
    this.lastWaterHeight = null;
    this.immersionUnder = false;
    this.lastProbeSubjects = [];
    this.lastProbeIssueTime = null;
    this.lastSurfaceDiagnostics = null;
    this.weather.reset();
    this.atmosphere.reset();
    this.outdoorLighting.reset();
    this.environment.reset(missionGeneration);
    this.optics.reset();
    this.caustics.reset(missionGeneration);
    this.surfaceEffects.reset(missionGeneration);
    this.ocean.bindOptics(null);
    this.splashIds.clear();
    this.trailAt.clear();
    this.hitCursor = 0;
    for (const pulse of this.hitPulse) {
      pulse.until = 0;
      pulse.peak = 0;
    }
    this.decayHitLights(0);
  }

  resize(width: number, height: number, dpr = 1): void {
    this.environment.resize(width, height, dpr);
    this.optics.resize(width, height, dpr);
    this.caustics.resize(width, height, dpr);
  }

  /** CheapWater ripple normals — must run with the same camera as the main pass. */
  preRenderWater(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    const backend = this.environment.current;
    if (backend instanceof GerstnerBackend || backend instanceof SpectralBackend) {
      backend.bindPassTargets(renderer, camera);
    }
    this.environment.renderPasses();
    this.submitSurfaceProbes(renderer, camera);
    updateEntityLods(this.sub, camera);
    for (const entity of this.shipEntities.values()) {
      updateEntityLods(entity.mesh, camera);
    }
    for (const entity of this.entities.values()) {
      updateEntityLods(entity, camera);
    }
    this.islands.updatePresentation(
      this.presentationTime,
      this.presentationWindDetail,
      camera.position,
      this.presentationPaused,
      this.reducedMotion,
    );
    const maps = this.spectralSurfaceMaps();
    const coastal = this.ocean.coastalTexture();
    const coastalOrigin = this.ocean.coastalOrigin();
    this.caustics.update(renderer, {
      time: this.presentationTime,
      dt: this.lastHistoryDt,
      paused: this.presentationPaused,
      followX: this.ocean.mesh.position.x,
      followZ: this.ocean.mesh.position.z,
      sunDir: this.lastSunDir,
      waveHeight: this.lastWaveHeight,
      seaState: this.lastSeaState,
      storm: this.lastSeaState >= 0.6 ? 1 : 0,
      maps,
      sampledWaterHeight: this.lastWaterHeight ?? 0,
      bed: this.ocean.bedBind(),
      coastal,
      coastalOrigin: coastal ? { x: coastalOrigin.x, z: coastalOrigin.z } : undefined,
      coastalExtent: coastal ? coastalOrigin.extent : undefined,
      swellDirection: this.ocean.swellDirection(),
    });
    this.optics.render(renderer, this.scene, camera, this.ocean.mesh, this.lastWaterHeight ?? 0);
    this.ocean.bindOptics(this.optics);
    const foamMaps = this.worldFoamMaps();
    this.worldFoam.update(
      renderer,
      camera,
      { x: this.ocean.mesh.position.x, z: this.ocean.mesh.position.z },
      this.presentationTime,
      this.lastHistoryDt,
      foamMaps,
    );
    this.worldFoam.applyTo(this.ocean.material.uniforms);
    this.crestSpray.update(renderer, camera, this.presentationTime, this.lastHistoryDt, foamMaps);
    this.surfaceEffects.update({
      time: this.presentationTime,
      dt: this.lastHistoryDt,
      paused: this.presentationPaused,
      reducedMotion: this.reducedMotion,
      followX: this.ocean.mesh.position.x,
      followZ: this.ocean.mesh.position.z,
      cameraY: camera.position.y,
      seaState: this.lastSeaState,
      crests: this.lastEffectCrests,
      wakes: this.lastEffectWakes,
      submerged: this.lastEffectSubmerged,
    });
    // Aux FFT/optics/probe passes must not leave a bound target for the canvas frame.
    if (renderer.getRenderTarget() !== null) {
      renderer.setRenderTarget(null);
    }
  }

  private bindWorldHeight(game: GameState): void {
    const world = getWorld(game.worldVersion, game.terrainSeed);
    const key = `${worldCacheKey(world.version, world.seed, world.size)}:bed=${world.bedGridSize ?? world.size}`;
    if (key === this.heightFieldKey) return;
    this.heightFieldKey = key;
    this.currentTerrainSeed = game.terrainSeed;
    this.currentWorldVersion = game.worldVersion;
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
        if (prefersAuthoredGltf(kind) && !this.assets.hasGltf(kind) && !this.assets.isReady) return;
        entity = this.resolveEntityMesh(kind);
        this.entities.set(id, entity);
        this.scene.add(entity);
        const role = this.receiverRoleForKind(kind);
        if (role) this.caustics.attachToObject(entity, role);
      }
      entity.position.set(x, y, z);
      entity.rotation.y = -heading;
    };
    for (const torpedo of game.torpedoes) {
      const p = simToWorldMeters(torpedo.x, torpedo.y);
      const fishY = entityDepthY(torpedo.z);
      add(`torpedo:${torpedo.id}`, 'torpedo', p.x, fishY, p.z, torpedo.heading);
      this.emitTorpedoTrail(torpedo.id, p.x, fishY, p.z, torpedo.heading, game.time);
    }
    this.pruneTorpedoTrails(game.torpedoes.map((torpedo) => torpedo.id));
    for (const charge of game.depthCharges) {
      const p = simToWorldMeters(charge.x, charge.y);
      add(`charge:${charge.id}`, 'torpedo', p.x, entityDepthY(charge.z), p.z);
      if (charge.fuse < 0.35) {
        this.vfx.emit('plume', new THREE.Vector3(p.x, entityDepthY(charge.z), p.z), game.time);
        this.emitCombatSplash(
          `charge:${charge.id}`,
          p.x,
          entityDepthY(charge.z),
          p.z,
          1.4,
          'burst',
        );
      }
    }
    for (const aircraft of game.aircraft.filter((a) => a.active)) {
      const p = simToWorldMeters(aircraft.x, aircraft.y);
      add(`aircraft:${aircraft.id}`, 'aircraft', p.x, 18, p.z, aircraft.heading);
    }
    for (const powerup of game.powerups) {
      const p = simToWorldMeters(powerup.x, powerup.y);
      add(`powerup:${powerup.id}`, 'crate', p.x, SURFACE_SPLASH_Y, p.z);
    }
    for (const ship of game.ships) {
      if (ship.sinking !== undefined) {
        const p = simToWorldMeters(ship.x, ship.y);
        this.emitCombatSplash(`sink:${ship.id}`, p.x, SURFACE_SPLASH_Y, p.z, 1.6, 'burst');
      }
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
    const gltf = prefersAuthoredGltf(kind) ? this.assets.clone(kind) : undefined;
    const source = chooseAssetSource({
      hasGltf: Boolean(gltf),
      registryReady: this.assets.isReady,
      preferGltf: prefersAuthoredGltf(kind),
    });
    const detail =
      source === 'gltf' && gltf
        ? gltf
        : source === 'procedural'
          ? this.createFallback(kind)
          : new THREE.Group();
    if (source === 'pending') {
      detail.userData.assetKind = kind;
      detail.userData.assetSource = 'pending';
    }
    const mesh = detail;
    mesh.scale.setScalar(classScale);
    mesh.userData.classScale = classScale;
    mesh.userData.assetKind = kind;
    mesh.userData.assetSource = source;
    mesh.userData.hullHeight = source === 'pending' ? DEFAULT_SUB_HULL_HEIGHT_M : hullHeightY(mesh);
    mesh.userData.waterlineDraft =
      source === 'pending'
        ? surfaceDraftMetres(mesh.userData.hullHeight)
        : analyzeHullWaterline(mesh).draft;
    mesh.visible = source !== 'pending';
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
    this.outdoorLighting.update({
      atmosphere: atmo,
      cloudCoverage: weather.gains.cloudCoverage,
      lightning: weather.lightning,
      nowSeconds: sim.time,
      weatherPreset: weather.preset,
    });
    this.presentationTime = sim.time;
    this.presentationPaused = sim.paused;
    this.presentationWindDetail = weather.gains.windDetail;
    this.lastHistoryDt = historyDt;
    this.lastSeaState = settings.ocean.seaState;
    this.lastWaveHeight = settings.ocean.waveHeight;
    this.lastSunDir = { x: atmo.sunDir.x, y: atmo.sunDir.y, z: atmo.sunDir.z };
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
    this.lastSimTime = sim.time;
    this.noteBackendGeneration();
    const poses = this.consumeVesselAttitudes(sim, dt);
    const playerPose = poses.get('player');
    const seabedY = presentationBedY(this.currentWorldVersion, this.currentTerrainSeed, v.x, v.z);
    const hullHeight =
      (this.sub.userData.hullHeight as number | undefined) ?? DEFAULT_SUB_HULL_HEIGHT_M;
    const lift = playerPose?.presentationY ?? v.heave;
    const rawSubY = visualKeelY(v.depth, hullHeight) + (Number.isFinite(lift) ? lift : 0);
    const subY = clampPresentationY(rawSubY, seabedY);
    this.sub.position.set(v.x, subY, v.z);
    this.sub.rotation.order = 'YXZ';
    this.sub.rotation.y = -v.heading;
    const pitchGain = v.depth < 4 ? 1 : 0.35;
    const pitch = playerPose?.pitch ?? v.pitch;
    const roll = playerPose?.roll ?? v.roll;
    this.sub.rotation.x = (Number.isFinite(pitch) ? pitch : 0) * pitchGain;
    this.sub.rotation.z = (Number.isFinite(roll) ? roll : 0) * pitchGain;

    const peri = sim.viewMode === 'periscope';
    // Procedural hull stays visible until glTF hot-swaps after preload.
    this.sub.visible = this.sub.userData.assetSource !== 'pending';
    this.playerHullPeri = peri;
    this.playerHullDepth = v.depth;
    this.presentPlayerHull();
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
        if (
          prefersAuthoredGltf(assetKind) &&
          !this.assets.hasGltf(assetKind) &&
          !this.assets.isReady
        )
          continue;
        const scale = fleetClassScale(ship.kind);
        const mesh = this.resolveEntityMesh(assetKind, scale);
        this.tagPickId(mesh, ship.id);
        const wake = createWakeRibbon();
        const beacon = this.createBeacon(0x8f9a94);
        const hit = this.createPickVolume(ship.id, ship.kind === 'merchant' ? 7 : 5.5 * scale);
        mesh.renderOrder = 3;
        wake.renderOrder = 4;
        this.scene.add(mesh, wake, beacon, hit);
        this.caustics.attachToObject(mesh, 'hull');
        excludeFromWaterCapture(beacon);
        excludeFromWaterCapture(hit);
        entity = { mesh, wake, beacon, hit };
        this.shipEntities.set(ship.id, entity);
      }
      const selected = ship.id === selectedId;
      // Look-dev projects game `sub` → visual `uboat` with a submerged depth.
      const submerged = ship.kind === 'uboat' ? Math.max(ship.depth, 8) : 0;
      const pose = poses.get(ship.id);
      const heave = pose?.presentationY ?? ship.heave;
      const hullHeight =
        (entity.mesh.userData.hullHeight as number | undefined) ?? DEFAULT_SUB_HULL_HEIGHT_M;
      const lift = Number.isFinite(heave) ? heave : 0;
      let shipY = submerged > 0 ? visualKeelY(submerged, hullHeight) + lift * 0.12 : lift;
      const waterY = this.lastWaterHeight ?? 0;
      const bedY = presentationBedY(
        this.currentWorldVersion,
        this.currentTerrainSeed,
        ship.x,
        ship.z,
      );
      const draft =
        (entity.mesh.userData.waterlineDraft as number | undefined) ??
        surfaceDraftMetres(hullHeight);
      if (submerged <= 0) {
        shipY = clampSurfaceHullY(shipY, waterY, draft, bedY);
      } else {
        shipY = clampPresentationY(Number.isFinite(shipY) ? shipY : 0, bedY);
      }
      entity.mesh.position.set(ship.x, shipY, ship.z);
      entity.mesh.rotation.order = 'YXZ';
      const pitch = pose?.pitch ?? ship.pitch;
      const roll = pose?.roll ?? ship.roll;
      entity.mesh.rotation.set(
        Number.isFinite(pitch) ? pitch : 0,
        -ship.heading,
        Number.isFinite(roll) ? roll : 0,
      );
      entity.mesh.visible = entity.mesh.userData.assetSource !== 'pending';
      presentHullObject(entity.mesh, { peri: false, depthMetres: submerged });
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
      terrainSeed: this.currentTerrainSeed,
      worldVersion: this.currentWorldVersion,
    });
    this.lastEffectWakes = [
      {
        x: v.x,
        z: v.z,
        heading: v.heading,
        speed: v.speed,
        depth: v.depth,
        stern: 5,
      },
      ...sim.ships.map((ship) => ({
        x: ship.x,
        z: ship.z,
        heading: ship.heading,
        speed: ship.speed,
        depth: ship.kind === 'uboat' ? Math.max(ship.depth, 8) : 0,
        stern: ship.kind === 'merchant' ? 9 : 7,
      })),
    ];
    this.lastEffectCrests =
      settings.ocean.seaState > 0.4
        ? this.lastEffectWakes
            .filter((wake) => (wake.depth ?? 0) < 2.5 && wake.speed > 0.6)
            .map((wake) => ({
              x: wake.x,
              z: wake.z,
              energy: Math.min(1, settings.ocean.seaState * 0.7 + wake.speed * 0.04),
            }))
        : [];
    this.lastEffectSubmerged = [];
    if (v.depth > 0.6) {
      this.lastEffectSubmerged.push({
        x: v.x,
        y: visualKeelY(v.depth, hullHeight),
        z: v.z,
        speed: v.speed,
      });
    }
    for (const ship of sim.ships) {
      if (ship.kind !== 'uboat') continue;
      this.lastEffectSubmerged.push({
        x: ship.x,
        y: visualKeelY(Math.max(ship.depth, 8), DEFAULT_SUB_HULL_HEIGHT_M),
        z: ship.z,
        speed: ship.speed,
      });
    }

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

  private noteBackendGeneration(): void {
    const name = this.environment.getDiagnostics().backend;
    if (this.lastBackendName === name) return;
    this.lastBackendName = name;
    this.probeBackendGeneration += 1;
    this.probes.reset();
    this.attitudes.reset();
    this.lastWaterHeight = null;
    this.lastProbeIssueTime = null;
  }

  private consumeVesselAttitudes(sim: SimState, dt: number): Map<string, VesselAttitudeResult> {
    const living = new Set<string>(['player', 'camera', ...sim.ships.map((ship) => ship.id)]);
    this.attitudes.retain(living);
    const positions = new Map<string, { x: number; z: number }>();
    positions.set('player', { x: sim.vessel.x, z: sim.vessel.z });
    for (const ship of sim.ships) positions.set(ship.id, { x: ship.x, z: ship.z });
    const samples = this.probes.consume({
      missionGeneration: this.missionGeneration,
      backendGeneration: this.probeBackendGeneration,
      now: sim.time,
      livingIds: living,
      positions,
      maxSpatialError: PROBE_SPATIAL_TOLERANCE_M,
    });
    const cameraSample = samples.find((sample) => sample.entityId === 'camera');
    const playerCenter = samples.find(
      (sample) => sample.entityId === 'player' && sample.site === 'center',
    );
    if (cameraSample) this.lastWaterHeight = cameraSample.height;
    else if (playerCenter) this.lastWaterHeight = playerCenter.height;

    const poses = new Map<string, VesselAttitudeResult>();
    const subjects: Array<{
      entityId: string;
      x: number;
      z: number;
      heading: number;
      span: number;
      depth: number;
    }> = [
      {
        entityId: 'player',
        x: sim.vessel.x,
        z: sim.vessel.z,
        heading: sim.vessel.heading,
        span: attitudeSpanForKind('sub_nautilus'),
        depth: sim.vessel.depth,
      },
    ];
    poses.set(
      'player',
      this.attitudes.update({
        entityId: 'player',
        heading: sim.vessel.heading,
        depth: sim.vessel.depth,
        waterlineOffset: 0,
        fallback: {
          heave: sim.vessel.heave,
          pitch: sim.vessel.pitch,
          roll: sim.vessel.roll,
        },
        footprint: groupFootprint(samples, 'player'),
        probeTime: latestProbeTime(samples, 'player'),
        now: sim.time,
        dt,
      }),
    );
    for (const ship of sim.ships) {
      const depth = ship.kind === 'uboat' ? Math.max(ship.depth, 8) : 0;
      const hullHeight =
        (this.shipEntities.get(ship.id)?.mesh.userData.hullHeight as number | undefined) ??
        DEFAULT_SUB_HULL_HEIGHT_M;
      const storedDraft = this.shipEntities.get(ship.id)?.mesh.userData.waterlineDraft as
        number | undefined;
      const draft = Number.isFinite(storedDraft) ? storedDraft! : surfaceDraftMetres(hullHeight);
      const waterlineOffset = depth > 2.5 ? 0 : -draft;
      subjects.push({
        entityId: ship.id,
        x: ship.x,
        z: ship.z,
        heading: ship.heading,
        span: attitudeSpanForKind(ship.kind),
        depth,
      });
      poses.set(
        ship.id,
        this.attitudes.update({
          entityId: ship.id,
          heading: ship.heading,
          depth,
          waterlineOffset,
          fallback: { heave: ship.heave, pitch: ship.pitch, roll: ship.roll },
          footprint: groupFootprint(samples, ship.id),
          probeTime: latestProbeTime(samples, ship.id),
          now: sim.time,
          dt,
        }),
      );
    }
    this.lastProbeSubjects = subjects;
    const playerPose = poses.get('player');
    this.lastSurfaceDiagnostics = {
      surfaceHeight: this.lastWaterHeight,
      hullDraft: playerPose?.presentationY ?? 0,
      requestedX: sim.vessel.x,
      requestedZ: sim.vessel.z,
      resolvedX: playerCenter?.queryX ?? sim.vessel.x,
      resolvedZ: playerCenter?.queryZ ?? sim.vessel.z,
      source: playerPose?.source ?? 'fallback',
      missionGeneration: this.missionGeneration,
      backendGeneration: this.probeBackendGeneration,
      probeAge:
        playerCenter && Number.isFinite(sim.time - playerCenter.time)
          ? Math.max(0, sim.time - playerCenter.time)
          : Number.POSITIVE_INFINITY,
      readbackCount: this.probes.readbackCount,
      cadenceHz: PROBE_CADENCE_HZ,
    };
    return poses;
  }

  private submitSurfaceProbes(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const backend = this.environment.current;
    if (!(backend instanceof SpectralBackend)) return;
    if (
      !shouldRequestProbes(
        this.probes.hasPendingReadback,
        this.lastProbeIssueTime,
        this.lastSimTime,
      )
    ) {
      return;
    }
    const maps = spectralProbeMaps(backend, this.ocean, this.lastWaveHeight);
    if (!maps) return;
    const requests = prioritizeProbeRequests(
      this.lastProbeSubjects,
      { x: camera.position.x, z: camera.position.z },
      this.probes.capacity,
    );
    if (requests.length === 0) return;
    this.lastProbeIssueTime = this.lastSimTime;
    this.probes.request(renderer, maps, requests, {
      time: this.lastSimTime,
      missionGeneration: this.missionGeneration,
      backendGeneration: this.probeBackendGeneration,
    });
  }

  private emitCombatSplash(
    id: string,
    x: number,
    y: number,
    z: number,
    strength: number,
    kind: 'impact' | 'splash' | 'burst',
  ): void {
    if (this.splashIds.has(id)) return;
    this.splashIds.add(id);
    this.surfaceEffects.emitImpact({ x, y, z, strength, kind });
  }

  private receiverRoleForKind(kind: AssetEntity): CausticReceiverRole | null {
    switch (kind) {
      case 'torpedo':
        return 'weapon';
      case 'sub_nautilus':
      case 'uboat':
      case 'patrol':
      case 'destroyer':
      case 'freighter':
      case 'cruiser':
      case 'battleship':
        return 'hull';
      case 'aircraft':
      case 'fob_argus':
      case 'crate':
        return null;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  private spectralSurfaceMaps(): CausticSurfaceMaps | null {
    const backend = this.environment.current;
    if (!(backend instanceof SpectralBackend)) return null;
    const displacements = backend.displacementTextures;
    const slopes = backend.slopeTextures;
    if (displacements.length < 3 || slopes.length < 3) return null;
    return {
      displacements,
      slopes,
      lengths: DEFAULT_CASCADES.map((spec) => spec.length),
    };
  }

  private worldFoamMaps() {
    const maps = this.spectralSurfaceMaps();
    if (!maps) return null;
    const bed = this.ocean.bedBind();
    const coastal = this.ocean.coastalTexture();
    const coastalOrigin = this.ocean.coastalOrigin();
    const swell = this.ocean.swellDirection();
    return {
      ...maps,
      bed: bed?.texture ?? null,
      bedOrigin: bed ? { x: bed.origin.x, z: bed.origin.y } : { x: 0, z: 0 },
      bedExtent: bed?.extent ?? 1,
      wetBand: SHORE_WET_BAND_METRES,
      waveHeight: this.lastWaveHeight,
      coastal,
      coastalEnabled: Boolean(coastal),
      coastalOrigin: { x: coastalOrigin.x, z: coastalOrigin.z },
      coastalExtent: coastalOrigin.extent,
      swellDirection: swell,
      storm: this.lastSeaState >= 0.6 ? 1 : 0,
      wind: {
        x: 0.25 + this.presentationWindDetail * 0.7,
        z: 0.55 + this.presentationWindDetail * 0.4,
      },
    };
  }

  dispose(): void {
    this.ocean.bindOptics(null);
    this.probes.dispose();
    this.attitudes.reset();
    this.weather.reset();
    this.environment.dispose();
    this.optics.dispose();
    this.caustics.dispose();
    this.surfaceEffects.dispose();
    this.ocean.dispose();
    this.seabed.dispose();
    this.islands.dispose();
    this.atmosphere.dispose();
    this.outdoorLighting.dispose();
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
    this.worldFoam.dispose();
    this.crestSpray.dispose();
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

function latestProbeTime(
  samples: readonly { entityId: string; time: number }[],
  entityId: string,
): number | null {
  let latest: number | null = null;
  for (const sample of samples) {
    if (sample.entityId !== entityId) continue;
    if (latest === null || sample.time > latest) latest = sample.time;
  }
  return latest;
}

function spectralProbeMaps(
  backend: SpectralBackend,
  ocean: Ocean,
  waveHeight: number,
): SurfaceProbeMaps | null {
  const displacements = backend.displacementTextures;
  const slopes = backend.slopeTextures;
  if (displacements.length < 3 || slopes.length < 3) return null;
  const bed = ocean.bedBind();
  const coastal = ocean.coastalTexture();
  const coastalOrigin = ocean.coastalOrigin();
  const swell = ocean.swellDirection();
  return {
    displacements,
    slopes,
    lengths: DEFAULT_CASCADES.map((spec) => spec.length),
    bed: bed?.texture ?? null,
    bedOrigin: bed ? { x: bed.origin.x, z: bed.origin.y } : { x: 0, z: 0 },
    bedExtent: bed?.extent ?? 1,
    wetBand: SHORE_WET_BAND_METRES,
    waveHeight,
    coastal,
    coastalEnabled: Boolean(coastal),
    coastalOrigin: { x: coastalOrigin.x, z: coastalOrigin.z },
    coastalExtent: coastalOrigin.extent,
    swellDirection: swell,
  };
}
