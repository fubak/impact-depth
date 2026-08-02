import { loadSettings, saveSettings } from './core/settings';
import { advanceAccumulator, FIXED_DT } from './core/sim';
import type { LookDevSettings, SimState, ViewMode } from './core/types';
import { adaptToLookDevSim } from './game/adapt/lookdev';
import type { GameCommand } from './game/commands/types';
import {
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
import { GameAudio } from './game/audio/audio';
import type { GameState } from './game/sim/types';
import { InputController } from './input/controls';
import { CameraRig } from './render/cameras';
import { RendererHost } from './render/renderer';
import { QualityGovernor, QUALITY_PROFILES } from './render/quality';
import { GameScene } from './render/scene';
import { Hud } from './ui/hud';
import { PatrolOverlay } from './ui/overlays';
import { LookDevPanel } from './ui/panel';
import { PeriscopeOverlay } from './ui/periscope';
import { SonarScope } from './ui/sonar';
import { TutorialOverlay } from './ui/tutorial';

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
  private readonly audio = new GameAudio();
  private readonly pauseBanner: HTMLElement;
  private readonly appRoot: HTMLElement;
  private accum = 0;
  private last = performance.now();
  private running = true;
  private raf = 0;
  private readonly reducedMotion: boolean;
  private fpsEma = 60;
  private frameMsEma = 16.7;
  private readonly quality = new QualityGovernor();

  constructor() {
    this.settings = loadSettings();
    this.game = { ...createGame(19), settings: this.settings };
    this.sim = adaptToLookDevSim(this.game);
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const canvas = $('scene') as HTMLCanvasElement;
    this.appRoot = $('app');
    this.renderer = new RendererHost(canvas);
    this.renderer.setQuality(QUALITY_PROFILES.high);
    this.renderer.setExposure(this.settings.atmosphere.exposure);
    this.scene = new GameScene();
    this.scene.setQuality(QUALITY_PROFILES.high);
    this.cameras = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    this.cameras.setMode(this.sim.viewMode);

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
    this.tutorial = new TutorialOverlay($('tutorial-overlay'));

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

    this.input = new InputController(canvas, {
      setViewMode: (mode) => this.changeView(mode),
      togglePause: () => this.inputPause(),
      togglePanel: () => this.panel.toggle(),
      orbit: (dx, dy) => this.cameras.orbit(dx, dy),
      periLook: (dx, dy) => this.cameras.periLook(dx, dy),
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

  private beginPatrol(): void {
    this.game = { ...startMission(this.game), settings: this.settings };
    const freighter = this.game.ships[0];
    if (freighter) this.game = selectTarget(this.game, freighter.id);
    this.sim = adaptToLookDevSim(this.game);
    this.patrol.render(this.game);
    this.tutorial.show();
    this.audio.unlock();
  }

  private restartPatrol(): void {
    this.game = { ...createGame(this.game.seed), settings: this.settings };
    this.sim = adaptToLookDevSim(this.game);
    this.patrol.render(this.game);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'KeyF' && this.game.phase === 'playing') {
      this.game = fireWeapon(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (e.code === 'KeyR' && this.game.phase === 'playing') {
      this.game = toggleSilentRunning(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (e.code === 'KeyC' && this.game.phase === 'playing') {
      this.game = deployCountermeasure(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (e.code === 'KeyT' && this.game.phase === 'playing' && this.game.ships[0]) {
      this.game = selectTarget(this.game, this.game.ships[0]!.id);
      this.sim = adaptToLookDevSim(this.game);
    }
    if (this.game.phase === 'playing') {
      const depth = ({ KeyZ: 'surface', KeyX: 'periscope', KeyC: 'attack', KeyV: 'deep' } as const)[
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
    if (action === 'help') { this.tutorial.show(true); return; }
    if (action === 'mute') { this.audio.setMuted(!this.audio.isMuted); return; }
    if (action === 'pause') { this.inputPause(); return; }
    if (this.game.phase !== 'playing') return;
    if (action === 'weapon' && value) this.game = setWeapon(this.game, value as 'torpedo' | 'seeker' | 'decoy');
    if (action === 'screen') this.game = deployCountermeasure(this.game);
    if (action === 'spread') this.game = toggleTorpedoSpread(this.game);
    if (action === 'sonar') this.game = sonarPulse(this.game);
    if (action === 'fire') this.game = fireWeapon(this.game);
    if (action === 'silent') this.game = toggleSilentRunning(this.game);
    if (action === 'scope') this.game = toggleScope(this.game);
    if (action === 'snorkel') this.game = toggleSnorkel(this.game);
    if (action === 'tactic' && value) this.game = setAutopilot(this.game, value as 'ambush' | 'stalk' | 'intercept' | 'evade' | 'exfil', this.game.selectedTargetId);
    if (action === 'stop-ai') this.game = cancelAutopilot(this.game);
    if (action === 'clear') this.game = clearEngagement(this.game);
    if (action === 'depth' && value) this.game = setDepthOrder(this.game, value as 'surface' | 'periscope' | 'attack' | 'deep');
    if (action === 'speed' && value) this.game = setSpeedOrder(this.game, value as 'stop' | 'oneThird' | 'twoThirds' | 'flank');
    this.audio.unlock();
    this.audio.sfxClick();
    this.sim = adaptToLookDevSim(this.game);
  }

  private inputPause(): void {
    if (this.game.phase !== 'playing' && this.game.phase !== 'paused') return;
    this.game = setPhase(this.game, this.game.phase === 'paused' ? 'playing' : 'paused');
    this.sim = adaptToLookDevSim(this.game);
    this.pauseBanner.hidden = this.game.phase !== 'paused';
  }

  private select(id: string): void {
    this.game = this.game.selectedTargetId === id ? clearEngagement(this.game) : selectTarget(this.game, id);
    this.sim = adaptToLookDevSim(this.game);
  }

  private plot(x: number, y: number): void {
    if (this.game.phase !== 'playing') return;
    this.game = orderMove(this.game, snapToNavigable(this.game, { x, y }));
    this.sim = adaptToLookDevSim(this.game);
  }

  private handleWorldInteraction(button: 0 | 2, clientX: number, clientY: number): void {
    if (this.game.phase !== 'playing') return;
    const canvas = $('scene').getBoundingClientRect();
    const point = snapToNavigable(this.game, { x: ((clientX - canvas.left) / canvas.width) * 96, y: ((clientY - canvas.top) / canvas.height) * 96 });
    const ship = this.game.ships.find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 3);
    if (button === 2) this.game = fireWeapon(this.game);
    else if (ship) this.select(ship.id);
    else this.plot(point.x, point.y);
    this.sim = adaptToLookDevSim(this.game);
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
  };

  private readonly onUnload = (): void => {
    saveSettings(this.settings);
    this.dispose();
  };

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const elapsed = (now - this.last) / 1000;
    this.last = now;

    this.input.update();

    const tick = advanceAccumulator(this.accum, elapsed);
    this.accum = tick.accum;
    const renderDt = tick.elapsedUsed;

    if (this.game.phase === 'playing') {
      for (let i = 0; i < tick.steps; i++) {
        const command: GameCommand = { type: 'helm', ...this.input.intent };
        this.game = updateGame(this.game, [command], FIXED_DT);
      }
      this.sim = adaptToLookDevSim(this.game);
    }

    this.scene.syncGame(this.game, this.sim, this.settings);
    this.cameras.update(this.sim, renderDt);
    this.renderer.setExposure(this.settings.atmosphere.exposure);
    this.renderer.render(this.scene.scene, this.cameras.camera);

    this.hud.render(this.game, this.sim, this.settings);
    this.audio.observe(this.game);
    this.peri.render(this.sim, this.settings, this.cameras.periYaw);
    this.sonar.render(this.sim, renderDt, this.reducedMotion);
    this.patrol.render(this.game);

    const fpsInst = renderDt > 0 ? 1 / renderDt : 60;
    this.fpsEma = this.fpsEma * 0.9 + fpsInst * 0.1;
    this.frameMsEma = this.frameMsEma * 0.9 + renderDt * 1000 * 0.1;
    const profile = this.quality.update(this.frameMsEma, renderDt);
    this.renderer.setQuality(QUALITY_PROFILES[profile]);
    this.scene.setQuality(QUALITY_PROFILES[profile]);
    if (this.panel.isVisible()) {
      this.panel.setPerf(this.fpsEma, this.frameMsEma, profile);
    }

    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    window.removeEventListener('keydown', this.onKeyDown);
    this.input.dispose();
    this.tutorial.dispose();
    this.audio.dispose();
    this.scene.dispose();
    this.renderer.dispose();
  }
}
