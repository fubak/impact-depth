# Silent Depths — project state

> Rolling SSOT. Updated **2026-09-26**. Claims: `docs/release/solo-production-status.md`. Notes: `memory/MEMORY.md`.

## Now

**Plan 026 machine work landed.** Phases 1–4 (ordnance physics, vessel dynamics, escort doctrine, instanced-particle combat VFX) are in `df4f424`. This session added Phase 5 — bloom post pipeline (`?bloom=0` off, on by default at `quality=high`), depth-graded underwater fog/exposure, sun shafts, marine snow — and Phase 6: HUD target-card damage states (FLOODING / ON FIRE / DEAD IN WATER / SINKING), staggered wave rings that keep large waves inside the 30–55 u envelope, wave-1 roving-escort sweep that finds a quiet boat in ~16–25 s, and flow noise keyed on realized speed. Campaign balance is pinned by `tests/game/playtest/campaign-balance.test.ts` (wave-1 sweep + wave-2 kills across 5 seeds).

**Pending operator gates:** GPU FPS with bloom enabled, lighting/explosion eye-pass, fun/feel, soak, world default, `solo-production` tag.

**Next (Plan 025 leftovers):** Phase 5 world factory and exfil seed 7. Do not self-approve Phases 6–7 or any operator gate.

Phases 1–3 are in `feedf32` and the parents. Evidence: [phase 1](../docs/release/plan-025-phase1.md), [phases 2–3](../docs/release/plan-025-phase2-3.md). This commit adds:

- Phase 4 tutorial and HUD. Quick-start Steer, Fire, and Survive are live exercises (`silent-depths-tutorial-v2`). Explain cards pause the clock. Chrome `npm run test:e2e:tutorial -- http://127.0.0.1:8111/?quality=low` passed: dodge left the hull at 100%, and the score did not overlap contacts at 1280×720, 1366×768, 1920×1080, or 125% zoom. That preview did not include the munition edits below.
- Torpedoes appear at the boat's center and run at constant speed. Heading stays within 60° of the bow. An Mk-14 does not turn; it does chase the target's depth (sub 0.32, surface 0.02). Mk-18 and enemy fish turn and chase depth. A hit needs the fish within 0.2 of that depth.
- A sunk hull is kept. If none was on screen, the fallback is that class's hull at depth, not a box on the water. A sub kill is a bubble burst plus a surface column. Surface sinks add a water column.
- Wave contacts spawn on separate rings. Escort slots are 12 ahead/astern and 10 on the beam. Chrome on `:8112` showed five contacts at least 33 units apart.

Still open: Phase 5 world init and seed-7 exfil, Phase 6 human playtests, Phase 7 operator gates. Quiet sweep cap stays 18. Key M is 4×. Key V is Deep. World default stays `legacy-v1`.

## Older plans (pointers)

- 022 machine work is on master. Operator FPS, lighting, fleet, audio, soak, fun/feel, world default, and `solo-production` stay pending. Plan 017 owns the tag.
- 023 is the review of `ddd4281`. Probes: `docs/release/plan-023-simulation-probes.json`.
- 024 landed in `cf0ab5a`. The 8.9 s strike in that report teleported. The real seed-19 run is 20.33 s and is in the phase 2–3 note.
- Evade seeds 7/42/91 and exfil seed 7 were still failing when last probed. Do not treat later doctrine edits as a pass until Phase 5 remeasures them.

## Current

**Plan 027 (2026-10-02):** cinematic sunset pass on branch `plan-027-cinematic-sunset` — continuous sun-driven sky, ocean SSS/sun road/whitecaps, persistent wake-foam field, lit spray + bow spray, hull spring dynamics, camera hull coupling, `sunset-passage` preset (`?look=sunset-passage`). Uses the Plan 026 render path. Operator GPU FPS + lighting eye-pass PENDING; see `plans/027-cinematic-sunset-pass.md`.

Active plan is **025**. Do not start 009. Do not flip the world default. Operator GPU, lighting, fleet, audio, soak, and the production tag stay pending.

| Field   | Value                                                         |
| ------- | ------------------------------------------------------------- |
| Product | Solo patrol on Vite + Three.js. Sim is `src/game/sim/**`.     |
| HEAD    | Plan 025 phases 1–4 plus munition edits, on `origin/master`.  |
| Tag     | `solo-rc` exists. `solo-production` does not.                 |
| Fleet   | `models/v2`, manifest v5. Operator silhouette accept pending. |
| Preview | `npm run preview` (port 8080, or another free port).          |

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

## Agent next

1. Phase 5. Remeasure exfil seed 7 and the Evade seeds. Do not self-approve Phase 6 or 7.
2. 018/014/015 operator ACCEPT stays pending. Do not flip the world default. Do not execute 009, 013, or 016.

## Human next

- GPU FPS, fleet look, lighting, audio listen, and soak. Agent screenshots are not those gates.
- Plan 017 is the only path to `solo-production`.

## Verify (quick)

```bash
npm run typecheck && npm test && npm run assets:validate
```
