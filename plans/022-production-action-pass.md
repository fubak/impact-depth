# Plan 022: Production action pass (solo)

Status: **MACHINE WORK LANDED (2026-09-26)**. Operator gates PENDING.
Reviewed: 2026-09-26, `master` 4195c66, with the uncommitted operator WIP present in the main checkout.
Executors: Sonnet (logic, shaders, gameplay, harness) and Haiku (mechanical changes, timeouts, docs). Every item below is self-contained.

## Outcome

Torpedo launches, hits and sinkings become readable and audible. Enemies push the player instead of waiting to be hit. Every system has been driven by scripted play at least once. CI is green, the bundle is split, and the HUD gets out of the way. The simulation stays deterministic and free of Three.js/DOM. The rendering layer draws from snapshots.

**Out of scope:** new assets or downloads, any framework migration, Plan 009 co-op, and every operator gate.

## Verified facts this plan is built on (as of 4195c66)

1. **Torpedo hits have no VFX or audio.** `'explosion'` is emitted only from `debugBurstPresentationFx` in `src/render/scene.ts` (around line 528). The frame loop in `src/app.ts` calls that debug burst in production whenever a depth charge disappears, and it fires at a fixed offset. `audio.observe` in `src/game/audio/audio.ts` plays an explosion only on a sinking. VFX sprites start at 1.1 m wide with additive blending; hulls are 5 m per sim unit (`METERS_PER_UNIT`).
2. **The operator WIP is uncommitted in `/home/fubak/projects/impact-depth` itself.** It touches `package.json`, `scripts/gauntlet-presentation.mjs` (this is the lint fix), `src/app.ts` (cinema camera), `src/render/cameras.ts`, `src/game/sim/{systems,types}.ts`, and adds `src/game/sim/{contact,ship-separation}.ts` plus three tests. Lint passes today only because that WIP is on disk.
3. **Prettier fails on 40 files, not five:** 19 under `src/` and 21 under `tests/`. `format:check` does not glob `src/` or `tests/`. CI runs `verify` and smoke only, so the only CI-red cause is lint.
4. **`restart-reentry` fails on a stale assertion, not a timeout.** `beginPatrol()` sets `viewMode: 'chase'`, but `scripts/e2e-patrol.mjs:240` and `tests/e2e/helpers.mjs:716` (`restartPatrolViaReload`) assert `'tactical'`. The "PERISCOPE" text in the failure was the depth-band label.
5. **The freighter and other procedural hulls are procedural by design.** `prefersAuthoredGltf` in `src/render/assets.ts` returns true only for `sub_nautilus`, `uboat` and `destroyer`. `preload()` still downloads all 11 GLBs, about 720 kB that are never rendered.
6. **The 986 kB chunk is JavaScript only.** WAV and HDR files are fetched at runtime. GitHub Pages cannot set cache headers.
7. **Replay and 10k-tick tests compare two runs of the same build.** They have no goldens, so they catch nondeterminism but not balance drift. Balance needs outcome assertions.
8. **`tests/game/no-math-random.test.ts` scans `src/game/**`.**
9. **Timeout-flaky tests:** `tests/game/world-legacy.test.ts` (the littoral cache test), `tests/render/world-texture.test.ts` (the littoral 1 m bed test), `tests/game/land-avoidance.test.ts` (8.18 s even in isolation, per Plan 021), and `tests/scripts/import-modern-fleet.test.mjs` (startup).
10. **No CDP or port-9223 harness exists in the repo.** `App.game` is private in TypeScript.

## Rules for every executor (the "do not" list)

- **Operator gates:** never mark GPU FPS ≥55, lighting eye-pass, fleet ACCEPT, audio listen (Plan 014), soak, the `solo-production` tag, the world-default flip, or the fun/feel sign-off as PASS. SwiftShader or headless captures are evidence only, never a visual pass.
- **Operator files:** never edit the Phase 0 frozen files until the WIP is committed and pushed. Never re-implement the cinema camera, `snapToTarget`, `contact.ts` or `ship-separation.ts`.
- **Simulation purity:** `src/game/**` must not import `three` or touch the DOM. No `Math.random` there. No wall-clock time in the simulation. New presentation logic goes in `src/game/adapt/` (pure) or `src/render/`.
- **Tests:** do not change `tests/game/survival.balance.test.ts` or `tests/game/stealth-start.test.ts` assertions without operator sign-off. Never weaken a test to make it pass.
- **Build and dependencies:** do not raise `chunkSizeWarningLimit` (800). No new runtime dependencies. No third-party error service. No framework migration.
- **Git:** never `git add -A` or `git add .`; the root has untracked `ambush-bow-forward.png` and `.claude/`. Stage explicit paths only. Use fresh worktrees from `origin/master`; the worktrees under `.claude/worktrees/` from earlier passes are stale.
- **Scope:** one item per agent. Do not touch files outside the item's list; if you need to, STOP and report.

## Operator decisions (the orchestrator asks; agents never decide)

| ID | Decision | Default if the operator says "use defaults" |
| --- | --- | --- |
| OD1 | Land or abandon the WIP (commit **and push**) | Must be explicit; there is no default |
| OD2 | Mass-format `src/` and `tests/`, overriding I11's "no mass rewrite" | Yes, as one commit, then widen `format:check` |
| OD3 | Add `format:check` to `verify` and CI | Yes, after OD2 |
| OD4 | Default patrol view: chase (current code) or tactical (plans/README.md says tactical) | Chase; update the README line |
| OD5 | Which hulls use GLB models (Plan 015) | Unchanged |
| OD6 | Pacing bands for Phase 3 | First passive detection 60–150 s; loud detection ≤15 s; wave breather 20 s; `VICTORY_TARGET` stays 8 |
| OD7 | Error reporting destination | Local only (console, on-screen toast, counter) |

## Phase 0: operator gate (blocks everything)

| ID | Exec | Change | Acceptance |
| --- | --- | --- | --- |
| P0.1 | Operator | Commit and push the WIP, or `git stash`/drop it (OD1) | `git status --porcelain` shows no tracked changes; `origin/master` contains the WIP commit |
| P0.2 | Orchestrator | Run `npm ci && npm run verify && npm run test:gauntlet:unit` on a clean clone of `origin/master` | Lint exits 0, all green, and the result is recorded in `tasks/state.md` |
| P0.3 | Haiku (only if OD2 is yes) | Run `npx prettier --write "src/**/*.{ts,css}" "tests/**/*.{ts,mjs}"` as one commit and add its SHA to `.git-blame-ignore-revs`. Widen the `format:check` globs in `package.json` to include `src/**/*.{ts,css}` and `tests/**/*.{ts,mjs}`. If OD3 is yes, append `&& npm run format:check` to `verify`. | `npm run format:check` exits 0. `npm run verify` is green. `git diff --stat` shows whitespace-only changes (`git diff -w` is empty apart from `package.json`). |

**STOP** if P0.1 is not done. Only Phase 1 items K1, K2 and K4 may start early, and only if the operator allows it.

## Phase 1: foundations (all lanes parallel; no shared files)

| ID | Exec | Files | Change | Acceptance (the discriminating test fails without the change) | Risk / effort | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Sonnet | new `src/game/adapt/combat-events.ts`, new `tests/game/combat-events.test.ts` | Pure `deriveCombatEvents(prev: GameState, next: GameState): CombatEvent[]`, called once per fixed step. Event union: `torpedoLaunch{owner,id,x,y,z,heading}`, `torpedoHit{id,targetId,x,y,z}`, `torpedoExpired{id,x,y,z}`, `shipSunk{id,kind,x,y}`, `chargeBlast{x,y,z,near}`, `playerHit{damage,x,y}`, `countermeasure{kind,x,y}`, `sonarPing`, `pickup{x,y}`, `waveStart{wave}`, `victory`, `gameover`. Positions are in sim units. Attribute a hit as: torpedo gone and the nearest ship whose HP dropped within 3 units of the torpedo's last position. Also export `collectOverSteps(states[])`. | Tests: (a) a two-torpedo spread hitting two ships in one step gives two `torpedoHit` with distinct `targetId`s. (b) Nine steps aggregated, as at 7 FPS, lose no events. (c) An expiry gives `torpedoExpired`, not a hit. (d) No `three` import (grep test). If attribution needs simulation data, STOP and propose an `events` field for operator review. | M / 1 d | P0 |
| S2 | Sonnet | `src/render/vfx.ts`, `tests/render/vfx.test.ts`, new `src/render/presentation/combat-fx.ts` + `tests/render/combat-fx.test.ts` | Add kinds `flash`, `fireball`, `smoke`, `debris`, `shockwave`, `spray`, `bubbles`. Add `emitBurst(spec: FxBurst, now)`, where `FxBurst = {preset:'torpedoHit'\|'sink'\|'chargeBlast'\|'launch'\|'playerHit', x, y, z, intensity}` in world metres. Scale to hulls: fireball 10–16 m, spray column ≥20 m. Additive blending for flash and fire only; normal blending for smoke and water. Flash sprites use `fog: false`. Jitter comes from a seeded LCG. Eviction priority: wake < bubbles < smoke < others. `combat-fx.ts` maps presets to particle lists. It does **not** import S1 types. | Tests: the `torpedoHit` preset spawns ≥12 particles with max scale ≥10. A flood of 500 wakes never evicts an active flash. `setCap` still holds. The existing vfx tests stay green. | M / 1 d | P0 |
| S3 | Sonnet | `src/game/audio/audio.ts`, `tests/game/audio.test.ts` | Add `playCue(cue: 'launch'\|'hit'\|'distantBoom'\|'sink'\|'hullHit'\|'incoming'\|'decoy'\|'waveStart'\|'victory'\|'gameover', opts?:{distance?:number; intensity?:number})`, using existing banks or synthesized tones. Gain follows distance. Add `setTension(0..1)`, which crossfades ambient into a synthesized pulse layer. Keep `observe()` but stop it double-playing a cue that `playCue` has already played (dedupe window). No new asset files. | Tests use the existing audio mock pattern. A `hit` cue at distance 5 is louder than at 60. `setTension(1)` raises the pulse gain. `observe` plus `playCue('sink')` in the same frame plays one explosion. | M / 1 d | P0 |
| S4 | Sonnet | new `tests/game/playtest/*.test.ts` (tests only) | Headless scripted bots over `createGame`/`updateGame` pin current behaviour. Cover: decoy vs enemy torpedo; bubble cuts charge damage (×0.75); ping reveals the player; enemy sub fires on a detected player; wave 1 cleared leads to wave 2 containing a battleship and three pickups; eight sinks give victory; HP 0 gives gameover, and `createGame(seed)` then resets; FOB dock repairs and restocks; each powerup type; every doctrine within 3 min on seeds 1, 7, 19, 42 and 91. Also measure and **log** time to first `alert>0.25` for a passive silent bot at attack depth. | All tests pass on the current code, or the defect is recorded in `docs/release/balance-notes.md` with `it.fails`. No `src/` edits. | M / 1.5 d | P0 |
| S5 | Sonnet | new `src/ui/threat-indicators.ts`, new `src/styles/threats.css`, new `tests/input/threat-indicators.test.ts` | Pure `computeThreatMarkers(game, project:(x,y,z)=>{sx,sy,onScreen})`. It returns edge-clamped markers for enemy torpedoes within 25 units, alerted ships and aircraft, each with bearing, range and urgency. It includes a DOM renderer class and does **not** touch `cameras.ts`. | Tests: an off-screen torpedo behind the camera clamps to the screen edge with the correct side. An on-screen one is not marked. Markers are ordered by urgency. | M / 1 d | P0 |
| K1 | Haiku | the four flaky test files from fact 9 | Add explicit per-test timeouts of 30–60 s to the heavy tests only. No logic changes. | `npm test` passes three times in a row locally. | L / 1 h | — |
| K2 | Haiku | `tests/e2e/helpers.mjs`, `scripts/e2e-patrol.mjs`, new `tests/game/e2e-contract.test.ts` | Export `DEFAULT_PATROL_MODE = 'chase'` from helpers and use it in both restart assertions. The contract test asserts `startMission(createGame(1)).viewMode === DEFAULT_PATROL_MODE`. | The contract test goes red if the default diverges. `npm run test:e2e -- <url>` passes `restart-reentry`. | L / 2 h | OD4 |
| K3 | Haiku | `src/render/assets.ts`, `tests/render/asset-mapping.test.ts` | In `preload()`, skip `loadAsync` for kinds where `!prefersAuthoredGltf(kind)` and set their state to `'missing'`. The manifest and license ledger stay unchanged. | A test with a stub loader shows only three URLs are requested. `npm run test:e2e:assets` is green. | L / 2 h | P0 |
| K4 | Haiku | `vite.config.ts` | Add `build.rollupOptions.output.manualChunks: { three: ['three'] }`. | `npm run build` prints no chunk-size warning with the limit still at 800. `test:smoke` is green. A build with `--base=/impact-depth/` loads. | L / 1 h | — |

**Phase 1 gate:** after each lane merges, the orchestrator runs `npm run verify`. At the end of the phase it runs `npm run build && npm run preview`, then `npm run test:smoke`, `npm run test:e2e -- http://127.0.0.1:8080/`, and `npm run test:gauntlet`.

## Phase 2: integration

Lanes run in parallel. Items inside a lane run in order.

| ID | Exec | Lane | Files | Change | Acceptance | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Sonnet | B (sole owner of `scene.ts`) | `src/render/scene.ts`, new `src/render/presentation/combat-event-fx.ts` + test | Add `GameScene.playCombatEvents(events: readonly CombatEvent[], now: number)`. It maps S1 events to S2 `FxBurst` using `simToWorldMeters` and `entityDepthY`. Torpedo trail becomes a denser bubble trail underwater and a surface wake line when shallow. Pre-allocate **two** hit `PointLight`s at scene init with intensity 0 and pulse them, so no lights are added at runtime (program-cache stability). Remove nothing that the gauntlet uses. | The mapping test gives a hit at depth `z` a burst at y = `entityDepthY(z)`. A light-count test shows `scene.children` light count constant across 100 events. The `debugBurstPresentationFx` gauntlet still passes. | S1, S2 |
| B2 | Sonnet | B | `src/render/presentation/hull-materials.ts`, `src/render/presentation/immersion.ts`, `src/render/scene.ts` | Fix the "ghostly" underwater player hull. Audit caustic, emissive and fog contributions on the player hull only, and add a bounded underwater key/rim term (albedo floor, fog-distance exemption within 30 m). Surface look unchanged. | A unit test shows restored baselines after surfacing (existing pattern). Playthrough PNG metric: in the underwater chase view, mean luminance ratio of the hull box to its surrounding ring is ≥1.4. Record before and after. | B1 |
| A1 | Sonnet | A (sole owner of `app.ts`) | `src/app.ts`, `src/main.ts`, `index.html`, new `src/ui/boot.ts`, new `src/styles/boot.css` | Loading screen with asset progress. Add an `App.whenAssetsReady()` passthrough. Wrap `new App()` in `main.ts`: on WebGL2 failure show plain-language help (enable hardware acceleration, supported browsers) instead of a blank page. | A test on `boot.ts` shows its failure-copy renderer produces the message. Smoke shows the boot overlay hidden after ready. Launching Chrome with `--disable-gpu --disable-software-rasterizer` shows the fallback text (script assertion). | P0 |
| A2 | Sonnet | A | `src/app.ts` | In the frame loop, keep prev/next per fixed step and collect `deriveCombatEvents`. Dispatch to `scene.playCombatEvents`, `audio.playCue` and shake/hit-freeze (hit 0.5, player hit 0.9, sink 0.4 s freeze; zero under reduced motion). Drive `audio.setTension` from the maximum ship alert. Delete the production call to `debugBurstPresentationFx` but keep the method. Add public `getGameSummary()` returning `{phase,wave,time,hp,maxHp,torpedoes,decoys,cmCharges,shipsSunk,score,viewMode,ships:[{id,kind,alert,hp,maxHp,range}],incoming,errors}` and `getCombatEventLog()` (last 64 events). | `typecheck`, unit and gauntlet pass. The playthrough fire-and-hit journey asserts a `torpedoHit` in the event log and ≥1 `flash` alive in `getPresentationGauntlet().vfx` within 1 s. | A1, B1, S3 |
| A3 | Sonnet | A | `src/app.ts`, `src/ui/tutorial.ts`, new `src/styles/tutorial.css` | Tutorial: the simulation pauses while it is open. A new four-card "quick start" (steer, depth/stealth, fire, survive) replaces 11 modal steps; the full tour stays reachable from Help. Keep `data-tutorial-action="skip"` and Escape. Mount S5 threat indicators using the camera projection. | Tests: `game.time` does not advance while the tutorial is open. The quick start has ≤4 steps. e2e `beginPatrolAndSkipTutorial` still works. | A2, S5 |
| C1 | Sonnet | C | new `scripts/playthrough.mjs`, new `tests/e2e/playthrough-lib.mjs`, `package.json` (script `test:playthrough`) | Playwright `chromium.connectOverCDP('http://127.0.0.1:9223')`, falling back to `launch()`. Journeys: stealth approach; fire and hit; incoming torpedo plus decoy; bubble; ping; each doctrine through `debugSetTactic`; wave 2; gameover then restart; tutorial quick start. Screenshots go to `artifacts/plan-022/playthrough/<ISO>/` with `report.json` (WebGL renderer string, `isSwiftShader`, per-journey pass/fail, `getGameSummary` samples). Also report the HUD-coverage metric: union of HUD panel rects as a fraction of the viewport. | Runs green against preview. When the renderer is SwiftShader, the report says "NOT A VISUAL PASS". A negative control (preview without A2) fails the fire-and-hit journey. | A2's summary signature (code against it; merge after A2) |
| D1 | Sonnet | D | `src/ui/hud.ts`, `src/styles/main.css`, `tests/game/hud-commands.test.ts` | Declutter the HUD: fold Gear and Doctrine, the contacts detail and the legend by default; cut panel backdrop opacity and blur; text contrast ≥4.5:1 (WCAG AA); add a visible `:focus-visible` ring. Keep every `aria-label` and `data-action` the e2e suites use. | `test:e2e:hud` and patrol `compact-viewport-reachability` are green. The C1 HUD-coverage metric is ≤22% at 1280×720 (record the before value). A contrast test on the colour tokens passes. | P0 |

**Phase 2 gate:** the Phase 1 gate, plus `npm run test:e2e:hud`, `npm run test:e2e:assets` and `npm run test:playthrough`, run on the operator's **GPU Chrome over CDP 9223**. The orchestrator opens and inspects the hit, sink and underwater-chase PNGs. Its findings go in `docs/release/plan-022-evidence.md`, clearly labelled as agent inspection, not acceptance.

## Phase 3: pacing and fun

The simulation changes here. Needs OD6.

| ID | Exec | Lane | Files | Change | Acceptance | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Sonnet | G (sole owner of `systems.ts`, `create.ts` and `constants.ts`; runs in order) | `src/game/sim/systems.ts`, `src/game/sim/create.ts`, `src/game/sim/constants.ts`, new `tests/game/pacing.test.ts` | Escorts actively hunt. Each escort gets a patrol screen around the merchants and a periodic active sweep (deterministic, driven by `rngState`). A sweep detects a sub within its radius unless the sub is deep, silent and slow. When a merchant or escort is alerted, the alert spreads to warships within 30 units. Build on the WIP's `lastKnownX/Y`; do not rewrite `contact.ts`. | Pacing test over seeds 1, 7, 19, 42 and 91: a passive silent bot is first detected within the OD6 band (median). A loud bot (flank plus ping) is detected in ≤15 s. A deep, silent, stopped bot survives 120 s on ≥4 of 5 seeds. `survival.balance`, `stealth-start`, replay, 10k and soak are green. | Phase 2 |
| G2 | Sonnet | G | Same files as G1, plus `tests/game/playtest/countermeasures.test.ts` | Make countermeasures a meaningful counter. A decoy seduces homing torpedoes within its radius (deterministic roll). A bubble screen drains an escort's `holdContact` 3× faster. | Over 20 seeds, the hit rate of an incoming Mk-18-style torpedo is ≤40% with a decoy and ≥70% without. Bubble breaks contact in less than half the no-bubble time. | G1 |
| G3 | Sonnet | G | Same files as G1 | Wave escalation. After a clear there is a breather (OD6), a "WAVE N INBOUND" message, and a spawn ring 34–50 units out. Starting alert per wave = min(0.2·(wave−1), 0.5). `VICTORY_TARGET` is unchanged unless OD6 says otherwise. | S4's wave test is updated only on the breather timing, with the operator-approved number cited. Wave 2 ships start with alert 0.2. | G2 |
| G4 | Haiku | D | `src/ui/hud.ts`, `src/styles/main.css` | Scoring feedback. Show "+N HIT / SUNK" pops from `game.messages` and a score and wave strip. Uses messages only; no simulation change. | A unit test on the pop formatter. `test:e2e:hud` is green. | D1 |

**Phase 3 gate:** the Phase 2 gate, plus `npm run test:soak` and a 10-minute scripted GPU playthrough. Record time to first contact, wave-2 reach time and deaths in `docs/release/balance-notes.md`.

## Phase 4: production hygiene

| ID | Exec | Lane | Files | Change | Acceptance | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | Sonnet | A | new `src/ui/error-toast.ts`, `src/main.ts`, `src/app.ts` | Handle `window.onerror` and `unhandledrejection`: show a toast with a copyable summary and add to the `errors` counter in `getGameSummary()`. Add a reduced-motion override from settings that zeroes shake, flash and hit-freeze. | A unit test on toast formatting. A playthrough that injects an error sees the toast and counter. | A3 |
| H2 | Haiku | E | `src/core/settings.ts`, `src/ui/panel.ts`, `tests/settings.test.ts` | Persist master volume, reduced-motion override and quality preference. Version-migrate the old key. | Round-trip and migration tests. | P0 |
| H3 | Haiku | F | `src/core/runtime-selection.ts`, `tests/game/runtime-selection.test.ts` | Low-end start profile: `low` when `deviceMemory ≤ 4`, `hardwareConcurrency ≤ 4`, or the UA is mobile, unless `?quality=` is given. | Table test over inputs. | P0 |
| H4 | Haiku | G | `README.md` | Add a how-to-play section, the controls table (from `src/input/controls.ts`), the live Pages URL, browser requirements and an accessibility note. | Headings exist; `format:check` (if OD3) passes. | Phase 3 |

**Phase 4 gate:** full `npm ci && npm run verify`, `npm run assets:validate`, every e2e suite, and the GPU playthrough. Then push to `master`, which redeploys Pages, and run `test:smoke` against `https://fubak.github.io/impact-depth/`.

## Verification and rollback protocol (every lane)

1. Each agent works in a fresh worktree from the current `origin/master`: `npm ci`, then `npm run typecheck && npm run lint && npx vitest run <touched tests>`. Paste the discriminating test's red→green evidence: run it on the base commit and it fails, run it on the branch and it passes.
2. The orchestrator merges lanes one at a time (`--no-ff`) and runs `npm run verify` after each merge. A failure means `git revert -m 1 <merge>`, and the item goes back to its lane with the log. Allow at most one fix-forward attempt.
3. At the phase gate, a failure attributable to one lane reverts that lane only. If it can't be attributed, revert the whole phase back to the last green gate SHA recorded in `tasks/state.md`.
4. Push once per phase after the gate, never per lane, because each push redeploys Pages.

## STOP conditions

- P0.1 is not done, or an item needs a frozen or operator-owned file.
- Replay, 10k, soak or `no-math-random` goes red, or a `src/game/**` file needs `three` or the DOM.
- An item needs to change `survival.balance` or `stealth-start`, move a metric outside OD6, add a dependency, fetch a network asset, or raise the chunk limit.
- S1 cannot attribute events without simulation changes (escalate the proposed `events` field).
- The same GPU e2e or playthrough journey fails twice after a fix.
- Anyone is about to write PASS for an operator gate.

## Definition of done (machine)

- [ ] CI is green on `master`: verify, smoke, and format:check if OD3.
- [ ] Three consecutive full-suite passes.
- [ ] No chunk warning.
- [ ] S1–S5, K1–K4, B1–B2, A1–A3, C1, D1, G1–G4 and H1–H4 are merged, each with its discriminating test.
- [ ] The GPU playthrough report shows every journey green. PNGs for hit, sink, underwater chase, wave 2 and restart are archived under `artifacts/plan-022/`.
- [ ] The HUD-coverage and hull-contrast metrics meet their targets. Balance metrics are recorded.
- [ ] Pages is live with a loading screen, WebGL fallback and error toast.
- [ ] `tasks/state.md`, the `plans/README.md` row, `docs/release/solo-production-status.md` and `docs/release/balance-notes.md` are updated (a Haiku docs item after Phase 4).

## Operator handoff (stays PENDING)

- GPU ≥55 FPS at the reference scene, recorded in `docs/release/perf-notes.md`, including the new VFX and hit lights.
- Lighting eye-pass (018/021) and the underwater hull look.
- Fleet visual ACCEPT (015) and OD5.
- Audio listen (014), including the new cues and tension layer.
- Soak playthrough.
- Fun/feel sign-off on the OD6 pacing.
- World-default flip (stays `legacy-v1`).
- Tag `solo-production` (Plan 017).
- Decisions OD1–OD7.

### Critical files for implementation

- `src/app.ts`
- `src/render/scene.ts`
- `src/render/vfx.ts`
- `src/game/sim/systems.ts`
- `tests/e2e/helpers.mjs`
