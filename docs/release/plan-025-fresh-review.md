# Impact Depth: fresh game-development review

Reviewed September 26, 2026, at commit `cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd` (`feat: land action-gameplay combat rules and the convoy strike`). This reassesses the merged implementation against the earlier action-gameplay plan. Review only: no game source was changed.

## Assessment

The merge materially improves combat correctness and introduces a focused mission, but it does not yet establish a production-quality action game. The highest-value next milestone is one readable, manually playable convoy strike that passes an actual browser journey from menu through extraction. More weapons, environments, or mission types should follow that proof.

The remaining gap is the connection between simulation, player information, and validation. Extraction exists in the simulation without visible navigation guidance; an assistance setting is not enforced; the tutorial advances without performing its lessons; and the mission completion test teleports the submarine to the exit. These are concrete integration gaps, not requests for additional scope.

## What now works

| Area | Fresh result | Interpretation |
| --- | --- | --- |
| Type checking, lint, unit tests, production build | `npm run verify` passed; 651 tests across 116 files | Healthy automated foundation; does not prove the full player journey |
| Asset validation | Passed with zero warnings/errors | Asset contracts pass; visual/audio quality still needs human review |
| Evade | All five sampled seeds returned control alive at 100 HP in 16.8–25.8 simulation seconds | Previous catastrophic terrain losses are resolved in this sample |
| Emergency retreat | Advanced to approach after 20 seconds | Previous repeated phase reset is fixed |
| Deep launch restriction | No torpedo fired at depth 0.82 | Combat rule now agrees with the intended launch restriction |
| Blast depth separation | Surface charge did not damage the deep submarine | Previous horizontal/depth comparison defect is fixed in the probe |
| Return to base | Four of five seeds reached the base radius in about 100–107 seconds | Much improved; seed 7 still had not arrived at 180 seconds and had 9.64 HP |
| Convoy strike reachability | Command-only simulation completed in 20.33 seconds, four shots, 100 HP | Exit is physically reachable, but this used perfect inputs and hidden exit coordinates |

The five sampled seeds were 1, 7, 19, 42, and 91. These are regression probes, not statistically representative balance testing. Existing dependencies were reused because dependency files did not change. No new long-duration soak, GPU performance certification, or audio listening sign-off was performed.

## Release blockers and priority fixes

### 1. Repair the failing browser journey and bind deployment to the tested revision

The fresh local production browser run passed startup/tutorial, viewpoint switching, and helm navigation, then failed targeting/fire with `Timed out waiting for PLOT course after water click (5000ms)`. Later journeys did not run. No console errors, page errors, or failed requests were reported.

[CI for this revision also failed](https://github.com/fubak/impact-depth/actions/runs/36265096465) in targeting/fire, although its immediate symptom was a canvas-click/navigation timeout rather than the local PLOT-state timeout. The two results establish a failing journey, not a proven common root cause. Diagnose input targeting, click completion, and expected navigation state before increasing timeouts.

[Pages deployment was skipped](https://github.com/fubak/impact-depth/actions/runs/36265679757), which is the correct result for red CI. However, the new workflow-run gate checks out the default branch without pinning the successful CI run's revision. If another commit arrives while CI is running, an earlier green run can cause a newer, untested commit to be built. [GitHub documents that workflow_run uses the last commit on the default branch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run). Pin automated checkout to `github.event.workflow_run.head_sha`, or deploy the artifact from that successful run. Define validation separately for manual dispatch.

Evidence: [.github/workflows/pages.yml](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/.github/workflows/pages.yml#L24).

**Acceptance:** targeting/fire and all subsequent journeys pass locally and in CI; deployed revision exactly equals the successful tested revision.

### 2. Make extraction discoverable, then test it with real controls

The strike creates an exit 34 units ahead with a four-unit completion radius. Searches found `strikeExit` consumed by simulation logic, but no HUD, minimap, or renderer consumer. A player receives an extraction objective without an exit marker, bearing, or distance.

The scripted strike test directly assigns submarine coordinates to the exit after the merchant sinks. Its reported 8.9-second victory therefore cannot validate escape navigation, route safety, mission pacing, or whether a player understands what to do. My independent command-only probe reached victory without teleportation in 20.33 seconds, but it knew the hidden exit coordinates. This establishes reachability, not usability or typical human completion time.

Add an exit marker and bearing/distance guidance, a clear objective transition after the merchant sinks, and an unmistakable extraction boundary. Replace the teleporting test with commands and add a browser strike journey that uses visible information.

Evidence: [strike scenario](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/game/sim/scenarios/convoy-strike.ts), [teleporting completion test](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/tests/game/convoy-strike.test.ts#L86).

**Acceptance:** a new player can locate and reach extraction without developer guidance; an automated journey completes through normal input without rewriting simulation state.

### 3. Restore player ownership of firing and build a meaningful encounter

The strike sets `assistanceAutoFire: false`, but the firing logic never reads that flag. Independent probes issued only autopilot commands: Ambush fired three torpedoes by 6.38 seconds, and Intercept fired one by 5.95 seconds. Neither probe issued a fire command.

Enforce the flag at every automatic launch path and test that movement assistance cannot expend ammunition when automatic firing is disabled. Keep manual launch feedback explicit: ready state, legal depth, target/lead information, and launcher arc.

The perfect-input strike's four-shot, full-health, 20-second victory suggests the authored sequence still needs pacing work. It is not evidence that every human run will be easy. Playtest an approach, firing commitment, escort response, meaningful defensive maneuver, and escape. Measure whether players make those decisions before adding difficulty by simply increasing enemy damage.

Evidence: [scenario assistance setting](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/game/sim/scenarios/convoy-strike.ts#L58), [autopilot system](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/game/sim/systems.ts#L733).

**Acceptance:** assistance-off produces zero automatic shots; human playtests demonstrate a legible attack-and-evade sequence rather than only repeated launch inputs.

### 4. Make onboarding teach actions and fix combat readability

In a fresh 1280×720 browser session, all four strike tutorial cards could be completed with Next/Finish. No steering, firing, or successful dodge was required. Simulation time remained at zero and health stayed at 100. The survival card spawned charges astern, but the paused cards did not teach an actual timed escape.

Convert the introductory sequence into safe, live exercises with completion conditions for steering, firing, and leaving a telegraphed threat. Preserve an explicit skip option. Version completion state so returning players can access the new lessons.

The new objective and incoming text expanded the top-right score panel into CONTACTS at this viewport; score rows were obscured. Charge markers also crowded the bottom help strip. Reserve layout space and define marker priority instead of appending more text to fixed positions. Nearby on-screen underwater threats still need attention: the new charge visibility exception applies only beyond 12 units, while closer on-screen markers can remain suppressed. Show imminent danger consistently, with readable timing and direction.

Evidence: [tutorial integration](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/app.ts#L528), [HUD additions](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/ui/hud.ts#L486), [threat marker rules](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/ui/threat-indicators.ts#L156).

**Acceptance:** an unfamiliar player completes the taught actions; objective, contacts, controls, and imminent threats remain readable together at supported desktop sizes.

### 5. Fix the sinking animation clock

The app supplies simulation seconds to combat presentation. The scene divides elapsed time by 1,000 before advancing wrecks, whose lifetime is defined in seconds. A nominal six-second wreck therefore persists for roughly 6,000 simulation seconds—100 minutes. A reproduction accumulated only 0.06 seconds of wreck age after 60 simulation seconds.

Use one time unit end to end and test the scene integration, not only the standalone wreck helper. Preserve the sunk ship's silhouette and heading: the current replacement is the same box geometry for every ship, weakening the payoff of a successful hit.

Evidence: [time forwarding](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/app.ts#L874), [incorrect conversion](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/render/scene.ts#L579), [six-second lifetime](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/render/presentation/wrecks.ts#L10).

**Acceptance:** ships list, sink, and disappear in the intended interval at normal speed and under time compression, with bounded presentation objects.

## Additional correctness work

- **Initialize the selected world correctly.** Menu paths create the default world and then overwrite `worldVersion`. For opt-in `littoral-v2`, relabeling leaves world-derived state inconsistent: seed 19's base was `(13.24,13.24)` instead of the properly initialized `(10.24,10.24)`. Pass the world selection into creation, including scenario construction and restart. Default legacy play is unaffected by this specific mismatch. Evidence: [menu creation paths](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/app.ts#L385).
- **Validate return-to-base success, not merely a fallback message.** Seed 7 still did not arrive within the 180-second probe. The new “cannot reach” condition uses absolute mission time greater than 170 seconds; ordering a viable retreat late can therefore immediately produce a failure message. Detect stalled route progress relative to the order, and test actual arrival under a defined threat budget. Accepting arrival, a warning, or some death cases is too weak to certify reliable navigation. Evidence: [time-based warning](https://github.com/fubak/impact-depth/blob/cf0ab5ae83b7cc43aa1684855ac6cde40bc718dd/src/game/sim/autopilot.ts#L293).
- **Retain the outstanding production gates.** Asset validation and new documentation do not replace contrast measurements, audio listening, representative-hardware frame-time checks, or a soak. Art and sound still need an observed in-game quality pass. Do not mark those gates complete from unit-test counts.

## Recommended next milestone

1. Restore green browser CI, pin deployment to the tested commit, fix the assistance flag and wreck clock.
2. Deliver visible extraction, a real-input strike completion test, and one browser mission journey.
3. Turn onboarding into live exercises; repair HUD layout and nearby threat visibility.
4. Tune escort reaction and escape pressure through human playtests; record completion time, damage, deaths, missed cues, and assistance usage.
5. Resolve world initialization and return-to-base reliability, then complete the existing performance, audio, art, and soak gates.

Ship this milestone when a new player can understand, attack, evade, extract, and retry with dependable controls and readable feedback. That is the evidence needed before expanding content.

## Evidence files

- [Baseline regression probes](plan-025-simulation-probes.json): repeated against the merge.
- [New feature probes](plan-025-feature-probes.json): assistance behavior, command-only strike, wreck clock, and world initialization.
- [Failed CI run](https://github.com/fubak/impact-depth/actions/runs/36265096465): targeting/fire failure.
- [Skipped Pages run](https://github.com/fubak/impact-depth/actions/runs/36265679757): deployment withheld.

Full local verification/browser logs were retained with the review deliverables rather than committed as repository release proof.

These results describe this revision and this review environment. Browser timing failures require diagnosis; they should not be presented as proof of a single gameplay defect. The mission timing probes use simulation time and deterministic commands, not human playtest timing.
