# Plan 008: Harden, balance, optimize, and ship the solo game

> **Executor instructions:** This is a release gate, not permission for feature expansion. Fix only issues needed to satisfy measured acceptance criteria. Produce a release-candidate report and rollback instructions.
>
> **Drift check:** require all P1 plan rows 001–007 to be DONE and a clean worktree before starting.

## Status

- **Priority:** P1
- **Effort:** L (2–4 weeks)
- **Risk:** MED
- **Depends on:** Plans 005, 006, 007
- **Category:** performance, correctness, release, docs
- **Planned at:** 2026-08-02 planning snapshot
- **Outcome:** Technical RC tagged `solo-rc` (→ `4480c3f`). Not `solo-production`.
  Operator GPU FPS, wall-clock soak, human playthroughs, deploy/rollback rehearsal,
  and visual acceptance remain **unproven** (see Plans 011–017 and `docs/release/`).

## Why this matters

Feature completeness is not launch readiness. The game must survive long sessions, maintain the target frame rate, communicate failures, preserve settings/tutorial state, and deploy reproducibly before optional co-op work begins.

## Scope

**In scope:** full PRD checklist audit; deterministic soak/fuzz/replay; balance passes; GPU/CPU/memory profiling; quality hysteresis; loading/error handling; save/settings migration; Chromium compatibility; production security headers for a static game; analytics/crash reporting only if privacy-minimal and explicitly approved; deployment/rollback docs; release candidate build.

**Out of scope:** co-op/auth/signaling, new campaign content, mobile performance guarantee, unplanned monetization/telemetry, major art-direction changes.

## Steps and gates

1. **Parity matrix:** convert PRD sections 3–17 and section 20 into a machine/human acceptance matrix linking each requirement to test, replay, E2E, benchmark, or explicit manual gate. Zero silent “not implemented” items.
2. **Correctness hardening:** fuzz commands and dt boundaries; run repeated seeds; test pause/restart/settings migrations; 2-hour real-time and accelerated soaks; ensure finite values, bounded entities/resources, and replay hashes.
3. **Balance:** instrument time-to-first-contact, sink rate, damage sources, FOB usage, ammo economy, wave difficulty, and mission completion. Tune data constants only, preserve PRD numbers unless the owner approves a documented change.
4. **Performance:** profile reference scenes on GPU-enabled Chromium. Meet ≥55 FPS high at 1440×900 and ≥30 FPS medium fallback, with p95 frame time and memory budgets recorded. Fix allocation hot paths, LOD, shader/texture costs, and draw calls based on evidence.
5. **Compatibility/accessibility:** current stable Chromium plus one previous version, context loss/recovery, resize/fullscreen, keyboard/mouse, reduced motion, audio unlock, and 1024×700 layout.
6. **Production build/deploy:** choose and document the solo static Vite deploy path, cache headers, CSP, asset hashing, source-map policy, health/smoke check, version stamp, and rollback. Do not introduce server/auth dependencies.
7. **Release candidate:** freeze features, run complete gates twice from clean installs, perform three human playthroughs with different mission flavors, triage all P0/P1 defects, and write `docs/release/solo-rc.md`.

## Verification

- `npm ci && npm run verify && npm run test:e2e && npm run test:visual && npm run test:perf` all exit 0.
- `npm run test:soak` completes with no divergence, non-finite state, or unbounded resource growth.
- Production URL smoke passes after deploy and after rollback rehearsal.

## Done criteria

- [x] Launch-critical PRD matrix covered by automated tests or explicitly documented deferrals (`docs/release/solo-rc.md`).
- [ ] **Unproven (operator GPU):** ≥55 FPS desktop high at 1440×900; ≥30 FPS medium fallback. Headless/SwiftShader numbers are directional only — not GPU proof.
- [x] Accelerated deterministic soak + multi-seed replay/fuzz suite pass (`npm run test:soak`, replay/fuzz tests).
- [ ] **Unproven (operator):** wall-clock two-hour soak.
- [x] No open P0/P1 defects recorded at `solo-rc` tag time; known P2s documented with workarounds/rationale.
- [x] Clean install/build path documented; static `dist/` is the shippable artifact.
- [ ] **Unproven (operator):** production deploy + rollback rehearsal against a live host.
- [ ] **Unproven (operator):** three human playthroughs (stealth / loud / FOB).
- [x] Technical solo RC (`solo-rc`) ships offline without networking, auth, or a backend — **not** a `solo-production` claim.

## STOP conditions

- Meeting performance requires silently reducing the accepted visual quality bar.
- A PRD requirement lacks an objective acceptance method.
- Deployment needs secrets committed to the client or repository.
- A P0/P1 is waived without explicit owner approval.

## Maintenance notes

Archive benchmark reports with hardware, browser, resolution, quality preset, seed, and scene. Plan 009 starts from the production tag (Plan 017), not from the technical `solo-rc` alone. Plans 011–017 close trustworthy gates, content, and operator acceptance.
