# Plan 018 operator accept

**Status:** GPU / lighting / fleet are **PENDING**. Agents must not self-approve these gates and must not change `parseRuntimeSelection` defaults until all three ACCEPT lines below are recorded by the operator.

**Candidate:** machine close via `plans/018-finish-gaps.md`. Defaults remain Gerstner + `legacy-v1` until ACCEPT.

## How to run headed authoritative GPU bench

Preview (separate terminal):

```sh
npm run build
npx vite preview --host 127.0.0.1 --port 8082
```

PowerShell, discrete-GPU Chromium, headed, high quality:

```powershell
$env:PERF_AUTHORITATIVE=1
$env:PERF_HEADED=1
$env:PERF_QUALITY="high"
npm run test:fps -- "http://127.0.0.1:8082/?ocean=spectral&world=littoral-v2&quality=high"
```

When `PERF_AUTHORITATIVE=1` and warmup/sample env vars are unset, `scripts/fps-bench.mjs` uses ≥30 s warmup and ≥60 s sample. Casual `npm run test:fps` without that flag stays short.

Rollback URL if defaults are later activated: `?ocean=gerstner&world=legacy-v1`.

## Checklist (operator only)

- [ ] Lighting day / dusk / night eye-pass on spectral + littoral-v2
- [ ] Fleet waterline calm / storm
- [ ] Foam reads as irregular breakers/wakes (not honeycomb-dominant)
- [ ] GPU p95 ≥55 FPS at 1440×900 high on discrete GPU (`PERF_AUTHORITATIVE=1`)

## Recorded decisions

```
GPU: PENDING
LIGHTING: PENDING
FLEET: PENDING
```

Do not flip `src/core/runtime-selection.ts` defaults until all three lines are `ACCEPT`.
