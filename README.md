# Silent Depths — Look Development Lab

Caribbean littoral presentation prototype: transparent Gerstner ocean, sandy bathymetry, beach-ringed islands with foliage, and three instrument modes (tactical / periscope / sonar). Built for mood and visual tuning before full production.

This is **not** the full Silent Depths combat sim. Co-op, weapons, AI combat, and production assets are out of scope. See `docs/prd.md` for the long-term product contract. The original Canvas project is preserved in `.archive/silent-depths-project.zip` (do not modify).

## Requirements

- Node.js 20+ recommended
- Desktop Chromium with a GPU

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open **http://localhost:8080** (bound to `0.0.0.0:8080`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite look-dev server |
| `npm run build` | Typecheck + production bundle |
| `npm run preview` | Preview production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (waves / terrain / settings / sim) |

## Controls

| Input | Action |
|-------|--------|
| `W` `A` `S` `D` | Surge / turn |
| `Q` / `E` | Rise / dive (depth trim) |
| Mouse drag | Orbit (tactical) or look (periscope) |
| Mouse wheel | Dolly orbit radius (tactical) |
| `1` | Tactical view |
| `2` | Periscope view |
| `3` | Sonar PPI plot |
| `Space` | Pause / resume |
| `H` | Toggle look-dev panel |

## Modes

1. **Tactical** — elevated cinematic view with transparent ocean, seabed, islands, ships, range rings, optional grid.
2. **Periscope** — waterline FOV with mast/optic height, optical vignette, bearing tape, reticle. Own hull is hidden in this mode.
3. **Sonar** — graphic circular PPI with sweep, contact traces, and acoustic telemetry (HTML canvas over the WebGL scene).

## Look-dev panel

Grouped live controls (instrument chrome stays dark):

- **Atmosphere** — time of day, haze, exposure, sun elevation / azimuth / intensity
- **Ocean** — clarity, absorption, sea state, wave height, choppiness, foam, deep/shallow colors
- **Littoral** — sand, foliage, rock/mountain colors
- **Presentation** — HUD opacity, label density, film grain, vignette, tactical grid
- **Presets** — Caribbean Noon (default), Trade Wind Morning, Golden Cay
- **Reset** / **Copy settings JSON** · panel-only FPS

Settings persist in `localStorage` under `silent-depths-lookdev-v4`. Defaults and presets live in `src/core/settings.ts`. Wave components: `src/core/waves.ts`. Terrain helpers: `src/core/terrain.ts`. Tactical grid is off by default (toggleable in the panel).

## Architecture

```
src/
  core/       # settings, Gerstner sampling, terrain, fixed-timestep vessel sim (no Three)
  render/     # WebGL renderer, transparent ocean, seabed, islands/foliage, atmosphere
  input/      # keyboard / pointer
  ui/         # HUD, look-dev panel, periscope & sonar overlays
  app.ts      # composition root
tests/        # pure helper tests
```

Simulation state is independent of the renderer. Vessel motion uses a fixed `1/60` timestep with bounded hitch catch-up.

## Scope boundaries

**In scope:** one WebGL context, custom 4-component Gerstner ocean (transparent), procedural Caribbean littoral, three presentation modes, live look-dev, keyboard/mouse helm, accessibility basics, deterministic helper tests.

**Out of scope:** combat, multiplayer, FFT/SPH water, glTF production assets, React shell, mobile-first UX.

## Accessibility

- High-contrast dark instrument chrome over the bright world canvas
- Keyboard-operable look-dev controls with visible `:focus-visible` rings
- `prefers-reduced-motion` reduces film grain animation and sonar sweep motion

## Target display

Optimized for **1440×900** desktop Chromium; usable down to **1024×700**.
