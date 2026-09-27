import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  setAutopilot,
  setDepthOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';

describe('ambush full engagement', () => {
  it('runs Ambush until the locked merchant is eliminated', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 60; i++) state = updateGame(state, [], FIXED_DT);

    const merchant = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
    const targetId = merchant.id;
    const startHp = merchant.hp;

    state = {
      ...state,
      selectedTargetId: targetId,
      ships: state.ships.map((s) =>
        s.id === targetId ? s : { ...s, alert: 0, holdContact: 0, weaponCooldown: 99 },
      ),
      submarine: {
        ...state.submarine,
        x: merchant.x - 16,
        y: merchant.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
        invuln: 600,
        hp: 100,
        sysFlood: 0,
        torpedoes: 8,
        seekers: 4,
        reloadMk14: 0,
        reloadMk18: 0,
        silentRunning: false,
      },
    };

    state = setAutopilot(state, 'ambush', targetId);

    let fired = 0;
    let hits = 0;
    let minRange = Infinity;
    let sawDestroyed = false;
    let wasSinking = false;
    const log: string[] = [];
    const limit = Math.ceil(180 / FIXED_DT);

    for (let i = 0; i < limit; i++) {
      const beforeFish = state.torpedoes.length;
      const beforeHp = state.ships.find((s) => s.id === targetId)?.hp ?? 0;
      state = updateGame(state, [], FIXED_DT);
      if (state.torpedoes.length > beforeFish) fired += 1;
      const live = state.ships.find((s) => s.id === targetId);
      const hp = live?.hp ?? 0;
      if (hp < beforeHp) hits += 1;
      // A mortal hit now stands the autopilot down long before the hull
      // finishes sinking — the stand-down message can expire from the queue
      // while we wait for removal, so latch it as it appears.
      if (state.messages.some((m) => /CONTACT DESTROYED/.test(m.text))) sawDestroyed = true;
      if (live) {
        const range = Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y);
        minRange = Math.min(minRange, range);
      }
      const justStartedSinking =
        live !== undefined && live.sinking !== undefined && !wasSinking;
      if (i % Math.ceil(10 / FIXED_DT) === 0 || !live || justStartedSinking) {
        log.push(
          `t=${(i * FIXED_DT).toFixed(0)}s phase=${state.autopilot.phase} tactic=${state.autopilot.tactic} ` +
            `range=${live ? Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y).toFixed(1) : 'SUNK'} ` +
            `hp=${live?.hp ?? 0} fish=${state.torpedoes.length} fired=${fired} hits=${hits} ` +
            `depth=${state.submarine.z.toFixed(2)} shotT=${state.autopilot.shotTimer.toFixed(1)}`,
        );
      }
      wasSinking = live?.sinking !== undefined;
      if (!live || (live.sinking !== undefined && live.sinking <= 0)) break;
      if (live.sinking !== undefined) {
        // Wait for sink completion through damage system
      }
    }

    const survivor = state.ships.find((s) => s.id === targetId);
    const sunk = !survivor || survivor.sinking !== undefined || (survivor.hp ?? 0) <= 0;
    console.log(log.join('\n'));
    console.log({
      startHp,
      endHp: survivor?.hp ?? 0,
      sunk,
      fired,
      hits,
      minRange,
      damageDealt: state.stats.damageDealt,
      shipsSunk: state.stats.shipsSunk,
      messages: state.messages.filter((m) => /HIT|SUNK|BREAKING/.test(m.text)).map((m) => m.text),
    });

    expect(fired).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    expect(minRange).toBeLessThan(10);
    expect(sunk || state.stats.shipsSunk > 0 || (survivor?.hp ?? 0) <= 0).toBe(true);
    // After the locked contact dies, Ambush stands down and waits for orders.
    expect(state.stats.shipsSunk > 0 || sunk).toBe(true);
    expect(state.autopilot.enabled).toBe(false);
    expect(state.autopilot.tactic).toBe('manual');
    expect(sawDestroyed).toBe(true);
  });
});
