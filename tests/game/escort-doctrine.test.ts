import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  setDepthOrder,
  setSpeedOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';
import { canHearSubmarine } from '../../src/game/sim/contact';
import { releaseCallouts } from '../../src/game/sim/defense-callout';
import {
  escortIntent,
  merchantIntent,
  predictDatum,
} from '../../src/game/sim/escort-doctrine';
import { SINK_DURATION } from '../../src/game/sim/ship-damage';
import { shipMaxSpeed } from '../../src/game/sim/sonar';
import type { DepthCharge, GameState, Ship, Torpedo } from '../../src/game/sim/types';

function shipFixture(partial: Partial<Ship> = {}): Ship {
  return {
    id: 'escort-1',
    kind: 'destroyer',
    name: 'TEST ESCORT',
    x: 60,
    y: 60,
    heading: 0,
    speed: 1,
    hp: 120,
    maxHp: 120,
    flooding: 0,
    fire: 0,
    speedFactor: 1,
    sinkDuration: SINK_DURATION.destroyer,
    listSide: 1,
    alert: 0,
    holdContact: 0,
    weaponCooldown: 999,
    patrolIndex: 0,
    path: [],
    repathTimer: 0,
    ...partial,
  };
}

/** A mission state reduced to exactly the ships the test cares about. */
function lab(
  ships: Ship[],
  sub: Partial<GameState['submarine']> = {},
  seed = 19,
): GameState {
  const base = startMission(createGame(seed));
  return {
    ...base,
    sonarPing: 0,
    sonarCooldown: 0,
    aircraft: [],
    depthCharges: [],
    torpedoes: [],
    shells: [],
    countermeasures: [],
    base: { ...base.base, x: -500, y: -500 },
    autopilot: { ...base.autopilot, enabled: false, tactic: 'manual' },
    submarine: {
      ...base.submarine,
      x: 60,
      y: 60,
      z: 0.7,
      targetDepth: 0.7,
      speed: 0,
      targetSpeed: 0,
      noise: 0.08,
      silentRunning: true,
      snorkel: false,
      scopeUp: false,
      invuln: 0,
      ...sub,
    },
    ships,
  };
}

describe('escort hearing', () => {
  const loudBoat = { noise: 0.5, silentRunning: false, z: 0.4, targetDepth: 0.4 };

  it('a boat in the escort baffles is not heard at a range the bow would hear it', () => {
    // Dead astern the escort's own wake blankets the hydrophones.
    const escort = shipFixture({ x: 60, y: 60, heading: 0, speed: 1 });
    const state = lab([escort], loudBoat);
    const astern = { ...state, submarine: { ...state.submarine, x: 52, y: 60 } };
    const abeam = { ...state, submarine: { ...state.submarine, x: 60, y: 52 } };
    expect(canHearSubmarine(astern.ships[0]!, astern)).toBe(false);
    expect(canHearSubmarine(abeam.ships[0]!, abeam)).toBe(true);
  });

  it('a flank-speed escort hears less — flow noise blinds the arrays', () => {
    const sub = { x: 72, y: 60, ...loudBoat };
    const slow = lab([shipFixture({ speed: 0.5 })], sub);
    const fast = lab([shipFixture({ speed: shipMaxSpeed.destroyer * 0.95 })], sub);
    expect(canHearSubmarine(slow.ships[0]!, slow)).toBe(true);
    expect(canHearSubmarine(fast.ships[0]!, fast)).toBe(false);
  });

  it('a deep boat inside the blind zone is not heard', () => {
    const escort = shipFixture({ x: 60, y: 60 });
    const state = lab([escort], loudBoat);
    const deep = { ...state, submarine: { ...state.submarine, x: 60.9, y: 60, z: 0.5 } };
    const shallow = { ...state, submarine: { ...state.submarine, x: 60.9, y: 60, z: 0.15 } };
    expect(canHearSubmarine(deep.ships[0]!, deep)).toBe(false);
    expect(canHearSubmarine(shallow.ships[0]!, shallow)).toBe(true);
  });
});

describe('escort doctrine', () => {
  it('drops the pattern on the predicted datum, not where the boat is now', () => {
    // The boat sprinted on after the last fix: the datum leads it, the run
    // commits to the lead, and the charges land on the track — not on the
    // stale fix and not on some random spot.
    let state = lab(
      [
        shipFixture({
          doctrine: 'attackRun',
          x: 76.5,
          y: 60,
          heading: 0,
          datumX: 75,
          datumY: 60,
          datumVx: 0.5,
          datumVy: 0,
          lastFixTime: 0, // fix is stale relative to state.time once we step
          weaponCooldown: 0,
          alert: 1,
          holdContact: 0,
        }),
      ],
      { x: 95, y: 60, z: 0.7, silentRunning: true, noise: 0.08 },
    );
    state = { ...state, time: 10, ships: state.ships.map((s) => ({ ...s, lastFixTime: 8 })) };
    const predicted = predictDatum(state.ships[0]!, state.time)!;
    expect(predicted.x).toBeGreaterThan(state.ships[0]!.datumX!);
    const next = updateGame(state, [], FIXED_DT);
    const runner = next.ships[0]!;
    expect(runner.doctrine).toBe('reattack');
    expect(next.depthCharges.length).toBeGreaterThanOrEqual(5);
    const meanX =
      next.depthCharges.reduce((sum, charge) => sum + charge.x, 0) / next.depthCharges.length;
    const meanY =
      next.depthCharges.reduce((sum, charge) => sum + charge.y, 0) / next.depthCharges.length;
    // Near the predicted datum, not the stale fix and not the live boat.
    expect(Math.hypot(meanX - predicted.x, meanY - predicted.y)).toBeLessThan(3);
    expect(Math.hypot(meanX - 95, meanY - 60)).toBeGreaterThan(10);
  });

  it('lets only two escorts commit to an attack run at once', () => {
    const datum = { datumX: 63, datumY: 60, lastFixTime: 10 };
    const ships = [0, 1, 2].map((index) =>
      shipFixture({
        id: `escort-${index}`,
        doctrine: 'prosecute',
        x: 66 + index,
        y: 60 + index * 2,
        heading: Math.PI,
        alert: 0.9,
        holdContact: 2,
        weaponCooldown: 999,
        ...datum,
      }),
    );
    let state = lab(ships, { x: 95, y: 95, z: 0.8, silentRunning: true });
    state = { ...state, time: 10 };
    const next = updateGame(state, [], FIXED_DT);
    const runners = next.ships.filter((ship) => ship.doctrine === 'attackRun');
    expect(runners.length).toBeLessThanOrEqual(2);
  });

  it('an escort that loses the fix searches, then gives up back to screen', () => {
    const state = lab([shipFixture({ doctrine: 'prosecute', suspicion: 0.6 })]);
    const ship = state.ships[0]!;
    // Fix went cold more than SEARCH_AFTER ago: hold the datum, start circling.
    const stale = escortIntent(
      { ...ship, datumX: 70, datumY: 60, lastFixTime: state.time - 10, alert: 0.5, holdContact: 0 },
      null,
      state,
      FIXED_DT,
      0,
    );
    expect(stale.ship.doctrine).toBe('search');
    // A fresh fix inside the search breaks back to prosecute immediately.
    const refixed = escortIntent(stale.ship, { x: 62, y: 61 }, state, FIXED_DT, 0);
    expect(refixed.ship.doctrine).toBe('prosecute');
    // After the give-up clock runs out the datum is released entirely.
    const exhausted = escortIntent(
      { ...stale.ship, doctrineTimer: 46, lastFixTime: state.time - 60 },
      null,
      state,
      FIXED_DT,
      0,
    );
    expect(exhausted.ship.doctrine).toBe('screen');
    expect(exhausted.ship.suspicion).toBe(0);
    expect(exhausted.ship.datumX).toBeUndefined();
  });
});

describe('merchant evasion', () => {
  it('an alerted merchant zig-zags off the threat datum at full speed', () => {
    const merchant = shipFixture({
      id: 'merch-1',
      kind: 'merchant',
      alert: 0.6,
      lastKnownX: 70,
      lastKnownY: 60,
      patrolIndex: 2,
    });
    const state = lab([merchant]);
    const intent = merchantIntent(merchant, merchant.heading, state, FIXED_DT);
    expect(intent.speedFrac).toBe(1);
    expect(intent.heading).not.toBeNull();
    // Threat is dead ahead (+x): the weave must carry it off that bearing.
    expect(Math.abs(Math.cos(intent.heading!))).toBeLessThan(1);
    const away = Math.atan2(merchant.y - 60, merchant.x - 70);
    const delta = Math.atan2(Math.sin(intent.heading! - away), Math.cos(intent.heading! - away));
    expect(Math.abs(delta)).toBeLessThanOrEqual(0.46);
  });

  it('merchants scatter directly away from a nearby torpedo hit for 30s', () => {
    const hitX = 63;
    const hitY = 60;
    const victim = shipFixture({
      id: 'victim',
      x: hitX,
      y: hitY,
      lastHitX: hitX,
      lastHitY: hitY,
      lastHitTime: 0,
    });
    const merchant = shipFixture({ id: 'merch-1', kind: 'merchant', x: 60, y: 60 });
    const state = { ...lab([merchant, victim]), time: 0.1 };
    const scattered = merchantIntent(merchant, merchant.heading, state, FIXED_DT);
    expect(scattered.ship.scatterTimer).toBeGreaterThan(29);
    expect(scattered.heading).toBeCloseTo(Math.PI, 1); // away from the hit (+x)
    expect(scattered.speedFrac).toBe(1);
    // Once the hit is old news the scatter persists on its own timer.
    const later = { ...state, time: 5 };
    const still = merchantIntent(scattered.ship, merchant.heading, later, FIXED_DT);
    expect(still.heading).toBeCloseTo(Math.PI, 1);
    expect(still.ship.scatterTimer).toBeLessThan(30);
  });
});

describe('release callouts', () => {
  const chargeNear = (id: string): DepthCharge => ({
    id,
    kind: 'depthCharge',
    sourceId: 'escort-1',
    x: 65,
    y: 60,
    z: 0.1,
    vx: 0,
    vy: 0,
    vz: -0.12,
    fuse: 4,
    damage: 45,
    radius: 2.2,
    targetDepth: 0.7,
  });
  const torpedo = (owner: 'player' | 'enemy'): Torpedo => ({
    id: `fish-${owner}`,
    owner,
    kind: 'enemy',
    x: 70,
    y: 60,
    z: 0.5,
    heading: Math.PI,
    speed: 7,
    runSpeed: 7,
    lockId: null,
    life: 20,
    armDelay: 0.5,
    damage: 40,
    targetId: null,
    sourceId: 'escort-1',
    turnRate: 2,
    run: 0,
  });

  it('shouts depth charges and enemy torpedoes, each throttled to 4s', () => {
    const state = lab([shipFixture()], { x: 60, y: 60 });
    const first = releaseCallouts(state, [chargeNear('a')], [torpedo('enemy')]);
    expect(first.map((m) => m.text)).toEqual([
      'DEPTH CHARGES IN THE WATER',
      'TORPEDO IN THE WATER',
    ]);
    const flooded = { ...state, messages: [...state.messages, ...first] };
    // Same messages still live — a second release in the window stays quiet.
    expect(releaseCallouts(flooded, [chargeNear('b')], [torpedo('enemy')])).toEqual([]);
    // A player fish earns no callout, and distant charges stay silent.
    expect(releaseCallouts(state, [], [torpedo('player')])).toEqual([]);
    const farCharge = { ...chargeNear('c'), x: 90, y: 90 };
    expect(releaseCallouts(state, [farCharge], [])).toEqual([]);
  });
});

describe('dodge skill', () => {
  /**
   * Two escorts with a firm fix prosecute the boat. One bot holds depth and
   * course; the other goes deep, silent, and turns hard the moment charges
   * splash. Evasion must beat standing still across seeds.
   */
  function attackScenario(seed: number): GameState {
    const escorts = [-1, 1].map((side, index) =>
      shipFixture({
        id: `escort-${index}`,
        x: 60 + side * 7,
        y: 60 + side * 2,
        heading: side < 0 ? 0 : Math.PI,
        alert: 1,
        holdContact: 5,
        doctrine: 'prosecute',
        datumX: 60,
        datumY: 60,
        datumVx: 0,
        datumVy: 0,
        lastFixTime: 0,
        weaponCooldown: index === 0 ? 0 : 4,
      }),
    );
    return lab(escorts, { x: 60, y: 60, z: 0.75, targetDepth: 0.75 }, seed);
  }

  function runFight(seed: number, evade: boolean): GameState {
    let state = attackScenario(seed);
    if (evade) {
      state = setDepthOrder(state, 'deep');
      state = setSpeedOrder(state, 'twoThirds');
      state = {
        ...state,
        submarine: { ...state.submarine, silentRunning: true },
      };
    }
    let yaw = 1;
    const steps = Math.round(60 / FIXED_DT);
    for (let index = 0; index < steps; index += 1) {
      const commands =
        evade && state.depthCharges.length > 0
          ? [{ type: 'helm' as const, surge: 0, yaw, depth: 0 }]
          : [];
      state = updateGame(state, commands, FIXED_DT);
      if (evade && index % Math.round(4 / FIXED_DT) === 0) yaw = -yaw;
      if (state.phase !== 'playing') break;
    }
    return state;
  }

  it('a deep silent boat that turns under the pattern survives more often', () => {
    const seeds = [1, 7, 19, 42, 91];
    const evasive = seeds.filter((seed) => runFight(seed, true).submarine.hp > 0);
    const passive = seeds.filter((seed) => runFight(seed, false).submarine.hp > 0);
    expect(evasive.length).toBeGreaterThan(passive.length);
    expect(evasive.length).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
