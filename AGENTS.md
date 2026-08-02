# Silent Depths — agent contract

Read this before changing code. Execute exactly one plan from `plans/` per Cursor session.

## Architecture boundaries

- **Simulation owns gameplay truth.** `src/core/` advances fixed-step state and accepts commands. Keep it deterministic and free of Three.js / DOM.
- **Rendering consumes snapshots.** `src/render/` draws from sim state; it must not own gameplay authority.
- **Input emits commands.** `src/input/` and UI translate keys/pointers into intents or view-mode changes; they do not mutate sim fields ad hoc outside the command path.
- Do not migrate to React, TanStack, auth, or multiplayer before the solo launch gate (see Plan 009).

## Exact commands

| Purpose | Command |
|---------|---------|
| Install | `npm ci` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Format check | `npm run format:check` |
| Unit tests | `npm test` |
| Coverage | `npm run test:coverage` |
| Watch tests | `npm run test:watch` |
| Production build | `npm run build` |
| Preview build | `npm run preview` |
| Browser smoke | `npm run test:smoke` (preview must be serving on `:8080`) |
| Full gate | `npm run verify` |

Before finishing a milestone: `npm ci && npm run verify`, then `npm run build && npm run preview` in one terminal and `npm run test:smoke` in another when the plan requires browser proof.

## Archive rule

`.archive/` is reference-only. Inspect with `unzip -p` / `unzip -l`. Never modify, delete, or overwrite archive contents.

## Secrets

Do not commit credentials, `.env` files, private keys, or tokens. If you discover one, report its path and type only — do not print the secret.

## One plan per session

Follow `plans/NNN-*.md` step by step. Honor every scope boundary, verification gate, and STOP condition. Update that plan’s row in `plans/README.md` when done. Do not start the next plan in the same session unless the operator explicitly continues the same milestone for a fix.

## Performance target

Desktop Chromium/WebGL2 with a GPU is the launch target. Treat **≥55 FPS** at the desktop reference scene as the bar Plan 008 will enforce. The FPS probe is informational until then; do not regress the playable loop.

## Playable build after each milestone

Every completed plan must leave `npm run build` and `npm run preview` working. A green unit suite alone is not enough when the plan names browser or visual gates.
