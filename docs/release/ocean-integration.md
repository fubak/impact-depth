# Ocean world engine integration

Status: **IN PROGRESS** (Plan 018). Checkpoints 0–2 machine work complete (legacy world, 24 m depth, R32F bed mask).
CP6–7 machine (2026-09-11): presentation weather, ocean asset validator, quality FFT sizes, URL quality lock.
Issue list: `tasks/state.md` (I1–I12).

## Upstream provenance

| Field         | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Repository    | https://github.com/iamtechartist/ocean-simulation       |
| Pinned commit | `3f756c128f7775f76e9fc7e93ad2f4e825df4354` (2026-09-10) |
| License       | MIT (Copyright 2026 Techartist)                         |
| Fetched       | 2026-09-11 into `artifacts/ocean-sources/` (gitignored) |

| File                | SHA-256                                                            | Bytes  |
| ------------------- | ------------------------------------------------------------------ | ------ |
| LICENSE             | `b0e0e711c04aac69e316e9c79a3119b722dc7d65e129990cdbe7a35dea6fec8b` | 1067   |
| README.md           | `2756b06daaaeb4a736705dc6331fccfc2655fec0cb06226c66ff9d2951697b5b` | 236    |
| upstream/index.html | `7ef353234553616bb68b4ffb2a0474c78db63ff75350b87aee90a769c609ed8a` | 146635 |

Extracted symbols (not yet ported): `buildCoastalField`, `SpectralCascade`, `createFoamSystem`, `createSurfaceEffects`, `createSurfaceProbe`, `createParticulate`, `terrainHeight`, `seabedHeight`, `captureRefraction`, `updateReflection`, `updateSpectrum`, `updateWeather`.

Three.js in the demo is `esm.sh/three@0.185.0`. HDR sky: Poly Haven _Kloofendal 48d Partly Cloudy (Pure Sky)_, CC0 1.0.

**HDR staging skipped (CP6).** There is no local CC0 Kloofendal file in-tree. Do not download it, do not load `esm.sh`, and do not whitelist polyhaven.org. Production stays self-only (`RoomEnvironment` PMREM). `npm run assets:validate:ocean` exits 0 with `no environment pack` until a local file is staged under `public/assets/environment/v1/` with a license/hash manifest.

## Architecture (current)

Silent Depths owns the canvas, clock, and `updateGame` loop. `EnvironmentController` wraps an `EnvironmentBackend`. Checkpoint 1 wraps the existing Gerstner `Ocean` and does not install a second animation loop. Spectral activation is stubbed to fail closed onto Gerstner until checkpoint 3.

World version remains `legacy-v1` until checkpoint 5. Default ocean remains Gerstner.

### Presentation weather (CP6)

`src/render/environment/weather.ts` maps look-dev `ocean.seaState` onto calm / breeze / storm. Golden hour remains Atmosphere lighting (`timeOfDay`); there is still one sun system. Wave/foam/cloud histories freeze when `sim.paused` (dt=0). Reduced motion zeros lightning and skips camera flicker. Restart/`resetEnvironment` clears weather history.

### Quality (CP7)

`QUALITY_PROFILES` now include `spectralFftSize` matching `fftSizeForQuality` in `spectrum.ts` (low 64, medium 128, high 128/256 wind). `?quality=high|medium|low` sets `qualityForced` so `QualityGovernor` will not auto-downgrade. Unspecified quality still starts high and may adapt.

### Perf flags (not implemented in `scripts/fps-bench.mjs`)

Authoritative GPU fail-the-build is **not** wired. Intended operator invocation (PENDING until hardware evidence):

```bash
FPS_WARMUP_MS=30000 FPS_BENCH_MS=60000 PERF_AUTHORITATIVE=1 PERF_HEADED=1 PERF_QUALITY=high \
  npm run test:perf -- 'http://127.0.0.1:8080/?ocean=spectral&world=littoral-v2&quality=high'
```

| Flag                        | Intended meaning                                                 | Current script                        |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| `PERF_AUTHORITATIVE=1`      | Reject software/unknown renderers; fail on missed p95 frame-time | ignored                               |
| `PERF_HEADED=1`             | Headed Chromium, no software-forcing launch args                 | ignored (headless + `--use-gl=angle`) |
| `PERF_QUALITY=high\|medium` | Assert requested quality/backend                                 | ignored; use `?quality=`              |
| `FPS_WARMUP_MS`             | Discard warmup before sampling                                   | ignored                               |
| `FPS_BENCH_MS`              | Sample duration                                                  | implemented (default 4000)            |

Thresholds when the operator run exists: high p95 ≤ 1000/55 ms; medium p95 ≤ 1000/30 ms. Do not treat SwiftShader/llvmpipe as PASS.
