import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import { canonicalSnapshot } from '../../src/game/replay';
import { createGame, setEnvironment, startMission, updateGame } from '../../src/game/sim/api';
import { WORLD_CENTER } from '../../src/game/sim/constants';
import { canHearSubmarine, canSeeSubmarine } from '../../src/game/sim/contact';
import {
  DEFAULT_ENVIRONMENT,
  TIME_OF_DAY_IDS,
  WEATHER_KINDS,
  environmentFor,
  patternScatter,
  shipSpeedFactor,
  sonarRangeFactor,
  visualRangeFactor,
  type Environment,
  type TimeOfDayId,
  type WeatherKind,
} from '../../src/game/sim/environment';
import { depthChargePattern, hedgehogEllipse } from '../../src/game/sim/ordnance-physics';
import { passiveRange, shipMachineryNoise } from '../../src/game/sim/sonar';
import type { GameState, Ship, Submarine } from '../../src/game/sim/types';

const withWind = (windMs: number): Environment => ({ ...DEFAULT_ENVIRONMENT, windMs });
const WINDS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

function placed(
  state: GameState,
  ship: Partial<Ship> & Pick<Ship, 'kind'>,
  sub: Partial<Submarine>,
  env: Environment,
): GameState {
  const base = state.ships.find((s) => s.kind === ship.kind) ?? state.ships[0]!;
  return {
    ...state,
    environment: env,
    sonarPing: 0,
    sonarContacts: [],
    countermeasures: [],
    base: { ...state.base, x: -200, y: -200 },
    submarine: {
      ...state.submarine,
      silentRunning: false,
      snorkel: false,
      scopeUp: false,
      invuln: 0,
      speed: 0,
      targetSpeed: 0,
      speedOrder: 'stop',
      ...sub,
    },
    ships: [
      {
        ...base,
        heading: 0,
        speed: 0,
        alert: 0,
        holdContact: 0,
        path: [],
        formationAnchorId: null,
        lastKnownX: undefined,
        lastKnownY: undefined,
        ...ship,
      },
    ],
  };
}

function run(state: GameState, seconds: number): GameState {
  let next = state;
  for (let i = 0; i < Math.ceil(seconds / FIXED_DT); i++) next = updateGame(next, [], FIXED_DT);
  return next;
}

describe('default environment is the identity (A3)', () => {
  it('is clear, day, light breeze', () => {
    expect(DEFAULT_ENVIRONMENT.weather).toBe('clear');
    expect(DEFAULT_ENVIRONMENT.timeOfDay).toBe('day');
    expect(DEFAULT_ENVIRONMENT.windMs).toBeGreaterThan(2);
    expect(DEFAULT_ENVIRONMENT.windMs).toBeLessThan(6);
    expect(environmentFor('clear', 'day')).toEqual(DEFAULT_ENVIRONMENT);
  });

  it('every factor is exactly 1', () => {
    expect(sonarRangeFactor(DEFAULT_ENVIRONMENT)).toBe(1);
    expect(visualRangeFactor(DEFAULT_ENVIRONMENT)).toBe(1);
    expect(shipSpeedFactor(DEFAULT_ENVIRONMENT)).toBe(1);
    expect(patternScatter(DEFAULT_ENVIRONMENT)).toBe(1);
  });

  it('both worlds start in the default environment', () => {
    expect(createGame(7).environment).toEqual(DEFAULT_ENVIRONMENT);
    expect(createGame(7, 'littoral-v2').environment).toEqual(DEFAULT_ENVIRONMENT);
  });

  it('every weather/time pair stays inside the documented factor bounds', () => {
    for (const weather of WEATHER_KINDS) {
      for (const time of TIME_OF_DAY_IDS) {
        const env = environmentFor(weather, time);
        expect(env.rain).toBeGreaterThanOrEqual(0);
        expect(env.rain).toBeLessThanOrEqual(1);
        expect(env.fog).toBeGreaterThanOrEqual(0);
        expect(env.fog).toBeLessThanOrEqual(1);
        expect(env.cloud).toBeGreaterThanOrEqual(0);
        expect(env.cloud).toBeLessThanOrEqual(1);
        expect(sonarRangeFactor(env)).toBeGreaterThanOrEqual(0.45);
        expect(sonarRangeFactor(env)).toBeLessThanOrEqual(1);
        expect(visualRangeFactor(env)).toBeGreaterThanOrEqual(0.15);
        expect(visualRangeFactor(env)).toBeLessThanOrEqual(1);
        expect(shipSpeedFactor(env)).toBeGreaterThan(0.5);
        expect(shipSpeedFactor(env)).toBeLessThanOrEqual(1);
        expect(patternScatter(env)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('weather kinds carry sensible winds', () => {
    const wind = (w: WeatherKind) => environmentFor(w, 'day').windMs;
    expect(wind('storm')).toBeCloseTo(19, 0);
    expect(wind('rain')).toBeCloseTo(9, 0);
    expect(wind('overcast')).toBeCloseTo(7, 0);
    expect(wind('fog')).toBeCloseTo(3, 0);
    expect(environmentFor('fog', 'day').fog).toBeCloseTo(0.8, 5);
    expect(environmentFor('storm', 'day').rain).toBeGreaterThan(0.5);
  });
});

describe('factor monotonicity', () => {
  it('sonar range never rises as the sea builds, and stays above the floor', () => {
    let previous = 1;
    for (const wind of WINDS) {
      const factor = sonarRangeFactor(withWind(wind));
      expect(factor).toBeLessThanOrEqual(previous);
      expect(factor).toBeGreaterThanOrEqual(0.45);
      previous = factor;
    }
    expect(sonarRangeFactor(withWind(20))).toBeLessThan(0.7);
  });

  it('rain lowers sonar range further', () => {
    expect(sonarRangeFactor({ ...withWind(9), rain: 1 })).toBeLessThan(
      sonarRangeFactor({ ...withWind(9), rain: 0 }),
    );
  });

  it('storm slows ships and widens ordnance scatter monotonically with wind', () => {
    let speed = 1;
    let scatter = 1;
    for (const wind of WINDS) {
      const s = shipSpeedFactor(withWind(wind));
      const p = patternScatter(withWind(wind));
      expect(s).toBeLessThanOrEqual(speed);
      expect(p).toBeGreaterThanOrEqual(scatter);
      speed = s;
      scatter = p;
    }
    expect(shipSpeedFactor(environmentFor('storm', 'day'))).toBeCloseTo(0.78, 1);
    expect(patternScatter(environmentFor('storm', 'day'))).toBeGreaterThan(1.5);
  });

  it('light degrades visual range: day > dusk/dawn > night', () => {
    const at = (t: TimeOfDayId) => visualRangeFactor(environmentFor('clear', t));
    expect(at('day')).toBe(1);
    expect(at('dawn')).toBeCloseTo(0.7, 5);
    expect(at('dusk')).toBeCloseTo(0.7, 5);
    expect(at('night')).toBeCloseTo(0.35, 5);
  });

  it('fog and rain cut visual range, bad nights bottom out above the floor', () => {
    const day = (w: WeatherKind) => visualRangeFactor(environmentFor(w, 'day'));
    expect(day('fog')).toBeLessThan(0.6);
    expect(day('rain')).toBeLessThan(1);
    expect(day('storm')).toBeLessThan(day('rain'));
    expect(visualRangeFactor(environmentFor('fog', 'night'))).toBeGreaterThanOrEqual(0.15);
    expect(visualRangeFactor(environmentFor('storm', 'night'))).toBeGreaterThanOrEqual(0.15);
  });
});

describe('setEnvironment command', () => {
  it('sets weather and keeps time of day on a partial patch', () => {
    const state = createGame(5);
    const stormy = updateGame(state, [{ type: 'setEnvironment', weather: 'storm' }], 0);
    expect(stormy.environment).toEqual(environmentFor('storm', 'day'));
    const night = updateGame(stormy, [{ type: 'setEnvironment', timeOfDay: 'night' }], 0);
    expect(night.environment).toEqual(environmentFor('storm', 'night'));
  });

  it('works from the menu phase and through the api helper without mutating the input', () => {
    const state = createGame(5);
    const frozen = canonicalSnapshot(state);
    const next = setEnvironment(state, { weather: 'fog', timeOfDay: 'dusk' });
    expect(next.environment).toEqual(environmentFor('fog', 'dusk'));
    expect(canonicalSnapshot(state)).toBe(frozen);
    expect(setEnvironment(next, {}).environment).toEqual(next.environment);
  });
});

describe('A15 - determinism with an environment', () => {
  it('same seed + environment gives an identical sim', () => {
    const play = () => {
      let state = setEnvironment(startMission(createGame(11)), {
        weather: 'storm',
        timeOfDay: 'night',
      });
      for (let i = 0; i < 600; i++) state = updateGame(state, [], FIXED_DT);
      return canonicalSnapshot(state);
    };
    expect(play()).toBe(play());
  });

  it('a different environment changes the outcome', () => {
    const play = (weather: WeatherKind) => {
      let state = setEnvironment(startMission(createGame(11)), { weather });
      for (let i = 0; i < 600; i++) state = updateGame(state, [], FIXED_DT);
      return state.ships.map((ship) => `${ship.x.toFixed(4)},${ship.y.toFixed(4)}`).join('|');
    };
    expect(play('storm')).not.toBe(play('clear'));
  });
});

describe('A4 - rough sea shortens acoustic detection through real sim steps', () => {
  const ESCORT = { kind: 'destroyer' } as const;
  // Flank speed keeps the boat loud (noise ~0.63) after the sim recomputes it each step.
  const hearingSub = {
    x: WORLD_CENTER,
    y: WORLD_CENTER,
    z: 0.3,
    targetDepth: 0.3,
    noise: 0.63,
    speed: 2.4,
    targetSpeed: 2.4,
    speedOrder: 'flank' as const,
  };

  it('an escort that hears the boat on a calm sea loses it in a storm', () => {
    const base = startMission(createGame(21));
    const probe = placed(
      base,
      { ...ESCORT, x: WORLD_CENTER + 12, y: WORLD_CENTER, heading: Math.PI },
      hearingSub,
      DEFAULT_ENVIRONMENT,
    );
    expect(canHearSubmarine(probe.ships[0]!, probe)).toBe(true);
    const heardBy = (env: Environment) => {
      let state = placed(
        base,
        { ...ESCORT, x: WORLD_CENTER + 12, y: WORLD_CENTER, heading: Math.PI },
        hearingSub,
        env,
      );
      // One step is enough: detection raises holdContact immediately.
      state = updateGame(state, [], FIXED_DT);
      return state.ships[0]!.holdContact;
    };
    expect(heardBy(DEFAULT_ENVIRONMENT)).toBeGreaterThan(0);
    expect(heardBy(environmentFor('storm', 'day'))).toBe(0);
  });

  it('hearing range falls monotonically with wind (hear/no-hear boundary only moves inward)', () => {
    const base = startMission(createGame(21));
    const heard = WINDS.map((wind) => {
      const probe = placed(
        base,
        { ...ESCORT, x: WORLD_CENTER + 14, y: WORLD_CENTER, heading: Math.PI },
        hearingSub,
        withWind(wind),
      );
      return canHearSubmarine(probe.ships[0]!, probe);
    });
    for (let i = 1; i < heard.length; i++)
      expect(Number(heard[i])).toBeLessThanOrEqual(Number(heard[i - 1]));
    expect(heard[0]).toBe(true);
    expect(heard[heard.length - 1]).toBe(false);
  });

  it("the player's hydrophone also loses ships in a storm", () => {
    const base = startMission(createGame(21));
    const sub = { x: WORLD_CENTER, y: WORLD_CENTER, z: 0.3, targetDepth: 0.3, noise: 0.2 };
    const prototype = placed(
      base,
      { kind: 'destroyer', x: 0, y: 0, speed: 1.4 },
      sub,
      DEFAULT_ENVIRONMENT,
    );
    const noise = shipMachineryNoise(prototype.ships[0]!);
    const range = passiveRange('player', noise, sub.z, 0.02, 1);
    const distance = range * 0.85;
    const contactsFor = (env: Environment) => {
      let state = placed(
        base,
        { kind: 'destroyer', x: WORLD_CENTER + distance, y: WORLD_CENTER, speed: 1.4 },
        sub,
        env,
      );
      // Keep the escort in place so the margin is the only variable.
      state = { ...state, ships: state.ships.map((s) => ({ ...s, speed: 1.4 })) };
      state = updateGame(state, [], FIXED_DT);
      return state.sonarContacts.filter((c) => c.source === 'passive' && c.targetId !== null)
        .length;
    };
    expect(contactsFor(DEFAULT_ENVIRONMENT)).toBe(1);
    expect(contactsFor(environmentFor('storm', 'day'))).toBe(0);
  });

  it('an active sweep reaches less far in a storm', () => {
    const base = startMission(createGame(21));
    const sub = { x: WORLD_CENTER, y: WORLD_CENTER, z: 0.55, targetDepth: 0.55, noise: 0.05 };
    const distance = 29;
    const fixFor = (env: Environment) => {
      let state = placed(
        base,
        { ...ESCORT, x: WORLD_CENTER + distance, y: WORLD_CENTER },
        sub,
        env,
      );
      // The player is pinging, so the sweep radius is the loud 36 u; land a sweep pulse next step.
      state = { ...state, sonarPing: 4, time: 8.005 };
      state = updateGame(state, [], FIXED_DT);
      return state.ships[0]!.holdContact;
    };
    expect(fixFor(DEFAULT_ENVIRONMENT)).toBeGreaterThanOrEqual(1);
    expect(fixFor(environmentFor('storm', 'day'))).toBeLessThan(1);
  });
});

describe('A5 - night, fog and rain cut visual detection', () => {
  const surfaced = { x: WORLD_CENTER, y: WORLD_CENTER, z: 0.06, targetDepth: 0.06, noise: 0.05 };

  it('a surfaced boat seen by day goes unseen at night (merchant, no sweep or hearing)', () => {
    const base = startMission(createGame(21));
    const at = (env: Environment) =>
      placed(base, { kind: 'merchant', x: WORLD_CENTER + 6.3, y: WORLD_CENTER }, surfaced, env);
    const day = at(DEFAULT_ENVIRONMENT);
    expect(canSeeSubmarine(day.ships[0]!, day)).toBe(true);
    const night = at(environmentFor('clear', 'night'));
    expect(canSeeSubmarine(night.ships[0]!, night)).toBe(false);

    const seenAfter = (state: GameState) => updateGame(state, [], FIXED_DT).ships[0]!.holdContact;
    expect(seenAfter(day)).toBeGreaterThan(0);
    expect(seenAfter(night)).toBe(0);
  });

  it('raised scope and snorkel are covered by the same factor', () => {
    const base = startMission(createGame(21));
    for (const exposure of [
      { scopeUp: true, z: 0.3 },
      { snorkel: true, z: 0.3 },
    ]) {
      const at = (env: Environment) =>
        placed(
          base,
          { kind: 'merchant', x: WORLD_CENTER + 6.3, y: WORLD_CENTER },
          { ...surfaced, ...exposure, targetDepth: 0.3 },
          env,
        );
      const day = at(DEFAULT_ENVIRONMENT);
      const fog = at(environmentFor('fog', 'day'));
      expect(canSeeSubmarine(day.ships[0]!, day)).toBe(true);
      expect(canSeeSubmarine(fog.ships[0]!, fog)).toBe(false);
    }
  });

  it('visual range shrinks monotonically with the factor', () => {
    const base = startMission(createGame(21));
    const envs = [
      environmentFor('clear', 'day'),
      environmentFor('clear', 'dusk'),
      environmentFor('clear', 'night'),
    ];
    // 9 u merchant range * 1 / 0.7 / 0.35 -> seen at 5 u in all three? no: day only past 3.2 u.
    const seen = envs.map((env) => {
      const state = placed(
        base,
        { kind: 'merchant', x: WORLD_CENTER + 5, y: WORLD_CENTER },
        surfaced,
        env,
      );
      return canSeeSubmarine(state.ships[0]!, state);
    });
    expect(seen).toEqual([true, true, false]);
  });
});

describe('A11 - storm slows ships and widens ordnance scatter; calm is the identity', () => {
  const speedOf = (env: Environment) => {
    const base = startMission(createGame(21));
    const state = placed(
      base,
      { kind: 'merchant', x: WORLD_CENTER + 40, y: WORLD_CENTER + 40, speed: 1.1 },
      { x: WORLD_CENTER - 40, y: WORLD_CENTER - 40, z: 0.8, targetDepth: 0.8 },
      env,
    );
    return updateGame(state, [], FIXED_DT).ships[0]!.actualSpeed ?? 0;
  };

  it('ships make good the storm speed factor and calm changes nothing', () => {
    const calm = speedOf(DEFAULT_ENVIRONMENT);
    expect(calm).toBeGreaterThan(0);
    const storm = environmentFor('storm', 'day');
    expect(speedOf(storm) / calm).toBeCloseTo(shipSpeedFactor(storm), 9);
    expect(speedOf(storm)).toBeLessThan(calm * 0.85);
  });

  it('warships are slowed too (all surface ships)', () => {
    const base = startMission(createGame(21));
    const at = (env: Environment) =>
      updateGame(
        placed(
          base,
          { kind: 'destroyer', x: WORLD_CENTER + 40, y: WORLD_CENTER + 40, speed: 2 },
          { x: WORLD_CENTER - 40, y: WORLD_CENTER - 40, z: 0.8, targetDepth: 0.8 },
          env,
        ),
        [],
        FIXED_DT,
      ).ships[0]!.actualSpeed ?? 0;
    const storm = environmentFor('storm', 'day');
    expect(at(storm) / at(DEFAULT_ENVIRONMENT)).toBeCloseTo(shipSpeedFactor(storm), 9);
  });

  it('hedgehog volleys spread by the scatter factor', () => {
    const base = placed(
      startMission(createGame(21)),
      { kind: 'destroyer', x: WORLD_CENTER, y: WORLD_CENTER },
      { x: WORLD_CENTER + 3, y: WORLD_CENTER },
      DEFAULT_ENVIRONMENT,
    );
    const stormState = { ...base, environment: environmentFor('storm', 'day') };
    const spread = (state: GameState) => {
      const charges = hedgehogEllipse(state, state.ships[0]!, WORLD_CENTER + 3, WORLD_CENTER);
      return Math.max(
        ...charges.map((c) => Math.hypot(c.x - (WORLD_CENTER + 3), c.y - WORLD_CENTER)),
      );
    };
    expect(spread(stormState) / spread(base)).toBeCloseTo(
      patternScatter(stormState.environment),
      9,
    );
  });

  it('depth-charge K-gun throws spread by the scatter factor', () => {
    const base = placed(
      startMission(createGame(21)),
      { kind: 'destroyer', x: WORLD_CENTER, y: WORLD_CENTER },
      { x: WORLD_CENTER + 3, y: WORLD_CENTER },
      DEFAULT_ENVIRONMENT,
    );
    const stormState = { ...base, environment: environmentFor('storm', 'day') };
    const ship = base.ships[0]!;
    const calm = depthChargePattern(base, ship, 1234).charges;
    const rough = depthChargePattern(stormState, ship, 1234).charges;
    const factor = patternScatter(stormState.environment);
    expect(rough).toHaveLength(calm.length);
    // Throw velocities (K-guns) scale; the pistol depth rolls are untouched, so RNG is identical.
    const throws = (charges: typeof calm) => charges.filter((c) => c.vx !== 0 || c.vy !== 0);
    expect(throws(calm)).toHaveLength(2);
    for (const [index, charge] of throws(rough).entries()) {
      const reference = throws(calm)[index]!;
      expect(Math.hypot(charge.vx, charge.vy) / Math.hypot(reference.vx, reference.vy)).toBeCloseTo(
        factor,
        9,
      );
    }
    expect(rough.map((c) => c.targetDepth)).toEqual(calm.map((c) => c.targetDepth));
  });

  it('default scatter reproduces the original pattern exactly', () => {
    const base = placed(
      startMission(createGame(21)),
      { kind: 'destroyer', x: WORLD_CENTER, y: WORLD_CENTER },
      { x: WORLD_CENTER + 3, y: WORLD_CENTER },
      DEFAULT_ENVIRONMENT,
    );
    const ship = base.ships[0]!;
    expect(hedgehogEllipse(base, ship, WORLD_CENTER + 3, WORLD_CENTER)[0]).toMatchObject({
      x: WORLD_CENTER + 3 + 0.7 * Math.cos(0) * Math.cos(0),
      y: WORLD_CENTER + 0 + 0.7 * Math.cos(0) * Math.sin(0),
    });
  });
});

describe('run-through sanity', () => {
  it('a full minute under every weather keeps the sim finite', () => {
    for (const weather of WEATHER_KINDS) {
      let state = setEnvironment(startMission(createGame(3)), { weather, timeOfDay: 'night' });
      state = run(state, 2);
      for (const ship of state.ships) {
        expect(Number.isFinite(ship.x)).toBe(true);
        expect(Number.isFinite(ship.y)).toBe(true);
      }
    }
  });
});
