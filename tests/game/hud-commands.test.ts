import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
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
