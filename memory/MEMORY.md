# Silent Depths — agent memory

**Project:** impact-depth / Silent Depths  
**Last sync:** 2026-09-11  
**SSOT for rolling status:** `tasks/state.md`  
**Long plans:** `plans/README.md`  
**Release claims:** `docs/release/solo-production-status.md`

## Product fact

Playable solo patrol sim on Three.js/Vite (not look-dev only). Deterministic game domain in `src/game/sim/**`; look-dev sim in `src/core/` still feeds render cameras. Default local URL often `:8800` when 8080 is busy.

## Architecture

- **Authoritative sim:** `src/game/sim/**` + `src/game/commands/**` — pure TS, fixed step, no Three.
- **Render:** `src/render/**` — glTF registry, LOD, ocean, vessels fallbacks. Plan 018
  introduced `EnvironmentController` + Gerstner backend (`three@0.185.0`). Spectral is not
  live; it fails closed onto Gerstner. Do not add a second canvas or rAF. Presentation
  weather (calm/breeze/storm) is look-dev only; `?quality=` locks the governor. HDR pack
  is not staged (self-only CSP).
- **World versions:** default gameplay is `legacy-v1`. `getWorld('littoral-v2')` is a CPU
  1 m signed-metre field (islands + seabed + corridor deepen ≤28 m). Do not switch
  `createGame` defaults until Plan 018 operator acceptance.
- **UI:** `src/ui/hud.ts` (throttled ~8 Hz), tutorial, look-dev panel, sonar/periscope overlays.
- **Input:** canvas world interact gated so HUD clicks do not plot waypoints (`shouldDispatchWorldInteract`).

## Fleet / assets (2026-08-04)

- Production content: **`public/assets/models/v2/*.glb`** + manifest **v5**.
- **Do not overwrite** immutable older path bytes; new content = new path (v2+) or new name.
- Import: `artifacts/fleet-sources/sources.json` → `npm run assets:import-modern` → `npm run assets:validate`.
- Importer **never downloads** and never reads cookies.
- Class sources (distinct meshes):
  - CC-BY Sketchfab: player LA (`sub_nautilus`), Akula (`uboat`), Visby **destroyer only**
  - CC0 Kenney watercraft: patrol, cruiser, battleship, freighter, fob, crate
  - CC0 OGA light plane → aircraft (Blender export to `staging/aircraft_src.glb`)
  - Project procedural: torpedo (+ `src/render/vessels.ts` fallbacks)
- Runtime: preload gate (no player procedural flash), LOD distances `[40,120,280]`, hot-swap contacts after preload, Look-dev **ASSET CREDITS** from ledger.
- Plan **015** is **partially** complete — machine pipeline + distinct GLBs + LOD/preload yes; operator visual acceptance per class **not** closed.

## Combat / AI facts worth remembering

- Ambush/Stalk/Intercept **stand down to Manual** when preferred contact dies (no auto-retask NEW CONTACT).
- Depth/speed HUD orders intentionally cancel doctrine autopilot.
- Torpedoes: short arm, segment hits, lead aim; fire depth gated.
- HUD world click bug fixed: only canvas-origin pointer sequences dispatch world interact.

## HUD (2026-08-04 clarity pass)

- Labels: Quiet, Home, Manual, Clear route, Bubbles, Decoy, Ping; Gear/Doctrine fold (localStorage `silent-depths-hud-panels-v1`, default expanded).
- Tooltips via `title` + `data-tip`; map legend; fewer ORDERS duplicates.
- Selectors for automation: keep `data-action` / `data-value` (e2e).

## Operator gates (never agent-self-approve)

- GPU ≥55 FPS @ 1440×900, 2h soak, human playthroughs, lighting eye-pass, live deploy/rollback, visual acceptance of fleet silhouettes.
- Tag `solo-production` only via Plan 017.

## Commands

```bash
npm run typecheck && npm test
npm run assets:validate
npm run assets:import-modern   # after source GLB changes
npm run verify                   # full gate when touching release-critical paths
# e2e / visual need a serving preview URL
npm run test:e2e -- http://127.0.0.1:8800/
```

## Do not

- Commit Sketchfab cookies / secrets / private downloads.
- Scale one corvette into all surface classes again.
- Claim solo-production or operator visual PASS from HTTP 200 alone.
- Modify `.archive/`.
- Push tags or remotes unless the operator asks.
