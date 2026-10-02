# Silent Depths

Solo submarine patrol game: deterministic sim, Three.js Caribbean littoral world, command HUD, sonar, and doctrine AI. Built with Vite.

Long-term product contract: `docs/prd.md`. Archived Canvas original: `.archive/silent-depths-project.zip` (read-only).  
**Agent orientation:** `tasks/state.md` · `memory/MEMORY.md` · `AGENTS.md` · `plans/README.md`.

## Play it

**Live build:** https://fubak.github.io/impact-depth/

## How to play

You command a submarine on a stealth patrol. Begin at attack depth and silent running. Stay quiet and deep to avoid detection by enemy hydrophones. When you fire, nearby warships are alerted—expect a hunt. Evade by going deep, using the Evade doctrine, deploying decoys, and screening with bubbles. Each ship you sink salvages one Mk-14 torpedo. Dock at FOB Argus to repair and restock. Clear the sector by sinking 8 ships.

## Controls

| Input | Action |
|-------|--------|
| `W` / `S` | Surge ahead / astern |
| `A` / `D` | Turn port / starboard |
| `Q` / `E` | Trim up / down |
| `Z` | Surface depth |
| `X` | Periscope depth |
| `B` | Attack depth |
| `V` | Deep depth |
| `0` | Stop engines |
| `I` | One-third speed |
| `O` | Two-thirds speed |
| `P` | Flank speed |
| `F` | Fire selected weapon |
| `T` | Cycle / select target |
| `R` | Quiet (silent running) |
| `C` | Deploy countermeasure (bubble screen / decoy) |
| `G` | Blow tanks (emergency surface) |
| `1`–`7` | Tactical / chase / bridge / periscope / free / map / sonar views |
| `Space` | Pause |
| `H` | Look-dev panel |
| **Mouse drag** | Rotate view in all modes |
| **Mouse wheel** | Zoom camera |
| **Left click** / **Right click** | Plot waypoint / fire at target |

HUD tooltips and the Help button expand this list.

## Requirements

- **Browser:** Current Chrome, Edge, Firefox, or Safari with WebGL2 support
- **Hardware acceleration:** Enabled (required for playable framerates)
- **GPU strongly recommended:** Software rendering is very slow

## Accessibility

- **Reduced-motion:** Setting is honored
- **Keyboard:** All HUD controls are keyboard-operable; mouse is optional for world interaction
- **Focus indicators:** Visible on all interactive elements

## Development

```bash
npm ci                      # Install dependencies
npm run typecheck           # Type checking
npm run lint                # Linting
npm run format:check        # Format check
npm test                    # Unit tests
npm run test:coverage       # Test coverage report
npm run verify              # Full gate (typecheck + lint + test + build)
npm run build               # Production build
npm run preview             # Preview production build
npm run test:smoke <url>    # Browser smoke test
npm run test:e2e <url>      # Patrol E2E tests
npm run assets:validate     # Validate assets
npm run assets:import-modern # Import staged assets
```

## Requirements (build)

- Node.js 20+

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open the printed local URL (often `http://localhost:8080` or the next free port).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production bundle |
| `npm run preview` | Preview production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (sim, combat, HUD commands, assets mapping, …) |
| `npm run assets:validate` | Manifest/GLB/license gate for `models/v2` |
| `npm run assets:import-modern` | Normalize staged sources → `public/assets/models/v2` |
| `npm run assets:export` | Bake procedural fleet GLBs (careful: may not overwrite external heroes) |
| `npm run verify` | typecheck + lint + test + build |
| `npm run test:e2e -- <url>` | In-patrol Playwright journeys |
| `npm run test:visual -- <url>` | Visual capture into `artifacts/visual/` |

## Controls (summary)

| Input | Action |
|-------|--------|
| `W` `A` `S` `D` | Surge / turn |
| `Q` / `E` | Depth trim |
| `Z` `X` `B` `V` | Depth orders |
| `0` `I` `O` `P` | Speed orders |
| `F` / RMB | Fire |
| `T` | Cycle / pick target |
| `R` | Quiet (silent) |
| `C` | Bubble screen |
| `1`–`7` | Camera / POV modes |
| `Space` | Pause |
| `H` | Look-dev panel |
| Help (HUD) | Tutorial |

Bottom help strip and HUD tooltips expand this list. Full command paths go through the game API.

## Assets

- Production meshes: `public/assets/models/v2/` (manifest v5)
- Staging / licenses: `artifacts/fleet-sources/`
- Fallbacks: `src/render/vessels.ts`
- Credits: Look-dev panel → **ASSET CREDITS**

## Architecture

```
src/
  game/       # authoritative deterministic sim, commands, waves, AI
  core/       # look-dev settings, waves, terrain helpers
  render/     # Three.js scene, ocean, assets registry, LOD
  input/      # keyboard / pointer → intents
  ui/         # HUD, tutorial, overlays, look-dev
  app.ts      # composition root
tests/
public/assets/
```

## Release status

- Technical RC: tag `solo-rc` (Plan 008) — **not** production complete.
- Status ledger: `docs/release/solo-production-status.md`
- Deploy notes: `docs/release/solo-production.md` (Cloudflare Pages)

## Scope notes

Combat, waves, sonar, FOB, and doctrine AI are in-tree. Co-op (Plan 009) remains deferred until after Plan 017.

## Target display

Optimized for **1440×900** desktop Chromium; usable toward **1024×700**.
