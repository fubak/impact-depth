import { engineOrderLabel, formatDepth, formatSpeed, headingDegrees } from '../core/sim';
import { seaStateLabel } from '../core/waves';
import type { LookDevSettings, SimState } from '../core/types';
import type { GameState } from '../game/sim/types';

const MODE_LABEL: Record<SimState['viewMode'], string> = {
  tactical: 'TACTICAL',
  periscope: 'PERISCOPE',
  sonar: 'SONAR PLOT',
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;

  constructor(root: HTMLElement, help: HTMLElement) {
    this.root = root;
    this.help = help;
    this.help.innerHTML = `
      <span><kbd>WASD</kbd> helm</span>
      <span><kbd>Q</kbd>/<kbd>E</kbd> depth</span>
      <span><kbd>F</kbd> fire Mk-14</span>
      <span><kbd>T</kbd> target</span>
      <span><kbd>R</kbd> silent</span>
      <span><kbd>1</kbd> tac <kbd>2</kbd> peri <kbd>3</kbd> sonar</span>
      <span><kbd>Space</kbd> pause</span>
      <span><kbd>H</kbd> tune</span>
    `;
  }

  render(game: GameState, sim: SimState, settings: LookDevSettings): void {
    const v = sim.vessel;
    const opacity = settings.presentation.hudOpacity;
    this.root.style.opacity = String(opacity);
    this.help.style.opacity = String(Math.min(1, opacity + 0.05));

    this.root.innerHTML = `
      <div class="hud-block hud-identity">
        <div class="hud-title">USS NAUTILUS</div>
        <div class="hud-sub">SSN · FLEET BOAT</div>
      </div>
      <div class="hud-block hud-telemetry">
        <div class="tel"><span class="k">HDG</span><span class="v">${String(headingDegrees(v.heading)).padStart(3, '0')}°</span></div>
        <div class="tel"><span class="k">SPD</span><span class="v">${formatSpeed(v.speed)}</span></div>
        <div class="tel"><span class="k">DEP</span><span class="v">${formatDepth(v.depth)}</span></div>
        <div class="tel"><span class="k">ENG</span><span class="v">${engineOrderLabel(v.engineOrder)}</span></div>
        <div class="tel"><span class="k">BAT</span><span class="v">${Math.round(v.battery)}%</span></div>
        <div class="tel"><span class="k">NSE</span><span class="v">${(v.noise * 100).toFixed(0)}%</span></div>
        <div class="tel"><span class="k">HULL</span><span class="v">${Math.round(game.submarine.hp)}%</span></div>
        <div class="tel"><span class="k">ORDER</span><span class="v">${game.submarine.speedOrder} / ${game.submarine.targetDepth.toFixed(2)}</span></div>
        <div class="tel"><span class="k">MK-14</span><span class="v">${game.submarine.torpedoes} · ${game.submarine.reloadMk14.toFixed(1)}s</span></div>
        <div class="tel"><span class="k">CONTACT</span><span class="v">${game.selectedTargetId ?? 'NONE'}</span></div>
        <div class="tel"><span class="k">SCORE</span><span class="v">${game.stats.score}</span></div>
        <div class="tel"><span class="k">SEA</span><span class="v">${seaStateLabel(settings.ocean.seaState)}</span></div>
        <div class="tel"><span class="k">MODE</span><span class="v accent">${MODE_LABEL[sim.viewMode]}</span></div>
      </div>
      <div class="hud-block hud-mission">
        <div class="k">OBJECTIVE</div>
        <div class="mission">${sim.mission}</div>
      </div>
    `;
  }
}
