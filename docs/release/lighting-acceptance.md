# Lighting acceptance — Plan 010 Phase G

**Date:** 2026-08-03

## Checklist

| POV / condition | Status | Notes |
|-----------------|--------|--------|
| Tactical day | PASS* | Day phase offset from look-dev noon; IBL + fill/bounce restored |
| Chase day | PASS* | Agent screenshot post-restore |
| Bridge / peri / free / map | PENDING | Operator visual pass |
| Night / dusk presets | PENDING | Soft ambient/moon present; needs human eye |
| Quality medium/low | PENDING | Operator |
| No black-silhouette regression | PASS* | vs pre-fix midnight spawn bug |

\* Agent-verified under Chromium automation; operator should confirm on GPU desktop.

## Fixes retained

- Day cycle: `(lookDevTod + game.time/DAY_LENGTH) % 1` (not midnight at t=0)
- Ambient + fill + bounce lights; RoomEnvironment IBL via `bindEnvironment`
- Exposure / sunIntensity defaults (`lookdev-v5`)
