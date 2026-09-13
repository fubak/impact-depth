# Plan 018 realism upgrade — independent review

**Candidate:** dirty `master` after `018-finish-gaps.md` machine close (foam/lambda, optics, matrix, resource cycles, vegetation)  
**Date:** 2026-09-13  
**Environment:** Windows 10, Chromium/WebGL2 via Cursor browser (NVIDIA RTX 4070 Ti) + Playwright smoke/e2e against `vite preview` on `127.0.0.1:8082`

## Machine gates (this candidate)

| Gate                                                | Result                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck`                                 | PASS                                                                         |
| `npm test` / `npm run verify`                        | PASS — 322 tests + lint + build (`index-kcmF1Rtl.js` ~934 KB)               |
| `npm run assets:validate` / `assets:validate:ocean` | PASS                                                                         |
| `npm run format:check`                              | PASS                                                                         |
| Spectral hitch-final (Cursor browser, 12 s Flank) | CLEAN — ~75 FPS, p95 13.5 ms, max 13.7 ms, 0 frames >100 ms; RTX 4070 Ti     |
| GPU ≥55 FPS operator accept                         | **PENDING** (agent probe only; not operator acceptance)                      |
| Lighting / fleet visual accept                      | **PENDING**                                                                  |
| Default flip to spectral + littoral-v2              | **NOT DONE** (opt-in only)                                                   |

## Post-merge playability fixes

1. **1–2 s hitch** — coastal rebuild every 60 frames with unsapped origin. Now snap to 128 m, rebuild on snap only, async chunked solver, cheaper live physics.
2. **Blocky bed** — `packWorldHeightTexture` uploads littoral 1 m `bedMetres` (640²) instead of downsampling to 128.
3. **Green/foam plates / storm honeycomb** — 2026-09-13: Tessendorf pack lambda `min(0.72)*0.40`, lower cascade gains, chop-weighted `oceanFoam`, GLSL `foamPatch` (not reserved `patch`). Storm tactical honeycomb closed. Overhead spectral **map** follow-square was projected detail caustics; faded above ~70–120 m camera height.

## Remaining defects (severity)

### High

- Operator GPU ≥55 / lighting / fleet ACCEPT still required before default flip.

### Medium

- Bed caustics not a hero proof: chase captures stay at periscope depth (6.7 m); map correctly fades projected lighting.
- Chase spectral hull reads washed-out white vs Gerstner teal (fleet ACCEPT).

### Low / process

- `format:check` PASS. Defaults, production tag, two-hour soak remain Plan 017 / operator gates.

## Visual evidence

| Capture | Notes |
| --- | --- |
| `artifacts/browser-smoke.png` | Default Gerstner patrol smoke |
| `artifacts/plan-018-finish/*.png` | 46-file four-combo matrix (lead-inspected) |
| `artifacts/plan-018-finish/matrix-report.md` | Per-image pass/fail |
| `artifacts/plan-018-finish/hitch-final.json` | GPU hitch CLEAN |
| `artifacts/plan-018-finish/resource-cycles.json` | 20× cycles bounded |

## Blocking bugs found and fixed in this pass

1. **GLSL double-include** — `SPECTRUM_SAMPLE_GLSL` + full `SURFACE_GLSL` redefined `cascadeUv` and uniforms. Split to `SURFACE_FUNCTIONS_GLSL` for ocean + caustics.
2. **Blank spectral canvas** — `SurfaceProbeQueue.request` called `SimulationPass.run` without restoring the renderer target. Optics then snapshotted the probe RT and restored to it, so the main frame drew off-screen. Fixed with `withRendererPass` + a null-target guard at end of `preRenderWater`.
3. **World URL ignored at boot** — `createGame(19)` then overwrote `worldVersion`, leaving legacy entities. Now `createGame(19, runtime.world)` + `setPresentationWorld` before spectral activate.
4. **Foam derive `patch` reserved word** — WebGL compile failed (`Illegal use of reserved word`). Renamed to `foamPatch`.
5. **Storm hexagonal plates** — high Tessendorf lambda folded the mesh. Lower pack chop + cascade gains.

## Recommendation status (original review themes)

| Theme                                | Status                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| Shared world authority (littoral-v2) | Implemented (opt-in); unit parity tests green                                 |
| Spectral cascades + coastal field    | Spectral live via `?ocean=spectral`; storm honeycomb + map follow-square closed |
| Reflection / refraction optics       | Wired; peri/bridge reflections inspected in finish matrix                   |
| Caustics / surface effects           | Attached + altitude-faded for map; bed pattern not in chase POVs            |
| Vessel probes / attitude / picking   | Wired; probes no longer steal the canvas RT                                   |
| Outdoor IBL / vegetation             | Fan palms inspected; no HDR pack                                             |
| Quality / recovery                   | 20× resource-cycle harness bounded; operator GPU PENDING                      |
| Importer / audio readiness           | Prior Phase I commit on branch                                                |
| Defaults / production tag            | Outstanding — operator gates only                                             |

## Intentional alternatives

- Procedural sky PMREM vs licensed HDR (HDR pack not staged; CSP self-only).
- Default mission remains Gerstner + legacy-v1 until explicit operator activation.

## Next actions

1. Operator GPU eye-pass + lighting/fleet ACCEPT (`docs/release/plan-018-operator-accept.md`).
2. After ACCEPT: tiny activation PR for defaults + rollback note; re-run browser matrix on bare URL.
3. Keep Plan 017 soak / production tag outside this upgrade.
