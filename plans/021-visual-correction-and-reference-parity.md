# Plan 021 — Correct vessel motion and close the visual gap

Status: **IN PROGRESS** — session 1 (phases A/B) on machine gates. Phases C–F not started. Operator visual/GPU ACCEPT still pending.
Reviewed: 2026-09-13, impact-depth `d75802f` (latest fetched origin/master).
Reference: [ocean-simulation](https://github.com/iamtechartist/ocean-simulation), pinned `3f756c128f7775f76e9fc7e93ad2f4e825df4354` (no newer origin/main commit at review).
Visual sources: [reference demo](https://iamtechartist.github.io/ocean-simulation/) and [user video](https://x.com/bradshannon/status/2099202666521919787/video/1).

## Outcome

Deliver believable vessel contact and motion, clear depth-dependent ocean optics, restrained foam, coherent outdoor lighting, and natural island vegetation at the project's desktop performance target. Preserve deterministic simulation and gameplay. This plan consolidates remaining visual work from Plans 018–020; it does not reopen completed integrations merely because older reports still describe them as missing.

## Evidence and limits

The X video initially failed to load, then played successfully in the in-app browser. Multiple moments across its repeating playback were visually inspected. A surface ship visibly pitches toward upright; vessels and sand appear very pale; broad shallow water reads as milky cyan; cays have simple rounded silhouettes and a conspicuous pale perimeter. These are observations, not proof of a particular shader or motion defect. The recording's commit, quality profile and world mode are unknown. Do not claim its extreme pose is reproduced on current master until a controlled recording proves it. Current code already clamps pitch/roll, so the video could predate some fixes.

The reference was inspected at aerial and settled waterline views. Its strongest differences are continuous multiscale wave detail, dark blue offshore water, localized turquoise shallows, coherent reflections, irregular shore geometry, rocks, dense varied foliage, and much stronger material/depth separation. The target is that visual coherence, not identical island geography or copying a single screenshot's colors.

Latest work already includes default spectral water, a local Kloofendal HDR, optics, caustics, bounded effects, shared-world support, asynchronous probes, procedural vegetation, and recovery machinery. These are valuable foundations. Presence of each subsystem does not establish correct coupling or reference parity.

Fresh verification: dependency installation succeeded; typecheck passed; lint completed with warnings; full test run had 358 passing and two 5-second timeouts among 360 tests. Timeouts were land avoidance and importer startup. The importer suite subsequently passed all seven tests in isolation. Production build passed independently, producing a 951.09 kB main JS chunk (263.27 kB gzip) and a size warning. The full verify command therefore did not pass. Current browser capture and isolated land-avoidance checks were still pending when the initial plan was drafted; record their actual outcomes below, never infer success. This review does not certify GPU performance, visual acceptance, audio listening, fleet acceptance, or a long soak.

## Prioritized findings

Final verification update: land avoidance also timed out in isolation (8.18 seconds against the 5-second limit), so its timeout remains unresolved. The fresh production browser look-capture script completed successfully: local HDR returned 200, HDR-PMREM became ready, Gerstner rollback became ready, and no console errors, page errors or failed requests were recorded. This is a successful capture/smoke result, not visual or performance certification.

Paths/line anchors below refer to reviewed d75802f and may move during implementation.

| Priority | Evidence                                                                                                                                                   | Required action                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | `src/render/ocean/surface-probes.ts:61–88` sums raw cascades; `surface.ts:26–40` applies bed/coastal/weather gains; `scene.ts:1431` supplies only raw maps | Make probes and rendered surface evaluate the same displacement, slope and world conventions.                                                                                                                  |
| P1       | `presentation/vessel-attitude.ts:302–343` uses CPU heave with GPU angles and repeatedly extrapolates previous rendered velocity by probe age               | Replace mixed-source motion with coherent, stable sample reconstruction. Audit repeated extrapolation for positive feedback; prove behavior with delayed readback tests before claiming this caused the video. |
| P1       | `scene.ts:886–895` clamps player presentation to legacy `sampleSeabedY` despite v2 bed installation at 509–515                                             | Use the active canonical world for every bed-dependent placement.                                                                                                                                              |
| P1       | `ocean/surface.ts:29–39` ignores coastal direction; field is 32² over 2048 m in `spectral-backend.ts:232,346`                                              | Implement meaningful coastal refraction, depth envelope and blocker exposure at useful world resolution.                                                                                                       |
| P1       | `ocean/foam.ts:10–41` is cascade-local; `ocean.ts:486,703,918` heavily suppresses foam; shoreline noise has no advected history                            | Build bounded world-space shoreline/wake foam with persistence, drainage and localized breakup.                                                                                                                |
| P1       | `scene.ts:922–927,1003–1006` overwrites emissive underwater without restoration; `assets.ts:77–83` adds baseline emission                                  | Restore material baselines on surfacing and remove uncontrolled self-lighting.                                                                                                                                 |
| P2       | `ocean/caustics.ts:281–343,611` focuses at bed and passes depth zero for global attenuation                                                                | Attenuate per receiver depth/normal/immersion; do not apply bed-focused energy indiscriminately to hulls.                                                                                                      |
| P2       | `ocean/optics.ts:106–137`, `ocean.ts:641–644` use exact capture projection with distorted UVs                                                              | Add measured reflection/refraction overscan and robust edge/immersion handling.                                                                                                                                |
| P2       | `surface-probes.ts:112–123`, `scene.ts:1214–1219,1286–1315` check age but not spatial movement; issue whenever previous request completes                  | Reject spatially stale samples and impose adaptive cadence with diagnostics.                                                                                                                                   |
| P2       | `spectral-backend.ts:358–390,551–565` uses shared busy flag and unconditional async finally                                                                | Generation-tag coastal rebuild ownership; old completions cannot bind or clear new work.                                                                                                                       |
| P2       | `vegetation.ts:23–56,278–285` deforms color shader but has no matching depth material                                                                      | Apply identical wind to foliage color and shadow passes.                                                                                                                                                       |
| P2       | `vegetation.ts:232,258–283,310–319` merges all islands, disables culling, truncates first N instances                                                      | Partition spatially, cull independently and thin deterministically per island.                                                                                                                                 |
| P2       | `vegetation.ts:23–30,288–295`, `islands.ts:33–68` lack reference leaf coverage/transmission and geology variation                                          | Add leaf detail, natural density, slope-aware materials and bounded coastal rocks.                                                                                                                             |
| P2       | `sky-lighting.ts:155–161`, `outdoor-lighting.ts:101–117` retain static daytime HDR while weather/sun change                                                | Coordinate environment lighting, visible sky, fog and directional sun per preset.                                                                                                                              |
| P2       | `seabed.ts:118–129` mixes canonical height with legacy color and baked sinusoidal caustics                                                                 | Derive albedo from active terrain and let dynamic caustics own moving light.                                                                                                                                   |
| P2       | `.github/workflows/ci.yml` runs verify plus smoke only                                                                                                     | Add focused GPU integration checks and retained visual artifacts; keep human visual approval explicit.                                                                                                         |

## Execution order and acceptance

### A. Establish a reproducible baseline

- Record commit, seed, world mode, backend, quality, viewport, browser/GPU, weather, camera and time in every capture. Reproduce the video scenario with a surface vessel beside a cay and record 30–60 seconds of motion.
- Capture current and reference aerial, waterline and shallows views under calm, breeze, storm and golden-hour conditions. Match framing and exposure intent where practical; avoid pixel-diffing unrelated terrain.
- Add diagnostics for surface height, hull draft, requested/resolved probe position/time, source/generation, pose, readback count/latency, caustic strength and active environment. Keep developer data outside normal player UI.
- Preserve before images and machine logs. Establish whether nearly upright motion still exists on current master. A static screenshot cannot close the motion issue.

Acceptance: anyone can replay the same current-game scenario; video observations and current reproduction results are distinguished.

### B. Fix vessel motion, waterline and world authority first

- Share the actual surface evaluator and uniforms across visible water, probes and relevant caustic sampling: cascade scales, displacement inversion, bed, coast, sea state and coordinate origin.
- Reconstruct a coherent timestamped pose. Derive velocity from distinct accepted probe samples, not repeatedly from extrapolated rendered poses. Limit prediction once to a bounded horizon; use frame-rate-independent damping and bounded angular acceleration. Reject invalid, out-of-order, wrong-generation and spatially stale footprints.
- Once correspondence is proven, replace the CPU-heave/GPU-angle compromise with consistent surface contact. Retain a smooth fallback when unsupported or stale. Preserve render-only authority.
- Audit model axes, yaw/pitch/roll conventions, fitted keel offsets, actual hull length/beam and draft for every fleet type. Use model waterline metadata rather than assuming keel-at-zero equals floating draft. Test cardinal headings; bow and beam sample signs must match visible mesh rotation.
- Replace the legacy bed clamp in v2. Surface, collision, islands, seabed, vegetation exclusion and presentation must consume the active world consistently.
- Add a configurable probe cadence around 10 Hz as an initial budget, with near-camera priority, spatial rejection and measured adaptation rather than per-frame readback.

Acceptance: synthetic planar waves give correct angle signs and draft; delayed samples at 30/60/120 FPS do not accumulate angular motion; constant target plus an initial perturbation converges; no NaNs or snap on reset/backend change/dive/surface; sampled and rendered heights agree within a documented meter tolerance in deep and shallow water. The reproduced video scenario has stable contact and no uncommanded violent rotation. Gameplay/replay state is unchanged by GPU timing.

### C. Restore material and lighting coherence

- Store original per-material values before presentation adjustments. Compute immersion effects reversibly and prevent shared-material leakage between entities.
- Remove permanent cyan emission and tune hull roughness/metalness/exposure under neutral light before ocean effects. Preserve authored GLBs and asset provenance; make corrections in the presentation pipeline or versioned importer output.
- Use per-receiver depth, surface normal, visibility and submergence for caustics. Keep focused seabed projection for terrain; use an appropriate bounded approximation for moving hulls. Receivers above water get no underwater caustic energy.
- Remove static caustic patterns from seabed albedo. Derive seabed tone from canonical height, slope and stable world variation.
- Match sky background, reflection environment, sun and fog. Restrict static HDR to compatible conditions or introduce measured blending/procedural updates for changing weather/time. Tune exposure once, then water absorption/scattering; avoid fixing excess light with arbitrary global darkening.

Acceptance: deep-to-surface roundtrip restores exact base material values; two vessels do not contaminate one another; receivers at +1, -2 and -20 m behave appropriately; noon/golden/storm show coherent highlight direction and horizon. Hull shape and sand detail survive highlights without a white glow.

### D. Complete the coastal water system

- Use the reference's coastal travel/direction, depth and exposure concepts through the modular engine contract, preserving MIT attribution. Implement finite-depth shoaling and a bounded breaking envelope with consistent slopes.
- Allocate useful field resolution over the actual world, initially evaluate at least 128 samples across the 640 m sector or a nested field. Benchmark before choosing final profile sizes; avoid blocking rebuilds.
- Build wide/near world-space ping-pong foam history. Inject breaker, shoreline runup, wake and impact energy; advect, decay and drain. Separate offshore whitecaps from persistent shallow foam and avoid a continuous white island outline.
- Couple wake foam and ripple normals to vessel speed/turn/immersion. Ensure effects share world coordinates and pause/reset semantics.
- Add capture overscan (reference uses approximately 1.26) with correct projective mapping for supported cameras; verify quality costs and edge behavior. Test waterline crossings explicitly because planar reflection/clipping remains an approximation to a displaced surface.
- Generation-tag async coastal jobs and texture ownership across reset, world switch and disposal.

Acceptance: shore transects show depth-dependent wave behavior and obstacle sheltering; foam moves and fades rather than sticking to the camera or forming a uniform ring; calm water stays restrained; rough-sea viewport corners reveal no rectangular captures; stale build A cannot overwrite or clear newer build B. Quality changes do not leak targets or stall the main thread.

### E. Build believable islands and vegetation

- Retain canonical coastline/collision authority while adding irregular visible silhouette, slope-dependent sand/soil/rock, world-space macro variation and fine normal detail without obvious tiling.
- Add seeded, capped rock clusters and varied vegetation density aligned to slope, height, wetness and shoreline exclusion. Do not place decorative rocks in navigable channels without corresponding gameplay/world decisions.
- Add generated/local leaf coverage textures, color variation and restrained backlight transmission. Use alpha-to-coverage where supported and suitable; validate fallback and shimmer at distance.
- Share wind deformation with custom depth/shadow materials and dispose both properly.
- Partition foliage by island/spatial cell; maintain accurate bounds and independent LOD. Use stable per-island density selection so low quality does not erase later islands.

Acceptance: near and distant cays retain natural proportions and varied crowns; wind and shadows move together; every island retains representative vegetation at each quality; distant buckets stop drawing; no neon foliage, uniform foam discs, severe alpha shimmer or visibly repeated placement patterns.

### F. Validate, measure and write a fresh analysis

- Run full verify after implementation. Investigate the two current timeouts under normal CI concurrency; separate workload contention from algorithmic regression. Do not merely raise global timeouts or hide failing assertions. Fix the unused lint-disable warnings when touching their files.
- Add behavioral GPU tests for surface/probe correspondence, delayed motion, foam history, receiver-depth caustics, camera movement, async generation ownership and context recovery. Existing string/unit tests are insufficient for these coupled effects.
- Run smoke, ocean E2E, asset validation, visual matrix, mission/backend/world/quality reset cycles and a sustained cruise. Archive screenshots, motion clips, diagnostics and errors on failure.
- Measure target desktop hardware at stated resolution/profile: maintain project target >=55 FPS, report median/p95/p99 frame time, >100 ms hitches, readback cadence, draw calls and resource plateaus. Label software/headless results separately. Budget foam, optics, shadows and vegetation before increasing resolution.
- Evaluate code splitting for the current 951 kB main bundle only where it improves measured loading without creating gameplay-time stalls. Record first playable and HDR/asset-ready timing.
- Produce a fresh report keyed to the implementation commit with before/after evidence and a disposition for every finding above. Update stale state/release documentation that still says spectral is opt-in or HDR absent. Keep remaining Plan 012/014/015/018 operator checks explicit.

Acceptance: repeatable green machine gates, stable resource counts, no shader/console failures, measured performance and a reviewed motion recording. Human visual, hardware, listening, soak and release/tag approval are separate; do not self-certify them from automated screenshots.

## Suggested session split

1. Baseline and B: motion/surface/world correctness. Stop visual tuning from masking incorrect inputs.
2. C: reversible materials, caustics and coherent lighting.
3. D: coastal physics, foam, optics and lifecycle.
4. E: island/foliage art and spatial performance.
5. F: integrated matrix, performance correction and fresh review.

Use lower-cost models for bounded tests, documentation and isolated foliage/material work when delegation is authorized; reserve cross-system surface/motion integration and final review for the coordinating agent. Avoid concurrent edits to scene.ts or shared surface contracts. Each session should land a focused reviewable change and retain the Gerstner rollback until validation is complete.

## Next-session instruction

Read AGENTS.md, tasks/state.md and this plan, then confirm the new HEAD and rerun only baseline checks invalidated by intervening changes. Start with phases A/B, reproduce the observed ship instability, and fix coherent surface contact before color tuning. Implement within the simulation/render boundary, add the behavioral checks specified here, and update the evidence ledger with actual results. Continue through remaining phases in order as scope permits; leave a precise handoff for unfinished phases rather than marking the entire realism effort complete.

Fresh screenshot inspection: artifacts/plan-019/tactical-shallows.png confirms current master still has broad milky cyan shallows, an almost white player hull, an excessively bright shoreline foam band, and a simple sand-dominated cay. These appearance issues are reproduced in the fresh build; extreme ship rotation remains a video observation requiring controlled reproduction.

## Session 1 (A/B) machine log — 2026-09-13

Implemented: shared `oceanDisplacement` in GPU probes, CPU twin + 0.25 m tolerance, probe heave (no CPU/GPU mix), accepted-sample velocity, active-world bed clamp, 10 Hz cadence, spatial rejection keyed to hull origin, look-dev surface diagnostics, `scripts/look-021.mjs`.

Verified: typecheck; `tests/render` 179 passed; production build (955 kB main). Headed capture at `http://127.0.0.1:8082/` wrote `artifacts/plan-021/` with `source: "probe"`, 10 Hz, 13 readbacks. Software-GL probe age was ~0.4 s (not GPU proof). Foam, pale hull, milky shallows remain for phases C–E. Not committed.
