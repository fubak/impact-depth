import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../src/core/sim';
import {
  createGame,
  setAutopilot,
  setDepthOrder,
  startMission,
  updateGame,
} from '../../src/game/sim/api';

describe('ambush realistic engagements', () => {
  it('from ~36u with full wave: closes, fires, and eliminates merchant', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 120; i++) state = updateGame(state, [], FIXED_DT);

    const merchant = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
    const targetId = merchant.id;

    // Match browser-ish start: far, invuln, full mag, but escorts LIVE.
    state = {
      ...state,
      selectedTargetId: targetId,
      submarine: {
        ...state.submarine,
        x: merchant.x - 36,
        y: merchant.y - 2,
        z: 0.28,
        targetDepth: 0.28,
        heading: Math.PI, // pointed away initially
        invuln: 300,
        hp: 100,
        sysFlood: 0,
        torpedoes: 8,
        seekers: 4,
        reloadMk14: 0,
        maxTorpedoes: 8,
      },
    };
    state = setAutopilot(state, 'ambush', targetId);

    let fired = 0;
    let hits = 0;
    let minRange = Infinity;
    let maxBreakaway = 0;
    const events: string[] = [];
    for (let i = 0; i < Math.ceil(240 / FIXED_DT); i++) {
      const beforeFish = state.torpedoes.length;
      const beforeHp = state.ships.find((s) => s.id === targetId)?.hp ?? 0;
      const phaseBefore = state.autopilot.phase;
      state = updateGame(state, [], FIXED_DT);
      if (state.torpedoes.length > beforeFish) {
        fired += 1;
        events.push(`FIRE t=${(i * FIXED_DT).toFixed(1)} range=${state.ships.find(s=>s.id===targetId) ? Math.hypot(state.submarine.x-(state.ships.find(s=>s.id===targetId)?.x??0), state.submarine.y-(state.ships.find(s=>s.id===targetId)?.y??0)).toFixed(1) : '?'} depth=${state.submarine.z.toFixed(2)}`);
      }
      const live = state.ships.find((s) => s.id === targetId);
      if (live && live.hp < beforeHp) hits += 1;
      if (live) minRange = Math.min(minRange, Math.hypot(state.submarine.x - live.x, state.submarine.y - live.y));
      if (state.autopilot.phase === 'breakaway') maxBreakaway += FIXED_DT;
      if (phaseBefore !== state.autopilot.phase) {
        events.push(`PHASE ${phaseBefore}->${state.autopilot.phase} t=${(i*FIXED_DT).toFixed(1)} tactic=${state.autopilot.tactic}`);
      }
      if (state.autopilot.tactic === 'exfil') {
        events.push(`EXFIL t=${(i*FIXED_DT).toFixed(1)} hp=${state.submarine.hp} flood=${state.submarine.sysFlood}`);
        break;
      }
      if (!live) {
        events.push(`SUNK t=${(i * FIXED_DT).toFixed(1)}`);
        break;
      }
    }

    const survivor = state.ships.find((s) => s.id === targetId);
    console.log(events.join('\n'));
    console.log({
      fired, hits, minRange, maxBreakaway,
      endHp: survivor?.hp ?? 0,
      sunk: !survivor,
      shipsSunk: state.stats.shipsSunk,
      damageDealt: state.stats.damageDealt,
      tactic: state.autopilot.tactic,
      phase: state.autopilot.phase,
      playerHp: state.submarine.hp,
      messages: state.messages.filter(m => /HIT|SUNK|EXFIL|NO MK|LOCKED/.test(m.text)).slice(-8).map(m => m.text),
    });

    expect(fired).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
    expect(!survivor || state.stats.shipsSunk > 0).toBe(true);
  });

  it('re-engages after breakaway if target survives first salvo', () => {
    let state = startMission(createGame(19));
    state = setDepthOrder(state, 'periscope');
    for (let i = 0; i < 60; i++) state = updateGame(state, [], FIXED_DT);
    const merchant = state.ships.find((s) => s.kind === 'merchant') ?? state.ships[0]!;
    // Beefy hull so one spread cannot delete it.
    state = {
      ...state,
      selectedTargetId: merchant.id,
      ships: state.ships.map((s) =>
        s.id === merchant.id ? { ...s, hp: 200, maxHp: 200 } : { ...s, weaponCooldown: 99, alert: 0 },
      ),
      submarine: {
        ...state.submarine,
        x: merchant.x - 8,
        y: merchant.y,
        z: 0.28,
        targetDepth: 0.28,
        heading: 0,
        invuln: 400,
        hp: 100,
        sysFlood: 0,
        torpedoes: 8,
        reloadMk14: 0,
      },
    };
    state = setAutopilot(state, 'ambush', merchant.id);

    let salvos = 0;
    let sawApproachAfterBreakaway = false;
    let wasBreakaway = false;
    for (let i = 0; i < Math.ceil(120 / FIXED_DT); i++) {
      const before = state.torpedoes.length;
      state = updateGame(state, [], FIXED_DT);
      if (state.torpedoes.length > before) salvos += 1;
      if (state.autopilot.phase === 'breakaway') wasBreakaway = true;
      if (wasBreakaway && (state.autopilot.phase === 'approach' || state.autopilot.phase === 'setup')) {
        sawApproachAfterBreakaway = true;
      }
      if (!state.ships.find((s) => s.id === merchant.id)) break;
      if (salvos >= 2 && sawApproachAfterBreakaway) break;
    }

    console.log({ salvos, wasBreakaway, sawApproachAfterBreakaway, sunk: !state.ships.find(s => s.id === merchant.id), hp: state.ships.find(s => s.id === merchant.id)?.hp });
    expect(salvos).toBeGreaterThanOrEqual(2);
    expect(wasBreakaway).toBe(true);
    expect(sawApproachAfterBreakaway).toBe(true);
  });
});
