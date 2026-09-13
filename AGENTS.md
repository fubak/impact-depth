# Silent Depths — agent contract

Read this before changing code. Execute exactly one plan from `plans/` per Cursor session
unless the operator assigns discrete non-plan work (docs, HUD polish, asset import).

**Session orientation:** `tasks/state.md` · **Persistent notes:** `memory/MEMORY.md` · **Claims:**
`docs/release/solo-production-status.md` · **Roadmap:** `plans/README.md`

## Architecture boundaries

- **Game simulation owns gameplay truth.** `src/game/sim/**` (and commands) advance deterministic
  fixed-step state. Keep free of Three.js / DOM.
- **Look-dev core** (`src/core/`) still feeds vessel attitude / waves for presentation; do not
  reintroduce gameplay authority into the renderer.
- **Rendering consumes snapshots.** `src/render/` draws from sim/adapted snapshots; no gameplay authority.
- **Asset packing:** production GLBs live under `public/assets/models/v2/` (immutable CDN path).
  Sources and licenses: `artifacts/fleet-sources/`. Commands: `assets:import-modern`, `assets:validate`.
  Never download/scrape inside the importer; never commit cookies/secrets.
- **Input emits commands.** `src/input/` and HUD translate keys/pointers into intents. Canvas world
  interact must remain gated so HUD buttons do not plot waypoints (`shouldDispatchWorldInteract`).
- Do not migrate to React, TanStack, auth, or multiplayer before Plan 017 / Plan 009 gate.

## Exact commands

| Purpose               | Command                                                     |
| --------------------- | ----------------------------------------------------------- |
| Install               | `npm ci`                                                    |
| Typecheck             | `npm run typecheck`                                         |
| Lint                  | `npm run lint`                                              |
| Format check          | `npm run format:check`                                      |
| Unit tests            | `npm test`                                                  |
| Coverage              | `npm run test:coverage`                                     |
| Watch tests           | `npm run test:watch`                                        |
| Asset validate        | `npm run assets:validate`                                   |
| Asset import          | `npm run assets:import-modern`                              |
| Procedural GLB export | `npm run assets:export`                                     |
| Production build      | `npm run build`                                             |
| Preview build         | `npm run preview`                                           |
| Browser smoke         | `npm run test:smoke` (pass serving base URL if not `:8080`) |
| Patrol E2E            | `npm run test:e2e -- <url>`                                 |
| Full gate             | `npm run verify`                                            |

Before finishing a milestone: `npm ci && npm run verify`, then `npm run build && npm run preview` in one terminal and browser smoke/e2e in another when the plan requires browser proof. When assets change: also `npm run assets:validate`.

## Archive rule

`.archive/` is reference-only. Inspect with `unzip -p` / `unzip -l`. Never modify, delete, or overwrite archive contents.

## Secrets

Do not commit credentials, `.env` files, private keys, tokens, or Sketchfab session cookies. If you discover one, report its path and type only — do not print the secret.

## One plan per session

Follow `plans/NNN-*.md` step by step. Honor every scope boundary, verification gate, and STOP condition. Update that plan’s row in `plans/README.md` and `tasks/state.md` when done. Do not start the next plan in the same session unless the operator explicitly continues the same milestone for a fix.

Do **not** self-approve operator gates (GPU FPS, soak, lighting eye-pass, fleet visual accept, production tag).

## Performance target

Desktop Chromium/WebGL2 with a GPU is the launch target. Treat **≥55 FPS** at the desktop reference scene as the bar Plan 008/017 will enforce. The FPS probe is informational for agents on software renderers; do not regress the playable loop.

## Playable build after each milestone

Every completed plan must leave `npm run build` and `npm run preview` working. A green unit suite alone is not enough when the plan names browser or visual gates.
