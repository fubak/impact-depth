import { loadSettings, saveSettings } from './core/settings';
import {
  advanceAccumulator,
  FIXED_DT,
} from './core/sim';
import type { LookDevSettings, SimState, ViewMode } from './core/types';
import { adaptToLookDevSim } from './game/adapt/lookdev';
import type { GameCommand } from './game/commands/types';
import { createGame, setPhase, updateGame } from './game/sim/api';
import type { GameState } from './game/sim/types';
import { InputController } from './input/controls';
import { CameraRig } from './render/cameras';
import { RendererHost } from './render/renderer';
import { GameScene } from './render/scene';
import { Hud } from './ui/hud';
import { LookDevPanel } from './ui/panel';
import { PeriscopeOverlay } from './ui/periscope';
import { SonarScope } from './ui/sonar';

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
  private readonly sonar: SonarScope;
  private readonly peri: PeriscopeOverlay;
  private readonly pauseBanner: HTMLElement;
  private readonly appRoot: HTMLElement;
  private accum = 0;
  private last = performance.now();
  private running = true;
  private raf = 0;
  private readonly reducedMotion: boolean;
  private fpsEma = 60;
  private frameMsEma = 16.7;

  constructor() {
    this.settings = loadSettings();
    this.game = { ...setPhase(createGame(), 'playing'), settings: this.settings };
    this.sim = adaptToLookDevSim(this.game);
    this.reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const canvas = $('scene') as HTMLCanvasElement;
    this.appRoot = $('app');
    this.renderer = new RendererHost(canvas);
    this.renderer.setExposure(this.settings.atmosphere.exposure);
    this.scene = new GameScene();
    this.cameras = new CameraRig(window.innerWidth / Math.max(1, window.innerHeight));
    this.cameras.setMode(this.sim.viewMode);

    this.hud = new Hud($('hud'), $('help-strip'));
    this.pauseBanner = $('pause-banner');
    this.sonar = new SonarScope(
      $('sonar-overlay'),
      $('sonar-canvas') as HTMLCanvasElement,
      $('sonar-telemetry'),
    );
    this.peri = new PeriscopeOverlay(
      $('periscope-overlay'),
      $('peri-bearing'),
      $('peri-range'),
    );

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
      togglePause: () => {
        this.game = setPhase(this.game, this.game.phase === 'paused' ? 'playing' : 'paused');
        this.sim = adaptToLookDevSim(this.game);
        this.pauseBanner.hidden = !this.sim.paused;
      },
      togglePanel: () => this.panel.toggle(),
      orbit: (dx, dy) => this.cameras.orbit(dx, dy),
      periLook: (dx, dy) => this.cameras.periLook(dx, dy),
      zoom: (d) => this.cameras.zoom(d),
      getViewMode: () => this.sim.viewMode,
    });

    this.applyPresentationCss();
    this.syncOverlays();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.onUnload);
    this.raf = requestAnimationFrame(this.frame);
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

    if (!this.sim.paused) {
      for (let i = 0; i < tick.steps; i++) {
        const command: GameCommand = { type: 'helm', ...this.input.intent };
        this.game = updateGame(this.game, [command], FIXED_DT);
      }
      this.sim = adaptToLookDevSim(this.game);
    }

    this.scene.sync(this.sim, this.settings);
    this.cameras.update(this.sim, renderDt);
    this.renderer.setExposure(this.settings.atmosphere.exposure);
    this.renderer.render(this.scene.scene, this.cameras.camera);

    this.hud.render(this.sim, this.settings);
    this.peri.render(this.sim, this.settings, this.cameras.periYaw);
    this.sonar.render(this.sim, renderDt, this.reducedMotion);

    const fpsInst = renderDt > 0 ? 1 / renderDt : 60;
    this.fpsEma = this.fpsEma * 0.9 + fpsInst * 0.1;
    this.frameMsEma = this.frameMsEma * 0.9 + renderDt * 1000 * 0.1;
    if (this.panel.isVisible()) {
      this.panel.setPerf(this.fpsEma, this.frameMsEma);
    }

    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    this.input.dispose();
    this.scene.dispose();
    this.renderer.dispose();
  }
}
