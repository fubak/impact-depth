# Performance notes — Plan 010 Phase B

**Date:** 2026-08-03  
**Host class:** agent CI / software raster (llvmpipe) — **not** a GPU desktop proof.

## Status

| Gate | Status | Notes |
|------|--------|--------|
| Adaptive quality hysteresis | Present | `QualityGovernor` high→medium→low |
| HUD throttle ~8 Hz | Present | |
| Terrain cache | Present | `getTerrain` |
| Shadow map 2048 + soft PCF | Present (post lighting restore) | |
| `npm run test:perf` on agent | Directional only | WebGL often unavailable / unreliable under llvmpipe |
| ≥55 FPS high @ 1440×900 GPU Chromium | **OPERATOR REQUIRED** | Record GPU, driver, Chromium, seed, quality |
| ≥30 FPS medium fallback | **OPERATOR REQUIRED** | Force medium profile and re-measure |

## Operator checklist

```bash
npm ci && npm run build
npx vite preview --host 127.0.0.1 --port 8090 --strictPort
npm run test:perf -- http://127.0.0.1:8090/
```

Append results here with hardware stamp when available. Do not mark Plan 010 Phase B DONE until GPU desktop evidence exists.
