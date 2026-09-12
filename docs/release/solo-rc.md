# Solo Release Candidate — Silent Depths

**RC commit / tag:** `solo-rc` → `4480c3f`  
**Date:** 2026-08-02  
**Scope:** Solo offline Chromium/WebGL2. Co-op (Plan 009) deferred.  
**Claim level:** **Technical RC only** — not `solo-production`. Do not move or retag `solo-rc`.

## Acceptance summary

| Area | Status | Evidence |
|------|--------|----------|
| DX / CI / smoke / replay | PASS (automated) | Plan 001; `npm run verify`, `test:smoke` |
| Deterministic game domain | PASS (automated) | Plan 002; 10k-tick replay |
| First patrol loop | PASS (automated) | Plan 003; `tests/game/patrol.replay.test.ts` |
| Combat / FOB / waves / powerups | PASS (automated) | Plan 004; `tests/game/combat-progression.test.ts` |
| Sonar / AI / pathfinding / doctrine | PASS (automated) | Plan 005; soak + doctrine/sonar tests |
| Visuals / quality profiles | PASS* (automated + content caveats) | Plan 006; see gaps / Plans 015–016 |
| HUD / audio / tutorial / a11y | PASS (automated) | Plan 007 |
| Browser patrol journeys | PASS (automated, Plan 011) | `npm run test:e2e` enters patrol; not menu-only |
| Visual capture enter-patrol | PASS (machine capture, Plan 011) | `npm run test:visual` → `artifacts/visual/report.json` (`phase: playing`); screenshots are **human-review**, not visual PASS |
| Perf / ship gate | DIRECTIONAL* | Adaptive quality hysteresis; HUD throttle; fps-bench after Begin Patrol |
| GPU ≥55 FPS @ 1440×900 | **PENDING operator** | Must be GPU desktop Chromium; never record SwiftShader/llvmpipe as proof |
| Wall-clock 2h soak | **PENDING operator** | CI accelerated soak only |
| Deploy + rollback rehearsal | **PENDING operator** | Docs exist; live host not proven |
| Human playthroughs (×3) | **PENDING operator** | Required before `solo-production` |

\* Visual/content bar at `solo-rc` accepted procedural fallbacks; production fleet/audio continue in Plans 014–015.  
\* Headless agent FPS is directional only.

## Performance notes

- Target: ≥55 FPS high @ 1440×900; ≥30 FPS medium fallback on **GPU** desktop Chromium.
- `QualityGovernor` steps high→medium→low with hysteresis on frame-time EMA.
- HUD DOM rebuilds throttled to ~8 Hz; patrol overlay rebuilds only on phase/score change.
- Terrain heightfield cached by seed (`getTerrain`).
- Measure: `npm run test:perf -- <preview-url>` (clicks Begin Patrol first).
- Headless/llvmpipe agents may fail WebGL context creation; treat agent FPS as directional only — **not** GPU proof.

## Known gaps (P2 / deferred to 011–017)

1. Trustworthy in-patrol browser/visual gates — addressed by Plan 011 (machine).
2. Camera-correct world interaction — Plan 012.
3. Shared littoral heightfield / shoreline — Plan 013.
4. Authored audio lifecycle — Plan 014.
5. Distinct licensed fleet assets — Plan 015 (**partial 2026-08-04:** class-distinct `models/v2` + pipeline; operator silhouette accept open).
6. Water effects within GPU budget — Plan 016.
7. Operator visual/GPU/soak/deploy + `solo-production` tag — Plan 017 only.

## Build / run / rollback

```bash
npm ci
npm run verify
npm run build
npm run preview   # serves dist on :8080 with --strictPort
```

Rollback: `git checkout <previous-sha>` and rebuild. Primary technical RC tip: tag `solo-rc` at the Plan 008 completion commit (`4480c3f`). Do not rewrite history or move that tag.

## Soak note

Full wall-clock two-hour soak is **operator-run** and remains unproven. CI covers the accelerated 30-minute deterministic soak (`tests/game/soak.test.ts`) plus 10k-tick replay and command fuzz.
