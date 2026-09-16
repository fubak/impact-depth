import { formatDepth, formatSpeed, headingDegrees } from '../core/sim';
import { ISLAND_MESH_RADIUS_FACTOR, ISLAND_SPECS } from '../core/terrain';
import type { LookDevSettings, SimState } from '../core/types';
import {
  DEPTH_TARGET,
  FIRE_MAX_DEPTH,
  FIRE_MIN_DEPTH,
  METERS_PER_UNIT,
  WORLD_SIZE,
} from '../game/sim/constants';
import { worldMetersToSim } from '../game/sim/coords';
import type { AutopilotTactic, DepthOrder, GameState, SpeedOrder } from '../game/sim/types';
import { getTerrain, isLand } from '../game/sim/world';
import { findPixelProximateContact, MAP_PROXIMATE_PX } from '../input/world-click';
import { listFirmContacts, type FirmContact } from './sonar';

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

const DEPTHS: readonly [DepthOrder, string, string][] = [
  ['surface', 'Surf', 'Surface — fastest transit, fully exposed'],
  ['periscope', 'Peri', 'Periscope depth — fire from tubes, visual attacks'],
  ['attack', 'Atk', 'Attack depth — balanced combat band'],
  ['deep', 'Deep', 'Deep — quieter, safer, slower, cannot fire'],
];
const SPEEDS: readonly [SpeedOrder, string, string][] = [
  ['stop', 'Stop', 'All stop'],
  ['oneThird', '1/3', 'One-third speed — stealthy cruise'],
  ['twoThirds', '2/3', 'Two-thirds speed — standard transit'],
  ['flank', 'Flank', 'Flank speed — noisy and battery-heavy'],
];
const TACTICS: readonly [AutopilotTactic, string, string][] = [
  ['ambush', 'Ambush', 'Quiet approach on the beam, rise, fire, break deep'],
  ['stalk', 'Stalk', 'Trail the contact from the wake station'],
  ['intercept', 'Intercept', 'Sprint closed on the predicted intercept'],
  ['evade', 'Evade', 'Open range and break contact'],
  ['exfil', 'Home', 'Return to base — dock at FOB Argus for repair/restock'],
];
const SPEED_FRACTION: Record<SpeedOrder, number> = {
  stop: 0,
  oneThird: 1 / 3,
  twoThirds: 2 / 3,
  flank: 1,
};
const DEPTH_LABEL: Record<DepthOrder, string> = {
  surface: 'SURFACE',
  periscope: 'PERISCOPE',
  attack: 'ATTACK',
  deep: 'DEEP',
};

const HUD_PANEL_KEY = 'silent-depths-hud-panels-v1';

type PanelPrefs = { gear: boolean; doctrine: boolean };

function loadPanelPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(HUD_PANEL_KEY);
    if (!raw) return { gear: true, doctrine: true };
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      gear: parsed.gear !== false,
      doctrine: parsed.doctrine !== false,
    };
  } catch {
    return { gear: true, doctrine: true };
  }
}

function savePanelPrefs(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(HUD_PANEL_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

function tipAttr(tip: string): string {
  return ` title="${escapeAttr(tip)}" data-tip="${escapeAttr(tip)}"`;
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function button(
  action: string,
  label: string,
  active = false,
  value?: string,
  disabled = false,
  pending = false,
  tip?: string,
): string {
  const cls = `hud-btn${active ? ' active' : ''}${pending ? ' pending' : ''}`;
  return `<button type="button" class="${cls}" data-action="${action}"${value ? ` data-value="${value}"` : ''}${disabled ? ' disabled' : ''}${tip ? tipAttr(tip) : ''}>${label}</button>`;
}

function depthBand(depth: number): string {
  if (depth < 0.15) return 'SURFACE';
  if (depth < 0.42) return 'PERISCOPE';
  if (depth < 0.7) return 'ATTACK';
  return 'DEEP';
}

function orderedDepth(target: number): DepthOrder {
  let best: DepthOrder = 'surface';
  let bestDist = Infinity;
  for (const [order, value] of Object.entries(DEPTH_TARGET) as [DepthOrder, number][]) {
    const dist = Math.abs(target - value);
    if (dist < bestDist) {
      best = order;
      bestDist = dist;
    }
  }
  return best;
}

function contactsMarkup(contacts: readonly FirmContact[], selectedTargetId: string | null): string {
  if (!contacts.length) return '<p class="empty">Listening… no firm contacts</p>';
  return contacts
    .map((contact) => {
      const brg = String(headingDegrees(contact.bearing)).padStart(3, '0');
      const active = contact.id === selectedTargetId ? ' active' : '';
      return `<button type="button" class="contact${active}" data-contact="${contact.id}"${tipAttr('Select to aim tubes and AI')}><b>${contact.name}</b><span>${brg}° · ${Math.ceil(contact.range)}u</span></button>`;
    })
    .join('');
}

function fireStatus(game: GameState): { ready: boolean; label: string; tip: string } {
  const sub = game.submarine;
  if (sub.sysTubes < 0.35)
    return { ready: false, label: 'TUBES DAMAGED', tip: 'Repair at FOB Argus' };
  if (sub.z < FIRE_MIN_DEPTH)
    return {
      ready: false,
      label: 'DIVE TO FIRE',
      tip: 'Go to peri or attack depth before opening tubes',
    };
  if (sub.z > FIRE_MAX_DEPTH)
    return { ready: false, label: 'TOO DEEP', tip: 'Rise to attack or peri depth to fire' };
  if (game.weaponMode === 'torpedo') {
    if (sub.torpedoes <= 0)
      return { ready: false, label: 'NO MK-14', tip: 'Straight runners empty — restock at FOB' };
    if (sub.reloadMk14 > 0)
      return {
        ready: false,
        label: `RELOAD ${Math.ceil(sub.reloadMk14)}s`,
        tip: 'Mk-14 tube reloading',
      };
    return {
      ready: true,
      label: game.selectedTargetId ? 'MK-14 READY' : 'PICK TARGET',
      tip: game.selectedTargetId
        ? 'Straight-running torpedo — aim with target selected'
        : 'Select a contact (list, map, or T) then fire',
    };
  }
  if (game.weaponMode === 'seeker') {
    if (sub.seekers <= 0)
      return { ready: false, label: 'NO MK-18', tip: 'Acoustic seekers empty — restock at FOB' };
    if (sub.reloadMk18 > 0)
      return {
        ready: false,
        label: `RELOAD ${Math.ceil(sub.reloadMk18)}s`,
        tip: 'Mk-18 tube reloading',
      };
    return {
      ready: true,
      label: game.selectedTargetId ? 'MK-18 READY' : 'PICK TARGET',
      tip: 'Acoustic seeker — locks onto noisy contacts',
    };
  }
  if (sub.decoys <= 0)
    return { ready: false, label: 'NO DECOYS', tip: 'Foxers spent — restock at FOB' };
  return { ready: true, label: 'DECOY READY', tip: 'Deploy a towed noise maker (Foxer)' };
}

/** SVG land that matches sim heightfield + island discs (not a decorative hardcoded path). */
function buildLandSvg(terrainSeed: number): string {
  const terrain = getTerrain(terrainSeed);
  const parts: string[] = [];
  for (const island of ISLAND_SPECS) {
    const center = worldMetersToSim(island.cx, island.cz);
    const radius = (island.radius * ISLAND_MESH_RADIUS_FACTOR) / METERS_PER_UNIT;
    parts.push(
      `<circle class="land" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="${radius.toFixed(2)}"/>`,
    );
  }
  const step = 2;
  for (let y = 0; y < WORLD_SIZE; y += step) {
    for (let x = 0; x < WORLD_SIZE; x += step) {
      if (!isLand(terrain, x + step * 0.5, y + step * 0.5)) continue;
      parts.push(
        `<rect class="land" x="${x}" y="${y}" width="${step}" height="${step}" opacity="0.85"/>`,
      );
    }
  }
  return parts.join('');
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly help: HTMLElement;
  private lastRender = 0;
  private lastShips: ReadonlyArray<{ id: string; x: number; y: number }> = [];
  private landSvg = '';
  private landSeed: number | null = null;
  private chromeKey = '';
  private lastActionAt = 0;
  private panels: PanelPrefs = loadPanelPrefs();

  constructor(
    root: HTMLElement,
    help: HTMLElement,
    private readonly cb: HudCallbacks,
  ) {
    this.root = root;
    this.help = help;
    this.help.innerHTML = `
      <span class="help-group"><kbd>WASD</kbd> steer</span>
      <span class="help-group"><kbd>Q</kbd>/<kbd>E</kbd> trim · <kbd>Z</kbd><kbd>X</kbd><kbd>B</kbd><kbd>V</kbd> depth · <kbd>G</kbd> blow tanks</span>
      <span class="help-group"><kbd>0</kbd><kbd>I</kbd><kbd>O</kbd><kbd>P</kbd> speed</span>
      <span class="help-group"><kbd>F</kbd>/<kbd>RMB</kbd> fire · <kbd>T</kbd> target</span>
      <span class="help-group"><kbd>R</kbd> quiet · <kbd>C</kbd> bubbles</span>
      <span class="help-group"><kbd>1–7</kbd> view · <kbd>Space</kbd> pause · <kbd>H</kbd> look-dev</span>
    `;
    // pointerdown survives the ~8 Hz innerHTML rebuild better than click.
    this.root.addEventListener('pointerdown', this.onPointerAction);
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

    if (this.landSeed !== game.terrainSeed) {
      this.landSeed = game.terrainSeed;
      this.landSvg = buildLandSvg(game.terrainSeed);
    }

    const sub = game.submarine;
    // GameState.ships — same firm contacts as the sonar plot (not delayed hydrophone sonarContacts).
    const contacts = listFirmContacts(
      sub.x,
      sub.y,
      game.ships.map((ship) => ({
        id: ship.id,
        name: ship.name,
        kind: ship.kind,
        x: ship.x,
        y: ship.y,
      })),
      6,
    );
    this.lastShips = game.ships.map((ship) => ({ id: ship.id, x: ship.x, y: ship.y }));
    const fobSafe = Math.hypot(sub.x - game.base.x, sub.y - game.base.y) <= game.base.radius;
    const weapon = game.weaponMode;
    const message = game.messages[0];
    const depthOrder = orderedDepth(sub.targetDepth);
    const depthSettled = Math.abs(sub.z - sub.targetDepth) < 0.02;
    const speedSettled = Math.abs(sub.speed - sub.targetSpeed) < 0.05;
    const tubes = fireStatus(game);
    const target = game.ships.find((ship) => ship.id === game.selectedTargetId);
    const targetRange = target ? Math.hypot(target.x - sub.x, target.y - sub.y) : null;
    const headingDeg = Math.round(
      (((sub.displayHeading ?? sub.heading) * 180) / Math.PI + 360) % 360,
    );
    const course =
      game.autopilot.waypoint != null
        ? `PLOT ${Math.round(game.autopilot.waypoint.x)},${Math.round(game.autopilot.waypoint.y)}`
        : game.autopilot.enabled
          ? `${game.autopilot.tactic === 'exfil' ? 'HOME' : game.autopilot.tactic.toUpperCase()} · ${game.autopilot.phase.toUpperCase()}`
          : 'MANUAL HELM';
    const fireDisabled =
      !tubes.ready ||
      (weapon === 'torpedo'
        ? sub.reloadMk14 > 0 || sub.torpedoes <= 0
        : weapon === 'seeker'
          ? sub.reloadMk18 > 0 || sub.seekers <= 0
          : sub.decoys <= 0);

    const chromeKey = [
      game.phase,
      weapon,
      game.torpedoSpread ? 1 : 0,
      sub.silentRunning ? 1 : 0,
      sub.scopeUp ? 1 : 0,
      sub.snorkel ? 1 : 0,
      game.autopilot.enabled ? game.autopilot.tactic : 'off',
      depthOrder,
      depthSettled ? 1 : 0,
      sub.speedOrder,
      speedSettled ? 1 : 0,
      tubes.ready ? 1 : 0,
      tubes.label,
      fireDisabled ? 1 : 0,
      sub.cmCooldown > 0 ? 1 : 0,
      game.sonarCooldown > 0 ? 1 : 0,
      this.cb.isMuted() ? 1 : 0,
      this.panels.gear ? 1 : 0,
      this.panels.doctrine ? 1 : 0,
      game.selectedTargetId ?? '',
      contacts.map((c) => c.id).join('|'),
      sub.torpedoes,
      sub.seekers,
      sub.decoys,
      sub.cmCharges,
    ].join('/');

    if (chromeKey === this.chromeKey && this.root.childElementCount > 0) {
      this.patchDynamic(game, sim, {
        course,
        depthOrder,
        depthSettled,
        speedSettled,
        headingDeg,
        tubes,
        target,
        targetRange,
        fobSafe,
        message,
        contacts,
      });
      return;
    }
    this.chromeKey = chromeKey;

    const layerSide = sub.z < 0.5 ? 'ABOVE LAYER' : 'BELOW LAYER';
    const reload14 = Math.ceil(sub.reloadMk14);
    const reload18 = Math.ceil(sub.reloadMk18);

    this.root.innerHTML = `
      <section class="hud-block hud-status" data-tutorial="status" aria-label="Boat status">
        <div class="hud-title">USS NAUTILUS</div>
        <div class="hud-sub" data-field="band"${tipAttr(
          'Thermocline layer: quiet water below masks sound — escorts detect you more easily above it',
        )}>FLEET BOAT · ${depthBand(sub.z)} · ${layerSide}</div>
        <div class="status-grid">
          <span${tipAttr('Hull integrity — 0% ends the patrol')}><span class="status-k">Hull</span> <b data-field="hull">${Math.ceil(sub.hp)}%</b></span>
          <span${tipAttr('Battery — drains submerged, recharges snorkel/surface')}><span class="status-k">Battery</span> <b data-field="bat">${Math.ceil(sub.battery)}%</b></span>
          <span${tipAttr('Own noise — what enemy hydrophones hear')}><span class="status-k">Noise</span> <b data-field="noise">${Math.ceil(sub.noise * 100)}%</b></span>
          <span${tipAttr('Flooding — rise and RTB if severe')}><span class="status-k">Flood</span> <b data-field="flood">${Math.ceil(sub.sysFlood * 100)}%</b></span>
          <span${tipAttr('Mission clock (in-world day hour)')}><span class="status-k">Day</span> <b data-field="day">${Math.floor(
            (game.time / 60) % 24,
          )
            .toString()
            .padStart(2, '0')}:00</b></span>
          <span${tipAttr('Inside FOB Argus ring — repair and restock when SAFE')}><span class="status-k">FOB</span> <b data-field="fob">${fobSafe ? 'SAFE' : 'OUT'}</b></span>
        </div>
        <div class="upgrade-pips" aria-label="Upgrade tiers"${tipAttr('Pickup crates raise hull / weapons / engine tiers')}>
          <span>Hull ${'●'.repeat(sub.hullTier)}${'○'.repeat(3 - sub.hullTier)}</span>
          <span>Wpn ${'●'.repeat(sub.weaponTier)}${'○'.repeat(3 - sub.weaponTier)}</span>
          <span>Eng ${'●'.repeat(sub.speedTier)}${'○'.repeat(3 - sub.speedTier)}</span>
        </div>
      </section>
      <section class="hud-block hud-orders" aria-label="Active orders">
        <div class="panel-label">ORDERS <span data-field="course">${course}</span></div>
        <div class="order-grid">
          <div class="order-row"${tipAttr('Current depth and ordered band')}><span>Depth</span><b data-field="order-depth" class="${depthSettled ? 'settled' : 'changing'}">${formatDepth(v.depth)} → ${DEPTH_LABEL[depthOrder]}</b></div>
          <div class="order-row"${tipAttr('Current speed and ordered pace')}><span>Speed</span><b data-field="order-speed" class="${speedSettled ? 'settled' : 'changing'}">${formatSpeed(v.speed)} → ${SPEEDS.find(([o]) => o === sub.speedOrder)?.[1] ?? sub.speedOrder.toUpperCase()}</b></div>
          <div class="order-row"><span>Hdg</span><b data-field="hdg">${headingDeg}°</b></div>
          <div class="order-row"${tipAttr('Stealth posture and helm AI')}><span>Stance</span><b data-field="mode">${[
            sub.silentRunning ? 'QUIET' : null,
            sub.scopeUp ? 'SCOPE' : null,
            sub.snorkel ? 'SNORKEL' : null,
            game.autopilot.enabled
              ? game.autopilot.tactic === 'exfil'
                ? 'HOME'
                : game.autopilot.tactic.toUpperCase()
              : 'MANUAL',
          ]
            .filter(Boolean)
            .join(' · ')}</b></div>
          <div class="order-row"${tipAttr('Selected contact for fire and doctrine')}><span>Target</span><b data-field="target" class="${target ? 'engaged' : ''}">${
            target
              ? `${target.name} · ${Math.ceil(targetRange ?? 0)}u · ${Math.round(target.hp)}% HP`
              : 'None — map / list / T'
          }</b></div>
        </div>
      </section>
      <section class="hud-block hud-score" aria-label="Patrol score">
        <span>Score <b data-field="score">${game.stats.score}</b></span>
        <span>Wave <b data-field="wave">${game.stats.wave}</b></span>
        <span>Sunk <b data-field="sunk">${game.stats.shipsSunk}</b></span>
        <span>Time <b data-field="time">${Math.floor(game.stats.timeSurvived / 60)}:${String(Math.floor(game.stats.timeSurvived % 60)).padStart(2, '0')}</b></span>
      </section>
      <section class="hud-block hud-contacts" data-tutorial="contacts" aria-label="Hydrophone contacts">
        <div class="panel-label" ${tipAttr('Same contacts as the sonar plot — select to aim')}>CONTACTS <span data-field="contact-count">${contacts.length}/6</span></div>
        <div data-field="contacts">
        ${contactsMarkup(contacts, game.selectedTargetId)}
        </div>
      </section>
      <section class="hud-block hud-magazine" data-tutorial="magazine" aria-label="Weapons">
        <div class="panel-label">WEAPONS <span data-field="mag-status" class="${tubes.ready ? 'ready' : 'locked'}"${tipAttr(tubes.tip)}>${tubes.label}</span></div>
        <div class="mag-grid mag-primary">
          ${button(
            'weapon',
            `Mk-14 ×${sub.torpedoes}`,
            weapon === 'torpedo',
            'torpedo',
            false,
            false,
            reload14 > 0
              ? `Straight torpedo · reload ${reload14}s`
              : 'Straight-running Mk-14 — needs a selected target',
          )}
          ${button(
            'weapon',
            `Mk-18 ×${sub.seekers}`,
            weapon === 'seeker',
            'seeker',
            false,
            false,
            reload18 > 0
              ? `Seeker torpedo · reload ${reload18}s`
              : 'Acoustic Mk-18 seeker — tracks noisy contacts',
          )}
          ${button('fire', tubes.ready ? 'FIRE' : tubes.label, false, undefined, fireDisabled, false, tubes.tip)}
        </div>
        <div class="control-row fold-row">
          ${button(
            'toggle-gear',
            this.panels.gear ? 'Gear ▴' : 'Gear ▾',
            this.panels.gear,
            undefined,
            false,
            false,
            this.panels.gear
              ? 'Hide decoys, bubbles, spread, and sonar'
              : 'Show decoys, bubbles, spread, and sonar',
          )}
        </div>
        <div class="mag-grid mag-secondary${this.panels.gear ? '' : ' is-collapsed'}" data-panel="gear">
          ${button(
            'weapon',
            `Decoy ×${sub.decoys}`,
            weapon === 'decoy',
            'decoy',
            false,
            false,
            'Foxer towed decoy — select then FIRE to stream noise',
          )}
          ${button(
            'screen',
            `Bubbles ×${sub.cmCharges}`,
            false,
            undefined,
            sub.cmCooldown > 0,
            false,
            sub.cmCooldown > 0
              ? `Bubble screen recharging ${Math.ceil(sub.cmCooldown)}s`
              : 'Bubble screen — masks your position from weapons and sonar',
          )}
          ${button(
            'spread',
            game.torpedoSpread ? 'Spread' : 'Single',
            game.torpedoSpread,
            undefined,
            false,
            false,
            game.torpedoSpread
              ? 'Spread fire on — multiple fish per salvo'
              : 'Single shot — one fish per FIRE',
          )}
          ${button(
            'sonar',
            game.sonarCooldown > 0 ? `Ping ${Math.ceil(game.sonarCooldown)}s` : 'Ping',
            false,
            undefined,
            game.sonarCooldown > 0,
            false,
            'Active sonar pulse — sharper contacts, reveals you to escorts',
          )}
        </div>
      </section>
      <section class="hud-block hud-tactics" data-tutorial="tactics" aria-label="Tactical controls">
        <div class="panel-label">HELM <span data-field="tactic-status">${
          game.autopilot.enabled
            ? `${game.autopilot.tactic === 'exfil' ? 'HOME' : game.autopilot.tactic.toUpperCase()} · ${game.autopilot.phase.toUpperCase()}`
            : 'MANUAL'
        }</span></div>
        <div class="control-row">
          ${button('silent', 'Quiet', sub.silentRunning, undefined, false, false, 'Silent running — lower noise, slower battery use when careful')}
          ${button('scope', 'Scope', sub.scopeUp, undefined, false, false, 'Raise periscope — useful at peri depth, exposes you')}
          ${button('snorkel', 'Snorkel', sub.snorkel, undefined, false, false, 'Snorkel — recharge battery shallow, leaves a plume')}
        </div>
        <div class="control-row fold-row">
          ${button(
            'toggle-doctrine',
            this.panels.doctrine ? 'Doctrine ▴' : 'Doctrine ▾',
            this.panels.doctrine,
            undefined,
            false,
            false,
            this.panels.doctrine ? 'Hide ambush/stalk AI modes' : 'Show combat AI modes',
          )}
        </div>
        <div class="control-row doctrine-row${this.panels.doctrine ? '' : ' is-collapsed'}" data-panel="doctrine">
          ${TACTICS.map(([tactic, label, tip]) =>
            button(
              'tactic',
              label,
              game.autopilot.tactic === tactic && game.autopilot.enabled,
              tactic,
              false,
              false,
              tip,
            ),
          ).join('')}
        </div>
        <div class="control-row">
          ${button('stop-ai', 'Manual', false, undefined, false, false, 'Cancel helm AI — you steer with WASD / plot')}
          ${button('clear', 'Clear route', false, undefined, false, false, 'Drop selected target and cancel plotted waypoint')}
        </div>
      </section>
      <section class="hud-block hud-depth" data-tutorial="depth" aria-label="Depth order">
        <div class="panel-label">DEPTH <span data-field="depth-label">${formatDepth(v.depth)} → ${DEPTH_LABEL[depthOrder]}</span></div>
        <div class="control-row">${DEPTHS.map(([order, label, tip]) =>
          button(
            'depth',
            label,
            Math.abs(sub.targetDepth - DEPTH_TARGET[order]) < 0.001 && depthSettled,
            order,
            false,
            Math.abs(sub.targetDepth - DEPTH_TARGET[order]) < 0.001 && !depthSettled,
            tip,
          ),
        ).join('')}</div>
        <div class="control-row">${button('blow', 'Blow tanks', false, undefined, false, false, 'Emergency surface — loud, fast, costly (G)')}</div>
      </section>
      <section class="hud-block hud-speed" aria-label="Speed order">
        <div class="panel-label">SPEED <span data-field="speed-label">${formatSpeed(v.speed)} → ${formatSpeed(sub.maxSpeed * SPEED_FRACTION[sub.speedOrder] * 5)}</span></div>
        <div class="control-row">${SPEEDS.map(([order, label, tip]) =>
          button(
            'speed',
            label,
            sub.speedOrder === order && speedSettled,
            order,
            false,
            sub.speedOrder === order && !speedSettled,
            tip,
          ),
        ).join('')}</div>
      </section>
      <section class="hud-block hud-minimap" data-tutorial="minimap" aria-label="Minimap; click to plot course">
        <div class="panel-label" ${tipAttr('Click water to plot a course · click a contact to select it')}>PLOT <span data-field="view-mode">${MODE_LABEL[sim.viewMode]}</span></div>
        <svg class="map" viewBox="0 0 ${WORLD_SIZE} ${WORLD_SIZE}" role="img" aria-label="Sector map">
          <g data-field="land">${this.landSvg}</g>
          <circle class="fob" cx="${game.base.x}" cy="${game.base.y}" r="${game.base.radius}"/><circle class="player" data-field="player" cx="${sub.x}" cy="${sub.y}" r="2"/>
          <g data-field="ships">${game.ships
            .map(
              (ship) =>
                `<circle class="ship${ship.id === game.selectedTargetId ? ' selected' : ''}${ship.kind === 'sub' ? ' sub' : ''}" data-ship-id="${ship.id}" cx="${ship.x}" cy="${ship.y}" r="${ship.kind === 'sub' ? 1.7 : 1.4}"/>`,
            )
            .join('')}</g>
          <g data-field="crates">${game.powerups.map((pickup) => `<rect class="crate" x="${pickup.x - 1}" y="${pickup.y - 1}" width="2" height="2"/>`).join('')}</g>
          <g data-field="plot">${
            game.autopilot.waypoint
              ? `<circle class="plot" cx="${game.autopilot.waypoint.x}" cy="${game.autopilot.waypoint.y}" r="1.8"/>`
              : ''
          }</g>
        </svg>
        <ul class="map-legend" aria-label="Map legend">
          <li><i class="lg player"></i> You</li>
          <li><i class="lg ship"></i> Contact</li>
          <li><i class="lg fob"></i> FOB</li>
          <li><i class="lg crate"></i> Crate</li>
          <li><i class="lg land"></i> Land</li>
          <li><i class="lg plot"></i> Plot</li>
        </ul>
      </section>
      <section class="hud-block hud-chrome" aria-label="Game controls">
        ${button('pause', game.phase === 'paused' ? 'Resume' : 'Pause', false, undefined, false, false, 'Pause simulation')}
        ${button('mute', this.cb.isMuted() ? 'Unmute' : 'Mute', false, undefined, false, false, 'Toggle audio')}
        ${button('help', 'Help', false, undefined, false, false, 'Tutorial and onboarding guide')}
      </section>
      <div class="hud-toasts" aria-live="polite" data-field="toasts">${message ? `<div class="toast">${message.text.replace(/(\d+\.\d+)s/g, (_, n: string) => `${Math.ceil(Number(n))}s`)}</div>` : ''}</div>
    `;
  }

  private patchDynamic(
    game: GameState,
    sim: SimState,
    extras: {
      course: string;
      depthOrder: DepthOrder;
      depthSettled: boolean;
      speedSettled: boolean;
      headingDeg: number;
      tubes: { ready: boolean; label: string; tip: string };
      target: GameState['ships'][number] | undefined;
      targetRange: number | null;
      fobSafe: boolean;
      message: GameState['messages'][number] | undefined;
      contacts: readonly FirmContact[];
    },
  ): void {
    const sub = game.submarine;
    const v = sim.vessel;
    const set = (field: string, text: string, className?: string) => {
      const el = this.root.querySelector(`[data-field="${field}"]`);
      if (!el) return;
      if (el.textContent !== text) el.textContent = text;
      if (className !== undefined) el.className = className;
    };
    set(
      'band',
      `FLEET BOAT · ${depthBand(sub.z)} · ${sub.z < 0.5 ? 'ABOVE LAYER' : 'BELOW LAYER'}`,
    );
    set('hull', `${Math.ceil(sub.hp)}%`);
    set('bat', `${Math.ceil(sub.battery)}%`);
    set('noise', `${Math.ceil(sub.noise * 100)}%`);
    set('flood', `${Math.ceil(sub.sysFlood * 100)}%`);
    set(
      'day',
      `${Math.floor((game.time / 60) % 24)
        .toString()
        .padStart(2, '0')}:00`,
    );
    set('fob', extras.fobSafe ? 'SAFE' : 'OUT');
    set('course', extras.course);
    set(
      'order-depth',
      `${formatDepth(v.depth)} → ${DEPTH_LABEL[extras.depthOrder]}`,
      extras.depthSettled ? 'settled' : 'changing',
    );
    set(
      'order-speed',
      `${formatSpeed(v.speed)} → ${SPEEDS.find(([o]) => o === sub.speedOrder)?.[1] ?? sub.speedOrder.toUpperCase()}`,
      extras.speedSettled ? 'settled' : 'changing',
    );
    set('hdg', `${extras.headingDeg}°`);
    set(
      'mode',
      [
        sub.silentRunning ? 'QUIET' : null,
        sub.scopeUp ? 'SCOPE' : null,
        sub.snorkel ? 'SNORKEL' : null,
        game.autopilot.enabled
          ? game.autopilot.tactic === 'exfil'
            ? 'HOME'
            : game.autopilot.tactic.toUpperCase()
          : 'MANUAL',
      ]
        .filter(Boolean)
        .join(' · '),
    );
    set(
      'target',
      extras.target
        ? `${extras.target.name} · ${Math.ceil(extras.targetRange ?? 0)}u · ${Math.round(extras.target.hp)}% HP`
        : 'None — map / list / T',
      extras.target ? 'engaged' : '',
    );
    set('score', String(game.stats.score));
    set('wave', String(game.stats.wave));
    set('sunk', String(game.stats.shipsSunk));
    set(
      'time',
      `${Math.floor(game.stats.timeSurvived / 60)}:${String(Math.floor(game.stats.timeSurvived % 60)).padStart(2, '0')}`,
    );
    set('depth-label', `${formatDepth(v.depth)} → ${DEPTH_LABEL[extras.depthOrder]}`);
    set(
      'speed-label',
      `${formatSpeed(v.speed)} → ${formatSpeed(sub.maxSpeed * SPEED_FRACTION[sub.speedOrder] * 5)}`,
    );
    set('view-mode', MODE_LABEL[sim.viewMode]);
    set(
      'tactic-status',
      game.autopilot.enabled
        ? `${game.autopilot.tactic === 'exfil' ? 'HOME' : game.autopilot.tactic.toUpperCase()} · ${game.autopilot.phase.toUpperCase()}`
        : 'MANUAL',
    );
    set('contact-count', `${extras.contacts.length}/6`);
    const contactsEl = this.root.querySelector('[data-field="contacts"]');
    if (contactsEl) contactsEl.innerHTML = contactsMarkup(extras.contacts, game.selectedTargetId);
    set('mag-status', extras.tubes.label, extras.tubes.ready ? 'ready' : 'locked');
    const magStatus = this.root.querySelector('[data-field="mag-status"]');
    if (magStatus instanceof HTMLElement) {
      magStatus.title = extras.tubes.tip;
      magStatus.dataset.tip = extras.tubes.tip;
    }
    const toasts = this.root.querySelector('[data-field="toasts"]');
    if (toasts) {
      toasts.innerHTML = extras.message
        ? `<div class="toast">${extras.message.text.replace(/(\d+\.\d+)s/g, (_, n: string) => `${Math.ceil(Number(n))}s`)}</div>`
        : '';
    }
    const player = this.root.querySelector('[data-field="player"]');
    if (player instanceof SVGCircleElement) {
      player.setAttribute('cx', String(sub.x));
      player.setAttribute('cy', String(sub.y));
    }
    const ships = this.root.querySelector('[data-field="ships"]');
    if (ships) {
      ships.innerHTML = game.ships
        .map(
          (ship) =>
            `<circle class="ship${ship.id === game.selectedTargetId ? ' selected' : ''}${ship.kind === 'sub' ? ' sub' : ''}" data-ship-id="${ship.id}" cx="${ship.x}" cy="${ship.y}" r="${ship.kind === 'sub' ? 1.7 : 1.4}"/>`,
        )
        .join('');
    }
    const plot = this.root.querySelector('[data-field="plot"]');
    if (plot) {
      plot.innerHTML = game.autopilot.waypoint
        ? `<circle class="plot" cx="${game.autopilot.waypoint.x}" cy="${game.autopilot.waypoint.y}" r="1.8"/>`
        : '';
    }
    const crates = this.root.querySelector('[data-field="crates"]');
    if (crates) {
      crates.innerHTML = game.powerups
        .map(
          (pickup) =>
            `<rect class="crate" x="${pickup.x - 1}" y="${pickup.y - 1}" width="2" height="2"/>`,
        )
        .join('');
    }
  }

  private togglePanel(which: 'gear' | 'doctrine'): void {
    this.panels = {
      ...this.panels,
      [which]: !this.panels[which],
    };
    savePanelPrefs(this.panels);
    this.chromeKey = '';
  }

  private dispatchButton(target: HTMLButtonElement): void {
    const now = performance.now();
    if (now - this.lastActionAt < 40) return;
    this.lastActionAt = now;
    if (target.dataset.contact) {
      this.cb.select(target.dataset.contact);
      return;
    }
    const action = target.dataset.action;
    if (!action) return;
    if (action === 'toggle-gear') {
      this.togglePanel('gear');
      return;
    }
    if (action === 'toggle-doctrine') {
      this.togglePanel('doctrine');
      return;
    }
    this.cb.command(action, target.dataset.value);
  }

  private readonly onPointerAction = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest('svg.map')) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    event.preventDefault();
    this.dispatchButton(target);
  };

  private readonly onClick = (event: MouseEvent): void => {
    // Mouse/touch already handled on pointerdown; keep click for keyboard activation.
    if (event.detail !== 0) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    if ((event.target as Element).closest('svg.map')) return;
    this.dispatchButton(target);
  };

  private readonly onMapPointer = (event: PointerEvent): void => {
    const map = (event.target as Element).closest<SVGSVGElement>('svg.map');
    if (!map || event.button !== 0) return;
    event.preventDefault();
    const rect = map.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WORLD_SIZE;
    const y = ((event.clientY - rect.top) / rect.height) * WORLD_SIZE;
    const direct = (event.target as Element).closest<SVGCircleElement>('circle.ship[data-ship-id]');
    if (direct?.dataset.shipId) {
      this.cb.select(direct.dataset.shipId);
      return;
    }
    const pxX = event.clientX - rect.left;
    const pxY = event.clientY - rect.top;
    const scaleX = rect.width / WORLD_SIZE;
    const scaleY = rect.height / WORLD_SIZE;
    const proximate = findPixelProximateContact(
      pxX,
      pxY,
      this.lastShips.map((ship) => ({
        id: ship.id,
        x: ship.x * scaleX,
        y: ship.y * scaleY,
      })),
      MAP_PROXIMATE_PX,
    );
    if (proximate) {
      this.cb.select(proximate);
      return;
    }
    this.cb.plot(x, y);
  };
}
