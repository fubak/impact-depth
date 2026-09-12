# Solo production bar — status

**Date:** 2026-08-04  
**Depends on:** technical RC tag `solo-rc` (`4480c3f`) + Plan 010 worktree  
**Production tag:** pending — only Plan 017 may close `solo-production`  
**Rolling agent SSOT:** `tasks/state.md` · **Memory:** `memory/MEMORY.md`

## Claim levels

| Claim | Meaning |
|-------|---------|
| DONE (code/docs) | Landed in tree; covered by automated tests or docs |
| PASS (automated) | Machine gate exited 0 |
| DIRECTIONAL | Soft evidence (e.g. software renderer FPS) — not acceptance |
| PENDING operator | Requires human/GPU/host evidence; agents must not self-approve |
| PARTIAL | Code path landed; remaining steps or content quality still open |

## Phase status

| Phase | Status | Evidence |
|-------|--------|----------|
| A Balance / early death | DONE (code) | `docs/release/balance-notes.md`; `tests/game/survival.balance.test.ts` |
| B GPU FPS gate | PENDING operator | `docs/release/perf-notes.md` — agent host is not GPU proof |
| C glTF fleet | **PARTIAL** (code + v2 content) | `public/assets/models/v2/*` + manifest v5; `npm run assets:validate`; Plan 015 not closed (operator silhouette accept; kenney/CC0 not final warship bar) |
| D Convoy/escort formation | DONE | `tests/game/formation.test.ts` |
| E Authored audio banks | DONE (code; lifecycle polish in 014) | `public/assets/audio/*.wav`; `tests/game/audio.test.ts` |
| F Deploy path | DONE (docs) | `docs/release/solo-production.md`, `public/_headers` (`/assets/models/*` immutable) |
| G Lighting acceptance | PENDING operator (partial code) | `docs/release/lighting-acceptance.md` |
| H Operator gate | PENDING operator | Wall-clock soak + 3 playthroughs + deploy/rollback + tag |
| Plan 011 browser/release honesty | PASS (automated) | See machine-gate evidence below |
| HUD clarity (post-007) | DONE (code) | `src/ui/hud.ts` tooltips/folds/plain labels; tutorial synced; not a standalone plan |

## Fleet content map (v2)

| Kind | Provenance | Notes |
|------|------------|--------|
| sub_nautilus | Sketchfab LA CC-BY | Hero player |
| uboat | Sketchfab Akula CC-BY | Enemy sub |
| destroyer | Sketchfab Visby CC-BY | Escort only — not re-used for other classes |
| patrol / cruiser / battleship / freighter / fob / crate | Kenney Watercraft CC0 | Distinct meshes; stylized civilian pack |
| aircraft | OGA lowpoly plane CC0 | Blender-exported |
| torpedo | project procedural GLB | Fallback geometry family |

Pipeline: `artifacts/fleet-sources/sources.json` → `npm run assets:import-modern` → `models/v2` → `npm run assets:validate`. Runtime LOD `[40,120,280]`, preload gate, credits in Look-dev panel.

## Plan 011 machine-gate evidence

| Item | Value |
|------|-------|
| Commands | `npm run verify` (exit 0); `npm run build`; `npx vite preview --host 127.0.0.1 --port 8082 --strictPort`; `npm run test:e2e -- http://127.0.0.1:8082/`; `npm run test:visual -- http://127.0.0.1:8082/` |
| Preview port note | Host `:8080` occupied by unrelated collector (`404 page not found`); production preview served on **8082** for this gate run |
| Worktree | dirty Plan 010+011 preserved (no reset/clean) |
| Commit tip | `4da4d3f10d64315ae8adcb6276788ef1683ef637` + uncommitted work |
| Viewport | 1440×900 primary; 1024×700 compact E2E |
| Playwright / Chromium | Playwright `1.62.1` (bundled Chromium) |
| `test:e2e` | exit 0 — journeys: boot-start-tutorial, pov-switching, helm-navigation, targeting-fire, pause-resume, restart-reentry, compact-viewport-reachability |
| `test:visual` | exit 0 — `artifacts/visual/report.json` reports `phase: playing`, six modes, overlays hidden, zero errors |
| Renderer note | Visual report renderer: SwiftShader — **not** GPU proof |

## How to finish (Plan 017)

1. GPU desktop: run `npm run test:perf -- <preview-url>` and paste into `perf-notes.md`.
2. Human playthroughs (stealth / loud / FOB) + wall-clock soak ≥2h.
3. POV/night lighting eye-pass and visual review of `artifacts/visual/` **and fleet class silhouettes**.
4. Live deploy + rollback rehearsal.
5. Tag `solo-production` when satisfied; then Plan 009.

## Verify

```bash
npm ci && npm run verify
npm run assets:validate
npm run build && npm run preview   # terminal A (:8080 when free)
npm run test:e2e -- http://127.0.0.1:8080/   # terminal B
npm run test:visual -- http://127.0.0.1:8080/
```
