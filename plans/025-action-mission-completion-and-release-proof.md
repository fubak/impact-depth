# Plan 025 — Complete the action mission and prove release readiness

**Status:** PLANNED — implementation not started.
**Baseline:** `cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd`, reviewed 2026-09-26.
**Depends on:** merged Plan 024; follows up Plan 023.
**Outcome:** one readable, manually playable convoy strike from menu through attack, evade, extraction, results, and retry; trustworthy release evidence.
**Release relationship:** supplies evidence to Plans 014/015/017/018. Only Plan 017 may close the production release and tag.

## Read first and execution contract

Read `AGENTS.md`, `tasks/state.md`, `memory/MEMORY.md`, `docs/release/current-scope.md`, and the [fresh review](../docs/release/plan-025-fresh-review.md). The review records observations; this document defines the implementation sequence and proposed acceptance targets.

Execute one phase per session. Stay in this plan until its engineering work is complete; do not start another plan to bypass a failed gate. Mark individual items complete only with evidence for the tested commit. Each phase must leave a playable production build. Record failures honestly, including journeys that did not run. Documentation-only planning does not constitute implementation or acceptance.

- Simulation and commands own gameplay truth; no DOM or Three.js in `src/game/sim/**`.
- Renderers and HUD consume snapshots/events; UI guidance must reflect the authoritative objective.
- Remain solo desktop Chromium/WebGL2. Keep wave patrol, existing controls, and `legacy-v1` world default. Key M is transit compression; V remains Deep.
- No framework migration, co-op, authentication, new mission families, or new weapon families.
- Reuse the existing asset pipeline. Preserve provenance/licenses; no unreviewed asset downloads, secrets, or archive changes.
- Preserve the repaired launch-depth, blast-depth, homing/decoy, emergency-retreat, and terrain-clearance rules. Do not weaken stealth/survival tests to fit new pacing.
- No gameplay cheats in completion tests: no teleporting, direct damage, forced objective flags, hidden-coordinate navigation, or direct phase changes during a player journey. Explicit setup fixtures remain acceptable for isolated rule tests.
- Do not self-approve GPU, fleet, lighting, audio, soak, fun/feel, world-default, or production-tag gates. Prepare their concrete evidence and carry pending gates into Plan 017.
- Stage explicit paths. Commit/push only under the operator's current authorization; do not imply that pushing documentation approves a release.

## Baseline and evidence limits

| Check                | Observed at baseline                                                      | Required interpretation                                                         |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Verify/build/assets  | 651 tests, 116 files; typecheck/lint/build/assets passed                  | Re-run after implementation; these do not replace browser proof                 |
| Patrol E2E           | Local targeting/fire PLOT timeout; CI targeting/fire canvas-click timeout | Same failing journey, root cause not established; later local journeys untested |
| Pages                | Skipped following red CI                                                  | Correctly withheld; checkout still needs exact-revision binding                 |
| Evade                | Seeds 1/7/19/42/91 survived at 100 HP                                     | Preserve this sample and broaden only for specific risks                        |
| Exfil                | Four seeds arrived; seed 7 still 31.67 units away at 180 s, 9.64 HP       | Arrival is not yet reliable under the sampled combat conditions                 |
| Strike               | Command-only probe won in 20.33 s, four shots, 100 HP                     | Perfect inputs plus hidden exit coordinates; not human pacing evidence          |
| Existing strike test | Teleports to exit; reports 8.9 s victory                                  | Retain only as an isolated victory-rule test if renamed; not mission proof      |

Checked-in JSON probes accompany the review. Treat new numerical design targets below as provisional test goals, not measured facts or release claims.

## Phase 1 — Reliable input and exact-revision release gates

**Primary files:** `scripts/e2e-patrol.mjs`, input/world interaction modules, `src/app.ts`, `.github/workflows/ci.yml` and `.github/workflows/pages.yml`.

- [x] Reproduce targeting/fire against a production preview. Capture browser/version, viewport, camera, canvas bounds, pointer coordinates, resolved world hit, command dispatch, resulting waypoint, navigation events, trace, and screenshot on failure. Keep diagnostic output bounded and free of secrets.
- [x] Separate click-delivery/navigation waiting problems from missing world-interaction commands and incorrect water-plane projection. Fix the proven cause; do not merely increase timeouts, use forced clicks, suppress navigation waits without explanation, or skip the assertion.
- [x] Preserve HUD click isolation: buttons must not plot a course. Validate water plotting and target selection in the supported gameplay views, including after camera switches and resize.
- [x] Run every existing patrol journey. Once green, perform three consecutive complete runs on the fixed revision to establish that the repaired intermittent path is stable; record all attempts, not only the successful one. Repeat this diagnostic series only if subsequent changes affect the path or a failure recurs.
- [x] For automatic Pages runs, check out the successful CI run's `head_sha` or publish its already-built artifact. Assert artifact/build SHA equals the successful CI SHA. Preserve repository Pages base-path handling.
- [x] For manual dispatch, validate the selected revision with the same required gates before publishing, or require evidence from a successful run for exactly that revision. Do not leave manual dispatch as an unvalidated bypass.
- [x] Prevent an older completed run from replacing a newer deployment: check freshness and serialize deployment appropriately. Document the intended behavior when commits A and B overlap and finish out of order.
- [x] Verify failed/cancelled CI cannot deploy; test A/B revision selection through workflow fixtures or a controlled branch exercise, without publishing an untested build.

**Exit:** all patrol journeys pass with useful failure diagnostics; the deployed artifact can be traced to its tested SHA; the CI failure cause and fix are documented. A green unit suite alone does not close this phase.

## Phase 2 — Player firing authority and correct sinking presentation

**Primary files:** `src/game/sim/systems.ts`, `src/game/sim/scenarios/convoy-strike.ts`, `src/game/sim/types.ts`, `src/app.ts`, `src/render/scene.ts`, `src/render/presentation/wrecks.ts`, targeted tests.

- [x] Trace every automatic launch path. Enforce `assistanceAutoFire` at the shared authorization point while leaving steering assistance usable. Preserve automatic firing in modes that explicitly enable it.
- [x] Test Ambush and Intercept with assistance disabled across several reload opportunities: zero shots and unchanged ammunition without a fire command. Test enabled assistance and explicit manual launch separately. Cover changing mode/settings mid-engagement and restart/scenario defaults.
- [x] Show why a manual launch is unavailable: reload, ammunition, depth, damaged tubes, and arc as applicable. Expose a readable launcher arc and aim/lead cue without granting targeting knowledge beyond the game's contact rules. Keep HUD feedback synchronized with simulation launch eligibility.
- [x] Standardize presentation time in seconds. Remove the extra milliseconds conversion at the scene boundary. Handle first event, reset, pause, resume, and scenario restart without huge deltas or stale wrecks.
- [x] Add an integration test across app/event timing and wreck advancement: a wreck is visible during its intended lifetime and removed after six simulation seconds. Validate behavior at 1× and 4×; document whether visual motion should follow simulation time consistently.
- [ ] Preserve the sunk vessel's class silhouette, heading, and scale in a presentation snapshot before removal from the sim. Reuse safe asset instances/fallbacks; release per-instance resources without disposing shared assets.
- [x] Keep sinking feedback available under reduced-motion/flash settings without reintroducing prohibited camera motion/flashes. Test that suppressing flash does not accidentally suppress the wreck event.
- [ ] Verify repeated sinking/restart cycles leave bounded meshes, effects, and event subscriptions.

**Exit:** movement assistance cannot expend ammunition when disabled; manual firing remains clear and responsive; wrecks visibly sink and clean up on schedule without resource growth.

## Phase 3 — A discoverable, normally playable mission

**Primary files:** strike scenario/objective systems, snapshot adapters, `src/ui/hud.ts`, minimap/world-marker presentation, `tests/game/convoy-strike.test.ts`, browser journey scripts.

- [x] Define authoritative mission stages: attack merchant, survive/withdraw, reach extraction, complete; preserve defeat and restart paths. Do not require killing escorts unless intentionally specified and communicated.
- [x] Expose objective stage, exit position/radius, and distance/bearing through the normal presentation snapshot. Add a clearly labeled extraction marker to the tactical/minimap view and an off-screen direction cue in relevant views.
- [x] Before the merchant sinks, make the planned escape destination discoverable but subordinate to the attack objective. After sinking, promote it with one clear transition cue. Show extraction availability and the completion boundary; avoid displaying an available exit when its prerequisites are unmet.
- [ ] Place the exit and route in valid navigable water for the selected world. Ensure the four-unit completion radius and displayed boundary use the same coordinate conversion. Handle pause, camera changes, result state, and restart consistently.
- [x] Reclassify the teleporting test as isolated completion-rule coverage or replace it. Add a deterministic command-only mission test with normal acceleration, turning, reload, targeting, damage, and travel. Assert merchant sunk, actual exit entry, victory, and no unrelated state rewrites.
- [x] Add a production browser journey: menu → strike → tutorial completion/explicit skip → select/aim → launch → merchant sunk → follow visible extraction guidance → victory → retry. Navigation must use exposed player information and normal input, not hidden sim coordinates or debug APIs.
- [x] Add defeat/retry coverage and a fresh-session path. Assert one result screen, reset mission state, restored assistance defaults, and no stale markers/tutorial threats/wrecks.
- [x] Record simulation and wall-clock duration separately, launch count, damage, objective transitions, and outcome. Do not advertise bot completion time as human completion time.

**Exit:** the entire strike is completable from visible information, and the browser proves the player journey without cheats. If extraction remains unreadable, do not compensate with an omniscient test bot.

## Phase 4 — Active onboarding and readable combat UI

**Primary files:** `src/ui/tutorial.ts`, `src/app.ts`, `src/ui/hud.ts`, HUD styles, `src/ui/threat-indicators.ts`, `src/game/sim/defense-callout.ts`, tutorial persistence and browser tests.

- [ ] Separate explanatory cards from live exercises. Run time only when the active exercise requires it; make pause semantics explicit.
- [ ] Require observable player actions for steering to a marked location, firing a legal shot, and escaping a telegraphed danger area. Provide safe retry if an exercise fails. Keep Skip and replay tutorial available.
- [ ] Author the dodge exercise so the starting position would actually be threatened without action, with enough lead time for a new player. Show fuse/danger direction or boundary; avoid an already-safe astern pattern presented as a successful dodge.
- [ ] Scope tutorial threat spawning to the intended exercise/scenario. Opening general Help or revisiting a card must not duplicate live charges. Clean up exercise-only entities/state on skip, completion, death, and restart.
- [ ] Version tutorial completion state so existing users can discover/replay the new lessons. Respect saved settings and avoid forcing the tutorial on every retry.
- [ ] Give objective, score, contacts, threat callout, and controls explicit layout regions. Fix the observed top-right overlap at 1280×720 and bottom-marker collision with the help strip. Permit wrapping/collapsing by priority rather than arbitrary text clipping.
- [ ] Check 1280×720, 1366×768, and 1920×1080 plus browser zoom/text scaling. Long objectives, multiple contacts, low health, reload warnings, and result screens must remain usable together.
- [ ] Show imminent underwater charges/torpedoes when on-screen and nearby, including at/below the current 12-unit threshold. Use range, relative motion, depth separation, fuse, and dangerous trajectory where available to rank threats; do not mark every distant harmless projectile INCOMING.
- [ ] Cluster/cap markers with nearest/soonest danger taking priority. Preserve off-screen direction and avoid relying only on color; reduced motion must preserve all essential information.
- [ ] Capture inspectable screenshots/video of objective transition, multiple threats, launcher denial, extraction, and tutorial dodge at supported viewports. Add geometry/layout assertions where stable, and manually inspect the actual rendering.

**Exit:** an unfamiliar player performs the taught actions; objectives and immediate dangers remain readable during combat. Next/Finish alone cannot satisfy an action lesson.

## Phase 5 — Consistent worlds and trustworthy return-to-base behavior

**Primary files:** `src/app.ts` creation/menu/restart paths, game creation API, strike factory, `src/game/sim/autopilot.ts`, route/progress state, `tests/game/playtest/exfil-emergency.test.ts` and doctrine tests.

- [ ] Pass the selected world into creation before deriving terrain, base, spawns, and routes. Remove create-default-then-relabel paths from Begin Patrol, New Seed, Retry, strike, and restart. Define a scenario factory parameter/default without changing the product's legacy-world default.
- [ ] Test each creation entry point for both world versions: same seed/settings produce the same initialized world; spawn/base/exit are valid for that world; retry preserves seed/world and new seed changes only what it should.
- [ ] Replace absolute mission-time failure detection with elapsed time since the retreat order and measured route progress. Reset progress tracking on a new order/route; account for pause and compression in simulation time.
- [ ] Distinguish approaching normally, temporarily evading, replanning, genuinely blocked, and retreat interrupted by combat. Communicate a truthful reason and a useful recovery option. Do not report unreachable immediately just because the mission is older than 170 seconds.
- [ ] Reproduce seed 7 with route, clearance, damage source, speed, and progress traces. Determine whether failure is route planning, control, repeated evasion, or encounter pressure before changing the algorithm or balance.
- [ ] Separate navigation and combat-survival tests. In controlled reachable routes, require arrival for all five baseline seeds within 180 simulation seconds; a warning or death is not a pass. For combat runs, report arrival and survival separately and fix seed 7 or document an intentional, playtested limitation explicitly.
- [ ] Cover retreat ordered late, repeated emergency triggers, terrain obstruction, damaged movement, manual cancellation, and truly unreachable destinations. A blocked fixture should terminate/replan truthfully without an infinite loop.
- [ ] Preserve all five repaired Evade outcomes and add focused clearance tests for any navigation change. Avoid global terrain immunity or hidden invulnerability to force successful outcomes.

**Exit:** world initialization is consistent and return-to-base assertions prove arrival where reachable. Any remaining combat escape risk is intentional, communicated, and distinguished from broken navigation.

## Phase 6 — Tune the attack/evade/escape sequence through playtests

**Depends on:** Phases 1–5, so pacing measurements reflect working controls and information.

- [ ] Establish provisional first-play targets: a meaningful steering/targeting decision in the first 15–30 seconds; a readable escort response after attack; at least one useful defensive decision; an understandable escape. Aim initially for roughly 2–4 minutes for a successful first human strike, then revise based on observed enjoyment and comprehension rather than adding artificial waits.
- [ ] Tune approach distance, firing geometry, merchant resilience, escort reaction delay/search behavior, threat cadence, cover/depth options, and extraction location as one encounter. Keep threats telegraphed and leave recoverable mistakes. Avoid changing global wave balance just to tune the strike.
- [ ] Preserve skillful fast completions if they involve meaningful choices; do not force damage or an arbitrary minimum timer to invalidate the 20-second bot result.
- [ ] Ensure time compression disengages predictably for danger/player combat input. Verify aiming, cinema cancellation, pause, and tutorial transitions cannot hide an incoming attack or steal control.
- [ ] Run at least five first-time-player sessions with consistent instructions and no coaching beyond the in-game tutorial. Follow with returning-player retries. Record assistance settings, time to first action, shots/hits, damage source, deaths, extraction confusion, total time, and brief fun/clarity feedback.
- [ ] Proposed comprehension gate: at least four of five players identify the current objective and extraction direction without coaching; at least four perform the taught defensive action. Treat this small sample as a usability signal, not population-level statistical proof.
- [ ] Record wins and losses rather than targeting a perfect first-play win rate. Investigate repeated unexplained deaths, inability to find the exit, or passive auto-completion. Separate UI failures from tuning failures.
- [ ] Add deterministic regression cases for the selected encounter timings and critical counterplay opportunities. Keep numeric balance knobs documented with rationale and before/after evidence.

**Exit:** playtest observations demonstrate attack, response, defense, and escape. Fun/feel remains an explicit operator decision supported by recordings and notes.

## Phase 7 — Production presentation, performance, and release handoff

- [ ] Perform an in-game contrast/readability pass over bright shallows, dark water, surface/underwater views, and busy combat. Capture hull/target/threat/exit contrast evidence with a documented method; descriptive prose is not a measurement.
- [ ] Inspect ship-class recognition, sunk-ship continuity, explosions/wakes, marker occlusion, lighting, and camera motion. Route asset corrections through existing production assets/provenance and obtain fleet/lighting acceptance through the existing plans.
- [ ] Listen to actual launch, impact, incoming-threat, sinking, objective, extraction, UI, engine, and music cues in-game. Verify mute/unlock, pause/resume, repeated mission transitions, mixing priorities, and no duplicated loops/clipping. Update assets/mix only where evidence requires it; an audio-contract document does not close listening acceptance.
- [ ] Run the reference scene on representative physical GPU hardware under the existing ≥55 FPS bar. Record hardware/browser/settings, frame-time distribution, combat peaks, memory/resource behavior, and quality-tier fallback. Software-renderer numbers remain directional only.
- [ ] Complete the existing Plan 017 wall-clock soak and three playthrough requirements using their prescribed procedures; do not substitute accelerated simulation for soak. Include strike/wave patrol, retry, pause, camera changes, audio settings, and repeated sinking.
- [ ] Run final clean-install verification, production browser smoke, full patrol E2E, strike E2E, relevant HUD/assets/audio journeys, and asset validation when assets changed. Confirm deterministic regression results and deployment SHA integrity.
- [ ] Prepare the release/rollback evidence packet with exact commit, commands/results, traces/screenshots, hardware data, known limitations, and individually pending/accepted operator gates. Keep historical failures visible and qualify superseded claims.
- [ ] Update `plans/README.md`, `tasks/state.md`, and `docs/release/solo-production-status.md`. Mark engineering complete only when automated/player-journey criteria pass; keep production pending until Plan 017's actual approvals.

**Exit:** a reviewable production candidate and evidence packet, not an automatically approved production tag or world-default change.

## Verification procedure and evidence ownership

At each implementation phase exit, follow the repository contract: `npm ci`, `npm run verify`, then production build/preview and the browser proof required by that phase. Use `npm run test:smoke -- <url>` and `npm run test:e2e -- <url>` according to their actual script interfaces. Add a documented strike journey command when implemented. Run `npm run assets:validate` when assets change. Run focused tests while developing; avoid repeatedly running the entire matrix without a relevant change.

Store generated diagnostics under ignored `artifacts/plan-025/phase-N/`. Check in concise, sanitized release reports and deterministic result JSON under `docs/release/`; do not commit browser profiles, huge traces, cookies, or raw environment data. Each report names its commit, environment, invocation, duration/time basis, outcome, limitations, and links to retained artifacts. Missing operator evidence stays PENDING.

| Gate                      | Required evidence                                                   | Owner                          |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| Input/release correctness | Complete browser journeys, diagnosed regression, exact-SHA artifact | Implementer + CI               |
| Firing/wreck rules        | Boundary integration tests plus visible sinking                     | Implementer                    |
| Mission completion        | Command-only simulation and normal-input browser victory/retry      | Implementer + CI               |
| Tutorial/UI               | Actual exercises, viewport captures, newcomer observation           | Implementer + playtester       |
| World/navigation          | Factory matrix, five-seed arrival/progress results                  | Implementer                    |
| Pacing/fun                | Human session notes/recordings and explicit decision                | Operator/playtesters           |
| Audio/art/GPU/soak        | Existing plan-specific evidence and acceptance                      | Operator under 014/015/017/018 |

## Completion checklist

- [ ] All seven phases have evidence-backed outcomes; no red browser journey is mislabeled green.
- [ ] No silent automatic launch with assistance off; no time-unit wreck leak.
- [ ] A new player can learn, attack, dodge, locate extraction, win/lose, and retry through normal controls.
- [ ] Guidance and threat cues remain readable across supported desktop sizes and accessibility settings.
- [ ] Selected-world state is initialized correctly; late/blocked retreat feedback is truthful.
- [ ] CI tests the exact deployable revision and failing runs cannot publish.
- [ ] All inherited operator gates are individually recorded; no approval is inferred from this plan or a documentation push.

**Next:** Phase 5. Phases 6 and 7 stay unapproved. Pushing this document does not execute a phase.
