# Plan 018 realism upgrade — independent review

**Candidate:** branch `cursor/realism-upgrade-018-01b5` (base `2bec0d3` + uncommitted shader/RT/coastal fixes at review time)  
**Date:** 2026-09-12  
**Environment:** Windows 10, Chromium/WebGL2 via Cursor browser + Playwright smoke/e2e against `vite preview` on `127.0.0.1:8082`

## Machine gates (this candidate)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 296 tests |
| `npm run build` | PASS (~926 KB main chunk; size warning only) |
| `npm run test:smoke -- http://127.0.0.1:8082/` | PASS — `webglOk`, no console/page errors |
| `npm run test:e2e:ocean -- http://127.0.0.1:8082/` | PASS — spectral ready; all journeys including restart-reentry |
| GPU ≥55 FPS operator accept | **PENDING** (agent probe ~70–75 FPS EMA; not operator acceptance) |
| Lighting / fleet visual accept | **PENDING** |
| Default flip to spectral + littoral-v2 | **NOT DONE** (opt-in only) |

## Visual evidence

| Capture | Notes |
| --- | --- |
| `artifacts/browser-smoke.png` | Default Gerstner patrol renders water, island, freighter |
| `artifacts/plan-018-spectral-after-rt-fix.png` | Spectral + littoral-v2 after RT leak fix — scene visible |
| `artifacts/plan-018-gerstner-legacy.png` | Gerstner regression still clean |

## Blocking bugs found and fixed in this pass

1. **GLSL double-include** — `SPECTRUM_SAMPLE_GLSL` + full `SURFACE_GLSL` redefined `cascadeUv` and uniforms. Split to `SURFACE_FUNCTIONS_GLSL` for ocean + caustics.
2. **Blank spectral canvas** — `SurfaceProbeQueue.request` called `SimulationPass.run` without restoring the renderer target. Optics then snapshotted the probe RT and restored to it, so the main frame drew off-screen. Fixed with `withRendererPass` + a null-target guard at end of `preRenderWater`.
3. **World URL ignored at boot** — `createGame(19)` then overwrote `worldVersion`, leaving legacy entities. Now `createGame(19, runtime.world)` + `setPresentationWorld` before spectral activate.

## Recommendation status (original review themes)

| Theme | Status |
| --- | --- |
| Shared world authority (littoral-v2) | Implemented (opt-in); unit parity tests green |
| Spectral cascades + coastal field | Spectral live via `?ocean=spectral`; coastal build wired (async); foam still coarse / tiled |
| Reflection / refraction optics | Wired; works after RT fix; edge cases not fully matrix-proven |
| Caustics / surface effects | Modules attached; visual strength not operator-accepted |
| Vessel probes / attitude / picking | Wired; probes no longer steal the canvas RT |
| Outdoor IBL / vegetation | Integrated earlier on branch; not re-audited frame-by-frame here |
| Quality / recovery | Profiles + context recovery present; long cycle accounting thin |
| Importer / audio readiness | Prior Phase I commit on branch |
| Defaults / production tag | Outstanding — operator gates only |

## Remaining defects (severity)

### High

- Spectral surface still shows strong cellular/foam banding under Cursor GPU; needs gain/UV eye pass on a discrete GPU before any default flip.
- Coastal field may still lag first seconds; confirm `uCoastalEnabled=1` after warm-up on littoral-v2.

### Medium

- Optics / caustics cost and capture membership not fully proven across all seven POVs in this review.
- Bundle remains >800 KB; split only if measured startup benefit (plan forbids threshold-only silence).

### Low / process

- Preview script hardcodes port 8080; use `npx vite preview --host 127.0.0.1 --port 8082 --strictPort` when busy.
- Do not treat SwiftShader/software captures as visual PASS for production.

## Intentional alternatives

- Procedural sky PMREM vs licensed HDR (HDR pack not staged; CSP self-only).
- Default mission remains Gerstner + legacy-v1 until explicit operator activation.

## Next actions

1. Operator GPU eye-pass on spectral + littoral-v2 (day/storm, chase/peri).
2. Soften/retune cascade foam and coastal attenuation until tiling is gone.
3. After accept: tiny activation PR for defaults + rollback note; re-run browser matrix.
4. Keep Plan 017 soak / production tag outside this upgrade.
