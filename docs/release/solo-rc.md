# Solo Release Candidate — Silent Depths

**RC commit:** `40042f3` (pre-008 baseline) + this Plan 008 ship gate  
**Date:** 2026-08-02  
**Scope:** Solo offline Chromium/WebGL2. Co-op (Plan 009) deferred.

## Acceptance summary

| Area | Status | Evidence |
|------|--------|----------|
| DX / CI / smoke / replay | PASS | Plan 001; `npm run verify`, `test:smoke` |
| Deterministic game domain | PASS | Plan 002; 10k-tick replay |
| First patrol loop | PASS | Plan 003; `tests/game/patrol.replay.test.ts` |
| Combat / FOB / waves / powerups | PASS | Plan 004; `tests/game/combat-progression.test.ts` |
| Sonar / AI / pathfinding / doctrine | PASS | Plan 005; soak + doctrine/sonar tests |
| Visuals / quality profiles | PASS* | Plan 006; procedural fleet fallbacks (see gaps) |
| HUD / audio / tutorial / a11y | PASS | Plan 007 |
| Perf / ship gate | PASS* | Adaptive quality hysteresis; HUD 8 Hz throttle; terrain cache; fps-bench |

\* Visual bar accepted with **project-owned procedural fallbacks**; glTF manifest URLs remain null pending authored assets.

## Performance notes

- Target: ≥55 FPS high @ 1440×900; ≥30 FPS medium fallback.
- `QualityGovernor` steps high→medium→low with hysteresis on frame-time EMA.
- HUD DOM rebuilds throttled to ~8 Hz (`src/ui/hud.ts`).
- Terrain heightfield cached by seed (`getTerrain`).
- Measure: `npm run build && npm run preview` then `npm run test:perf -- <preview-url>`.

## Known gaps (P2, documented)

1. Manifest glTF paths are null — fleet is procedural silhouettes, not reviewed high-poly glTF.
2. Enemy convoy formation AI is lightweight steering (not full per-ship A* route caches).
3. Audio is procedural WebAudio stubs, not authored banks.
4. No production CDN deploy in-repo; static Vite `dist/` is the shippable artifact.
5. Co-op / auth deferred (Plan 009).

## Build / run / rollback

```bash
npm ci
npm run verify
npm run build
npm run preview   # serves dist on :8080 with --strictPort
```

Rollback: `git checkout <previous-sha>` and rebuild. Primary solo RC tip: tag `solo-rc` at the Plan 008 completion commit.

## Soak note

Full wall-clock two-hour soak is operator-run. CI covers the accelerated 30-minute deterministic soak (`tests/game/soak.test.ts`) plus 10k-tick replay and command fuzz.