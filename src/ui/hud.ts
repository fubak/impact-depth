import { formatDepth, formatSpeed } from '../core/sim';
import type { LookDevSettings, SimState } from '../core/types';
import type { AutopilotTactic, DepthOrder, GameState, SpeedOrder } from '../game/sim/types';

const MODE_LABEL: Record<SimState['viewMode'], string> = {
  tactical: 'TACTICAL',
  chase: 'CHASE',
  bridge: 'BRIDGE',
  periscope: 'PERISCOPE',
  free: 'FREE CAMERA',
  map: 'MAP',
  sonar: 'SONAR PLOT',
};

export type HudCallbacks = {
  command: (action: string, value?: string) => void;
  plot: (x: number, y: number) => void;
  select: (id: string) => void;
  isMuted: () => boolean;
};

const DEPTHS: readonly [DepthOrder, string][] = [['surface', 'Surf'], ['periscope', 'Peri'], ['attack', 'Atk'], ['deep', 'Deep']];
const SPEEDS: readonly [SpeedOrder, string][] = [['stop', 'Stop'], ['oneThird', '1/3'], ['twoThirds', '2/3'], ['flank', 'Flank']];
const TACTICS: readonly [AutopilotTactic, string][] = [['ambush', 'Ambush'], ['stalk', 'Stalk'], ['intercept', 'Intercept'], ['evade', 'Evade'], ['exfil', 'RTB']];

function button(action: string, label: string, active = false, value?: string, disabled = false): string {
  return `<button class="hud-btn${active ? ' active' : ''}" data-action="${action}"${value ? ` data-value="${value}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`;
}

function depthBand(depth: number): string {
  if (depth < 0.15) return 'SURFACE';
  if (depth < 0.42) return 'PERISCOPE';
  if (depth < 0.7) return 'ATTACK';
  return 'DEEP';
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;
  private lastRender = 0;

  constructor(root: HTMLElement, help: HTMLElement, private readonly cb: HudCallbacks) {
    this.root = root;
    this.help = help;
    this.help.innerHTML = `
      <span><kbd>WASD</kbd> helm</span>
      <span><kbd>Q</kbd>/<kbd>E</kbd> helm depth</span>
      <span><kbd>F</kbd>/<kbd>RMB</kbd> fire</span>
      <span><kbd>T</kbd> target</span>
      <span><kbd>R</kbd> silent</span>
      <span><kbd>C</kbd> screen</span>
      <span><kbd>1–7</kbd> POV</span>
      <span><kbd>Space</kbd> pause</span>
      <span><kbd>H</kbd> tune</span>
    `;
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('pointerdown', this.onMapPointer);
  }

  render(game: GameState, sim: SimState, settings: LookDevSettings): void {
    const now = performance.now();
    if (now - this.lastRender < 125) return;
    this.lastRender = now;
    const v = sim.vessel;
    const opacity = settings.presentation.hudOpacity;
    this.root.style.opacity = String(opacity);
    this.help.style.opacity = String(Math.min(1, opacity + 0.05));

    const sub = game.submarine;
    const contacts = game.sonarContacts.slice(0, 6);
    const fobSafe = Math.hypot(sub.x - game.base.x, sub.y - game.base.y) <= game.base.radius;
    const weapon = game.weaponMode;
    const message = game.messages[0];
    this.root.innerHTML = `
      <section class="hud-block hud-status" data-tutorial="status" aria-label="Boat status">
        <div class="hud-title">USS NAUTILUS</div>
        <div class="hud-sub">FLEET BOAT · ${depthBand(sub.z)} · ${sub.z < 0.5 ? 'ABOVE LAYER' : 'BELOW LAYER'}</div>
        <div class="status-grid">
          <span>HULL <b>${Math.ceil(sub.hp)}%</b></span><span>BAT <b>${Math.ceil(sub.battery)}%</b></span>
          <span>NOISE <b>${Math.ceil(sub.noise * 100)}%</b></span><span>FLOOD <b>${Math.ceil(sub.sysFlood * 100)}%</b></span>
          <span>DAY <b>${Math.floor((game.time / 60) % 24).toString().padStart(2, '0')}:00</b></span><span>FOB <b>${fobSafe ? 'SAFE' : 'OUT'}</b></span>
        </div>
        <div class="upgrade-pips" aria-label="Upgrades">H ${'●'.repeat(sub.hullTier)}${'○'.repeat(3 - sub.hullTier)} W ${'●'.repeat(sub.weaponTier)}${'○'.repeat(3 - sub.weaponTier)} E ${'●'.repeat(sub.speedTier)}${'○'.repeat(3 - sub.speedTier)}</div>
      </section>
      <section class="hud-block hud-score" aria-label="Patrol score">
        <span>SCORE <b>${game.stats.score}</b></span><span>WAVE <b>${game.stats.wave}</b></span><span>SUNK <b>${game.stats.shipsSunk}</b></span><span>TIME <b>${Math.floor(game.stats.timeSurvived / 60)}:${String(Math.floor(game.stats.timeSurvived % 60)).padStart(2, '0')}</b></span>
      </section>
      <section class="hud-block hud-contacts" data-tutorial="contacts" aria-label="Hydrophone contacts">
        <div class="panel-label">HYDROPHONE <span>${contacts.length}/6</span></div>
        ${contacts.length ? contacts.map((contact) => `<button class="contact${contact.targetId === game.selectedTargetId ? ' active' : ''}" data-contact="${contact.targetId ?? ''}" ${contact.targetId ? '' : 'disabled'}><b>${contact.label}</b><span>${Math.round(contact.bearing * 180 / Math.PI + 360) % 360}° · ${Math.ceil(contact.range)}u</span></button>`).join('') : '<p class="empty">Listening… no firm contacts</p>'}
      </section>
      <section class="hud-block hud-magazine" data-tutorial="magazine" aria-label="Weapon magazine">
        <div class="panel-label">MAGAZINE</div>
        <div class="mag-grid">
          ${button('weapon', `Mk-14 ${sub.torpedoes} · ${Math.ceil(sub.reloadMk14)}s`, weapon === 'torpedo', 'torpedo')}
          ${button('weapon', `Mk-18 ${sub.seekers} · ${Math.ceil(sub.reloadMk18)}s`, weapon === 'seeker', 'seeker')}
          ${button('weapon', `Foxer ${sub.decoys}`, weapon === 'decoy', 'decoy')}
          ${button('screen', `Screen ${sub.cmCharges}`, false, undefined, sub.cmCooldown > 0)}
          ${button('spread', game.torpedoSpread ? 'Spread' : 'Single', game.torpedoSpread)}
          ${button('sonar', game.sonarCooldown > 0 ? `Sonar ${Math.ceil(game.sonarCooldown)}s` : 'Sonar', false, undefined, game.sonarCooldown > 0)}
          ${button('fire', 'FIRE', false, undefined, sub.reload > 0)}
        </div>
      </section>
      <section class="hud-block hud-tactics" data-tutorial="tactics" aria-label="Tactical controls">
        <div class="panel-label">TACTICS <span>${game.autopilot.enabled ? game.autopilot.tactic.toUpperCase() : 'MANUAL'}</span></div>
        <div class="control-row">${button('silent', 'Silent', sub.silentRunning)}${button('scope', 'Scope', sub.scopeUp)}${button('snorkel', 'Snorkel', sub.snorkel)}</div>
        <div class="control-row">${TACTICS.map(([tactic, label]) => button('tactic', label, game.autopilot.tactic === tactic && game.autopilot.enabled, tactic)).join('')}</div>
        <div class="control-row">${button('stop-ai', 'Stop AI')}${button('clear', 'Clear')}</div>
      </section>
      <section class="hud-block hud-depth" data-tutorial="depth" aria-label="Depth order">
        <div class="panel-label">DEPTH <span>${formatDepth(v.depth)}</span></div><div class="control-row">${DEPTHS.map(([order, label]) => button('depth', label, sub.targetDepth === ({ surface: 0.05, periscope: 0.28, attack: 0.5, deep: 0.78 }[order]), order)).join('')}</div>
      </section>
      <section class="hud-block hud-speed" aria-label="Speed order">
        <div class="panel-label">SPEED <span>${formatSpeed(v.speed)}</span></div><div class="control-row">${SPEEDS.map(([order, label]) => button('speed', label, sub.speedOrder === order, order)).join('')}</div>
      </section>
      <section class="hud-block hud-minimap" data-tutorial="minimap" aria-label="Minimap; click to plot course">
        <div class="panel-label">TACTICAL PLOT <span>${MODE_LABEL[sim.viewMode]}</span></div>
        <svg class="map" viewBox="0 0 96 96" role="img" aria-label="Sector map">
          <path class="land" d="M3 7 Q17 2 24 13 T38 9 L34 22 Q21 26 15 20 L3 24Z M71 75 Q87 67 94 79 L93 95 L73 94Z"/>
          <circle class="fob" cx="${game.base.x}" cy="${game.base.y}" r="${game.base.radius}"/><circle class="player" cx="${sub.x}" cy="${sub.y}" r="2"/>
          ${game.ships.map((ship) => `<circle class="ship${ship.id === game.selectedTargetId ? ' selected' : ''}" cx="${ship.x}" cy="${ship.y}" r="1.4"/>`).join('')}
          ${game.powerups.map((pickup) => `<rect class="crate" x="${pickup.x - 1}" y="${pickup.y - 1}" width="2" height="2"/>`).join('')}
        </svg>
      </section>
      <section class="hud-chrome" aria-label="Game controls">${button('pause', game.phase === 'paused' ? 'Resume' : 'Pause')}${button('mute', this.cb.isMuted() ? 'Unmute' : 'Mute')}${button('help', 'Help')}</section>
      <div class="hud-toasts" aria-live="polite">${message ? `<div class="toast">${message.text.replace(/(\d+\.\d+)s/g, (_, n: string) => `${Math.ceil(Number(n))}s`)}</div>` : ''}</div>
    `;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    if (target.dataset.contact) this.cb.select(target.dataset.contact);
    else if (target.dataset.action) this.cb.command(target.dataset.action, target.dataset.value);
  };

  private readonly onMapPointer = (event: PointerEvent): void => {
    const map = (event.target as Element).closest<SVGSVGElement>('svg.map');
    if (!map || event.button !== 0) return;
    const rect = map.getBoundingClientRect();
    this.cb.plot(((event.clientX - rect.left) / rect.width) * 96, ((event.clientY - rect.top) / rect.height) * 96);
  };
}
