# Plan 018 execution update: complete the realistic ocean and world upgrade

Date: 2026-09-12

Status: **PLANNED — partial implementation drafts exist; integration and acceptance are incomplete**

Repository baseline: `efecea4561d513775320894063170c4708e2199e` plus the working-tree inventory below.

Companion contract: [018-ocean-world-engine-integration.md](018-ocean-world-engine-integration.md).

## 1. Requested outcome and authority

Complete the graphics upgrade identified in the repository review: spectral waves, coastal behavior, persistent foam and spray, real scene reflection/refraction, underwater caustic lighting, coherent outdoor lighting, detailed animated vegetation, water-following vessels, consistent world queries, scalable GPU resources, reliable recovery, and credible tests. Finish with a fresh independent analysis of the resulting game, including remaining defects and measured limitations.

The user requested implementation, use of lower-cost models where appropriate, tests, and a fresh analysis; subsequently requested this full plan be saved before further implementation. **The current action is planning only.** Preserve the interrupted implementation. Do not resume implementation just because this document exists.

This is the current execution update to Plan 018, not a parallel replacement engine. Use its verified baseline and work breakdown to correct stale progress claims in the original plan. Retain the original plan's architecture, gameplay, release and operator-acceptance constraints. Plans 013/016 remain superseded by 018. Narrow click-targeting, audio-startup, and importer-reproducibility fixes from the preceding review are explicit work items here, but do not automatically close all of Plans 012/014/015.

No deployment, push, merge, release tag, multiplayer, framework migration, balance redesign, or public publication is authorized by this plan. Human visual/GPU acceptance is a separate final gate. Missing human evidence must not prevent independent implementation, automated tests, or preparing reviewable captures.

## 2. Visual and gameplay targets

The result should read as a coherent Caribbean patrol environment: believable wave scale, sun glitter, vessel and island reflections, transparent turquoise shallows, depth-dependent underwater color, moving light on submerged surfaces, irregular foam around breaking waves and wakes, layered coastal terrain, detailed palms and ground cover moving with the wind, and convincing daylight/dusk/night transitions.

Realism must support play. The player submarine, contacts, weapons, targeting cues and tactical map must remain usable in every POV and weather condition. Do not hide broken rendering by forcing cameras above water, increasing emissive intensity every frame, lifting hulls independently of simulation, or reducing simulation frequency.

Keep these invariants:

- One application, one canvas, one renderer, one application-owned animation loop.
- CPU simulation owns positions, orders, collisions, damage, sonar, RNG, AI, outcomes and the fixed 60 Hz clock. GPU output is presentation-only.
- Sector remains 128 simulation units at 5 m/unit, 640 m across. Depth remains positive-down in simulation and 24 m per normalized depth unit.
- Same seed, world version and command stream produce identical gameplay regardless of ocean backend, graphics quality, FPS or device.
- Preserve all seven POVs: tactical, chase, bridge, periscope, free, map and sonar.
- Preserve existing controls, sticky orders, HUD selectors, assets, licenses, and old replay interpretation.
- Keep Gerstner/legacy-v1 startup until implementation and operator acceptance justify switching new-mission defaults. Allow explicit preview selection throughout.
- All production resources load locally. No CDN runtime imports or network dependency on the upstream demo.

## 3. Verified baseline and interrupted work

The September 12 review established these results **before the new drafts were integrated**:

| Check | Recorded result |
| --- | --- |
| Reproducible dependency install | Succeeded; the local Node 22.11 installation emitted engine warnings for ESLint dependencies |
| Typecheck, lint, tests, production build | Passed through `npm run verify` |
| Unit suite | 217 tests in 50 files passed, including deterministic replay and accelerated soak |
| Fleet validation | All 11 existing production models passed |
| Production bundle | Approximately 856 KB JavaScript before compression; build emitted a chunk-size warning |
| GitHub CI for baseline commit | Passed: run `34705640198` |
| Fleet importer | Failed with undeclared `@gltf-transform/functions`; required `artifacts/fleet-sources/sources.json` absent |
| Formatting | Failed in this Windows checkout; assess CRLF separately from genuine formatting differences |
| Local browser baseline | Initial attempt blocked by missing Playwright Chromium; installation was started, completion must be verified |
| GPU/visual acceptance | Not performed; no claim of comparison with upstream visual quality |

An accelerated deterministic soak is not a two-hour wall-clock gameplay or GPU-memory soak.

### Working-tree files to preserve and review

At plan creation, these are implementation drafts, **not verified delivered features**:

| Path | State / required review |
| --- | --- |
| `src/render/ocean/resources.ts` | Modified float-framebuffer capability check; review failure paths and mocks |
| `src/render/environment/sky-lighting.ts` | Untracked procedural outdoor PMREM draft; not connected to scene |
| `src/render/environment/vegetation.ts` | Untracked instanced foliage draft; inspect leaf geometry, wind/shadow consistency, culling and world placement |
| `src/render/ocean/foam.ts` | Untracked foam-history helpers; not wired into water rendering |
| `src/render/ocean/optics.ts` | Untracked reflection/refraction capture draft; verify clipping sign, cameras, render-state restoration and actual visible output |
| `src/render/ocean/surface-probes.ts` | Untracked asynchronous GPU probe draft; not integrated; reconcile with exact rendered displacement, stale requests and disposal |
| `src/render/ocean/surface.ts` | Untracked shared sampling draft written immediately before interruption; verify complete content |
| `tests/render/sky-lighting.test.ts` | Untracked focused tests; do not assume they ran or establish GPU correctness |

Lower-cost workers stopped due to usage limits. Do not infer completion from their proposed interfaces or messages. Inventory any additional files present at resume, preserve user edits, and inspect running preview/test processes before starting replacements. The previously started preview used port 8082 and may still serve the old `dist/`.

## 4. Source lineage and compatibility

Upstream reference: <https://github.com/iamtechartist/ocean-simulation>, pinned to `3f756c128f7775f76e9fc7e93ad2f4e825df4354` (MIT). The source is an HTML demo, not a packaged engine dependency. Reference checkout used during review: sibling `../ocean-simulation`.

Extract algorithms into owned TypeScript modules. Never iframe the demo, copy its UI/application loop, or silently update to upstream `main`. Preserve the MIT notice in shipped attribution and the source inventory. Record each extracted symbol, original hash, destination, intentional changes, coordinate assumptions and outstanding differences in `docs/release/ocean-integration.md`.

Use pinned Three.js and matching type declarations already in the project. Check installed source and official documentation when adapting shader chunks, depth conventions or async readback. Do not mix npm and CDN copies of Three.js.

Outdoor IBL may use either a properly staged local licensed HDR or an owned procedural HDR sky. Prefer the procedural path already drafted to avoid a new acquisition dependency. A procedural sky is a deliberate alternative, not a claim that the upstream HDR asset was imported. If adding external textures/HDR later, keep provenance, license, file size and SHA-256 in a versioned environment manifest. Do not loosen production CSP to fetch them at runtime.

## 5. Ownership and intended architecture

| Area | Modules / responsibilities |
| --- | --- |
| App composition and lifecycle | `src/app.ts`, `src/render/scene.ts`, `src/render/renderer.ts`; timing, diagnostics, context recovery, current-camera ordering |
| World authority | `src/game/world/**`, scoped callers in `src/game/sim/**`; versioned bed, navigation, footprint/draft, collision |
| Ocean simulation | `src/render/ocean/{spectral-backend,spectrum,coastal,resources,foam}.ts`; cascades, coastal input, histories and resource ownership |
| Shared visible surface | `src/render/ocean/surface.ts`; displacement, shore attenuation and sampling common to water, probes and caustics |
| Water appearance | `src/render/ocean.ts`; surface shader, capture sampling, color, foam, optical uniforms |
| Optical passes | `src/render/ocean/optics.ts`; reflection/refraction color and depth targets, camera matrices, clipping and membership |
| Underwater lighting | New `src/render/ocean/caustics.ts`; refracted-light projection and receiver integration |
| Surface and underwater effects | New `src/render/ocean/surface-effects.ts`; bounded spray, bubbles, wake/combat impulses and particulate |
| Fleet waterline | `src/render/ocean/surface-probes.ts`, new `src/render/presentation/vessel-attitude.ts`; asynchronous sampling and smoothed render transforms |
| World presentation | `src/render/{islands,seabed}.ts`, `src/render/environment/vegetation.ts`; shared bed, materials, wind and vegetation LOD |
| Lighting/weather | `src/render/{atmosphere,quality}.ts`, `src/render/environment/{weather,sky-lighting}.ts`; one sun/weather/quality authority |
| Evidence | `tests/**`, browser/FPS scripts, `.github/workflows/ci.yml`, release/state documents |

Render ordering must be explicit: advance fixed simulation; prepare world/weather and current entity transforms; update camera matrices; advance ocean histories if unpaused; submit batched probes; update due caustics; capture reflection/refraction with the current camera; render the main scene; render UI. A late probe may affect only a later presentation frame. Never sample a target while rendering into that same target.

## 6. Execution phases and exit criteria

### Phase A — Establish a reproducible candidate and baseline

1. Read `AGENTS.md`, this document, original Plan 018, current state, memory and release ledger. Reconcile discrepancies against actual source.
2. Save baseline commit, changed/untracked paths, hashes of relevant source/config files, tool versions and test logs under `artifacts/plan-018-upgrade/`. Exclude secrets, private staging assets and `.archive/`.
3. Use a supported, documented Node release; declare an engine requirement matching the locked tooling instead of the imprecise `Node 20+`. Do not upgrade unrelated dependencies to solve local PATH configuration.
4. Confirm dependency install, Chromium availability, typecheck, lint, formatting, tests and build. Attribute baseline failures correctly. Fix formatting narrowly with stable line-ending policy, not a repository-wide incidental rewrite.
5. Capture baseline populated patrol views and performance before the upgraded bundle replaces the old one. If original baseline was not captured, build an isolated copy from the recorded clean baseline without overwriting the active working tree.
6. Save seed 19/77 10,000-tick canonical gameplay outcomes and representative world samples. Keep legacy regression fixtures immutable.

Exit: reproducible baseline and clean attribution of failures. Existing test failures must be resolved or explicitly isolated before dependent changes proceed.

### Phase B — Make the world authoritative everywhere

1. Complete world-version propagation at construction, start/restart, host seed changes, waves, pickups, FOB, sonar/map and all terrain consumers.
2. Audit every use of `getTerrain`, `terrainHeight`, `isLand`, `snapToNavigable`, `isCrushedBySeamount`, `makeClear` and direct visual height sampling. Preserve exact legacy paths; route v2 callers through the canonical signed-metre field.
3. Upload v2's canonical high-resolution bed directly, with correct texel centers and bilinear sampling. Do not unnecessarily downsample to the legacy 128-cell grid and then claim 1 m shoreline fidelity. Fix edge interpolation if clamped sample indices disagree with GPU sampling.
4. Use the same field for terrain meshes, water coverage/depth, coastal solver, map shoreline, vegetation placement, pathfinding, spawns and collision. Preserve dry island footprints and convoy passages.
5. Navigation profiles include horizontal footprint and required water depth. Player radius is 0.35 simulation units; keel clearance is 1.6 m. Surface ships retain class footprint and a documented CPU draft. Enemy submarines use the explicit v2 cruise-depth contract of 0.35 consistently in navigation and presentation.
6. Autopilot plans for the greater of current/requested depth while descending, and current depth while ascending. Replan on profile changes; validate shortcuts and final segments. Unreachable orders produce stable messages/empty routes, not silent depth changes or exceptions escaping into the UI.
7. Sweep motion against the footprint; retain prior safe horizontal position on blockage. Resolve depth penetration in simulation and apply existing grounding damage once per attempted inward tick. Preserve invulnerability/FOB exemptions and zero-delta semantics.
8. Remove v2-only visual floor clamps once CPU behavior is verified. Bound decorative heave/roll against clearance without shifting authoritative hull position.

Exit: seeds 0–99 have legal starts, bases, pickups and wave spawns; surface/periscope/attack routes actually traverse to the existing required destinations; a reachable deep refuge is tested. Legacy replay results remain unchanged. Bed texture error is at most 0.1 m at tested texel centers and 0.25 m at tested interpolated coast points.

### Phase C — Complete spectral/coastal waves and persistent foam

1. Retain distinct long swell, wind-wave and short-detail cascades. Make wave gains, tile lengths, units and initial spectrum seed explicit.
2. Connect `buildCoastalField` to the active world. Cache by world version/seed/grid and incident swell direction; rebuild on relevant changes only. Stage expensive work outside the frame loop and swap completed fields atomically.
3. Consume coastal travel delay, wave direction and sheltered exposure in the water shader. Preserve fixed incident swell direction when weather changes local wind; do not rotate a stale travel field.
4. Use one shared surface function for combined displacement, shore attenuation, horizontal displacement inversion and normal calculation. Apply identical scale factors to probes and caustics. Remove disconnected heave multipliers and mismatched normal/displacement gains.
5. Bind the existing cascade foam-history channel into visible shading. Implement shoreline/surface foam advection, decay, sheltered-water behavior and bounded motion/combat impulses. Keep history targets ping-ponged and explicitly owned.
6. Reset histories on new mission/backend replacement; freeze evolution while paused. Discard background-tab catch-up debt. Initialization and fallback diagnostics must name the actual active backend.

Exit: a populated spectral patrol demonstrably renders evolving cascades, coastal behavior and persistent foam; pause freezes histories, restart clears them, backend fallback preserves the same mission. Shader compilation is verified by browser draws, not only unit/source-string tests.

### Phase D — Add real reflection and refraction

1. Finish `WaterOptics` with scene color/depth captures. Reflection includes appropriate sky, land, foliage and fleet; refraction includes underwater terrain, hulls and weapons.
2. Define membership by scene role. Exclude labels, range rings, pick volumes, tactical grid and UI cues. Ensure hot-swapped GLB descendants receive the same membership as fallback meshes.
3. Support perspective and orthographic cameras using their actual projection/inverse matrices. Keep one consistent standard-depth encoding; do not copy perspective FOV reconstruction into map view.
4. Reflect camera position, direction and up vector correctly across mean sea level. Verify clip-plane signs above and below water and at rough-water periscope crossings. Avoid an inverted, empty or incorrectly clipped reflection.
5. Bind capture textures and matrices into water shading. Distort UVs using surface normals, guard edges and invalid depth, reconstruct water-column distance, apply absorption and Fresnel reflectance, and avoid double tone mapping.
6. Track camera/projection, viewport/DPR/quality, world, lighting, entity-motion and visibility changes. Refresh moving-scene captures within a bounded maximum interval even with a stationary camera. Camera movement during pause may refresh optics without advancing waves.
7. Restore target, viewport, scissor, clear color/alpha, clipping, shadow update state, XR, tone mapping, and every temporarily hidden object in `finally`. Render targets must be cleared and initialized before first sampling.

Exit: moving vessels are present in reflection/refraction captures across all POVs; submerged hull/weapon visibility is proven in images and diagnostics; no feedback loops, WebGL errors, UI reflections, border smearing or persistent visibility mutations.

### Phase E — Project underwater light and add surface effects

1. Generate refracted-ray caustic illumination from the active surface field and sun direction. Project onto receiver depth using the canonical bed; compute concentration from ray/area changes rather than painting unrelated noise on the water.
2. Use bounded wide/detail caustic targets with quality-scaled resolution and cadence. Quantize follow regions to prevent orbit shimmer. Attenuate by depth, surface cover and storm/night conditions.
3. Attach caustic lighting to seabed, submerged rocks, submarine hulls and submerged weapons through composable material hooks. Preserve existing shader hooks/cache keys, color space, material reuse, normal maps and GLB load replacement.
4. Add bounded instanced spray at breaking crests and fast surface wakes, impact splashes from actual presentation events, and underwater particulate/bubbles where appropriate. Seed presentation randomness separately from gameplay RNG.
5. Underwater submarines must not produce permanent surface wakes. Expire effects, cap emitters/particles, reset mission state, pause histories and respect reduced-motion preferences.

Exit: caustics move on actual submerged receivers, align with wave/sun changes and diminish at depth/night. Effects are visible in populated combat captures and do not grow allocation counts across repeated engagements.

### Phase F — Synchronize vessel waterlines and camera immersion

1. Complete a batched asynchronous GPU probe queue using the exact rendered combined surface. Sample center/bow/stern/port/starboard for a bounded visible fleet, including player near the surface and the camera waterline where required.
2. Invert horizontal displacement to sample the displaced world location. Verify orientation/scale against known synthetic wave fields and browser measurements.
3. Tag results by entity ID, mission generation, backend generation, query time and position. Drop stale or despawned results. Keep at most one active readback per queue; reset must invalidate results without allowing unbounded overlapping requests or disposing in-use targets unsafely.
4. Smooth heave, pitch and roll with frame-rate-independent damping, bounded latency/extrapolation and a documented fallback. Derive attitude from sampled footprint, attenuate with submergence, and preserve fitted model waterline offsets.
5. Remove the current spectral `1.28` multiplier. GPU results must never enter `GameState`, AI, collision, damage, sonar, RNG or replay outcomes.
6. Stabilize immersion with sampled water height and hysteresis. Keep periscope, chase, bridge, free and map cameras usable; do not force the camera above crests to conceal transition problems.
7. Correct the nearby-ship click fallback: only select an actually hit or screen-proximate contact. Empty-water clicks must plot a waypoint even when a ship is close. Keep mean-sea-plane picking and HUD-origin input gating.

Exit: vessels float with the visible surface without obvious hovering/clipping in calm/storm; delayed/pending reads survive pause, restart, despawn and backend change; all input and camera regression journeys pass.

### Phase G — Complete outdoor lighting, terrain and vegetation

1. Replace static studio `RoomEnvironment` IBL with the local procedural sky PMREM or an explicitly staged licensed HDR solution. Keep lighting aligned with the existing sun, sky, horizon, clouds, time of day and storm state.
2. Bound PMREM refresh cadence; update on meaningful lighting changes. Avoid baking a lightning flash into lighting that persists seconds after the flash. Reset/dispose replaced targets and generator resources.
3. Balance direct, ambient and environment illumination in linear color space with a single final tone mapping/output conversion. Preserve night readability through intentional bounded settings, not cumulative emissive mutations.
4. Add terrain/sand/rock material variation, normals/roughness and a narrow wet-sand band using canonical elevations. Preserve island silhouettes and navigation; no decorative land over valid water.
5. Review and finish the foliage draft: nondegenerate tapered fronds/leaflets, varied canopy/shrub silhouettes, actual ground-cover blades, coherent placement heights and biome/density rules. Use seeded placement and instancing.
6. Animate wind with height-dependent trunk/frond/leaf motion and mild backlit leaf transmission. Apply matching deformation in depth/shadow passes; preserve shader hooks when adding caustics or lighting.
7. Use spatially meaningful vegetation LOD/culling and quality-scaled density. Avoid removing entire islands because instance ordering happens to group them last; do not cull world-space instances by a local geometry center.
8. Freeze wind history on pause and reduce sway/lightning/camera disturbances for reduced motion. Rebuild placement only on world/content changes, not every frame.

Exit: matched daylight/dusk/night and calm/storm captures show coherent outdoor lighting, detailed animated foliage and terrain-water agreement without detached shadows, disappearing islands or sustained GPU allocation.

### Phase H — Make quality, resource ownership and recovery real

1. One quality profile controls DPR, water geometry, FFT resolution/cadence, optics target scale/cadence, foam, caustics, particles, vegetation and shadows.
2. On runtime quality change, allocate/warm replacement FFT resources, rebind all consumers, atomically swap, then dispose old resources after pending consumers are safe. Merely changing water segments is insufficient.
3. Validate float framebuffer completeness and required filtering/readback paths on the actual renderer. Extension presence or WebGL2 alone is not proof. Fail gracefully to Gerstner with an explicit reason and unchanged world/game state.
4. Implement context loss/restoration: stop GL submission, show recoverable status, invalidate pending work, rebuild presentation resources and rebind loaded assets. Preserve mission state; offer explicit reload if recovery fails. Do not report ready until rebuild completes.
5. Restore all renderer state on successful and failed auxiliary passes. Dispose partial construction paths, stale asynchronous initialization, superseded textures/materials/targets, PMREM outputs and listeners.
6. Exercise at least 20 mission/backend cycles and 20 resize/quality cycles after warmup. Account for textures, geometries, programs and owned targets, including depth attachments/mipmaps. Counts must settle to bounded baselines; explain stable renderer caches.
7. Profile startup and bundle composition after functionality works. Split heavyweight optional rendering code only when measurement shows benefit and fallback/startup remain reliable. Do not hide size warnings by only raising thresholds.

Exit: requested and actual quality agree, target sizes/cost change as intended, forced quality stays fixed, recovery preserves gameplay, and repeated cycles show no accumulating owned resources.

### Phase I — Close the adjacent reproducibility and audio defects

These are bounded fixes from the earlier review, not permission to redesign audio or replace the fleet.

1. Declare the importer dependency it actually imports and update the lockfile reproducibly. Provide a tracked source-manifest contract outside ignored `artifacts/`, documenting how licensed source files are staged.
2. Make missing source inputs fail early with actionable messages. Validate the manifest before output mutation; support validation/dry-run so a clean-checkout test does not overwrite immutable GLBs. Never substitute existing output meshes as invented original provenance.
3. Test clean-install importer startup with a small licensed/project-owned fixture. Existing production assets remain byte-for-byte unchanged unless separately authorized new versioned outputs are required.
4. Fix audio bank readiness: if fallback ambient begins before authored banks decode, transition/crossfade to the loaded banks. Handle a late second ambient layer, pause/resume, mute, disposal and aborted/failed loading.
5. Add focused tests for first-patrol startup, delayed bank load and lifecycle. Existing fallback remains usable offline.

Exit: clean setup can validate/reproduce the documented pipeline with declared inputs, and delayed audio loading no longer leaves first-patrol ambience permanently on its fallback.

## 7. Test and evidence matrix

### Automated logic and component checks

Add behavioral tests where they detect real failures: world parity and route traversal; legacy replay invariance; shared surface sampling and displaced inversion; foam pause/reset; camera reflection and projection; render-state restoration after exceptions; resource replacement/disposal; stale probe rejection; sky refresh cadence; foliage geometry/wind-shadow inputs; click targeting; importer validation; audio readiness.

Mock tests establish contracts only. Source-string assertions, a nonempty path, a `ready` boolean, an HTTP 200, or a screenshot of empty water must never be the sole evidence for integrated correctness.

### Browser matrix

| Dimension | Required cases |
| --- | --- |
| Backend/world | Gerstner + legacy-v1 regression; spectral + legacy-v1; Gerstner + littoral-v2; spectral + littoral-v2 |
| Cameras | All seven POVs; perspective and orthographic; submerged free/chase; periscope surface crossing |
| Conditions | Day, dusk, night; calm, breeze, storm; reduced motion |
| Scene contents | Player and moving surface fleet; enemy sub; fired weapon; sink/impact; pickups/FOB; each island shoreline |
| Interaction | Start/tutorial, navigate, target/fire, pause/resume, restart/reentry, empty-water plotting near a contact |
| Quality/viewport | High/medium/low; 1440x900 and compact 1024x700; resize and DPR changes |
| Lifecycle | Delayed GLB/audio, pending probe restart, repeated backend changes, failed capability/init, context restoration |
| Offline/self-only | Block third-party requests, enter a populated patrol, verify all required local assets and fallbacks |

Use a bounded representative subset in normal CI, with a documented larger visual/lifecycle matrix for the candidate. Capture matching seeds, positions, camera matrices, weather, time, quality, backend/world and viewport for A/B review. Save before/after images and machine-readable reports under `artifacts/plan-018-upgrade/`; promote selected user-facing evidence to a documented release-review location.

Browser checks fail on uncaught errors, shader compile/link errors, invalid framebuffer operations, unexpected failed asset requests, backend mismatch and missing required visible scene content. Inspect screenshots manually as well as collecting them.

### Performance evidence

Extend `scripts/fps-bench.mjs` to implement, rather than merely document:

- `FPS_WARMUP_MS` (30,000 for acceptance) and `FPS_BENCH_MS` (at least 60,000).
- `PERF_AUTHORITATIVE=1`, rejecting software/unknown renderers and missing evidence.
- `PERF_HEADED=1`, without software-forcing flags; `PERF_QUALITY=high|medium` asserting actual quality/backend.
- Renderer/vendor/classification, browser/OS, viewport/DPR, world/seed, backend, fleet counts, calls/triangles, textures/geometries/programs, target dimensions/estimated bytes, optical update counts, median/p95/p99 frame times and all browser errors.

Reference scene: populated 1440x900 patrol after warmup. Test both backends on the same world and settings. High requires **p95 frame time <= 1000/55 ms**; medium requires **p95 <= 1000/30 ms**, as inherited from Plan 018. Average FPS alone cannot pass. Low is a usable fallback with measured results, not a substitute for the high acceptance bar.

Software rendering is directional evidence only. Identify hardware honestly and leave operator acceptance pending if the required hardware is unavailable. Do not change gameplay timing or silently lower locked quality to meet the threshold.

## 8. Commands and CI

Run from the repository with a supported Node runtime:

```sh
npm ci
npm run verify
npm run format:check
npm run assets:validate
npm run assets:validate:ocean
npm run build
npm run preview -- --host 127.0.0.1 --port 8082
```

In a separate terminal, once the built preview is ready:

```sh
npm run test:smoke -- http://127.0.0.1:8082/
npm run test:e2e -- http://127.0.0.1:8082/
npm run test:e2e:ocean -- http://127.0.0.1:8082/
npm run test:visual -- 'http://127.0.0.1:8082/?ocean=spectral&world=littoral-v2&quality=high'
```

Use shell-appropriate environment assignment for the performance flags; the old script does not yet implement all of them. Check argument handling before treating a command as coverage of a specific combination. Do not run mutating asset-import commands as a general verification step.

CI must install Chromium, run type/lint/unit/build and both asset validators, serve the production build, run smoke plus real patrol and ocean journeys, upload failure artifacts, and stop only the server it started. Add formatting to CI after the baseline formatting/line-ending discrepancy is resolved. Keep authoritative GPU performance in a separately configured hardware job; normal CI must not self-certify it.

## 9. Delegation and cost control

Use lower-cost models for bounded implementation or review where available. Suggested assignments: world queries/navigation; foliage and terrain materials; lighting module; test/tooling or documentation. Give each worker explicit file ownership and interface contracts. Do not allow concurrent edits to `scene.ts`, `ocean.ts`, `app.ts` or shared resource interfaces without coordination.

The lead integrates optical passes, shared surface/probes, lifecycle and camera behavior, reviews every worker diff, and runs the combined browser tests. Delegate a fresh review to a different worker after implementation if capacity permits. Review must be independent of author claims.

If lower-cost workers hit usage limits, record saved work and continue with the available model. Do not repeatedly spawn failing workers, wait for an assumed reset, or report untested partial modules as completed subsystems.

## 10. Fresh analysis and final handoff

After the final candidate passes its machine gates:

1. Re-read the final implementation, not the plan/checklist. Audit all original findings and new integration boundaries against running behavior.
2. Produce `docs/release/realism-upgrade-review.md` with candidate identity (commit plus dirty inventory if uncommitted), environment/tool versions, exact test results and artifact paths.
3. Give every original recommendation a status: implemented and verified; implemented with limited evidence; partial; or outstanding. Explain intentional alternatives such as procedural IBL versus imported HDR.
4. Report reproducible defects by severity with code locations, trigger, player impact and next action. Include remaining performance, visual, asset and lifecycle risks even if unit tests pass.
5. Compare baseline/candidate bundle size, startup, p95/p99 performance, GPU resource counts and representative images. Distinguish measurement from inference.
6. Update `tasks/state.md`, `memory/MEMORY.md`, roadmap and release ledger. Replace stale statements such as “spectral stubbed,” “coastal complete,” or “fleet importer reproducible” only with supported facts.
7. Present a playable candidate and matched views for operator review. Mark GPU performance, lighting/fleet visual acceptance and long human playthrough gates independently. Do not label the game production-ready based solely on this upgrade.

Only after machine checks and explicit operator visual/GPU acceptance should a separate, small activation change make spectral/littoral-v2 the new-mission defaults. Keep explicit legacy replay selection, Gerstner fallback and documented configuration rollback. Rerun browser regression after activation. Deployment, rollback rehearsal, two-hour wall-clock soak, production tag and multiplayer remain governed by their existing release plans.

## 11. Completion checklist

- [ ] A. Baseline, interrupted drafts, supported runtime and browser evidence reconciled.
- [ ] B. All v2 terrain consumers share authority; legacy replay and required routes pass.
- [ ] C. Coastal field, spectral surface and persistent foam are connected and verified.
- [ ] D. Actual scene reflection/refraction work across camera and immersion cases.
- [ ] E. Projected caustics and bounded spray/underwater effects work on real receivers.
- [ ] F. Fleet probes match the displayed water; picking and camera regressions pass.
- [ ] G. Outdoor IBL, terrain detail and animated foliage are integrated and reviewed.
- [ ] H. Runtime quality, resource cycles, fallback and context recovery pass.
- [ ] I. Importer reproducibility and delayed audio startup defects are resolved.
- [ ] Full unit/build/asset/format gates pass on the final combined candidate.
- [ ] Production-browser matrix and self-only startup pass; artifacts inspected.
- [ ] Hardware performance measured; operator visual/GPU acceptance recorded separately.
- [ ] Fresh analysis and current-state/release documents accurately describe the candidate.
- [ ] Defaults activated only after acceptance; rollback and legacy compatibility verified.

Writing this plan completes none of these implementation checkboxes.

## 12. Stop and recovery rules

Stop the dependent phase with a reproducible failure when source/license requirements cannot be met, legacy gameplay changes unexpectedly, shared-world routes require forbidden island/balance changes, a required POV becomes unusable, target costs cannot fit the measured budget, resource ownership cannot be made safe, or fallback cannot keep the existing patrol playable.

Continue independent authorized work where possible. Record failed hypotheses and the narrow unresolved decision rather than weakening assertions or inventing a pass. Preserve all user changes and archive contents. Do not reset, clean, delete unrelated files, force-push, publish or tag as a workaround.
