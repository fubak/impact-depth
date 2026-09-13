# Silent Depths — project state

> Rolling SSOT for agents. Last updated **2026-09-13**.
> Longer claims ledger: `docs/release/solo-production-status.md`  
> Persistent notes: `memory/MEMORY.md`

## Current

**Resume instruction (2026-09-13):** Plan 018 finish-gaps **machine complete**. Spectral
storm honeycomb closed; map follow-square closed (caustic altitude fade). Four-combo
matrix inspected in `artifacts/plan-018-finish/matrix-report.md`. Hitch-final CLEAN
on RTX 4070 Ti (~75 FPS, 0 frames >100 ms). **World** default remains `legacy-v1`.
Operator GPU/lighting/fleet gates still PENDING — do not self-approve those.
Look evidence: `artifacts/plan-019/look-report.md`. Plan 019 water-first is implemented (uncommitted): spectral empty-URL default + local Kloofendal HDR. Do not start 012/014/015/017/020 in this tree unless the look-report says it is not close.

| Field              | Value                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Product            | Solo patrol game (Silent Depths) on Vite + Three.js                                          |
| Technical RC       | `solo-rc` / Plan 008 — **not** `solo-production`                                             |
| Plan track         | 001–008 DONE · 011 DONE · **018 IN PROGRESS** · **019 IN PROGRESS** (water-first implemented, uncommitted) |
| Fleet content      | **models/v2** + manifest **v5** · `@gltf-transform/core` + `extensions` 4.5.0 declared       |
| HUD                | Clarity pass 2026-08-04 (tooltips, fold Gear/Doctrine, plain labels)                         |
| Open plans (order) | **019 demo-look water** · 018 operator ACCEPT (GPU/lighting/fleet) · 012 camera · 014 audio · **015 fleet** (partial) · 017 operator accept |
| Dev URL note       | Preview often `http://127.0.0.1:8082/` when 8080 is busy (`npx vite preview …`)              |

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

## Plan 018 snapshot (2026-09-13)

| Step                                         | Status                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| 0 Dirty-tree baseline                        | DONE — inventory + seed 19/77 10k-tick snapshots in `artifacts/plan-018/`      |
| 1 Three r185 + Gerstner controller           | DONE — PCFShadowMap I1 fix; smoke/E2E green                                    |
| 2 Versioned world + unit bridge              | DONE (machine) — 24 m depth, packed R32F bed mask                              |
| 3 Spectral ocean in a real patrol            | DONE (machine) — storm honeycomb + map follow-square closed; opt-in only |
| 4 Optics, cameras, vessel attitude           | DONE (machine) — peri/bridge reflections inspected; chase still peri-depth   |
| 5 Littoral-v2 shared world                   | DONE (CPU) — `createGame(seed, world)`; opt-in `?world=littoral-v2`            |
| 6 Terrain / foliage / weather / local assets | PARTIAL — fan palms inspected; no local HDR pack                               |
| 7 GPU bounds, lifecycle, fallback            | PARTIAL — hitch-final CLEAN (~75 FPS); 20× resource cycles; operator GPU PENDING |
| 8 Operator accept + switch defaults          | PENDING — do not self-approve                                                  |

Finish-gaps evidence: [`artifacts/plan-018-finish/matrix-report.md`](../artifacts/plan-018-finish/matrix-report.md).
Analysis: [`docs/release/realism-upgrade-review.md`](../docs/release/realism-upgrade-review.md).

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
| I11 | `format:check` fails on 5 existing files                 | Format those files only, no mass rewrite             | DONE                       |
| I12 | GPU ≥55 FPS / lighting eye-pass / soak                   | Operator hardware                                    | CP7–8 / Plan 017         |

## Agent next

1. Plan 019 machine work is in the working tree (uncommitted). Operator: inspect `artifacts/plan-019/look-report.md` and commit when ready.
2. 018 operator ACCEPT (`docs/release/plan-018-operator-accept.md`) still PENDING for GPU/lighting/fleet — do not self-approve; do **not** flip **world** default.
3. Do not execute 013/016. 012/014/015 remain independent. Do not start 020 unless 019 look-report says water-first is not close.

## Human next

- GPU FPS evidence into `docs/release/perf-notes.md`
- Eye-pass fleet + lighting + soak playthroughs
- Do not treat agent FPS/SwiftShader as PASS
- When satisfied end-to-end: Plan 017 → tag `solo-production` only

## Verify (quick)

```bash
npm run typecheck && npm test && npm run assets:validate
```
