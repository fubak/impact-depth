# Silent Depths — project state

> Rolling SSOT for agents. Last updated **2026-09-26**.
> Longer claims ledger: `docs/release/solo-production-status.md`  
> Persistent notes: `memory/MEMORY.md`

## Plan 024 — machine work landed 2026-09-26

[Execute the action-gameplay review](../plans/024-action-gameplay-execution.md). Unit suite 651 passed. `npm run build` and `npm run assets:validate` passed. Patrol E2E on `http://127.0.0.1:8098/` passed all 7 journeys in Chrome (no console errors). A system Chrome session started Convoy strike: objective "Sink the merchant, reach the exit", tutorial clock stayed at 0 while the cards were open, the Survive card spawned 6 hedgehog charges with hull still at 100, then the patrol resumed with 3 ships and INCOMING showing. Scripted strike report: victory in 8.9 s, 4 shots, 100 HP.

Key M toggles 4× transit. Key V stays Deep.

Ruling: the 18-unit quiet cap breaks OD6's "every seed alerts" passive band. The cap stays. The loud ≤15 s band stays.

Operator gates are not approved: GPU FPS, lighting eye-pass, fleet ACCEPT, audio listen, soak, fun/feel, world-default flip, `solo-production`. Hull-contrast ratio was not measured. No new GLBs. Not pushed.

## Plan 023 — planned 2026-09-26

[Action gameplay and production readiness](../plans/023-action-gameplay-and-production-readiness.md)
records the independent review of `ddd4281`, prioritized fixes, and four delivery
milestones. Documentation only; implementation and operator acceptance remain pending.
Review checks: verify (614 tests), asset validation, and browser smoke passed. Full
patrol E2E failed in targeting-fire while waiting for PLOT after a water click; later
journeys did not run and the cause remains unresolved.

Independent five-seed probes found Evade fails on 7/42/91 (seed 7 loses 100 HP to
world collision), while Exfil fails on 1/7/42/91 but reaches the base ring on seed 19.
This supersedes the older all-five Exfil failure claim below. See
`docs/release/plan-023-simulation-probes.json` for the measured outcomes.

## Plan 022 (production action pass) — machine work landed 2026-09-26

All Phase 1–4 items are merged to `master` (S1–S5, K1–K4, B1–B2, A1–A3, C1, D1, G1–G4, H1–H4 plus the cinema
follow-through and the score-strip fix). Live on Pages: https://fubak.github.io/impact-depth/ .

Operator gates remain **PENDING** (not self-approved): GPU >=55 FPS at the reference scene, lighting eye-pass,
fleet visual ACCEPT (015), audio listen (014) incl. new cues/tension layer, soak playthrough, fun/feel sign-off on
the pacing (first passive detection 60-150 s, loud <=15 s, 20 s wave breather), world-default flip, `solo-production` tag.

Known follow-ups: `it.fails` pins in `tests/game/playtest/doctrines.test.ts` (Evade dies on seeds 7/42/91, Exfil
sunk before FOB on all seeds); a burst of ~66 `GL_INVALID_OPERATION` (shadow sampler) messages at startup on a real GPU
(pre-existing, gone with `?quality=low`); underwater torpedo action is fogged out at range (threat markers and the
HIT toast are the cues); `hud.ts` and `app.ts` exceed 800 lines.

Evidence commands: `npm run verify`, `npm run test:smoke`, `npm run test:e2e -- <url>` (7 journeys),
`npm run test:e2e:hud`, `npm run test:playthrough` (CDP 9223; SwiftShader runs are NOT a visual pass).

## Current

**Resume instruction (2026-09-13):** Plan **021 A/B** is in progress (shared
surface evaluator, GPU heave, active-world bed clamp, 10 Hz probes). Plan 019
water-first remains close (HDR + spectral default). Plan 012 machine + patrol
E2E targeting is green. Plan 014 Chromium mute/unlock green; operator listen
PENDING. Plan 015 delayed-GLB E2E green; operator fleet ACCEPT PENDING.
Plan 018/017 operator GPU/soak/tag/world-default **must not** be self-approved.
Do not start Plan 009. Do not start 021 C–F in the same session unless the
operator continues.

| Field              | Value                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product            | Solo patrol game (Silent Depths) on Vite + Three.js                                                                                                                 |
| Technical RC       | `solo-rc` / Plan 008 — **not** `solo-production`                                                                                                                    |
| Plan track         | 001–008 DONE · 011 DONE · 012 machine DONE · **021 A/B IN PROGRESS** · **018 IN PROGRESS** (operator) · **019 IN PROGRESS** (look close) · 014/015 operator PENDING |
| Fleet content      | **models/v2** + manifest **v5** · `@gltf-transform/core` + `extensions` 4.5.0 declared                                                                              |
| HUD                | Clarity pass 2026-08-04 (tooltips, fold Gear/Doctrine, plain labels)                                                                                                |
| Open plans (order) | **021 motion/surface** · 019 look · 020 island art · 018 operator ACCEPT · 014 listen · **015 fleet ACCEPT** · 017 operator accept                                  |
| Dev URL note       | Preview often `http://127.0.0.1:8082/` when 8080 is busy (`npx vite preview …`)                                                                                     |

## Done recently (agent + tree)

- Distinct class GLBs (no multi-scale Visby for PD/CL/BB/merchant).
- Safe import pipeline: `artifacts/fleet-sources/sources.json` + `assets:import-modern` + `assets:validate`.
- Runtime LOD, player preload gate, contact mesh refresh after preload, in-panel asset credits.
- Engagement stand-down after kill; HUD vs world-click gate.
- HUD usability pass (see `src/ui/hud.ts`, `src/ui/tutorial.ts`).

## Plan 015 snapshot

| Step                                    | Status                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| 1 Validator + contract                  | DONE (`npm run assets:validate`)                                      |
| 2 Safe importer + sources.json          | DONE (no download/cookie path)                                        |
| 3 models/v2 + manifest                  | DONE (content is stylized CC0 + CC-BY heroes; not photoreal warships) |
| 4 Preload / hot-swap                    | DONE — delayed-GLB browser test (`npm run test:e2e:assets`)           |
| 5 Operator visual accept/waive per kind | **PENDING**                                                           |

## Plan 018 snapshot (2026-09-13)

| Step                                         | Status                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| 0 Dirty-tree baseline                        | DONE — inventory + seed 19/77 10k-tick snapshots in `artifacts/plan-018/`        |
| 1 Three r185 + Gerstner controller           | DONE — PCFShadowMap I1 fix; smoke/E2E green                                      |
| 2 Versioned world + unit bridge              | DONE (machine) — 24 m depth, packed R32F bed mask                                |
| 3 Spectral ocean in a real patrol            | DONE (machine) — empty-URL default spectral; rollback `?ocean=gerstner`          |
| 4 Optics, cameras, vessel attitude           | DONE (machine) — peri/bridge reflections inspected; chase still peri-depth       |
| 5 Littoral-v2 shared world                   | DONE (CPU) — `createGame(seed, world)`; opt-in `?world=littoral-v2`              |
| 6 Terrain / foliage / weather / local assets | DONE (machine) — local HDR + 021 E foliage/rocks; operator lighting PENDING      |
| 7 GPU bounds, lifecycle, fallback            | PARTIAL — hitch-final CLEAN (~75 FPS); 20× resource cycles; operator GPU PENDING |
| 8 Operator accept + switch defaults          | PENDING — do not self-approve                                                    |

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

| ID  | Issue                                                    | Likely fix                                           | When             |
| --- | -------------------------------------------------------- | ---------------------------------------------------- | ---------------- |
| I10 | `npm run assets:validate` missing `@gltf-transform/core` | Declared `@gltf-transform/core` + `extensions` 4.5.0 | DONE (CP6)       |
| I11 | `format:check` fails on 5 existing files                 | Format those files only, no mass rewrite             | DONE             |
| I12 | GPU ≥55 FPS / lighting eye-pass / soak                   | Operator hardware                                    | CP7–8 / Plan 017 |

## Agent next

1. Plan 021 machine A–F is committed. Operator GPU/lighting/fleet/soak ACCEPT still PENDING.
2. 018 operator ACCEPT (`docs/release/plan-018-operator-accept.md`) still PENDING — do not self-approve; do **not** flip **world** default.
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
