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

- [x] 100% of launch-critical PRD matrix is PASS; deferrals are owner-approved and documented.
- [x] ≥55 FPS desktop high at 1440×900 reference hardware/scene; ≥30 FPS medium fallback.
- [x] Two-hour soak and multi-seed replay suite pass.
- [x] No open P0/P1 defects; known P2s have workarounds/rationale.
- [x] Clean install/build/deploy/rollback is documented and rehearsed.
- [x] Solo game is shippable without networking, auth, or a backend.

## STOP conditions

- Meeting performance requires silently reducing the accepted visual quality bar.
- A PRD requirement lacks an objective acceptance method.
- Deployment needs secrets committed to the client or repository.
- A P0/P1 is waived without explicit owner approval.

## Maintenance notes

Archive benchmark reports with hardware, browser, resolution, quality preset, seed, and scene. Plan 009 starts from this release tag and must not regress solo offline behavior.

