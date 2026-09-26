import * as THREE from 'three';
import { loadPlayPreferences, loadSettings, saveSettings } from './core/settings';
import { advanceAccumulator, FIXED_DT } from './core/sim';
import type { LookDevSettings, SimState, ViewMode } from './core/types';
import { deriveCombatEvents, type CombatEvent } from './game/adapt/combat-events';
import { adaptToLookDevSim } from './game/adapt/lookdev';
import type { GameCommand } from './game/commands/types';
import {
  blowTanks,
  cancelAutopilot,
  clearEngagement,
  createGame,
  deployCountermeasure,
  fireWeapon,
  orderMove,
  selectTarget,
  setAutopilot,
  setDepthOrder,
  setPhase,
  setSpeedOrder,
  setWeapon,
  snapToNavigable,
  sonarPulse,
  startMission,
  toggleScope,
  toggleSilentRunning,
  toggleSnorkel,
  toggleTorpedoSpread,
  updateGame,
} from './game/sim/api';
import { actionTimeScale } from './game/sim/action-feel';
import { hasContact } from './game/sim/contact';
import { depthToMeters, simToWorldMeters, worldMetersToSim } from './game/sim/coords';
import { GameAudio } from './game/audio/audio';
import type { GameState, Point } from './game/sim/types';
import { InputController } from './input/controls';
import { canPlotFromView, resolveWorldClick } from './input/world-click';
import { CameraRig } from './render/cameras';
import { presentationBedY } from './render/presentation/world-bed';
import { RendererHost } from './render/renderer';
import { parseRuntimeSelection, type RuntimeSelection } from './core/runtime-selection';
import { QualityGovernor, QUALITY_PROFILES } from './render/quality';
import { GameScene } from './render/scene';
import { entityDepthY } from './render/presentation/coordinates';
import {
  idleTrack,
  startTrack,
  stepTrack,
  type CinemaPoint,
  type CinemaTrack,
} from './render/presentation/cinema-follow';
import { hideBootOverlay, setBootProgress } from './ui/boot';
import {
  bindMasterVolume,
  ErrorToast,
  recordCapturedError,
  reducedMotionGates,
  resolveReducedMotion,
  resolveStartupQuality,
  type ErrorRecord,
} from './ui/error-toast';
import { Hud } from './ui/hud';
import { PatrolOverlay } from './ui/overlays';
import { LookDevPanel } from './ui/panel';
import { PeriscopeOverlay } from './ui/periscope';
import { SonarScope } from './ui/sonar';
import {
  computeThreatMarkers,
  ThreatIndicatorLayer,
  type ThreatProjection,
} from './ui/threat-indicators';
import { TutorialOverlay, patrolClockRuns, phaseWhileTutorial } from './ui/tutorial';
import './styles/threats.css';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

export class App {
  private settings: LookDevSettings;
  private game: GameState;
  private sim: SimState;
  private readonly renderer: RendererHost;
  private readonly scene: GameScene;
  private readonly cameras: CameraRig;
  private readonly input: InputController;
  private readonly hud: Hud;
  private readonly panel: LookDevPanel;
  private readonly patrol: PatrolOverlay;
  private readonly sonar: SonarScope;
  private readonly peri: PeriscopeOverlay;
  private readonly tutorial: TutorialOverlay;
  private readonly threatRoot: HTMLElement;
  private readonly threats: ThreatIndicatorLayer;
  private readonly threatForward = new THREE.Vector3();
  private tutorialHeldPause = false;
  private readonly audio = new GameAudio();
  private readonly pauseBanner: HTMLElement;
  private readonly appRoot: HTMLElement;
  private readonly recoveryBanner: HTMLDivElement;
  private accum = 0;
  private last = performance.now();
  private running = true;
  private raf = 0;
  private readonly reducedMotion: boolean;
  private fpsEma = 60;
  private frameMsEma = 16.7;
  private readonly quality: QualityGovernor;
  private readonly runtime: RuntimeSelection;
  private missionGeneration = 0;
  private activeQuality: RuntimeSelection['quality'];
  private hitFreeze = 0;
  private cameraShake = 0;
  private cinema: CinemaTrack = idleTrack();
  private bootVisible = true;
  private readonly combatLog: CombatEvent[] = [];
  private errorCount = 0;
  private errorToast: ErrorToast | null = null;

  constructor() {
    const play = loadPlayPreferences();
    const parsed = parseRuntimeSelection(window.location.search);
    const startup = resolveStartupQuality(parsed, play.quality);
    this.runtime = { ...parsed, quality: startup.quality, qualityForced: startup.qualityForced };
    if (this.runtime.diagnostics.length > 0) {
      console.warn('[silent-depths]', this.runtime.diagnostics.join('; '));
    }
    this.quality = new QualityGovernor({
      initial: this.runtime.quality,
      locked: this.runtime.qualityForced,
    });
    this.activeQuality = this.runtime.quality;
    this.settings = loadSettings();
    this.game = {
      ...createGame(19, this.runtime.world),
      settings: this.settings,
    };
    this.sim = adaptToLookDevSim(this.game);
    const systemReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.reducedMotion = resolveReducedMotion(play.reducedMotion, systemReduce);
    bindMasterVolume(this.audio, play.masterVolume);

    const canvas = $('scene') as HTMLCanvasElement;
    this.appRoot = $('app');
    this.recoveryBanner = document.createElement('div');
    this.recoveryBanner.className = 'pause-banner';
    this.recoveryBanner.setAttribute('role', 'status');
    this.recoveryBanner.hidden = true;
    this.appRoot.append(this.recoveryBanner);
    this.errorToast = new ErrorToast(this.appRoot);
    this.renderer = new RendererHost(canvas);
    this.renderer.setQuality(QUALITY_PROFILES[this.runtime.quality]);
    this.renderer.setExposure(this.settings.atmosphere.exposure);
    this.scene = new GameScene();
    this.scene.setPresentationWorld(this.runtime.world, this.game.terrainSeed);
    if (typeof this.scene.bindEnvironment === 'function') {
      this.scene.bindEnvironment(this.renderer.renderer);
    }
    this.scene.setQuality(QUALITY_PROFILES[this.runtime.quality]);
    this.scene.setReducedMotion(this.reducedMotion);
    void this.scene.environment.activate(this.runtime.ocean, new AbortController().signal);
    this.scene.resize(
      window.innerWidth,
      window.innerHeight,
      Math.min(window.devicePixelRatio || 1, 1.75),
    );
    this.cameras = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    this.cameras.setMode(this.sim.viewMode);
    this.renderer.setContextRecoveryHandlers(
      (signal) =>
        this.scene.recoverPresentationResources(
          this.renderer.renderer,
          this.cameras.camera,
          signal,
        ),
      (status, reason) => this.setRecoveryStatus(status, reason),
    );

    this.hud = new Hud($('hud'), $('help-strip'), {
      command: (action, value) => this.handleHudCommand(action, value),
      plot: (x, y) => this.plot(x, y),
      select: (id) => this.select(id),
      isMuted: () => this.audio.isMuted,
    });
    this.pauseBanner = $('pause-banner');
    this.sonar = new SonarScope(
      $('sonar-overlay'),
      $('sonar-canvas') as HTMLCanvasElement,
      $('sonar-telemetry'),
    );
    this.peri = new PeriscopeOverlay($('periscope-overlay'), $('peri-bearing'), $('peri-range'));
    this.patrol = new PatrolOverlay(
      $('patrol-overlay'),
      () => this.beginPatrol(),
      () => this.restartPatrol(),
    );
    this.tutorial = new TutorialOverlay($('tutorial-overlay'), (open) =>
      this.holdForTutorial(open),
    );
    this.threatRoot = document.createElement('div');
    this.threatRoot.id = 'threat-indicators';
    this.appRoot.append(this.threatRoot);
    this.threats = new ThreatIndicatorLayer(this.threatRoot);

    this.panel = new LookDevPanel($('lookdev'), this.settings, {
      onChange: (s) => {
        this.settings = s;
        this.game = { ...this.game, settings: s };
        this.renderer.setExposure(s.atmosphere.exposure);
        this.applyPresentationCss();
      },
      onClose: () => this.panel.setVisible(false),
    });
    this.panel.setVisible(false);
    void this.whenAssetsReady().then(() => {
      this.panel.setAssetCredits([...this.scene.getAssetLicenses()]);
      this.finishBoot();
    });
    this.syncBootProgress();

    this.input = new InputController(canvas, {
      setViewMode: (mode) => this.changeView(mode),
      togglePause: () => this.inputPause(),
      togglePanel: () => this.panel.toggle(),
      orbit: (dx, dy) => this.cameras.orbit(dx, dy),
      periLook: (dx, dy) => this.cameras.periLook(dx, dy),
      bridgeLook: (dx, dy) => this.cameras.bridgeLook(dx, dy),
      zoom: (d) => this.cameras.zoom(d),
      getViewMode: () => this.sim.viewMode,
      interact: (button, x, y) => this.handleWorldInteraction(button, x, y),
    });

    window.addEventListener('keydown', this.onKeyDown);
    this.applyPresentationCss();
    this.syncOverlays();
    this.patrol.render(this.game);
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });

    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.onUnload);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Settles when the asset registry has finished its first preload pass. */
  whenAssetsReady(): Promise<void> {
    return this.scene.whenAssetsReady();
  }

  getEnvironmentDiagnostics() {
    return this.scene.environment.getDiagnostics();
  }

  getOutdoorLightingDiagnostics() {
    return this.scene.getOutdoorLightingDiagnostics();
  }

  getSurfaceDiagnostics() {
    return this.scene.getSurfaceDiagnostics();
  }

  getAudioDiagnostics() {
    return this.audio.getDiagnostics();
  }

  /** Live patrol snapshot. `incoming` is the count of enemy torpedoes still running. */
  getGameSummary() {
    const sub = this.game.submarine;
    return {
      phase: this.game.phase,
      wave: this.game.stats.wave,
      time: this.game.time,
      hp: sub.hp,
      maxHp: sub.maxHp,
      torpedoes: sub.torpedoes,
      decoys: sub.decoys,
      cmCharges: sub.cmCharges,
      shipsSunk: this.game.stats.shipsSunk,
      score: this.game.stats.score,
      viewMode: this.game.viewMode,
      ships: this.game.ships.map((ship) => ({
        id: ship.id,
        kind: ship.kind,
        alert: ship.alert,
        hp: ship.hp,
        maxHp: ship.maxHp,
        range: Math.hypot(ship.x - sub.x, ship.y - sub.y),
      })),
      incoming: this.game.torpedoes.filter((torpedo) => torpedo.owner === 'enemy').length,
      errors: this.errorCount,
    };
  }

  /** Count a window error or rejection and show the copyable toast. */
  noteCapturedError(record: ErrorRecord): void {
    const recorded = recordCapturedError(this.errorCount, record);
    this.errorCount = recorded.count;
    this.errorToast?.show(recorded.summary, recorded.count);
  }

  /** Newest combat cues, capped at 64. Oldest events drop first. */
  getCombatEventLog(): CombatEvent[] {
    return this.combatLog.slice();
  }

  getPresentationGauntlet() {
    return {
      audio: this.audio.getDiagnostics(),
      vfx: this.scene.getVfxDiagnostics(),
      surface: this.scene.surfaceEffects.getDiagnostics(),
      assets: this.scene.getAssetProbe(
        this.game.ships.map((ship) => ({ id: ship.id, kind: ship.kind })),
      ),
      vesselDepth: this.game.submarine.z,
      targetDepth: this.game.submarine.targetDepth,
      immersion: this.cameras.getImmersion(),
      cameraY: this.cameras.camera.position.y,
      contacts: this.scene.getContactHeights(),
    };
  }

  debugBurstPresentationFx() {
    this.audio.unlock();
    return this.scene.debugBurstPresentationFx();
  }

  debugSetDepth(order: 'surface' | 'periscope' | 'attack' | 'deep') {
    this.game = setDepthOrder(this.game, order);
    return { z: this.game.submarine.z, target: this.game.submarine.targetDepth };
  }

  getPerformanceProbe() {
    return {
      quality: this.activeQuality,
      world: this.game.worldVersion,
      seed: this.game.seed,
      phase: this.game.phase,
      fleet: {
        surfaceShips: this.game.ships.length,
        weapons:
          this.game.torpedoes.length +
          this.game.depthCharges.length +
          this.game.countermeasures.length,
      },
      environment: this.getEnvironmentDiagnostics(),
      outdoorLighting: this.getOutdoorLightingDiagnostics(),
      surface: this.getSurfaceDiagnostics(),
      graphics: this.renderer.getPerformanceDiagnostics(),
    };
  }

  private beginPatrol(): void {
    this.missionGeneration += 1;
    this.cinema = idleTrack();
    this.scene.resetEnvironment(this.missionGeneration);
    this.game = { ...startMission(this.game), settings: this.settings, viewMode: 'chase' };
    this.cameras.setMode('chase');
    const freighter = this.game.ships[0];
    if (freighter) this.game = selectTarget(this.game, freighter.id);
    this.sim = adaptToLookDevSim(this.game);
    this.patrol.render(this.game);
    this.tutorial.show();
    this.audio.unlock();
  }

  private restartPatrol(): void {
    this.missionGeneration += 1;
    this.cinema = idleTrack();
    this.scene.resetEnvironment(this.missionGeneration);
    this.game = {
      ...createGame(this.game.seed),
      settings: this.settings,
      worldVersion: this.runtime.world,
    };
    this.sim = adaptToLookDevSim(this.game);
    this.patrol.render(this.game);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'KeyF' && this.game.phase === 'playing') {
      this.applyFire((g) => fireWeapon(g));
    }
    if (e.code === 'KeyR' && this.game.phase === 'playing') {
      this.game = toggleSilentRunning(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (e.code === 'KeyG' && this.game.phase === 'playing') {
      this.game = blowTanks(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (e.code === 'KeyC' && this.game.phase === 'playing') {
      this.game = deployCountermeasure(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (e.code === 'KeyT' && this.game.phase === 'playing' && this.game.ships.length > 0) {
      const alive = this.game.ships.filter((ship) => ship.sinking === undefined);
      if (alive.length > 0) {
        const current = this.game.selectedTargetId;
        const index = Math.max(
          0,
          alive.findIndex((ship) => ship.id === current),
        );
        const next = alive[(index + 1) % alive.length]!;
        this.game = selectTarget(this.game, next.id);
        this.sim = adaptToLookDevSim(this.game);
      }
    }
    if (this.game.phase === 'playing') {
      // KeyC is screen/countermeasure — attack depth uses KeyB to avoid conflict.
      const depth = ({ KeyZ: 'surface', KeyX: 'periscope', KeyB: 'attack', KeyV: 'deep' } as const)[
        e.code
      ];
      const speed = (
        { Digit0: 'stop', KeyI: 'oneThird', KeyO: 'twoThirds', KeyP: 'flank' } as const
      )[e.code];
      if (depth) this.game = setDepthOrder(this.game, depth);
      if (speed) this.game = setSpeedOrder(this.game, speed);
      if (depth || speed) this.sim = adaptToLookDevSim(this.game);
    }
  };

  private handleHudCommand(action: string, value?: string): void {
    if (action === 'help') {
      this.tutorial.show(true);
      return;
    }
    if (action === 'mute') {
      this.audio.setMuted(!this.audio.isMuted);
      return;
    }
    if (action === 'pause') {
      this.inputPause();
      return;
    }
    if (this.game.phase !== 'playing') return;
    if (action === 'weapon' && value)
      this.game = setWeapon(this.game, value as 'torpedo' | 'seeker' | 'decoy');
    if (action === 'screen') this.game = deployCountermeasure(this.game);
    if (action === 'spread') this.game = toggleTorpedoSpread(this.game);
    if (action === 'sonar') this.game = sonarPulse(this.game);
    if (action === 'fire') {
      this.applyFire((g) => fireWeapon(g));
      this.audio.unlock();
      this.audio.sfxClick();
      return;
    }
    if (action === 'silent') this.game = toggleSilentRunning(this.game);
    if (action === 'scope') this.game = toggleScope(this.game);
    if (action === 'snorkel') this.game = toggleSnorkel(this.game);
    if (action === 'tactic' && value)
      this.game = setAutopilot(
        this.game,
        value as 'ambush' | 'stalk' | 'intercept' | 'evade' | 'exfil',
        this.game.selectedTargetId,
      );
    if (action === 'stop-ai') this.game = cancelAutopilot(this.game);
    if (action === 'clear') this.game = clearEngagement(this.game);
    if (action === 'blow') this.game = blowTanks(this.game);
    if (action === 'depth' && value)
      this.game = setDepthOrder(this.game, value as 'surface' | 'periscope' | 'attack' | 'deep');
    if (action === 'speed' && value)
      this.game = setSpeedOrder(this.game, value as 'stop' | 'oneThird' | 'twoThirds' | 'flank');
    this.audio.unlock();
    this.audio.sfxClick();
    this.sim = adaptToLookDevSim(this.game);
  }

  /** Tutorial holds the sim with the same paused phase the Pause control uses. */
  private holdForTutorial(open: boolean): void {
    const next = phaseWhileTutorial(this.game.phase, open, this.tutorialHeldPause);
    this.tutorialHeldPause = next.heldByTutorial;
    if (next.phase !== this.game.phase) {
      this.game = setPhase(this.game, next.phase);
      this.sim = adaptToLookDevSim(this.game);
    }
    this.pauseBanner.hidden = this.tutorialHeldPause || this.game.phase !== 'paused';
  }

  /**
   * Edge chevrons from the live camera. `projectNdc.clipW` is an out-of-frustum
   * flag, not clip-space w, so a point behind the lens is the view-direction dot.
   * Those contacts keep the raw mirrored pixels and `behind: true`.
   */
  private syncThreats(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cameras.camera.getWorldDirection(this.threatForward);
    const markers = computeThreatMarkers(
      this.game,
      (x, y, z) => this.projectThreat(x, y, z, width, height),
      { width, height },
    );
    this.threats.render(markers);
  }

  private projectThreat(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ): ThreatProjection {
    const world = simToWorldMeters(x, y);
    const altitude = entityDepthY(z);
    const ndc = this.cameras.projectNdc(world.x, altitude, world.z);
    const sx = (ndc.ndcX * 0.5 + 0.5) * width;
    const sy = (-ndc.ndcY * 0.5 + 0.5) * height;
    const camera = this.cameras.camera.position;
    const ahead =
      (world.x - camera.x) * this.threatForward.x +
      (altitude - camera.y) * this.threatForward.y +
      (world.z - camera.z) * this.threatForward.z;
    const behind = ahead <= 0;
    const onScreen = !behind && sx >= 0 && sx <= width && sy >= 0 && sy <= height;
    return { sx, sy, onScreen, behind };
  }

  private inputPause(): void {
    if (this.tutorial.isOpen()) return;
    if (this.game.phase !== 'playing' && this.game.phase !== 'paused') return;
    this.game = setPhase(this.game, this.game.phase === 'paused' ? 'playing' : 'paused');
    this.sim = adaptToLookDevSim(this.game);
    this.pauseBanner.hidden = this.game.phase !== 'paused';
  }

  private select(id: string): void {
    this.game =
      this.game.selectedTargetId === id ? clearEngagement(this.game) : selectTarget(this.game, id);
    this.sim = adaptToLookDevSim(this.game);
  }

  private plot(x: number, y: number): void {
    if (this.game.phase !== 'playing') return;
    this.game = orderMove(this.game, snapToNavigable(this.game, { x, y }));
    this.sim = adaptToLookDevSim(this.game);
  }

  private handleWorldInteraction(button: 0 | 2, clientX: number, clientY: number): void {
    if (this.game.phase !== 'playing') return;
    const canvas = $('scene') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const raycaster = this.cameras.setPickRay(clientX, clientY, rect);
    const rayHit = this.scene.pickShipId(raycaster);
    const screenProximate = this.scene.pickShipIdNearScreen(
      clientX,
      clientY,
      rect,
      this.cameras.camera,
    );
    const decision = resolveWorldClick(rayHit, screenProximate);
    if (button === 2) {
      if (decision.action === 'select') {
        this.applyFire((g) =>
          updateGame(g, [{ type: 'selectTarget', id: decision.id }, { type: 'fireWeapon' }], 0),
        );
      } else {
        const point = this.pickWaterSimPoint(clientX, clientY, rect);
        if (!point) return;
        this.applyFire((g) =>
          updateGame(g, [{ type: 'setAimPoint', point }, { type: 'fireWeapon' }], 0),
        );
      }
      return;
    }
    if (decision.action === 'select') {
      this.select(decision.id);
      return;
    }
    if (!canPlotFromView(this.game.viewMode)) return;
    const point = this.pickWaterSimPoint(clientX, clientY, rect);
    if (!point) return;
    this.plot(point.x, point.y);
  }

  private applyFire(mutate: (state: GameState) => GameState): void {
    const before = this.game;
    this.game = mutate(before);
    const prev = new Set(before.torpedoes.filter((t) => t.owner === 'player').map((t) => t.id));
    const fresh = this.game.torpedoes.find((t) => t.owner === 'player' && !prev.has(t.id));
    if (fresh) {
      this.cinema = startTrack(fresh.id, performance.now());
    }
    this.sim = adaptToLookDevSim(this.game);
  }

  private cinemaPresentation(): {
    cinema?: CinemaPoint;
    snapToTarget?: boolean;
  } {
    const escortFix = this.game.ships.some((ship) => hasContact(ship, this.game));
    const torpedo = this.cinema.id
      ? this.game.torpedoes.find((t) => t.id === this.cinema.id)
      : undefined;
    const world = torpedo ? simToWorldMeters(torpedo.x, torpedo.y) : null;
    const fish =
      torpedo && world
        ? { x: world.x, y: -depthToMeters(torpedo.z), z: world.z, heading: torpedo.heading }
        : undefined;
    const step = stepTrack(this.cinema, fish, escortFix, performance.now());
    this.cinema = step.track;
    return {
      ...(step.cinema ? { cinema: step.cinema } : {}),
      ...(step.snapToTarget ? { snapToTarget: true } : {}),
    };
  }

  /** Intersect the active camera ray with the y=0 sea plane, then convert to sim coords. */
  private pickWaterSimPoint(clientX: number, clientY: number, rect: DOMRect): Point | null {
    const hit = this.cameras.intersectWaterPlane(clientX, clientY, rect);
    if (!hit) return null;
    return snapToNavigable(this.game, worldMetersToSim(hit.x, hit.z));
  }

  private changeView(mode: ViewMode): void {
    this.game = updateGame(this.game, [{ type: 'setViewMode', viewMode: mode }], 0);
    this.sim = adaptToLookDevSim(this.game);
    this.cameras.setMode(mode);
    this.syncOverlays();
  }

  private syncOverlays(): void {
    const mode = this.sim.viewMode;
    this.sonar.setActive(mode === 'sonar');
    this.peri.setActive(mode === 'periscope');
  }

  private applyPresentationCss(): void {
    const grain = this.reducedMotion
      ? this.settings.presentation.filmGrain * 0.35
      : this.settings.presentation.filmGrain;
    this.appRoot.style.setProperty('--grain', String(grain));
    this.appRoot.style.setProperty('--ui-vignette', String(this.settings.presentation.vignette));
  }

  private readonly onResize = (): void => {
    this.renderer.resize();
    this.cameras.resize(window.innerWidth / Math.max(1, window.innerHeight));
    if (this.renderer.canSubmit) {
      this.scene.resize(
        window.innerWidth,
        window.innerHeight,
        Math.min(window.devicePixelRatio || 1, QUALITY_PROFILES[this.activeQuality].dpr),
      );
    }
  };

  private setRecoveryStatus(
    status: 'ready' | 'lost' | 'restoring' | 'failed',
    reason?: string,
  ): void {
    if (status === 'ready') {
      this.recoveryBanner.hidden = true;
      this.recoveryBanner.replaceChildren();
      return;
    }
    if (status === 'lost') {
      this.scene.invalidateForContextLoss();
      this.recoveryBanner.textContent = 'GRAPHICS CONTEXT LOST — WAITING TO RECOVER';
    } else if (status === 'restoring') {
      this.recoveryBanner.textContent = 'RESTORING PRESENTATION RESOURCES…';
    } else {
      const message = document.createElement('span');
      message.textContent = `GRAPHICS RECOVERY FAILED${reason ? ` — ${reason}` : ''}`;
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload';
      reload.addEventListener('click', () => window.location.reload(), { once: true });
      this.recoveryBanner.replaceChildren(message, reload);
    }
    this.recoveryBanner.hidden = false;
  }

  private readonly onUnload = (): void => {
    saveSettings(this.settings);
    this.dispose();
  };

  private syncBootProgress(): void {
    if (!this.bootVisible) return;
    const states = Object.values(this.scene.getAssetProbe().loaded);
    const loaded = states.filter((state) => state !== 'pending').length;
    setBootProgress(loaded, states.length);
  }

  private finishBoot(): void {
    if (!this.bootVisible) return;
    this.bootVisible = false;
    const states = Object.values(this.scene.getAssetProbe().loaded);
    setBootProgress(states.length, states.length);
    hideBootOverlay();
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.syncBootProgress();
    const elapsed = (now - this.last) / 1000;
    this.last = now;

    this.input.update();

    this.hitFreeze = Math.max(0, this.hitFreeze - elapsed);
    this.cameraShake *= Math.max(0, 1 - elapsed * 3.2);
    const scaled = this.hitFreeze > 0 ? 0 : elapsed * actionTimeScale(this.game);
    const tick = advanceAccumulator(this.accum, scaled);
    this.accum = tick.accum;
    const renderDt = tick.elapsedUsed;

    const combat: CombatEvent[] = [];
    if (patrolClockRuns(this.game.phase, this.tutorial.isOpen())) {
      const chargesBefore = this.game.depthCharges.length;
      for (let i = 0; i < tick.steps; i++) {
        const prev = this.game;
        const command: GameCommand = { type: 'helm', ...this.input.intent };
        this.game = updateGame(this.game, [command], FIXED_DT);
        combat.push(...deriveCombatEvents(prev, this.game));
      }
      const chargeShake = 0.85 * reducedMotionGates(this.reducedMotion).shakeScale;
      if (chargeShake > 0 && chargesBefore > this.game.depthCharges.length) {
        this.cameraShake = Math.max(this.cameraShake, chargeShake);
      }
      this.sim = adaptToLookDevSim(this.game);
    }

    this.scene.syncGame(this.game, this.sim, this.settings, renderDt);
    // Bursts share the sim clock: VfxPool.update ages particles with game.time.
    this.presentCombat(combat, this.game.time);
    const cinema = this.cinemaPresentation();
    this.cameras.update(this.sim, renderDt, {
      lightning: this.scene.weatherLightning,
      shake: this.cameraShake,
      reducedMotion: this.reducedMotion,
      waterHeight: this.scene.sampledWaterHeight,
      sampleTerrainY: (x, z) =>
        presentationBedY(this.game.worldVersion, this.game.terrainSeed, x, z),
      cinema: cinema.cinema,
      snapToTarget: cinema.snapToTarget,
    });
    const batteryFrac =
      this.game.submarine.maxBattery > 0
        ? this.game.submarine.battery / this.game.submarine.maxBattery
        : 1;
    this.renderer.setExposure(
      this.settings.atmosphere.exposure * (0.52 + 0.48 * Math.max(0, Math.min(1, batteryFrac))),
    );
    this.scene.applyImmersion(this.cameras.camera);
    if (this.renderer.canSubmit) {
      this.scene.preRenderWater(this.renderer.renderer, this.cameras.camera);
      this.renderer.render(this.scene.scene, this.cameras.camera);
    }

    this.syncThreats();
    this.hud.render(this.game, this.sim, this.settings);
    this.audio.observe(this.game);
    this.peri.render(this.sim, this.settings, this.cameras.periYaw);
    this.sonar.render(this.sim, renderDt, this.reducedMotion);
    this.patrol.render(this.game);

    const fpsInst = renderDt > 0 ? 1 / renderDt : 60;
    this.fpsEma = this.fpsEma * 0.9 + fpsInst * 0.1;
    this.frameMsEma = this.frameMsEma * 0.9 + renderDt * 1000 * 0.1;
    const profile = this.quality.update(this.frameMsEma, renderDt);
    if (profile !== this.activeQuality && this.renderer.canSubmit) {
      this.activeQuality = profile;
      this.renderer.setQuality(QUALITY_PROFILES[profile]);
      this.scene.setQuality(QUALITY_PROFILES[profile]);
    }
    if (this.panel.isVisible()) {
      this.panel.setPerf(this.fpsEma, this.frameMsEma, profile);
      this.panel.setSurfaceDiagnostics(this.scene.formatSurfaceDiagnostics());
    }

    this.raf = requestAnimationFrame(this.frame);
  };

  /** Dispatch one frame of fixed-step cues. `now` is sim seconds. */
  private presentCombat(events: readonly CombatEvent[], now: number): void {
    if (events.length > 0) {
      this.combatLog.push(...events);
      if (this.combatLog.length > 64) this.combatLog.splice(0, this.combatLog.length - 64);
      this.applyCombatFeel(events);
      for (const event of events) this.playCombatCue(event);
    }
    const gates = reducedMotionGates(this.reducedMotion);
    this.scene.playCombatEvents(gates.emitFlash ? events : [], now);
    const alert = this.game.ships.reduce((max, ship) => Math.max(max, ship.alert), 0);
    this.audio.setTension(this.game.phase === 'playing' ? alert : 0);
  }

  /** Hit shake 0.5, player-hit shake 0.9, sink freeze 0.4 s. All zero under reduced motion. */
  private applyCombatFeel(events: readonly CombatEvent[]): void {
    const gates = reducedMotionGates(this.reducedMotion);
    for (const event of events) {
      if (event.type === 'torpedoHit') {
        this.cameraShake = Math.max(this.cameraShake, 0.5 * gates.shakeScale);
      } else if (event.type === 'playerHit') {
        this.cameraShake = Math.max(this.cameraShake, 0.9 * gates.shakeScale);
      } else if (event.type === 'shipSunk') {
        this.hitFreeze = Math.max(this.hitFreeze, 0.4 * gates.freezeScale);
      }
    }
  }

  private playCombatCue(event: CombatEvent): void {
    const sub = this.game.submarine;
    const distanceOf = (x: number, y: number): number => Math.hypot(x - sub.x, y - sub.y);
    switch (event.type) {
      case 'torpedoLaunch':
        this.audio.playCue(event.owner === 'enemy' ? 'incoming' : 'launch', {
          distance: distanceOf(event.x, event.y),
        });
        return;
      case 'torpedoHit':
        this.audio.playCue('hit', { distance: distanceOf(event.x, event.y) });
        return;
      case 'shipSunk':
        this.audio.playCue('sink', { distance: distanceOf(event.x, event.y) });
        return;
      case 'chargeBlast':
        this.audio.playCue(event.near ? 'hullHit' : 'distantBoom', {
          distance: distanceOf(event.x, event.y),
        });
        return;
      case 'playerHit':
        this.audio.playCue('hullHit');
        return;
      case 'countermeasure':
        this.audio.playCue('decoy', { distance: distanceOf(event.x, event.y) });
        return;
      case 'waveStart':
        this.audio.playCue('waveStart');
        return;
      case 'victory':
        this.audio.playCue('victory');
        return;
      case 'gameover':
        this.audio.playCue('gameover');
        return;
      case 'torpedoExpired':
      case 'sonarPing':
      case 'pickup':
        return;
      default: {
        const unreachable: never = event;
        return unreachable;
      }
    }
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.dispose();
    this.tutorial.dispose();
    this.threatRoot.remove();
    this.audio.dispose();
    this.errorToast?.dispose();
    this.recoveryBanner.remove();
    this.finishBoot();
    this.scene.dispose();
    this.renderer.dispose();
  }

  /** Agent/browser probe: facing vs motion and tactic range. */
  getDebugProbe() {
    const sub = this.scene.sub;
    sub.updateMatrixWorld(true);
    const pts: Array<{ x: number; y: number; z: number }> = [];
    sub.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry?.attributes?.position) return;
      const pos = object.geometry.attributes.position;
      const v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 1500));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(object.matrixWorld);
        pts.push({ x: v.x, y: v.y, z: v.z });
      }
    });
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    const yCut = ys[Math.floor(ys.length * 0.9)] ?? 0;
    const top = pts.filter((p) => p.y >= yCut);
    const sail = top.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
    if (top.length) {
      sail.x /= top.length;
      sail.z /= top.length;
    }
    const v = this.sim.vessel;
    const forward = { x: Math.cos(v.heading), z: Math.sin(v.heading) };
    const sailOffset = { x: sail.x - v.x, z: sail.z - v.z };
    const sailAlongForward = sailOffset.x * forward.x + sailOffset.z * forward.z;
    const target = this.game.ships.find((s) => s.id === this.game.selectedTargetId);
    const range = target
      ? Math.hypot(target.x - this.game.submarine.x, target.y - this.game.submarine.y)
      : null;
    return {
      heading: v.heading,
      speed: v.speed,
      sailAlongForward,
      bowForward: sailAlongForward > 0.2,
      tactic: this.game.autopilot.tactic,
      phase: this.game.autopilot.phase,
      enabled: this.game.autopilot.enabled,
      range,
      targetId: this.game.selectedTargetId,
      assets: this.scene.getAssetProbe(this.game.ships.map((s) => ({ id: s.id, kind: s.kind }))),
    };
  }

  /** Test helper: engage a doctrine tactic against the current/first contact. */
  debugSetTactic(tactic: 'ambush' | 'stalk' | 'intercept' | 'evade' | 'exfil') {
    const targetId = this.game.selectedTargetId ?? this.game.ships[0]?.id ?? null;
    if (targetId && !this.game.selectedTargetId) this.game = selectTarget(this.game, targetId);
    this.game = setAutopilot(this.game, tactic, targetId);
    this.sim = adaptToLookDevSim(this.game);
    return this.getDebugProbe();
  }
}
