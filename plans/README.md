# Silent Depths implementation plans

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

| # | Finding | Impact | Effort | Risk | Evidence |
|---|---------|--------|--------|------|----------|
| 1 | Establish a production verification and agent workflow | Every large port currently relies on four unit-test files; there is no lint, browser smoke, deterministic replay, CI, or Git drift signal | M | LOW | `package.json:7-14`, `tests/sim.test.ts:20-153`; archived `scripts/browser-smoke.mjs:14-41` and `scripts/fps-bench.mjs:3-45` are reusable patterns |
| 2 | Replace the look-dev state with the full deterministic game contract | Current state models one sub and three looping contacts, while the PRD requires phases, weapons, damage, AI, waves, stats, sonar, FOB, and persistence | L | HIGH | `src/core/types.ts:70-106`, `src/core/sim.ts:64-125`; archived `src/game/types.ts:1-260` and `src/game/engine.ts:246-1273` contain the prior contract |
| 3 | Reconcile simulation coordinates, terrain, and rendering | The prototype uses meters and an effectively unbounded following scene; the PRD uses a 96-unit sector, normalized depth, land collision, and seeded navigation | L | HIGH | `src/core/types.ts:70-84`, `src/render/scene.ts:139-220`; `docs/prd.md` sections 3 and 18 |
| 4 | Port gameplay by subsystem, not by copying the archived monolith | The archive proves behavior but concentrates the game loop in a roughly 1,200-line engine; copying it would make correctness and network ownership hard to test | L | MED | archived `src/game/engine.ts:246-1273`; reusable subsystem seams exist in `pathfinding.ts`, `sonar.ts`, and `autopilot.ts` |
| 5 | Turn the renderer from a fixed diorama into an entity/VFX pipeline | Scene ownership is hard-coded to one destroyer and two merchants, with procedural placeholder vessels and only three cameras | L | MED | `src/render/scene.ts:16-69`, `src/render/cameras.ts:25-102`; `docs/prd.md` section 8 |
| 6 | Build the complete command UI and onboarding around gameplay truth | Current HUD is presentation telemetry; launch requires the 11 panels/controls and 11-step tutorial without intent flicker | L | MED | `src/input/controls.ts:30-103`, `README.md:36-65`; archived `GameHUD.tsx:16-733` and `TutorialOverlay.tsx:31-546` provide behavior references |
| 7 | Make performance a continuous acceptance gate | Current renderer fixes water at 200 segments and DPR at 1.75 but has no adaptive quality, LOD, GPU timing, or automated scene benchmark | M | MED | `src/render/renderer.ts:3-34`, `src/render/scene.ts:37-68`; `docs/prd.md` sections 8.8 and 20 |
| 8 | Keep multiplayer behind the solo launch gate | The archived P2P/signaling code is substantial and operationally risky; bringing it forward early would slow core gameplay and visual polish | L | HIGH | archived `src/game/net.ts:17-834`, `src/lib/multiplayer/p2p.ts:12-563`; user decision: co-op desired, not launch-blocking, max 10 |

## Execution order and status

| Plan | Title | Priority | Solo effort | Depends on | Status |
|------|-------|----------|-------------|------------|--------|
| 001 | Establish the production and Cursor execution baseline | P1 | 2–4 days | — | DONE |
| 002 | Build the deterministic game-domain foundation | P1 | 1–2 weeks | 001 | DONE |
| 003 | Deliver the first complete patrol vertical slice | P1 | 2–3 weeks | 002 | DONE |
| 004 | Complete weapons, damage, FOB, powerups, waves, and outcomes | P1 | 2–3 weeks | 003 | DONE |
| 005 | Complete sonar, enemies, ASW, aircraft, navigation, and doctrine AI | P1 | 2–4 weeks | 004 | DONE |
| 006 | Raise the Three.js world to production visual quality | P1 | 3–6 weeks | 003; parallel after interfaces settle | DONE |
| 007 | Complete HUD, controls, audio, tutorial, and accessibility | P1 | 2–4 weeks | 004, 005, 006 | DONE |
| 008 | Harden, balance, optimize, and ship the solo game | P1 | 2–4 weeks | 005, 006, 007 | TODO |
| 009 | Add optional host-authoritative co-op for up to 10 players | P2 | 3–6 weeks | 008 | TODO |

Estimated solo launch range: roughly 14–26 focused weeks, driven mainly by asset quality, balancing, browser QA, and content iteration rather than typing speed. Cursor can compress implementation time, but not the visual review, playtesting, asset licensing, or balance gates. Co-op adds roughly 3–6 weeks after solo launch readiness.

## Dependency notes

- Plan 001 is mandatory before large edits because all later plans depend on reliable drift checks and one-command verification.
- Plan 002 defines the only authoritative state and command contracts. Render, UI, replay, and networking must consume them.
- Plan 003 is the tracer bullet: one complete start-to-sink-to-result patrol before broad feature parity.
- Plans 004 and 005 deepen gameplay. Plan 006 may run in parallel only after Plan 003's renderer snapshot interface is frozen.
- Plan 007 starts after gameplay commands/events stabilize to avoid rebuilding the HUD around moving contracts.
- Plan 008 is a release gate, not a cleanup bucket. Do not begin co-op while any P1 acceptance item is open.
- Plan 009 may reuse concepts from the archive, but its protocol must be rebuilt against the new deterministic command/snapshot model and capped at 10 peers.

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
6. **Solo launch:** ≥55 FPS at the desktop reference scene, no P0/P1 defects, clean Chromium smoke/replay soak, and deploy rollback tested.
7. **Co-op beta:** 2/4/10-player soak, late join, host migration, recovery, protocol fuzz/validation, and hostile-network failure handling pass.

## Considered and rejected

- **Copy the archived project over the prototype:** rejected. It would restore feature volume quickly but also restore the old presentation architecture and a monolithic engine, undermining the Three.js rebuild.
- **Adopt FFT/SPH water now:** rejected. The PRD explicitly accepts Gerstner/FFT, and the current shader already proves the transparent Caribbean direction; shoreline masking and depth cues have higher leverage.
- **Start with multiplayer:** rejected. The user explicitly made co-op non-blocking, and deterministic solo gameplay is the prerequisite for trustworthy replication.
- **Ship the procedural placeholder fleet:** rejected for final quality. It is suitable for gameplay development but not the PRD's vessel-recognition and realism bar.
- **Target mobile parity before desktop launch:** rejected for the current scope. Maintain responsive UI and avoid desktop-only APIs, but prioritize the explicit Chromium/GPU target.
