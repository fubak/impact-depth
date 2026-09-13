# Plan 021 — machine review (A–F)

**Date:** 2026-09-13  
**Commits:** `3f5468c` (A/B) · `9213f15` (C) · `df421c1` (D) · `be473ef` (E) · this F pass  
**Environment:** Linux, typecheck/unit/lint/build on this machine. Playwright capture via SwiftShader-class GL at `http://127.0.0.1:8082/`. **Not** operator GPU, lighting, fleet, soak, or production-tag evidence.

## Machine gates

| Gate                                          | Result                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run verify`                              | PASS — typecheck, lint, **389 tests**, build `index-DR5SAboE.js` 958.77 kB (gzip 265.55 kB)               |
| `tests/game/land-avoidance.test.ts` isolation | PASS — ~1.0–1.9 s (Codex review saw 8.18 s; not a timeout here; did not raise global timeout)             |
| `tests/scripts/import-modern-fleet.test.mjs`  | PASS after installing declared `@gltf-transform/functions` 4.5.0                                          |
| Unused `eslint-disable`                       | Removed 3 unused directives (`no-new-func`, `no-console`)                                                 |
| Production build                              | Size warning retained. Code-split not applied (would risk gameplay-time stalls).                          |
| GPU ≥55 / lighting / fleet / soak             | **PENDING — operator only**                                                                               |

## Finding disposition

| Pri | Finding                                                       | Disposition                                                                   |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1  | Probes sum raw cascades vs `oceanDisplacement`                | **Fixed** A/B — shared GLSL + CPU twin, 0.25 m tolerance                      |
| P1  | Mixed CPU heave / GPU angles, rendered-velocity extrapolation | **Fixed** A/B — accepted-sample velocity, probe heave, rate limits            |
| P1  | Player floor uses legacy `sampleSeabedY` on v2                | **Fixed** A/B — `presentationBedY`                                            |
| P1  | Coastal 32² / 2048 m, unused direction                        | **Fixed** D — 128 / 640 m, `coast.yz` travel                                  |
| P1  | Cascade-local foam, spectral ring                             | **Partial** D — drain helper, thinner spectral lip; cascade ping-pong remains |
| P1  | Cyan emissive overwrite, no restore                           | **Fixed** C — baselines + unique materials                                    |
| P2  | Bed-focused caustics on hulls                                 | **Fixed** C — per-receiver envelope; above-water = 0                          |
| P2  | Optics exact projection, no overscan                          | **Fixed** D — 1.26 FOV overscan                                               |
| P2  | Probe age but not spatial movement                            | **Fixed** A/B — origin-keyed spatial reject + 10 Hz                           |
| P2  | Coastal async shared busy flag                                | **Fixed** D — `coastalJobOwnsBind`                                            |
| P2  | Vegetation wind missing depth material                        | **Fixed** E                                                                   |
| P2  | Merged islands, first-N truncate                              | **Fixed** E — per-island meshes + min count                                   |
| P2  | Weak leaf/geology variation                                   | **Partial** E — rocks on dry slope, stronger cay wobble; no new leaf atlas    |
| P2  | Static HDR vs weather/sun                                     | **Fixed** C — storm / low sun / night → procedural                            |
| P2  | Seabed baked sinusoid caustics                                | **Fixed** C                                                                   |
| P2  | CI visual artifacts                                           | **Open** — human visual approval stays explicit; not added this pass          |

## Captures

`artifacts/plan-021/` (gitignored): `baseline.json`, `bridge-waterline.png`, `tactical-cay.png`. After A/B spatial fix, diagnostics reported `source: "probe"` at 10 Hz. Software-GL probe age ~0.4 s. Milky shallows / pale hull / foam lip still present in stills — C–E reduce causes; operator eye-pass required.

Extreme upright pitch from the X video was **not** reproduced on this tree.

## Defaults (do not self-flip)

- Ocean empty URL: **spectral** (rollback `?ocean=gerstner`)
- World: **`legacy-v1`**
- HDR: local Kloofendal 1k under `public/assets/environment/v1/`
- Operator ACCEPT: GPU, lighting, fleet, listen, soak, production tag — Plan 017 / 018 STOP
