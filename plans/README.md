# Silent Depths implementation plans

## Action gameplay follow-up (2026-09-26)

[Plan 023: action gameplay and production readiness](023-action-gameplay-and-production-readiness.md)
is **PLANNED**, following the independent review of `ddd4281`. Priorities: trustworthy
escape/combat rules, one focused action mission, readable presentation, and verified
release gates. Implementation has not started; existing operator gates remain pending.
The older integration direction below is historical context, not evidence that those
gates have passed.

## Current integration direction (2026-09-12)

**Current execution update:** [Complete realism upgrade](018-realism-upgrade-execution.md).  
**Finish remaining gaps:** [018 finish gaps](018-finish-gaps.md) — machine close, full browser
matrix, visual PNG inspection, operator STOP before **world** default and GPU/fleet ACCEPT.  
**Next selected plan:** [019 demo-look water first](019-demo-look-water-first.md) — local Kloofendal
HDR, spectral empty-URL default, accept on bridge + tactical shallows. Do not start 019 in
the same session as 018. World stays `legacy-v1`. Art pass is Plan 020 if still not close.

The September 12 review found that the spectral foundation exists but optics,
coastal coupling, projected lighting, animated foliage, vessel probes and runtime
resource scaling remain incomplete. Machine candidate work is largely wired;
`018-finish-gaps.md` closes foam/optics/matrix/cycles/foliage proof and forbids
self-approved operator gates.

The operator requested a complete, executable plan to integrate
[`iamtechartist/ocean-simulation`](https://github.com/iamtechartist/ocean-simulation)
into Silent Depths. **[Plan 018](018-ocean-world-engine-integration.md) is the
integration track** (IN PROGRESS, machine close via `018-finish-gaps.md`).
**[Plan 019](019-demo-look-water-first.md) is IN PROGRESS** (spectral default + local HDR IBL in tree):
water-first look-match with local HDR and spectral empty-URL default. World stays `legacy-v1`.

Execute only one plan per session. 018 replaced the implementation scope of 013
and 016. Keep those old documents as historical reference; do not execute them
as parallel alternatives. Plans 012, 014 and 015 retain their independent
responsibilities. The release path is accepted 018 plus completed 012/014/015 →
017 → 009. Existing machine and operator gates are not waived. Plan 019 may
change the ocean URL default; it must not flip the world default or self-approve
GPU/fleet ACCEPT.

Generated on 2026-08-02 from `docs/prd.md`, the current Three.js look-development prototype, and the preserved `.archive/silent-depths-project.zip`. These plans are written for Cursor Agent to execute one at a time. The archive is reference material only and must never be modified.

Plan 001 established local Git. Drift checks for later plans should use commit `c6c344dbf0d2267c551249ed110bd94601a6500b` (baseline) plus subsequent history; `plans/BASELINE.sha256` remains the pre-Git snapshot record.

## Product decisions used by every plan

- Solo play is the launch-critical product. Co-op is a post-launch milestone and must not delay the solo release.
- Co-op supports at most 10 players, uses friendly fire off, and retains host-authoritative AI.
- Desktop Chromium/WebGL2 with a GPU is the launch target. Mobile is compatibility work after the desktop quality bar unless the operator explicitly reprioritizes it.
- Tactical is the default POV. Preserve the PRD's arcade-readable numbers and sticky speed/depth intent.
- The visual target is realistic Caribbean littoral: transparent turquoise water, readable underwater terrain/submarines, surface vessels, beaches, foliage, mountains, and mostly realistic daylight.
- Use a mixed asset pipeline: procedural water/terrain/foliage foundation plus optimized licensed or custom glTF vessels, aircraft, weapons, FOB, and hero props.
- Keep simulation deterministic and independent of Three.js. Rendering consumes snapshots and emits commands; it does not own gameplay truth.
- Do not migrate to React/TanStack/auth before the solo launch gate. Reconsider the archived shell only in Plan 009, when networking needs routes and signaling.

## Audit summary

| #   | Finding                                                              | Impact                                                                                                                                                          | Effort | Risk | Evidence                                                                                                                                              |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Establish a production verification and agent workflow               | Every large port currently relies on four unit-test files; there is no lint, browser smoke, deterministic replay, CI, or Git drift signal                       | M      | LOW  | `package.json:7-14`, `tests/sim.test.ts:20-153`; archived `scripts/browser-smoke.mjs:14-41` and `scripts/fps-bench.mjs:3-45` are reusable patterns    |
| 2   | Replace the look-dev state with the full deterministic game contract | Current state models one sub and three looping contacts, while the PRD requires phases, weapons, damage, AI, waves, stats, sonar, FOB, and persistence          | L      | HIGH | `src/core/types.ts:70-106`, `src/core/sim.ts:64-125`; archived `src/game/types.ts:1-260` and `src/game/engine.ts:246-1273` contain the prior contract |
| 3   | Reconcile simulation coordinates, terrain, and rendering             | The prototype uses meters and an effectively unbounded following scene; the PRD uses a 96-unit sector, normalized depth, land collision, and seeded navigation  | L      | HIGH | `src/core/types.ts:70-84`, `src/render/scene.ts:139-220`; `docs/prd.md` sections 3 and 18                                                             |
| 4   | Port gameplay by subsystem, not by copying the archived monolith     | The archive proves behavior but concentrates the game loop in a roughly 1,200-line engine; copying it would make correctness and network ownership hard to test | L      | MED  | archived `src/game/engine.ts:246-1273`; reusable subsystem seams exist in `pathfinding.ts`, `sonar.ts`, and `autopilot.ts`                            |
| 5   | Turn the renderer from a fixed diorama into an entity/VFX pipeline   | Scene ownership is hard-coded to one destroyer and two merchants, with procedural placeholder vessels and only three cameras                                    | L      | MED  | `src/render/scene.ts:16-69`, `src/render/cameras.ts:25-102`; `docs/prd.md` section 8                                                                  |
| 6   | Build the complete command UI and onboarding around gameplay truth   | Current HUD is presentation telemetry; launch requires the 11 panels/controls and 11-step tutorial without intent flicker                                       | L      | MED  | `src/input/controls.ts:30-103`, `README.md:36-65`; archived `GameHUD.tsx:16-733` and `TutorialOverlay.tsx:31-546` provide behavior references         |
| 7   | Make performance a continuous acceptance gate                        | Current renderer fixes water at 200 segments and DPR at 1.75 but has no adaptive quality, LOD, GPU timing, or automated scene benchmark                         | M      | MED  | `src/render/renderer.ts:3-34`, `src/render/scene.ts:37-68`; `docs/prd.md` sections 8.8 and 20                                                         |
| 8   | Keep multiplayer behind the solo launch gate                         | The archived P2P/signaling code is substantial and operationally risky; bringing it forward early would slow core gameplay and visual polish                    | L      | HIGH | archived `src/game/net.ts:17-834`, `src/lib/multiplayer/p2p.ts:12-563`; user decision: co-op desired, not launch-blocking, max 10                     |

## Execution order and status

| Plan | Title                                                               | Priority | Solo effort                            | Depends on                                                           | Status                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------- | -------- | -------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001  | Establish the production and Cursor execution baseline              | P1       | 2–4 days                               | —                                                                    | DONE                                                                                                                                                                                                             |
| 002  | Build the deterministic game-domain foundation                      | P1       | 1–2 weeks                              | 001                                                                  | DONE                                                                                                                                                                                                             |
| 003  | Deliver the first complete patrol vertical slice                    | P1       | 2–3 weeks                              | 002                                                                  | DONE                                                                                                                                                                                                             |
| 004  | Complete weapons, damage, FOB, powerups, waves, and outcomes        | P1       | 2–3 weeks                              | 003                                                                  | DONE                                                                                                                                                                                                             |
| 005  | Complete sonar, enemies, ASW, aircraft, navigation, and doctrine AI | P1       | 2–4 weeks                              | 004                                                                  | DONE                                                                                                                                                                                                             |
| 006  | Raise the Three.js world to production visual quality               | P1       | 3–6 weeks                              | 003; parallel after interfaces settle                                | DONE                                                                                                                                                                                                             |
| 007  | Complete HUD, controls, audio, tutorial, and accessibility          | P1       | 2–4 weeks                              | 004, 005, 006                                                        | DONE                                                                                                                                                                                                             |
| 008  | Harden, balance, optimize, and ship the solo game                   | P1       | 2–4 weeks                              | 005, 006, 007                                                        | DONE (`solo-rc` technical RC; operator GPU/soak/deploy/playthrough unproven)                                                                                                                                     |
| 010  | Close the solo production bar (initial balance/content/AI work)     | P1       | 3–6 weeks                              | 008                                                                  | IN PROGRESS — completion split into 011–017 after audit                                                                                                                                                          |
| 011  | Make browser and release gates prove real gameplay                  | P1       | 2–4 days                               | 010 worktree preserved                                               | DONE                                                                                                                                                                                                             |
| 012  | Make plotting and firing camera-correct                             | P1       | 2–4 days                               | 011                                                                  | **DONE (machine)** — water-plane plot + point/entity aim; patrol E2E targeting journey; operator visual still n/a                                                                                                |
| 013  | Make water, shorelines, and terrain share one heightfield           | P1       | 4–7 days                               | 011                                                                  | SUPERSEDED BY 018 — original Gerstner implementation retained as reference                                                                                                                                       |
| 014  | Make authored audio load, transition, and mix correctly             | P1       | 3–5 days + content review              | 011                                                                  | **IN PROGRESS** — load/crossfade/engine + Chromium mute/unlock; operator listen PENDING                                                                                                                          |
| 015  | Ship distinct, licensed, versioned fleet assets                     | P1       | 1–3 weeks                              | 011; shoreline acceptance via 018                                    | **IN PROGRESS** — delayed-GLB E2E green; operator silhouette ACCEPT still PENDING                                                                                                                                |
| 016  | Make water effects scale to the GPU budget                          | P1       | 4–8 days + GPU run                     | 013, 015 (historical)                                                | SUPERSEDED BY 018 — GPU thresholds and operator proof retained                                                                                                                                                   |
| 018  | Integrate the spectral ocean and a shared world into Silent Depths  | P1       | Multiple weeks + GPU/visual acceptance | 011 + existing 015 pipeline; no fleet sign-off prerequisite to start | IN PROGRESS — `018-finish-gaps.md` machine complete (operator STOP); GPU/lighting/fleet PENDING; **world** default remains `legacy-v1`; ocean default moves in 019; see `docs/release/realism-upgrade-review.md` |
| 019  | Demo-look water first (local HDR + spectral default)                | P1       | Days + headed look-report              | 018 machine close; operator approved water-first look-match          | **IN PROGRESS** — spectral default + local HDR; look-report closer (bridge + cay shallows); world still `legacy-v1`                                                                                              |
| 020  | Island / foliage art pass                                           | P1       | Hours                                  | 019 water close                                                      | **IN PROGRESS** — olive cay + palms; not demo-island copy; operator lighting still PENDING                                                                                                                       |
| 017  | Polish and release the solo production build                        | P1       | 4–10 days                              | 011, 012, 014, 015, accepted 018                                     | TODO — operator soak/GPU/tag; do not self-approve                                                                                                                                                                |
| 009  | Add optional host-authoritative co-op for up to 10 players          | P2       | 3–6 weeks                              | 017                                                                  | TODO                                                                                                                                                                                                             |

Historical estimate before Plan 018 (not an estimate for the revised integration track): roughly 3–6 focused weeks,
with licensed asset acquisition and operator QA as the long poles. Co-op (009) adds ~3–6 weeks
only after Plan 017's production tag.

## Dependency notes

- Plan 001 is mandatory before large edits because all later plans depend on reliable drift checks and one-command verification.
- Plan 002 defines the only authoritative state and command contracts. Render, UI, replay, and networking must consume them.
- Plan 003 is the tracer bullet: one complete start-to-sink-to-result patrol before broad feature parity.
- Plans 004 and 005 deepen gameplay. Plan 006 may run in parallel only after Plan 003's renderer snapshot interface is frozen.
- Plan 007 starts after gameplay commands/events stabilize to avoid rebuilding the HUD around moving contracts.
- Plan 008 produced `solo-rc` with documented P2 content gaps.
- Plan 010 contains the first balance, glTF packaging, audio-bank, convoy, and deployment-doc work.
  The independent audit found that several completion claims were not supported, so Plans 011–017
  are the authoritative finishing sequence.
- Plan 011 must land first because later browser/visual evidence depends on real in-patrol gates.
- Plans 012 and 014 may proceed independently after 011. Plan 015 has a **partial**
  machine pipeline under `models/v2` (2026-08-04); closing 015 still wants operator class
  accept and a delayed-load browser test. Plan 018 can start using that existing pipeline
  without waiting for fleet sign-off. Full littoral production now requires 018's shared-world,
  optical, shoreline and performance acceptance. Do not create a circular dependency between
  015's content acceptance and 018's implementation: both must be accepted before 017.
- Plans 013 and 016 are superseded by 018 on the selected track. Their historic no-FFT
  restrictions do not constrain execution of 018; their useful acceptance criteria are carried
  into 018. Do not mark the superseded plans DONE or treat their replacement as a waiver.
- Plan 017 is the only place operator visual acceptance, GPU proof, wall-clock soak, deploy,
  rollback, and the production tag may be closed.
- Plan 019 is a water-first look-match against the pinned ocean-simulation demo. It may
  flip the **ocean** empty-URL default to spectral (rollback `?ocean=gerstner`) and stage a
  local CC0 HDR. It must not flip the **world** default, copy the demo island, or self-approve
  GPU/fleet ACCEPT. Island/art restyle is a later 020 if 019 is still not close.
- Plan 009 may reuse archive concepts but must rebuild against the deterministic command/snapshot
  model, capped at 10 peers, and cannot start before 017 is DONE.

## Cursor Agent operating loop

Execute exactly one plan per Cursor session:

```bash
cursor-agent -p --force --trust "Read plans/001-production-baseline.md completely. Execute only that plan. Honor every scope boundary, verification gate, and STOP condition. Update plans/README.md when done, but do not push or publish anything."
```

For the next plan, replace the filename. Use `--continue` only to correct the current milestone; start a fresh session for a new milestone. After Cursor reports completion, the operator/reviewer must inspect the diff, run the plan's full verification commands independently, and perform the named visual/playtest gate before marking it DONE.

## Release gates

1. **Engineering baseline:** deterministic tests, browser smoke, lint/typecheck/build, CI, and drift protection are green.
2. **First playable:** menu → patrol → navigate → acquire → fire → sink → result → restart works without debug controls.
3. **Combat complete:** every PRD weapon, damage source, FOB behavior, pickup, wave, and win/lose rule is covered.
4. **Threat complete:** sonar, thermocline, all ship classes, aircraft, ASW, pathfinding, and doctrine AI behave correctly.
5. **Visual/content complete:** production assets, all POVs, shore interaction, VFX, audio, HUD, tutorial, and accessibility are accepted.
6. **Solo RC:** `solo-rc` tagged (Plan 008) with documented P2 gaps.
7. **Solo production bar:** Plan 010 track, with 018 replacing 013/016 — trustworthy gates, correct interaction/shoreline/audio,
   accepted fleet, GPU FPS proof, visual polish, deploy/rollback, and operator soak.
8. **Co-op beta:** Plan 009 — 2/4/10-player soak, late join, host migration, recovery, protocol fuzz/validation.

## Considered and rejected

- **Copy the archived project over the prototype:** rejected. It would restore feature volume quickly but also restore the old presentation architecture and a monolithic engine, undermining the Three.js rebuild.
- **Adopt FFT/SPH water now (historical decision):** the initial roadmap rejected this in
  favor of shoreline repair. **Revisited for FFT by operator request on 2026-09-11:** Plan 018
  evaluates and integrates pinned upstream spectral water while also completing shared terrain,
  depth/readability and measured performance. SPH remains out of scope. FFT default activation
  requires the plan's actual gameplay, GPU and operator visual evidence.
- **Start with multiplayer:** rejected. The user explicitly made co-op non-blocking, and deterministic solo gameplay is the prerequisite for trustworthy replication.
- **Ship the procedural placeholder fleet:** rejected for final quality. It is suitable for gameplay development but not the PRD's vessel-recognition and realism bar.
- **Target mobile parity before desktop launch:** rejected for the current scope. Maintain responsive UI and avoid desktop-only APIs, but prioritize the explicit Chromium/GPU target.

## Follow-up visual review — 2026-09-13

[Plan 021: vessel motion corrections and reference parity](021-visual-correction-and-reference-parity.md) machine A–F landed (`docs/release/plan-021-review.md`). Operator GPU/lighting/fleet/soak ACCEPT still pending.

## Production action pass — 2026-09-26

[Plan 022: production action pass](022-production-action-pass.md) machine work is landed (see `tasks/state.md`). Operator gates stay PENDING.
