# Plan 024: Execute the action-gameplay review

> **For agentic workers:** Implement one phase per session. Do not start the next phase in the same session. Steps use checkbox (`- [ ]`) syntax. Spec: [Plan 023](023-action-gameplay-and-production-readiness.md). Evidence: [probes](../docs/release/plan-023-simulation-probes.json) at `ddd4281`. This plan was written against `f55bfe6` (docs only on top of that revision).

**Goal:** Make escape and weapons truthful, then ship one readable attack-and-escape mission and a release check that fails when that mission's inputs fail.

**Architecture:** Simulation in `src/game/sim/**` stays the authority and stays free of Three.js and the DOM. Rendering and HUD read snapshots and typed combat events. Each phase leaves `npm run build` working. Operator gates from Plans 014, 015, 017, and 018 stay pending. This plan feeds Plan 017. It does not replace it and it does not tag `solo-production`.

**Tech stack:** Vite, TypeScript, Vitest, Playwright, Three.js. No new runtime dependencies.

## Global constraints

- Desktop Chromium / WebGL2. Do not flip the world default off `legacy-v1`. Ocean rollback remains `?ocean=gerstner`.
- `VICTORY_TARGET` stays `8`. A win still requires a cleared board and at least 8 sinks. Player-facing copy says **Clear two waves**, because wave 1 is 5 ships and wave 2 is 10.
- `FIRE_MAX_DEPTH` becomes `0.80`. `DEPTH_TARGET.deep` stays `0.82`, so Deep cannot fire. Attack (`0.5`) and periscope (`0.28`) still can.
- Blast horizontal `radius` stays in sim units. Vertical extent is normalized depth, per kind: depth charge `0.28`, hedgehog `0.18`, shell `0.12`, bomb `0.22`.
- Quiet-sweep growth after 62 s stays, and it is capped at `18` sim units. It still applies only to a silent, non-flank boat shallower than `DEEP_SAFE_DEPTH` (`0.6`).
- No `Math.random` in `src/game/**`. No network fetches. No new GLB downloads. Do not edit `.archive/`.
- Do not weaken `tests/game/survival.balance.test.ts` or `tests/game/stealth-start.test.ts`.
- Do not mark GPU ≥55 FPS, lighting eye-pass, fleet ACCEPT, audio listen, soak, fun/feel, or `solo-production` as pass. SwiftShader is not a visual pass.
- Git: stage explicit paths. Never `git add -A` (untracked `.claude/` and `ambush-bow-forward.png`). Commit only when the operator asked this session to commit. Push once per finished phase, only when asked, because a `master` push deploys Pages.
- One phase per session. Phase 1 has no product fork. Phases 2–4 use the defaults in this file.

## Defaults (locked)

| ID  | Choice                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Victory copy is "Clear two waves". The constant stays 8. Eight sinks with ships still on the board is not a win. Clearing wave 1 is not a win.                                |
| D2  | Deep cannot fire. Tooltip stays "cannot fire". The fire gate moves to `0.80`.                                                                                                 |
| D3  | Enemy AI torpedoes stay `kind: 'enemy'`. They home on the player with their existing `turnRate`, and both Foxer branches apply to them. Player Mk-18 behavior stays as it is. |
| D4  | The wave patrol remains. `convoy-strike` is an additional scenario. Doctrines keep auto-fire. The strike scenario leaves auto-fire off.                                       |
| D5  | Torpedo cinema cancels when the player changes heading or speed, and when an escort has contact (already true). Key `V` toggles 4× compression. It defaults on.               |
| D6  | New meshes, controller support, co-op, auth, and a framework rewrite are out of scope.                                                                                        |

## Phase 1 — Trustworthy combat and the red patrol check

Session exit: the tests below pass, `npm run verify` passes, and `npm run test:e2e -- <preview url>` completes every journey or the failing journey is fixed in this phase. Record the targeting-fire cause in `tasks/state.md`.

### Task 1: Lift the hull before seamount crush

Evade orders depth `0.72` every update (`setOrders` in `src/game/sim/autopilot.ts`). The next system integrates `z` toward that order (`integrateSubmarineDepth`). `worldCollision` then clamps `targetDepth` and leaves `z` where it is, so the next autopilot update writes `0.72` again. Crush is `SEAMOUNT_CRUSH_DPS` (18) while `isCrushedBySeamount`. The probe attributes seed 7's 100 HP to `worldCollision` at 13.57 s.

**Files:** `src/game/sim/world.ts`, `src/game/sim/systems.ts` (`worldCollision`), `src/game/sim/autopilot.ts` (`setOrders` call sites that pass a depth), `tests/game/seamount-clearance.test.ts` (new).

- [ ] **Step 1: Write the failing test**

```ts
it('a deep order over a seamount stops at the crush ceiling and deals no damage', () => {
  let state = startMission(createGame(7));
  const terrain = getTerrain(state.terrainSeed);
  const sub = state.submarine;
  let cell: { x: number; y: number } | null = null;
  for (let y = 2; y < 126 && !cell; y += 2) {
    for (let x = 2; x < 126 && !cell; x += 2) {
      if (isCrushedBySeamount(terrain, x, y, 0.72)) cell = { x, y };
    }
  }
  expect(cell).not.toBeNull();
  state = {
    ...state,
    ships: [],
    autopilot: { ...state.autopilot, enabled: false, tactic: 'manual' },
    submarine: {
      ...sub,
      x: cell!.x,
      y: cell!.y,
      z: 0.5,
      targetDepth: 0.72,
      hp: 100,
      invuln: 0,
      speed: 0,
      targetSpeed: 0,
      speedOrder: 'stop',
    },
  };
  state = updateGame(state, [], FIXED_DT);
  expect(state.submarine.hp).toBe(100);
  expect(
    isCrushedBySeamount(terrain, state.submarine.x, state.submarine.y, state.submarine.z),
  ).toBe(false);
  expect(state.submarine.z).toBeLessThanOrEqual(
    hullDepthLimit(terrain, state.submarine.x, state.submarine.y) + 1e-6,
  );
});
```

`hullDepthLimit` is `Math.max(SEAMOUNT_CRUSH_DEPTH, clampDepth(1 - terrainHeight(terrain, x, y) + 0.2) - 0.03)`.

- [ ] **Step 2: Run `npx vitest run tests/game/seamount-clearance.test.ts` and confirm the new test fails.**
- [ ] **Step 3: Implement.** Export `hullDepthLimit` from `world.ts`. In `worldCollision`, set `z` to `Math.min(clampDepth(sub.z), hullDepthLimit(...))` before the crush test, and set `targetDepth` to `Math.min(sub.targetDepth, hullDepthLimit(...))`. Crush damage on the lifted hull is 0. In `updateAutopilot`, pass `Math.min(orderedDepth, hullDepthLimit(terrain, sub.x, sub.y))` into every `setOrders` depth argument for the legacy world. When the limit is below the ordered depth, append one message `BOTTOM` with ttl `1.2` (do not spam: skip if a live `BOTTOM` message exists). Littoral-v2 keeps `resolveV2WorldCollision`.
- [ ] **Step 4: Re-run the test. Expected: pass.**

### Task 2: Evade survives the three grounding seeds

**Files:** `tests/game/playtest/doctrines.test.ts`, `src/game/sim/autopilot.ts` only if Task 1's depth clamp is not enough because the horizontal goal drives into a cell whose limit is still lethal. Prefer a goal from `steerAvoid` / `snapToNavigable` when `!clear(goal)`.

- [ ] **Step 1: Replace both `it.fails` blocks with per-seed tests.** Delete the aggregated "any seed missed" form.

```ts
for (const seed of [7, 42, 91] as const) {
  it(`evade on seed ${seed} returns to manual alive without sitting in a seamount`, () => {
    const state = runDoctrine(
      seed,
      'evade',
      (current) => current.autopilot.tactic === 'manual' || current.submarine.hp <= 0,
    );
    expect(state.submarine.hp).toBeGreaterThan(0);
    expect(state.autopilot.tactic).toBe('manual');
    expect(state.time).toBeLessThan(180);
    const terrain = getTerrain(state.terrainSeed);
    expect(
      isCrushedBySeamount(terrain, state.submarine.x, state.submarine.y, state.submarine.z),
    ).toBe(false);
  });
}
```

Keep the existing passing test for seeds 1 and 19.

- [ ] **Step 2: Run the new tests. They fail on current `master` (hp 0 around 13.57 s).**
- [ ] **Step 3: If Task 1 already makes them pass, stop. If a seed still dies, log HP and `isCrushedBySeamount` each second. A death with crush false is a weapon kill: STOP and report the seed. Do not change weapon damage in this task.**
- [ ] **Step 4: Expected: seeds 7, 42, and 91 end alive in `manual`.**

### Task 3: Emergency Exfil leaves breakaway

`updateAutopilot` line 175 sets `phase: 'breakaway'` and `phaseTimer: 0` on every update while `hp < 28` or `sysFlood > 0.45`. The breakaway branch returns before the exfil branch. Line 195 refuses to advance an exfil. The 20 s probe stays in breakaway at timer 0.

**Files:** `src/game/sim/types.ts` (`Autopilot.emergency: boolean`), `src/game/sim/create.ts` (initialize `false`), `src/game/sim/systems.ts` (the two autopilot literals around lines 471 and 768), `tests/game/engagement-stand-down.test.ts` (add `emergency: false` on the fixture), `src/game/sim/autopilot.ts`, `tests/game/playtest/doctrines.test.ts`.

- [ ] **Step 1: Failing test.** Empty the ship list so ordnance cannot kill the boat. Set `hp` to `20`, `sysFlood` to `0`, tactic `manual`, then `setAutopilot(..., 'exfil')`. Step `20` seconds.

```ts
expect(state.autopilot.tactic).toBe('exfil');
expect(state.autopilot.phase).not.toBe('breakaway');
expect(state.autopilot.phaseTimer).toBeGreaterThan(1);
expect(state.autopilot.emergency).toBe(true);
const distance = Math.hypot(state.submarine.x - state.base.x, state.submarine.y - state.base.y);
expect(distance).toBeLessThan(startDistance);
```

Second test, same setup, horizon 180 s: `distance <= state.base.radius` and `hp > 0`, or a message whose text is `CANNOT REACH BASE`.

- [ ] **Step 2: Confirm both fail (phase is still `breakaway`, timer stays 0).**
- [ ] **Step 3: Implement.** Add `emergency`. When the HP/flood condition is true and `emergency` is already true, do not touch `phase` or `phaseTimer`. When it becomes true, set `emergency`, `tactic: 'exfil'`, `phase: 'breakaway'`, `phaseTimer: 0` once. Change the breakaway exit so exfil advances to `phase: 'approach'` after `3.5` s. The existing exfil block then steers to `state.base`. When docked (`phase: 'dock'`) and `hp >= 28` and `sysFlood <= 0.45`, set `emergency` false and `tactic: 'manual'`. If 180 s elapse and the base distance is not inside `base.radius`, push `CANNOT REACH BASE`.
- [ ] **Step 4: Per-seed exfil tests, normal assertions, horizon 180 s.**

| Seed         | Expect                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| 19           | Alive and `distance <= base.radius` (already true at 100.2 s, 40 HP in the probe) |
| 1, 7, 42, 91 | Alive and inside the base ring, or alive with `CANNOT REACH BASE`                 |

A seed that dies from `isCrushedBySeamount` goes back to Task 1. A seed that dies from ordnance is a recorded result, not an `it.fails`: assert the cause by checking crush is false and `hp === 0`, and add the message requirement only for the empty-ocean test.

- [ ] **Step 5: `npx vitest run tests/game/playtest/doctrines.test.ts tests/game/engagement-stand-down.test.ts` passes.**

### Task 4: Vertical blast extent

`ordnance` treats a hit when horizontal distance `<= radius` and `abs(targetDepth - submarine.z) <= radius`. Depth is 0–1. Bomb `radius` is `1.8`, so a boat at `0.95` takes full damage from a surface burst. The probe: 100 HP to 70 HP.

**Files:** `src/game/sim/constants.ts`, `src/game/sim/blast.ts` (new, pure), `src/game/sim/systems.ts` (call it), `tests/game/blast.test.ts` (new).

- [ ] **Step 1: Failing test of the pure function.**

```ts
export const BLAST_VERTICAL: Record<DepthCharge['kind'], number> = {
  depthCharge: 0.28,
  hedgehog: 0.18,
  shell: 0.12,
  bomb: 0.22,
};

// horizontal 0, targetDepth 0.02, subZ 0.95, radius 1.8, vertical 0.22, damage 30 → 0
// horizontal 0, targetDepth 0.5, subZ 0.5, radius 1.8, vertical 0.22, damage 30 → 30
// horizontal === radius → 0
// horizontal half radius, depth delta half the vertical extent → 30 * 0.5 * 0.5
```

`blastDamage` returns `damage * (1 - horizontal / radius) * (1 - depthDelta / vertical)` when both ratios are `< 1`, else `0`.

- [ ] **Step 2: Confirm the test fails because the module does not exist.**
- [ ] **Step 3: Implement `blastDamage` and call it from the depth-charge branch. Keep the bubble `0.75` multiplier. Set `vertical` from `BLAST_VERTICAL[charge.kind]`.** The aircraft bomb uses kind `bomb`.
- [ ] **Step 4: Add one `updateGame` test.** A charge on the boat's XY, `targetDepth` `0.02`, boat `z` `0.95`, `radius` `1.8`, `damage` `30`, `fuse` `0` → HP stays `100`. The same charge with `z` `0.02` → HP drops. `npx vitest run tests/game/blast.test.ts` passes.

### Task 5: Enemy torpedoes use the Foxer and homing branches

`makeThreat` builds `kind: 'enemy'`. Homing and the 12-unit seduction branch require `kind: 'mk18'`. The short-range Foxer pull already applies to every enemy-owned torpedo. Enemy subs launch through `enemies` around line 1001.

**Files:** `src/game/sim/systems.ts` (`ordnance`), `tests/game/enemy-torpedo.test.ts` (new).

- [ ] **Step 1: Failing test that does not construct an Mk-18.** Start a mission, remove ships, insert one enemy `sub` at 8 units with `alert` `1`, `holdContact` `8`, `weaponCooldown` `0`. Step until a torpedo with `kind: 'enemy'` and `owner: 'enemy'` exists. With no countermeasure, after further steps its heading is closer to the player than its launch heading. With a Foxer on the line and `seduceRoll(seed, id) < FOXER_SEDUCE_ODDS`, heading moves toward the Foxer. Pick the seed inside the test by calling `seduceRoll` so the assertion matches the roll. A seed above the odds keeps homing on the player.
- [ ] **Step 2: Confirm it fails (heading unchanged, because kind is not `mk18`).**
- [ ] **Step 3: Implement.** Treat `owner === 'enemy' && targetId === 'player'` like the current `mk18Player` branch, including `FOXER_SEDUCE_RANGE` and `FOXER_SEDUCE_ODDS`. Leave the short-range Foxer consumption in place. Do not change player Mk-14 / Mk-18 firing.
- [ ] **Step 4: Test passes.** Existing countermeasure tests stay green.

### Task 6: Deep cannot fire, and the victory sentence matches the rule

**Files:** `src/game/sim/constants.ts` (`FIRE_MAX_DEPTH = 0.80`), `src/ui/hud.ts` (Deep tooltip stays "cannot fire"; add an objective line), `src/ui/tutorial.ts` (the "Sink ships to clear the sector" body), `src/ui/overlays.ts` (result card), `docs/prd.md` line 756 only, `tests/game/constants.test.ts`, `tests/game/fire-depth.test.ts` (new), `tests/game/playtest/progression.test.ts`, `tests/game/combat-progression.test.ts`.

- [ ] **Step 1: Fire test.** At `z = 0.82`, `fireStatus` is not ready and the label is `TOO DEEP`. At `z = 0.50`, a boat with tubes and Mk-14s is ready. A command to fire at `0.82` does not increment `torpedoesFired`.
- [ ] **Step 2: Victory tests.**

```ts
it('eight sinks with ships still afloat is not victory', () => {
  /* shipsSunk 8, one ship alive, phase stays playing */
});
it('clearing wave 1 is not victory', () => {
  /* existing wave-2 spawn test already expects phase playing; keep it */
});
```

The tests "eight sinks on a cleared wave give victory" and "only wins after an eight-sink cleared wave" stay, because they clear the board.

- [ ] **Step 3: Copy.** HUD objective text: `Clear two waves`. Tutorial body: `Clear two waves. Reopen this guide from Help anytime.` End card adds the same sentence beside the score. PRD checklist line 756 becomes `- [ ] Victory: clear two waves and at least 8 sinks; game over on 0 HP`. Deep tooltip string stays `Deep — quieter, safer, slower, cannot fire`.
- [ ] **Step 4: A string test reads the tutorial step and the HUD objective. `constants.test.ts` expects `FIRE_MAX_DEPTH: 0.8` and `VICTORY_TARGET: 8`.**

### Task 7: Bottom clearance on the HUD

**Files:** `src/ui/hud.ts`, `tests/game/hud-clearance.test.ts` (new). Export a pure `bottomClearanceText(limit: number, z: number): string | null` that returns `BOTTOM` when `limit - z < 0.08`, otherwise `null`. Render it in the depth readout. The sim message from Task 1 is the urgent toast. This function is the persistent label.

- [ ] Test: `bottomClearanceText(0.62, 0.60)` is `BOTTOM`. `bottomClearanceText(0.90, 0.50)` is `null`.

### Task 8: Quiet-sweep cap

**Files:** `src/game/sim/constants.ts` (`ESCORT_QUIET_SWEEP_CAP = 18`), `src/game/sim/systems.ts` (`escortSweepRadius`), `tests/game/pacing.test.ts`.

- [ ] Cap the quiet non-deep radius: `Math.min(ESCORT_QUIET_SWEEP_CAP, ESCORT_QUIET_SWEEP_RADIUS + grown) * jitter`. A test at `time = 62 + 1000` expects the uncapped formula to exceed 18 and the function result to be `<= 18 * jitter`. Deep silent (`z >= 0.6`) still returns `0`. Do not change `ESCORT_QUIET_HUNT_AFTER` or the loud radius. Encounter-local suspicion is Phase 2.

### Task 9: Patrol E2E `targeting-fire`

`plotCanvasWater` in `tests/e2e/helpers.mjs` waits 5 s for `[data-field="course"]` to match `/PLOT\s+\d+\s*,\s*\d+/`. That field is the autopilot waypoint text in `src/ui/hud.ts`. The review's full patrol run died on the first water click. Later journeys did not run. Smoke passed. CI does not run this suite.

- [ ] **Step 1: Reproduce.** `npm run build && npm run preview`, then `npm run test:e2e -- http://127.0.0.1:8080/`. Save the log under `artifacts/plan-024/e2e/` (create the directory; it is evidence, not a new subsystem).
- [ ] **Step 2: If it fails, log the course text, the click position, and whether a waypoint exists on `window.__silentDepths.game`.** Fix the cause in the input or camera path. Do not raise the 5 s timeout as the only change. Do not delete the journey.
- [ ] **Step 3: If it passes on the first run, run it a second time. Two passes close the task. Write the cause or "passed twice on this machine" into `tasks/state.md`.**
- [ ] **Step 4: The suite runs to the end, including journeys after `targeting-fire`.**

### Phase 1 gate

- [ ] `npm run verify`
- [ ] `npm run test:e2e -- <preview url>`
- [ ] `tasks/state.md` lists Phase 1 done and quotes the E2E result
- [ ] `plans/README.md` status for 024 says Phase 1 landed, Phases 2–4 not started

**STOP** if a doctrine seed dies from weapons and the crush predicate is false, if replay or `no-math-random` goes red, or if the E2E failure is a GPU-only render bug you cannot reproduce. Report and end the session.

## Phase 2 — One attack-and-escape mission

Do not start until Phase 1 is on `master`. The wave patrol and its 60–150 s passive / ≤15 s loud / 20 s breather bands stay. This phase adds a second mode.

### Task 10: Scenario `convoy-strike`

**Files:** `src/game/sim/scenarios/convoy-strike.ts` (new), `src/game/sim/create.ts` (a `scenario` field on `GameState`, default `'patrol'`), `src/game/sim/types.ts`, `tests/game/convoy-strike.test.ts`.

Layout, seed `19`, legacy world:

- Player start: the seed-19 patrol start.
- Contacts: one `merchant` named in the objective, plus one `destroyer` and one `patrol`, spawned 18 sim units ahead of the player's heading, spaced 4 units apart. No other ships. No wave spawn while `scenario === 'convoy-strike'`.
- Objective: sink that merchant, then reach a point 16 units further along the same heading. Exit radius `4`.
- Win: merchant sunk and player inside the exit radius. Loss: HP 0. Do not require the escorts to die.
- `assistanceAutoFire` false. Player fire still uses the existing lead helper. Doctrines are not started by the scenario.
- Time box for the scripted test only: a test driver that plots onto the merchant's beam, fires an Mk-14 from attack depth, and then orders the exit, finishes in under 180 s on seed 19. That is the machine gate. The 6–10 minute human target is an operator note, not a unit assertion.

- [ ] Test: patrol scenario still spawns wave 1 with 5 ships. Strike scenario spawns exactly 3 ships and does not increment `stats.wave`.
- [ ] Test: sinking the two escorts and leaving the merchant does not set `phase: 'victory'`.
- [ ] Test: merchant sunk plus player inside the exit radius sets `phase: 'victory'`.

### Task 11: Menu entries

**Files:** `src/ui/overlays.ts`, `src/app.ts` (begin handler), `tests` that render the menu string.

- [ ] Menu buttons: `Begin patrol` (current seed-19 patrol), `Convoy strike`, `New patrol seed` (seed `1 + (Date.now() % 9000)` only at the button handler, never inside `src/game/**`), `Retry same seed`.
- [ ] Result card: `Clear two waves` on patrol, `Merchant sunk` / `Merchant escaped` on the strike, plus HP cause. Cause string comes from the last player-damage source. Add `submarine.lastDamage: 'weapon' | 'ground' | null` in the sim, set it in `applyPlayerDamage` (`weapon`) and in crush (`ground`). The end card prints it. Task 1's crush path must set `ground` before it returns.

### Task 12: Shot and defense readability

**Files:** `src/ui/hud.ts`, `src/ui/threat-indicators.ts`, `src/game/sim/systems.ts` (export the lead point already computed for player torpedoes, or a pure `leadPoint(sub, target)` next to it), `tests/input/threat-indicators.test.ts`, `tests/game/defense-callouts.test.ts`.

- [ ] HUD shows weapon name, reload seconds, and a one-line reason from `fireStatus` (`TOO DEEP`, `RELOAD`, `NO MK-14`, `PICK TARGET`).
- [ ] Player torpedoes leave the tube within `60°` of the boat heading. Export `launchHeading(boatHeading, desiredHeading)` from the fire helper: the desired lead is unchanged on the HUD bracket, and the torpedo's initial `heading` is `boatHeading + clamp(angleDelta, -π/3, π/3)`. A test fires with a target directly astern and expects the torpedo heading within `60°` of the bow, not `180°` from it. Mk-14 stays a straight runner after launch (`turnRate` may still exist; guidance toward a ship stays off for `kind: 'mk14'`). Mk-18 keeps seeking and keeps spending the seeker magazine, which is its cost. Do not raise Mk-18 damage.
- [ ] Pure `defenseCallout(state): 'SEARCH' | 'LOCKED' | 'INCOMING' | null`. `INCOMING` when an enemy torpedo or depth charge exists. `LOCKED` when any hunter has `alert > 0.45` and `holdContact > 0`. `SEARCH` when any hunter has `alert >= 0.25` and the stronger states are false. HUD shows that word.
- [ ] Threat markers gain kind `charge`. `computeThreatMarkers` takes `underwater: boolean`. A charge with `onScreen: true` is omitted on the surface and kept when `underwater` is true and range `> 12`. Off-screen charges still clamp to the edge. Existing torpedo tests stay valid.
- [ ] `escortSweepRadius` is unchanged in this task except the Phase 1 cap. Add `suspicion` on each hunter ship, 0–1, increased only while that ship is inside its own sweep of the player, decayed otherwise. The quiet-sweep growth term stops using global `time` and uses this per-ship value times `ESCORT_QUIET_SWEEP_CAP`. Deep silent still returns 0. Update the pacing tests to the capped, per-ship rule. Bands from Plan 022 (first passive detection 60–150 s, loud ≤15 s) still pass on the patrol scenario. If they do not, STOP. Do not retune those bands in this phase.

### Task 13: Compression and cinema

**Files:** `src/game/sim/types.ts` (`compressEnabled: boolean`, default `true`), `src/game/sim/action-feel.ts`, `src/input/controls.ts`, `src/app.ts`, `src/render/presentation/cinema-follow.ts`, `src/ui/hud.ts`.

- [ ] `shouldTimeCompress` returns false when `compressEnabled` is false. Key `V` toggles it. HUD shows `4×` when `actionTimeScale(state) === 4`, otherwise nothing.
- [ ] `stepTrack` already cancels on escort contact. Also cancel when the caller passes `helmActive: true`. `app.ts` sets that from a heading or speed change since the previous frame. A unit test: an active track plus `helmActive` returns `idleTrack()`.

### Phase 2 gate

- [ ] `npm run verify`
- [ ] Patrol E2E still green (the strike scenario is not required in that suite)
- [ ] One scripted strike playthrough via `npm run test:playthrough` or a Vitest driver, archived under `artifacts/plan-024/strike/`
- [ ] Operator fun/feel on the strike is **not** marked pass

## Phase 3 — Presentation the machine can prove

Operator lighting, fleet ACCEPT, and audio listen stay pending. This phase prepares evidence and fixes communication bugs. It does not approve those gates.

### Task 14: Combat HUD and onboarding

**Files:** `src/ui/hud.ts`, `src/styles/main.css`, `src/ui/tutorial.ts`.

- [ ] The always-visible cluster is hull, the defense callout, weapon/reload, countermeasure counts, target name, and the objective line. Gear, doctrine, and the full contact list stay collapsed as they are after Plan 022.
- [ ] Quick start becomes four playable beats on the strike scenario, simulation paused between beats: steer to a marked water point, fire at the merchant from attack depth, a single telegraphed hedgehog pattern is spawned at a safe distance and the beat ends when the player is outside its blast, then steer to the exit. Help still opens the longer guide.
- [ ] Test: `game.time` does not advance while a beat panel is open. The hedgehog beat fails if the player's HP changes before the pattern is visible in the threat markers.

### Task 15: Wrecks are presentation-only

Ships leave the sim about `0.05` s after `sinking` is set (`systems.ts` damage). Keep that.

**Files:** `src/render/presentation/wrecks.ts` (new), `src/render/scene.ts`, `tests/render/wrecks.test.ts`.

- [ ] On `shipSunk`, spawn a presentation wreck at the sim position for `6` s: list `0.4` rad and sink `8` m over that time, then remove it. The sim ship list does not gain an entry. A test drives the presentation clock, not the sim, and expects the wreck gone after 6 s and the sim ship absent.

### Task 16: Underwater readability measurement

**Files:** `scripts/playthrough.mjs` or the existing gauntlet capture, `docs/release/plan-024-contrast.md`.

- [ ] Capture chase-underwater at high and low quality, day and the in-game night point, on the preview. Record the hull-box to surrounding-ring luminance ratio Plan 022 already defined (target ≥ `1.4`). If the ratio is already ≥ `1.4`, write the numbers and change no shaders. If it is below, adjust only the player-hull underwater term Plan 022 added, then re-measure. Do not restyle the ocean. Label the note "agent measurement, not lighting ACCEPT".

### Task 17: Audio cues that already exist

**Files:** `src/app.ts`, `src/game/audio/audio.ts`, `tests/game/audio.test.ts`, `docs/release/audio-banks.md` (one paragraph).

- [ ] Map distinct `playCue` ids onto launch, a near miss (enemy torpedo within 3 units, no hit), hull hit, distant blast (charge damage `0` because of vertical miss within 8 horizontal units), and sink. Use the banks Plan 022 already wired. No new WAV files. The audio-banks doc keeps the sentence that the shipped WAVs are fallback synthesis. Listening ACCEPT stays pending.

### Task 18: Settings and focus loss

**Files:** `src/ui/panel.ts`, `src/core/settings.ts`, `src/input/controls.ts`, `src/app.ts`.

- [ ] The existing panel gains: master volume, quality, reduced motion, captions on/off, `pauseOnBlur` default true, and a read-only list of the current key codes from `InputController`. Captions toggle hides or shows the HUD message list. No key rebinding. No gamepad.
- [ ] On `window` blur, clear the held-key set. If `pauseOnBlur`, pause the sim. A unit test calls the clear function and expects an empty key set.

### Task 19: Fleet standard (no new assets)

**Files:** `docs/release/fleet-standard.md` (new).

- [ ] Record the current rule: authored GLB only for `sub_nautilus`, `uboat`, and `destroyer` (`prefersAuthoredGltf`). Other classes stay procedural. State the identity split (modern hulls, WWII weapon names) as an open operator choice, not a resolved one. Do not download models. Fleet ACCEPT stays pending.

### Phase 3 gate

- [ ] `npm run verify`
- [ ] Contrast note written and labelled as measurement
- [ ] `npm run assets:validate` still passes
- [ ] No operator gate marked pass

## Phase 4 — Release checks that gate the deploy

### Task 20: CI runs the patrol E2E; Pages waits for CI

**Files:** `.github/workflows/ci.yml`, `.github/workflows/pages.yml`.

- [ ] After smoke, CI runs `npm run test:e2e -- http://127.0.0.1:8080/` against the preview it already starts. Upload `artifacts/` on failure.
- [ ] Pages stops deploying on every push. It runs on `workflow_run` for the CI workflow, branch `master`, and only when `conclusion == 'success'`. A failed targeting journey does not publish.
- [ ] Do not add `assets:validate` or format to this change unless they already pass locally. If you add them, they join the same CI job before Pages.

### Task 21: Scenario regression and restart

**Files:** `tests/game/convoy-strike.test.ts`, `tests/e2e` only if a journey is added without dropping patrol journeys.

- [ ] Vitest covers: strike win, strike loss at HP 0, patrol wave-1 does not win, retry keeps the seed, "new patrol seed" is not called from sim code.
- [ ] Quality `low` and `high`, world `legacy-v1`, are the two combinations the strike driver runs. `littoral-v2` is not a default and is not required here.

### Task 22: Current scope page

**Files:** `docs/release/current-scope.md` (new), `docs/prd.md` (a one-line note under the title, plus the victory line from Task 6).

- [ ] The scope page states: solo desktop Vite game; co-op and auth are Plan 009 after 017; world default `legacy-v1`; no mid-patrol save in 024 (retry replays the seed); operator gates still pending (list them); Plan 024 phases and which have landed. The PRD note points at that page and says the React/TanStack and mobile sections are historical. Do not rewrite the PRD body.

### Task 23: Bug report and build id

**Files:** `src/ui/error-toast.ts`, `src/app.ts`.

- [ ] The existing toast gains the build string Vite injects (`import.meta.env.MODE` plus the short git SHA if `VITE_COMMIT` is set at build, otherwise `dev`). The copyable summary includes phase, seed, scenario, HP, and `lastDamage`. No third-party reporter.

### Phase 4 gate

- [ ] `npm ci && npm run verify`
- [ ] `npm run assets:validate`
- [ ] Patrol E2E against preview
- [ ] CI config matches Task 20
- [ ] `tasks/state.md` and the `plans/README.md` row updated
- [ ] Operator gates remain pending. Plan 017 is still the production tag.

## Definition of done (machine)

- [ ] Phase 1 tests are normal assertions per seed. No doctrine `it.fails` remains for evade or exfil.
- [ ] A surface bomb does not damage a boat at depth `0.95`. A deep order over a seamount does not apply crush.
- [ ] An enemy-sub torpedo homes, and a seduced one turns toward a Foxer.
- [ ] HUD, tutorial, end card, and the PRD victory line all say two waves. `VICTORY_TARGET` is still 8.
- [ ] Deep at `0.82` cannot fire.
- [ ] Patrol E2E is green locally and is a CI job. Pages deploys only after that job succeeds.
- [ ] `convoy-strike` can be won by sinking one merchant and reaching the exit, without hunting the escorts.
- [ ] Compression shows `4×` and Key `V` cancels it. Helm input cancels torpedo cinema.
- [ ] No new GLBs. No operator gate marked pass.

## STOP

- A change needs Three.js inside `src/game/**`, or `Math.random` there.
- Doctrine survival or stealth-start assertions would have to move to make a phase green.
- The quiet-sweep cap breaks the Plan 022 detection bands. Report the numbers. Do not silently widen them.
- An E2E journey fails twice after a fix aimed at it.
- Anyone is about to write PASS on FPS, lighting, fleet, audio listen, soak, or `solo-production`.
