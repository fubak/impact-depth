# Plan 023: Action gameplay and production readiness

Reviewed 26 September 2026, `fubak/impact-depth`, branch `master`, commit `ddd4281f256fb38ce830a31ccfcbae7b50a598a8`.

Status: **PLANNED — implementation not started.** The operator requested this plan be committed and pushed. Existing production and operator acceptance gates remain pending.

## Assessment

This is a substantial playable prototype with a useful simulation foundation. It has fixed-step deterministic gameplay, several weapons and enemy types, doctrine AI, sonar, repair/restock, progression, multiple cameras, a considerable water renderer, combat feedback, quality controls, and extensive tests. Keep the simulation/rendering separation and the existing engine.

My recommendation is to commit to **a compact submarine action thriller**: identify a valuable target, maneuver for a shot, strike, survive the counterattack, and escape or press the advantage. The central development problem is making those decisions readable, effective, and repeatable. More graphical effects or enemy aggression alone will not solve it.

The recent Plan 022 already adds launch/hit/sink cues, tension audio, threat indicators, automatic time compression, camera follow-through, countermeasure improvements, and pacing changes. This review accounts for those additions; it does not propose them as if absent.

Current maturity: a prototype approaching a polished vertical slice, not a production-complete game. The remaining work combines gameplay correctness, encounter design, visual communication, coherent content, and release discipline.

## What I verified

- Fresh local clone and dependency installation.
- `npm run verify`: type checking, lint, 105 test files / 614 tests, and production build passed.
- Production JavaScript output: approximately 412 kB application + 610 kB Three.js; approximately 284 kB combined gzip, excluding runtime assets.
- `npm run assets:validate`: passed, with no reported errors or warnings.
- Production browser smoke: passed at 1440×900, including tactical, periscope, and sonar switching; zero captured JavaScript/console errors.
- Full production patrol E2E: **failed** in `targeting-fire`, waiting five seconds for the expected PLOT course after a water click. Startup/tutorial, POV switching, and helm navigation passed. Later journeys did not run. No captured console/page/request errors accompanied the failure. This is an unresolved release-check failure; this review does not establish whether the cause is input/game logic, scene-dependent targeting, or harness/render timing.
- Interactive local browser inspection: onboarding, chase, firing/reload feedback, pause, tactical, and periscope. These were brief inspection sessions, not a full human playthrough or a hardware performance acceptance test.
- Independent simulation probes on seeds 1, 7, 19, 42, and 91, plus isolated checks of retreat, depth firing, and blast damage.
- Dependency audit reports four development-tooling findings (three moderate, one high). This is an audit result, not evidence of a shipped gameplay exploit; triage and update with regression checks.

The repository's two expected-failure doctrine tests count as passing when the defective behavior persists. Therefore the 614-test result must not be read as 614 working gameplay promises. The accelerated simulation soak is also not a two-hour browser/audio/GPU soak.

## Fix these before making combat harder

| Priority | Finding and evidence | Required change / acceptance |
|---|---|---|
| P0 | **Evade can kill the boat through terrain.** Evade dies on seeds 7, 42, and 91 in the existing five-seed scenario. A per-system trace on seed 7 attributes all 100 HP lost to `worldCollision`, not enemy ordnance. The boat dies at about 13.57 simulation seconds. | Plan escape routes using depth clearance along the route, not only surface-water clearance. Clamp the actual dive trajectory before penetration, not just the target depth after movement. Show bottom clearance and an urgent grounding warning. Regression: supported evasive orders cannot drive a healthy boat into unavoidable terrain death on the test seeds. |
| P0 | **Emergency RTB can get trapped in breakaway.** At `autopilot.ts:175`, low HP/flooding resets Exfil to breakaway and resets its timer every update. The breakaway branch returns before the RTB branch, and its exit condition excludes Exfil. An isolated 20-second doctrine probe remains in breakaway at timer zero. | Explicit transitions: break contact → route home → approach → dock. Apply emergency entry once; do not reset the timer every frame. Require damaged-boat scenarios to reach a reachable base or report a meaningful inability to do so. |
| P0 | **Depth does not consistently change blast exposure.** `systems.ts:1220` compares normalized depth difference with a horizontal radius in map units. A staged surface-targeted blast with radius 1.8 damages a boat at depth 0.95 for the full 30 HP at the same XY. The normalized depth range is smaller than many blast radii. | Use consistent physical units or explicitly tuned horizontal and vertical blast extents. Include detonation depth, falloff, and visible danger volumes. Test that sufficient vertical separation reduces/avoids damage. Validate the intended arcade model rather than assuming realistic physics. |
| P1 | **The stated victory goal is misleading.** `systems.ts:1260` requires both eight sinks and an empty wave. The normal first two waves contain 5 and 10 ships. Consequently the normal route wins at 15 sinks, not 8. | Either win immediately at the advertised target, or advertise completing two waves / all remaining targets. Keep briefing, HUD, test, and end condition identical. |
| P1 | **Deep-depth help contradicts the simulation.** The HUD says Deep cannot fire. Deep is 0.82 and the fire limit is 0.85. A probe fires successfully at 0.82. | Choose the desired tradeoff and align tooltips, readiness state, tutorial, doctrine, and rules. Deep safety with unrestricted shooting may undermine the exposure decision. |
| P1 | **New homing/decoy behavior is not fully connected to normal enemy weapons.** Normal enemy torpedoes are created with `kind: 'enemy'`; the player-homing / 12-unit probabilistic seduction branch checks enemy-owned `kind: 'mk18'`. A separate nearby Foxer branch does affect ordinary enemy torpedoes. | Make weapon behavior explicit and test a torpedo actually launched by enemy AI through tracking, warning, countermeasure response, and impact. Do not rely only on injected Mk-18 fixtures to certify normal enemy combat. |

Measured doctrine outcomes, using the existing test style and a 180-second horizon:

| Seed | Evade | RTB / Exfil |
|---|---|---|
| 1 | Returns to manual alive, 16.83 s | Dies, 31.55 s |
| 7 | Dies, 13.57 s | Dies, 13.17 s |
| 19 | Returns to manual alive, 18.83 s | Reaches base ring alive, 100.20 s, 40 HP |
| 42 | Dies, 13.57 s | Dies, 13.50 s |
| 91 | Dies, 13.57 s | Dies, 25.03 s |

These are narrow bot scenarios, not estimates of human win rates. The existing notes claiming Exfil fails on all five seeds are stale: seed 19 succeeds on this commit. An aggregated expected-failure test cannot reveal partial improvement reliably; split outcomes by seed and assert the intended behavior normally after fixing it.

## Make the player do the exciting part

**Keep assisted aiming, but add meaningful shot decisions.** Target selection currently computes a lead directly from the target, and doctrines can approach, fire, and break away automatically. That supports a command game, but can leave little active mastery. For an action-first mode, retain assisted helm and lead prediction while making launch timing, firing position, weapon choice, and escape direction player decisions. Make full auto-fire an explicit assistance option.

Show a compact target bracket, intercept cue, reload ring, weapon identity, and the reason a shot is unavailable. Give Mk-14 straight shots a clear positional advantage and Mk-18 seekers a clear cost or counterplay. Prototype a forgiving launch arc/turn constraint rather than instantly aiming every shot at any bearing. Explain the assist level so it never feels arbitrary.

**Build a complete defense loop.** Announce an enemy search sweep, rising suspicion, a firm lock, and an actual incoming weapon as distinct states. Give torpedoes an identifiable trail and relative-depth cue; show depth-charge danger regions and time to detonation where appropriate. Distinguish decoy diversion, bubble masking, evasive turning, depth changes, and bottom clearance. The player should understand both a successful dodge and a death.

Existing threat markers cover off-screen torpedoes, alerted ships, and aircraft. They omit depth charges and suppress a marker whenever its projected point is on-screen, even if underwater fog makes the actual threat hard to see. Visibility to the player must matter, not only camera-frustum inclusion.

**Keep the camera under player control.** The existing torpedo camera follows for up to 3.5 seconds and can linger for another second; escort contact cancels it. Keep that spectacle, but make it optional, cancellable by steering, and subordinate to immediate danger. A small impact inset is worth prototyping if full-camera transitions disrupt evasive play. Ship deaths are removed from authoritative state after about 0.05 seconds; use presentation-only wrecks to deliver several seconds of listing, breakup, debris, and sinking without retaining dead combatants.

**Replace wave cleanup with encounters.** One short mission should have a route, a valuable objective, and an exit condition. Example: attack a convoy crossing a channel, survive the escort response, then escape into deeper water. Give escorts recognizable roles and weapon tells; introduce threats individually before combining them. Allow objective completion without searching every corner for the last ship.

Prototype targets—not established industry benchmarks—are: a meaningful decision in the first 15–30 seconds, a first useful shot within 30–60 seconds in the action tutorial, 20–45-second bursts of pressure followed by short recovery, and a complete first mission in roughly 6–10 minutes. Measure and adjust with new players. Retain slower stealth patrols as a separate pacing choice rather than accelerating everything globally.

The current automatic 4× transit compression and 20-second wave breather are useful foundations. Display the compression state and make it cancellable. Enemy quiet-sweep range grows with total mission time after 62 seconds and has no explicit cap; revise this into encounter-local suspicion/search behavior, so late-mission detection does not become an unexplained global timer.

## Presentation and usability work

The inspected starting chase scene has a pale submarine over a bright seabed, a dark overhead water band, and small distant combat cues. The HUD occupies multiple separated panels and displays precise status without clearly prioritizing the next decision. This is a specific readability observation, not a blanket claim that all scenes or GPU configurations look the same.

1. Put the boat, target, and dangerous ordnance ahead of water detail in contrast and composition. Tune underwater attenuation, exposure, rim lighting, silhouette, and effect scale together. Check day/night and high/low quality. Valve's [rendering paper](https://cdn.cloudflare.steamstatic.com/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf) is a useful primary reference for art and shading choices that support gameplay readability; this recommendation is an application of that principle, not a request to imitate TF2's style.
2. Consolidate combat essentials around the action: hull, detected state, weapon/reload, countermeasure availability, target, and current objective. Expand engineering, doctrine, and full navigation details contextually. Seven POVs are available; teach one combat view and one tactical view before the rest.
3. Turn the four-page quick start into a playable sequence: steer through a safe passage, shoot a forgiving target, avoid one clearly telegraphed threat, and reach an exit. Keep Help as a reference. The end screen needs damage cause, an actionable lesson, objective progress, and immediate retry; it currently reports score and ships sunk.
4. Choose a coherent fictional/historical identity and art standard. The project mixes modern hero vessels with WWII-style weapon labels and procedural fleet classes. Only the player sub, enemy sub, and destroyer prefer authored GLBs. Model presence and license validation do not establish in-game silhouette quality. Establish class proportions, materials, detail density, waterlines, and damaged variants before sourcing more assets.
5. Finish audio as gameplay communication: separate launch, near pass, hull impact, distant blast, and terminal sinking; add useful direction/distance cues, ducking, and restrained crew callouts with captions. Current bank documentation explicitly calls the shipped WAVs fallback-generated synthesis. A human listening pass remains necessary.
6. Provide a normal player settings screen for audio, graphics, captions, motion/flash intensity, key bindings, and assistance. Add focus-loss handling that clears held controls, plus an explicit pause-on-background policy. Controller support is valuable after the desktop keyboard/mouse loop feels good; mobile is a separate scope decision.

## Production work and release gates

**Preserve the architecture, improve its boundaries.** Extract weapon resolution, damage, enemy sensing/attacks, and mission progression out of the large `systems.ts`; separate orchestration and HUD responsibilities in `app.ts` and `hud.ts`. Do it incrementally as the affected behavior is fixed. Replace presentation inference of vanished torpedoes / nearest damaged hulls with authoritative typed combat events carrying source, target, position, and cause. This also makes death explanations and diagnostics trustworthy.

**Make a green release gate meaningful.** CI currently runs verify and browser smoke. Patrol E2E, HUD journeys, asset validation, and formatting are not all part of that required workflow. Pages deploys independently on a master push after its own build; it is not gated on the separate Verify job succeeding. Promote a tested artifact only after required checks pass. Add tests for real enemy weapon paths, terrain-safe evasions, mission completion, normal input, restart, and quality/world combinations. Keep broader seed/balance runs and browser soak as scheduled or pre-release gates.

**Measure target hardware.** The repository records real-GPU shadow-sampler errors; I did not independently reproduce or clear that historical issue. Zero JavaScript errors in headless smoke is not proof of zero WebGL warnings. Require a named GPU/browser/resolution, sustained ≥55 FPS at the reference scene, frame-time percentiles and hitches under peak combat, restart/resource stability, context loss/restoration, and a real wall-clock soak. [MDN's WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) supports treating WebGL errors and resource behavior as explicit engineering concerns.

**Finish the product surface.** The application starts from seed 19, and retry reuses that seed. Keep replay-same-seed, but add a deliberate mission/scenario selection and a distinct new-run option. Decide whether patrols need save/resume based on actual run length. Maintain settings migrations, loading failure/retry behavior, build identification, a reproducible bug report, and release rollback. Verify browser claims on the browsers actually supported at launch.

**Reconcile documentation.** The PRD still describes React/TanStack, co-op/auth, mobile goals, and older world constants while the active contract targets solo desktop Vite. The status documents also mix current outcomes with older instructions. Publish one current scope, one acceptance checklist, and one defect ledger. Defer co-op, auth, campaigns, and an engine/framework rewrite until the single-player loop passes playtests.

## Recommended delivery order

| Milestone | Concrete deliverable | Exit condition |
|---|---|---|
| 1. Trustworthy combat | Terrain-safe Evade/RTB, correct depth/blast rules, connected enemy torpedo behavior, truthful help and victory goal | Normal assertions pass per seed; no known expected-failure escape promises; human can explain a loss |
| 2. Action vertical slice | One authored 6–10-minute convoy strike / counterattack / escape mission, focused HUD, manual shot decisions, readable defense, optional shot camera | New players can complete the basic attack-and-escape sequence without verbal coaching and identify incoming threats |
| 3. Production presentation | Consistent fleet art, underwater contrast, visible weapon paths, persistent sinking visuals, finished sound mix, playable onboarding/settings | Day/night and quality-mode visual review plus audio listening acceptance on target hardware |
| 4. Release candidate | Required CI-to-deploy gate, scenario regression suite, performance evidence, save/retry decisions, browser matrix, soak and rollback | All recorded launch gates pass on a named build; no untriaged blocker defects |

Do not expand mission count until the vertical slice works. The most valuable next investment is one reliable, readable, satisfying attack-and-escape encounter. That will expose the correct balance, control, camera, audio, and performance needs for the rest of the game.

## Source map and evidence

The following links pin the reviewed revision, so later changes cannot silently alter the evidence:

- [Doctrine transitions](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/src/game/sim/autopilot.ts#L175): emergency retreat and breakaway.
- [Combat systems](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/src/game/sim/systems.ts#L1128): homing, impact, blast, sinking, and victory logic.
- [Depth and pacing constants](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/src/game/sim/constants.ts#L17).
- [Doctrine expected failures](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/tests/game/playtest/doctrines.test.ts).
- [Threat markers](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/src/ui/threat-indicators.ts).
- [Active asset selection](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/src/render/assets.ts#L21) and [audio provenance](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/docs/release/audio-banks.md).
- [CI](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/.github/workflows/ci.yml) and [Pages deployment](https://github.com/fubak/impact-depth/blob/ddd4281f256fb38ce830a31ccfcbae7b50a598a8/.github/workflows/pages.yml).
- Recorded independent simulation evidence: [Plan 023 probes](../docs/release/plan-023-simulation-probes.json). Verification and browser outcomes are recorded above; raw local logs are not part of this plan commit.

The review did not modify gameplay source. These recommendations are proposed work, not implemented changes or production sign-off. No audio listening acceptance, GPU FPS certification, or extended real-time soak was performed.
