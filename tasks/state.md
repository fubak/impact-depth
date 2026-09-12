# Silent Depths — project state

> Rolling SSOT for agents. Last updated **2026-09-11**.  
> Longer claims ledger: `docs/release/solo-production-status.md`  
> Persistent notes: `memory/MEMORY.md`

## Current

| Field              | Value                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Product            | Solo patrol game (Silent Depths) on Vite + Three.js                                          |
| Technical RC       | `solo-rc` / Plan 008 — **not** `solo-production`                                             |
| Plan track         | 001–008 DONE · 011 DONE · **018 IN PROGRESS** (replaces 013/016 implementation)              |
| Fleet content      | **models/v2** + manifest **v5** · `@gltf-transform/core` + `extensions` 4.5.0 declared       |
| HUD                | Clarity pass 2026-08-04 (tooltips, fold Gear/Doctrine, plain labels)                         |
| Open plans (order) | **018 ocean world** · 012 camera · 014 audio · **015 fleet** (partial) · 017 operator accept |
| Dev URL note       | Preview used `http://127.0.0.1:8080/` for 018 checkpoint 0/1                                 |

## Done recently (agent + tree)

- Distinct class GLBs (no multi-scale Visby for PD/CL/BB/merchant).
- Safe import pipeline: `artifacts/fleet-sources/sources.json` + `assets:import-modern` + `assets:validate`.
- Runtime LOD, player preload gate, contact mesh refresh after preload, in-panel asset credits.
- Engagement stand-down after kill; HUD vs world-click gate.
- HUD usability pass (see `src/ui/hud.ts`, `src/ui/tutorial.ts`).

## Plan 015 snapshot

| Step                                    | Status                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1 Validator + contract                  | DONE (`npm run assets:validate`)                                                                |
| 2 Safe importer + sources.json          | DONE (no download/cookie path)                                                                  |
| 3 models/v2 + manifest                  | DONE (content is stylized CC0 + CC-BY heroes; not photoreal warships)                           |
| 4 Preload / hot-swap                    | DONE enough for daily play (player gate + contact refresh); delayed-GLB browser test still thin |
| 5 Operator visual accept/waive per kind | **PENDING**                                                                                     |

## Plan 018 snapshot (2026-09-11)

| Step                                         | Status                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| 0 Dirty-tree baseline                        | DONE — inventory + seed 19/77 10k-tick snapshots in `artifacts/plan-018/`         |
| 1 Three r185 + Gerstner controller           | DONE — PCFShadowMap I1 fix; smoke/E2E green                                       |
| 2 Versioned world + unit bridge              | DONE (machine) — 24 m depth, packed R32F bed mask                                 |
| 3 Spectral ocean in a real patrol            | DONE (machine) — `test:e2e:ocean` backend=spectral, ready; default still Gerstner |
| 4 Optics, cameras, vessel attitude           | PARTIAL — chase/peri/crate Y; optical probes still open                           |
| 5 Littoral-v2 shared world                   | DONE (CPU) — opt-in `?world=littoral-v2`; default legacy-v1                       |
| 6 Terrain / foliage / weather / local assets | PARTIAL — weather + assets:validate; no local HDR/foliage pack                    |
| 7 GPU bounds, lifecycle, fallback            | PARTIAL — quality lock + dispose tests; operator GPU PENDING                      |
| 8 Operator accept + switch defaults          | PENDING — do not self-approve                                                     |

## Open issues (fix list)

Recorded 2026-09-11. Do not treat SwiftShader captures as visual PASS.

### Blocking / high (r185 + playable loop)

| ID  | Issue                                                                   | Likely fix                                 | When                       |
| --- | ----------------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| I1  | r185 `PCFSoftShadowMap` vs compare-mode depth textures                  | `PCFShadowMap` + material flags            | DONE (needs GPU eye-check) |
| I2  | Weapon/hull depth still uses `-z * 5` vs `METERS_PER_DEPTH = 24`        | Shared `entityDepthY` / splash Y           | DONE (CP2)                 |
| I3  | Gerstner still lifts water onto land (`world.y = max(world.y, floorY)`) | Coverage mask from packed bed; wet band    | DONE (CP2)                 |
| I4  | Height texture packed on CPU but not bound into ocean shader            | R32F `DataTexture` bound in Gerstner/Ocean | DONE (CP2)                 |

### Visual / HUD (Chrome patrol 2026-09-11)

| ID  | Issue                                                              | Likely fix                                  | When                       |
| --- | ------------------------------------------------------------------ | ------------------------------------------- | -------------------------- |
| I5  | Depth/speed tooltips cover the button row (`PERISCOPE` → `COPE`)   | Anchor tooltips above/below the control row | DONE                       |
| I6  | Chase framing at attack depth: empty water, huge ring, hull sliver | Camera follow/offset vs depth               | DONE (needs GPU eye-check) |
| I7  | Periscope often faces empty horizon, not the locked target         | Aim/yaw vs selected contact                 | DONE (needs GPU eye-check) |
| I8  | Pickup crate sits too high in bridge view                          | SURFACE_SPLASH_Y                            | DONE                       |
| I9  | Contacts panel “no firm contacts” while sonar plot lists ships     | Shared `listFirmContacts()`                 | DONE                       |

### Baseline gates (do not weaken)

| ID  | Issue                                                    | Likely fix                                           | When                     |
| --- | -------------------------------------------------------- | ---------------------------------------------------- | ------------------------ |
| I10 | `npm run assets:validate` missing `@gltf-transform/core` | Declared `@gltf-transform/core` + `extensions` 4.5.0 | DONE (CP6)               |
| I11 | `format:check` fails on 5 existing files                 | Format those files only, no mass rewrite             | Anytime before 018 close |
| I12 | GPU ≥55 FPS / lighting eye-pass / soak                   | Operator hardware                                    | CP7–8 / Plan 017         |

## Agent next

1. Operator GPU eye-pass of spectral `?ocean=spectral` and r185 hull lighting (I1).
2. Optional remaining machine: foam/caustics/optics, local HDR, foliage, switch defaults **only after** CP8 human accept.
3. Do not execute 013/016. 012/014/015 remain independent.

## Human next

- GPU FPS evidence into `docs/release/perf-notes.md`
- Eye-pass fleet + lighting + soak playthroughs
- Do not treat agent FPS/SwiftShader as PASS
- When satisfied end-to-end: Plan 017 → tag `solo-production` only

## Verify (quick)

```bash
npm run typecheck && npm test && npm run assets:validate
```
