import { describe, expect, it } from 'vitest';
// @ts-expect-error node builtins are outside the game tsconfig (types: vite/client)
import { readFileSync } from 'node:fs';
import { createInitialSim, FIXED_DT } from '../../src/core/sim';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { DEPTH_TARGET } from '../../src/game/sim/constants';
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
  setSpeedOrder,
  setWeapon,
  sonarPulse,
  startMission,
  toggleScope,
  toggleSilentRunning,
  toggleSnorkel,
  toggleTorpedoSpread,
  updateGame,
} from '../../src/game/sim/api';
import type { AutopilotTactic, DepthOrder, SpeedOrder } from '../../src/game/sim/types';
import { Hud, resolveHudPanelPrefs } from '../../src/ui/hud';

function playing(seed = 19) {
  let state = startMission(createGame(seed));
  for (let i = 0; i < 45; i++) state = updateGame(state, [], FIXED_DT);
  return state;
}

function withSafeBoat(state: ReturnType<typeof playing>) {
  return {
    ...state,
    submarine: {
      ...state.submarine,
      invuln: 300,
      hp: 100,
      sysFlood: 0,
      z: 0.28,
      targetDepth: 0.28,
      reloadMk14: 0,
      reloadMk18: 0,
      cmCooldown: 0,
    },
  };
}

describe('HUD / API command matrix', () => {
  const depths: DepthOrder[] = ['surface', 'periscope', 'attack', 'deep'];
  const speeds: SpeedOrder[] = ['stop', 'oneThird', 'twoThirds', 'flank'];
  const tactics: AutopilotTactic[] = ['ambush', 'stalk', 'intercept', 'evade', 'exfil'];

  for (const order of depths) {
    it(`depth order ${order} sets targetDepth`, () => {
      let state = withSafeBoat(playing());
      state = setDepthOrder(state, order);
      expect(state.submarine.targetDepth).toBeCloseTo(DEPTH_TARGET[order], 5);
      expect(state.messages.some((m) => m.text.includes('DEPTH'))).toBe(true);
    });
  }

  for (const order of speeds) {
    it(`speed order ${order} sets sticky targetSpeed`, () => {
      let state = withSafeBoat(playing());
      state = setSpeedOrder(state, order);
      expect(state.submarine.speedOrder).toBe(order);
      const frac = order === 'stop' ? 0 : order === 'oneThird' ? 0.33 : order === 'twoThirds' ? 0.66 : 1;
      expect(state.submarine.targetSpeed).toBeCloseTo(state.submarine.maxSpeed * frac, 5);
    });
  }

  it('depth/speed orders cancel active doctrine autopilot', () => {
    let state = withSafeBoat(playing());
    const ship = state.ships[0]!;
    state = setAutopilot(state, 'ambush', ship.id);
    expect(state.autopilot.enabled).toBe(true);
    state = setDepthOrder(state, 'deep');
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');

    state = setAutopilot(state, 'stalk', ship.id);
    expect(state.autopilot.enabled).toBe(true);
    state = setSpeedOrder(state, 'flank');
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');
  });

  for (const tactic of tactics) {
    it(`tactic ${tactic} engages autopilot`, () => {
      let state = withSafeBoat(playing(20 + tactics.indexOf(tactic)));
      const ship = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
      state = { ...state, selectedTargetId: ship.id };
      state = setAutopilot(state, tactic, ship.id);
      expect(state.autopilot.enabled).toBe(true);
      expect(state.autopilot.tactic).toBe(tactic);
      expect(state.autopilot.targetId === ship.id || tactic === 'exfil').toBe(true);
    });
  }

  it('stop-ai / cancelAutopilot clears doctrine', () => {
    let state = withSafeBoat(playing());
    state = setAutopilot(state, 'intercept', state.ships[0]!.id);
    state = cancelAutopilot(state);
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');
  });

  it('select / clear engagement', () => {
    let state = withSafeBoat(playing());
    const id = state.ships[0]!.id;
    state = selectTarget(state, id);
    expect(state.selectedTargetId).toBe(id);
    state = clearEngagement(state);
    expect(state.selectedTargetId).toBeNull();
  });

  it('plot / orderMove enables manual waypoint AP', () => {
    let state = withSafeBoat(playing());
    const wp = { x: state.submarine.x + 8, y: state.submarine.y + 4 };
    state = orderMove(state, wp);
    expect(state.autopilot.enabled).toBe(true);
    expect(state.autopilot.tactic).toBe('manual');
    expect(state.autopilot.waypoint).toEqual(wp);
  });

  it('silent / scope / snorkel / spread toggles', () => {
    let state = withSafeBoat(playing());
    const silent0 = state.submarine.silentRunning;
    state = toggleSilentRunning(state);
    expect(state.submarine.silentRunning).toBe(!silent0);

    const scope0 = state.submarine.scopeUp;
    state = toggleScope(state);
    expect(state.submarine.scopeUp).toBe(!scope0);

    const snorkel0 = state.submarine.snorkel;
    state = toggleSnorkel(state);
    expect(state.submarine.snorkel).toBe(!snorkel0);

    const spread0 = state.torpedoSpread;
    state = toggleTorpedoSpread(state);
    expect(state.torpedoSpread).toBe(!spread0);
  });

  it('weapon mode cycles Mk-14 / Mk-18 / Foxer', () => {
    let state = withSafeBoat(playing());
    state = setWeapon(state, 'seeker');
    expect(state.weaponMode).toBe('seeker');
    state = setWeapon(state, 'decoy');
    expect(state.weaponMode).toBe('decoy');
    state = setWeapon(state, 'torpedo');
    expect(state.weaponMode).toBe('torpedo');
  });

  it('fire Mk-14 from periscope spends a fish', () => {
    let state = withSafeBoat(playing());
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 90; i++) state = updateGame(state, [], FIXED_DT);
    state = {
      ...state,
      selectedTargetId: state.ships[0]!.id,
      submarine: { ...state.submarine, z: 0.28, torpedoes: 6, reloadMk14: 0 },
      weaponMode: 'torpedo',
    };
    const before = state.torpedoes.length;
    const ammo = state.submarine.torpedoes;
    state = fireWeapon(state);
    expect(state.torpedoes.length).toBe(before + 1);
    expect(state.submarine.torpedoes).toBe(ammo - 1);
  });

  it('screen / countermeasure deploys a bubble or foxer', () => {
    let state = withSafeBoat(playing());
    state = {
      ...state,
      submarine: { ...state.submarine, decoys: 3, cmCooldown: 0 },
    };
    const before = state.countermeasures.length;
    state = deployCountermeasure(state);
    expect(state.countermeasures.length).toBeGreaterThan(before);
  });

  it('sonar pulse starts cooldown / contacts refresh path', () => {
    let state = withSafeBoat(playing());
    state = { ...state, sonarCooldown: 0, sonarPing: 0 };
    state = sonarPulse(state);
    expect(
      state.sonarCooldown > 0 ||
        state.sonarPing > 0 ||
        state.messages.some((m) => /SONAR|PING|ACTIVE/.test(m.text)),
    ).toBe(true);
  });
});

describe('tactic short-horizon behavior smoke', () => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  it.each([
    { tactic: 'ambush' as const, seed: 31, offset: -18, heading: Math.PI, seconds: 12, kind: 'close' as const },
    { tactic: 'stalk' as const, seed: 32, offset: -18, heading: Math.PI, seconds: 12, kind: 'close' as const },
    { tactic: 'intercept' as const, seed: 33, offset: -18, heading: 0, seconds: 12, kind: 'close' as const },
    { tactic: 'evade' as const, seed: 34, offset: -5, heading: 0, seconds: 8, kind: 'open' as const },
  ])('$tactic moves in the expected direction', ({ tactic, seed, offset, heading, seconds, kind }) => {
    let state = withSafeBoat(playing(seed));
    const focus =
      kind === 'open'
        ? (state.ships.find((s) => s.kind === 'destroyer' || s.kind === 'patrol') ?? state.ships[0]!)
        : (state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!);

    state = {
      ...state,
      selectedTargetId: focus.id,
      submarine: {
        ...state.submarine,
        x: focus.x + offset,
        y: focus.y,
        heading,
        torpedoes: 0,
        seekers: 0,
      },
    };
    const start = dist(state.submarine, focus);
    state = setAutopilot(state, tactic, focus.id);
    for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) state = updateGame(state, [], FIXED_DT);
    const live = state.ships.find((s) => s.id === focus.id) ?? focus;
    const end = dist(state.submarine, live);
    if (kind === 'open') expect(end).toBeGreaterThan(start + 1.5);
    else expect(end).toBeLessThan(start - 2);
  });
});

const CSS = readFileSync(new URL('../../src/styles/main.css', import.meta.url), 'utf8');

function cssToken(name: string): string {
  const match = CSS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1].trim();
}

function cssPx(name: string): number {
  const raw = cssToken(name);
  const value = Number(raw.replace('px', ''));
  if (!Number.isFinite(value)) throw new Error(`${name} is not a length: ${raw}`);
  return value;
}

/** sRGB relative luminance, WCAG 2.x. */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrast(fg: string, bgLum: number): number {
  const a = luminance(fg);
  const hi = Math.max(a, bgLum);
  const lo = Math.min(a, bgLum);
  return (hi + 0.05) / (lo + 0.05);
}

function mixLum(rgb: number[], back: number[], alpha: number): number {
  const mixed = rgb.map((c, i) => (c * alpha + back[i]! * (1 - alpha)) / 255);
  const lin = mixed.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/**
 * Union of `.hud-block` boxes at 1280×720. Content heights track the folded
 * chrome (no gear row, no doctrine wrap, no contact list, no legend) plus the
 * parsed pad / button / map tokens. Positions follow the max-height:760 rules.
 *
 * Recorded before D1, with gear, doctrine, contacts, and the legend open
 * (pad 10, buttons 30, map 188, side 235, magazine 342): see HUD_COVERAGE_BEFORE.
 */
function hudBlockCoverage(opts: {
  pad: number;
  btn: number;
  map: number;
  sideW: number;
  magW: number;
  tacW: number;
  orderW: number;
  gear: boolean;
  doctrine: boolean;
  contacts: boolean;
  legend: boolean;
}): number {
  const viewW = 1280;
  const viewH = 720;
  const border = 2;
  const box = (content: number) => content + opts.pad * 2 + border;
  const toggle = Math.max(16, opts.btn);
  const status = box(16 + 15 + 48 + 16);
  const orders = box(16 + 8 + 14 * 5 + 8);
  const score = box(4 + 14 * 2 + 3);
  const contactsH = box(toggle + (opts.contacts ? 24 * 4 : 0));
  const chrome = box(opts.btn);
  const mag = box(toggle + opts.btn + (opts.gear ? 6 + opts.btn * 2 + 5 : 0));
  const tac = box(toggle + (4 + opts.btn) + (opts.doctrine ? 4 + opts.btn * 2 : 0) + (4 + opts.btn));
  const depth = box(16 + (4 + opts.btn) + (4 + opts.btn));
  const speed = box(16 + (4 + opts.btn));
  const mini = box(toggle + opts.map + (opts.legend ? 36 : 0));
  const miniW = opts.map + opts.pad * 2 + border;
  const boxes = [
    { x: 16, y: 16, w: 290, h: status },
    { x: 16, y: 156, w: 290, h: orders },
    { x: viewW - 16 - opts.sideW, y: 16, w: opts.sideW, h: score },
    { x: viewW - 16 - opts.sideW, y: 84, w: opts.sideW, h: contactsH },
    { x: 316, y: 16, w: 200, h: chrome },
    { x: 16, y: viewH - 44 - mag, w: opts.magW, h: mag },
    { x: 316, y: 156, w: opts.tacW, h: tac },
    { x: 316, y: viewH - 44 - depth, w: opts.orderW, h: depth },
    { x: 524, y: viewH - 44 - speed, w: opts.orderW, h: speed },
    { x: viewW - 16 - miniW, y: viewH - 44 - mini, w: miniW, h: mini },
  ];
  const ys = [...new Set(boxes.flatMap((b) => [b.y, b.y + b.h]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    const mid = (y0 + y1) / 2;
    const segs = boxes
      .filter((b) => b.y <= mid && mid < b.y + b.h)
      .map((b) => [b.x, b.x + b.w] as const)
      .sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let cx = -1e9;
    let cy = -1e9;
    for (const [x0, x1] of segs) {
      if (x0 > cy) {
        covered += cy - cx;
        cx = x0;
        cy = x1;
      } else cy = Math.max(cy, x1);
    }
    if (cy > cx) covered += cy - cx;
    area += covered * (y1 - y0);
  }
  return area / (viewW * viewH);
}

function stubEl(): HTMLElement {
  return {
    style: {},
    innerHTML: '',
    childElementCount: 0,
    addEventListener() {},
  } as unknown as HTMLElement;
}

describe('HUD declutter (D1)', () => {
  it('folds gear, doctrine, contacts, and the legend until the player opens them', () => {
    expect(resolveHudPanelPrefs(null)).toEqual({
      gear: false,
      doctrine: false,
      contacts: false,
      legend: false,
    });
    expect(resolveHudPanelPrefs('{"gear":true}')).toEqual({
      gear: true,
      doctrine: false,
      contacts: false,
      legend: false,
    });

    const root = stubEl();
    const hud = new Hud(root, stubEl(), {
      command() {},
      plot() {},
      select() {},
      isMuted: () => false,
    });
    hud.render(startMission(createGame(1)), createInitialSim(), DEFAULT_SETTINGS);
    const html = (root as unknown as { innerHTML: string }).innerHTML;
    expect(html).toContain('mag-secondary is-collapsed" data-panel="gear"');
    expect(html).toContain('doctrine-row is-collapsed" data-panel="doctrine"');
    expect(html).toContain('contacts-detail is-collapsed"');
    expect(html).toContain('map-legend is-collapsed"');
    for (const action of [
      'pause',
      'fire',
      'depth',
      'speed',
      'tactic',
      'stop-ai',
      'silent',
      'scope',
      'snorkel',
      'weapon',
      'spread',
      'screen',
      'sonar',
      'mute',
      'help',
      'clear',
      'toggle-gear',
      'toggle-doctrine',
    ]) {
      expect(html).toContain(`data-action="${action}"`);
    }
    for (const label of [
      'Boat status',
      'Active orders',
      'Patrol score',
      'Hydrophone contacts',
      'Weapons',
      'Tactical controls',
      'Depth order',
      'Speed order',
      'Minimap; click to plot course',
      'Sector map',
      'Map legend',
      'Game controls',
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it('keeps HUD text at WCAG AA on a dimmer, unblurred panel', () => {
    const alpha = Number(cssToken('--hud-panel-alpha'));
    const blur = cssPx('--hud-blur');
    const rgb = cssToken('--hud-panel-rgb')
      .split(',')
      .map((part) => Number(part.trim()));
    const sky = cssToken('--hud-contrast-sky');
    const canvas = cssToken('--canvas');
    expect(alpha).toBeLessThan(0.72);
    expect(alpha).toBeGreaterThan(0);
    expect(blur).toBe(0);
    expect(CSS).toMatch(/\.hud-btn:focus-visible[\s\S]*?box-shadow:\s*0 0 0 3px/);
    expect(CSS).toContain('backdrop-filter: blur(var(--hud-blur))');

    const skyRgb = [1, 3, 5].map((i) => Number.parseInt(sky.slice(i, i + 2), 16));
    const canvasRgb = [1, 3, 5].map((i) => Number.parseInt(canvas.slice(i, i + 2), 16));
    const grounds = [
      mixLum(rgb, rgb, 1),
      mixLum(rgb, canvasRgb, alpha),
      mixLum(rgb, skyRgb, alpha),
    ];
    for (const token of ['--text', '--muted', '--brass-ink']) {
      const hex = cssToken(token);
      for (const ground of grounds) {
        expect(contrast(hex, ground), `${token} on panel`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('covers at most 22% of a 1280×720 viewport once the extra panels are folded', () => {
    // Pre-D1 box model at 1280×720 (open gear/doctrine/contacts/legend).
    // C1's Playwright metric was not run in this lane; this is the same union.
    const HUD_COVERAGE_BEFORE = 0.346;
    const before = hudBlockCoverage({
      pad: 10,
      btn: 30,
      map: 188,
      sideW: 235,
      magW: 342,
      tacW: 268,
      orderW: 198,
      gear: true,
      doctrine: true,
      contacts: true,
      legend: true,
    });
    expect(before).toBeCloseTo(HUD_COVERAGE_BEFORE, 2);

    const prefs = resolveHudPanelPrefs(null);
    const after = hudBlockCoverage({
      pad: cssPx('--hud-pad-y'),
      btn: cssPx('--hud-btn-min'),
      map: cssPx('--hud-map-size'),
      sideW: 220,
      magW: 320,
      tacW: 248,
      orderW: 188,
      ...prefs,
    });
    expect(after).toBeLessThanOrEqual(0.22);
    expect(after).toBeLessThan(before);
  });
});

describe('HUD target card damage states', () => {
  const renderTargetCard = (ship: ReturnType<typeof playing>['ships'][number]) => {
    const root = stubEl();
    const hud = new Hud(root, stubEl(), {
      command() {},
      plot() {},
      select() {},
      isMuted: () => false,
    });
    const base = startMission(createGame(1));
    hud.render(
      { ...base, ships: [ship], selectedTargetId: ship.id },
      createInitialSim(),
      DEFAULT_SETTINGS,
    );
    return (root as unknown as { innerHTML: string }).innerHTML;
  };

  it('reports flooding, fire, and propulsion loss on the selected target', () => {
    const ship = {
      ...startMission(createGame(1)).ships[0]!,
      flooding: 0.4,
      fire: 0.3,
      speedFactor: 0.1,
    };
    const html = renderTargetCard(ship);
    expect(html).toContain('FLOODING');
    expect(html).toContain('ON FIRE');
    expect(html).toContain('DEAD IN WATER');
  });

  it('a sinking hull reports SINKING instead of per-system states', () => {
    const ship = {
      ...startMission(createGame(1)).ships[0]!,
      flooding: 0.4,
      fire: 0.3,
      speedFactor: 0.1,
      sinking: 0,
    };
    const html = renderTargetCard(ship);
    expect(html).toContain('SINKING');
    expect(html).not.toContain('FLOODING');
  });
});
