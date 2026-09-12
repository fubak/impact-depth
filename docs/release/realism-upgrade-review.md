# Plan 018 realism upgrade — independent review

**Candidate:** `master` after PR #1 merge + post-merge coastal hitch / bed / foam fixes  
**Date:** 2026-09-12  
**Environment:** Windows 10, Chromium/WebGL2 via Cursor browser + Playwright smoke/e2e against `vite preview` on `127.0.0.1:8082`

## Machine gates (this candidate)

| Gate                                                | Result                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck`                                 | PASS                                                                         |
| `npm test`                                          | PASS — 300 tests                                                             |
| `npm run build`                                     | PASS (~928 KB main chunk; size warning only)                                 |
| Spectral hitch (Cursor browser, 10 s moving sample) | PASS — ~75 FPS, p95 ≈ 13.5 ms, max ≈ 13.6 ms, 0 frames >100 ms after warm-up |
| GPU ≥55 FPS operator accept                         | **PENDING** (agent probe only; not operator acceptance)                      |
| Lighting / fleet visual accept                      | **PENDING**                                                                  |
| Default flip to spectral + littoral-v2              | **NOT DONE** (opt-in only)                                                   |

## Post-merge playability fixes

1. **1–2 s hitch** — coastal rebuild every 60 frames with unsapped origin. Now snap to 128 m, rebuild on snap only, async chunked solver, cheaper live physics.
2. **Blocky bed** — `packWorldHeightTexture` uploads littoral 1 m `bedMetres` (640²) instead of downsampling to 128.
3. **Green/foam plates** — softened coastal exposure gain, cascade foam, and underwater caustic boost. Residual cellular FFT foam remains.

## Remaining defects (severity)

### High

- Spectral foam can still read cellular/honeycomb under Cursor GPU; needs operator eye-pass on discrete GPU before default flip.
- Production browser matrix checklist items and self-only startup evidence still incomplete vs Plan 018 §11.

### Medium

- Optics / caustics / seven-POV matrix thin.
- Plants/sky look-dev assets unchanged (no HDR/foliage pack).

### Low / process

- Defaults, production tag, two-hour soak remain Plan 017 / operator gates.

## Visual evidence

| Capture | Notes |
| --- | --- |
| `artifacts/browser-smoke.png` | Default Gerstner patrol smoke |
| `artifacts/plan-018-upgrade/spectral/*.png` | 6 POV spectral + littoral-v2 + high (human review) |
| `artifacts/plan-018-upgrade/gerstner/*.png` | 6 POV Gerstner + legacy default (human review) |
| `artifacts/plan-018-upgrade/matrix-report.md` | Matrix inventory + hitch notes |

## Blocking bugs found and fixed in this pass

1. **GLSL double-include** — `SPECTRUM_SAMPLE_GLSL` + full `SURFACE_GLSL` redefined `cascadeUv` and uniforms. Split to `SURFACE_FUNCTIONS_GLSL` for ocean + caustics.
2. **Blank spectral canvas** — `SurfaceProbeQueue.request` called `SimulationPass.run` without restoring the renderer target. Optics then snapshotted the probe RT and restored to it, so the main frame drew off-screen. Fixed with `withRendererPass` + a null-target guard at end of `preRenderWater`.
3. **World URL ignored at boot** — `createGame(19)` then overwrote `worldVersion`, leaving legacy entities. Now `createGame(19, runtime.world)` + `setPresentationWorld` before spectral activate.

## Recommendation status (original review themes)

| Theme                                | Status                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Shared world authority (littoral-v2) | Implemented (opt-in); unit parity tests green                                 |
| Spectral cascades + coastal field    | Spectral live via `?ocean=spectral`; coastal snap+async; foam still imperfect |
| Reflection / refraction optics       | Wired; works after RT fix; edge cases not fully matrix-proven                 |
| Caustics / surface effects           | Modules attached; visual strength not operator-accepted                       |
| Vessel probes / attitude / picking   | Wired; probes no longer steal the canvas RT                                   |
| Outdoor IBL / vegetation             | Integrated earlier on branch; not re-audited frame-by-frame here              |
| Quality / recovery                   | Profiles + context recovery present; long cycle accounting thin               |
| Importer / audio readiness           | Prior Phase I commit on branch                                                |
| Defaults / production tag            | Outstanding — operator gates only                                             |

## Intentional alternatives

- Procedural sky PMREM vs licensed HDR (HDR pack not staged; CSP self-only).
- Default mission remains Gerstner + legacy-v1 until explicit operator activation.

## Next actions

1. Operator GPU eye-pass on spectral + littoral-v2 (day/storm, chase/peri).
2. Soften/retune cascade foam until residual cellular look is gone.
3. After accept: tiny activation PR for defaults + rollback note; re-run browser matrix.
4. Keep Plan 017 soak / production tag outside this upgrade.
