# Silent Depths — agent memory

**Last sync:** 2026-09-26. Rolling status is `tasks/state.md`. Release claims are `docs/release/solo-production-status.md`.

## Architecture

- Gameplay truth is `src/game/sim/**` and `src/game/commands/**`. No Three.js, DOM, or `Math.random`.
- `src/render/**` draws snapshots. `src/core/` still feeds cameras and waves. One canvas, one rAF.
- World default stays `legacy-v1`. Ocean empty-URL default is spectral (`?ocean=gerstner` rolls back). `?quality=` locks the governor.
- HUD clicks must not plot waypoints (`shouldDispatchWorldInteract`). A canvas click is pointer-up within 3px of pointer-down. Playwright `locator.click` on `#scene` stalls; e2e uses `page.mouse.click`.

## Weapons

- Tubes aim within 60° of the bow. The fish is spawned at the boat's center and runs at constant speed. No drag, buoyancy, or tube offset.
- Mk-14 holds heading and chases target depth. Mk-18 and enemy fish also turn. Sub depth is 0.32, surface ships 0.02. A hit needs `|dz| <= 0.2`.
- Deck gun, inside 8.5 units and shallower than 0.14, applies damage with no projectile. Charges sink at a constant rate until the fuse ends.
- Assistance auto-fire spends ammo only when `assistanceAutoFire` is on. Patrol defaults on. Convoy strike defaults off.
- Quiet escort sweep cap is 18. Loud alert stays ≤15 s. Do not restore the old 60–150 s passive band by raising the cap.
- Key M is 4×. Key V is Deep. Victory copy is "Clear two waves". `VICTORY_TARGET` is still 8.

## Mission

- Convoy strike: sink `strike-merchant`, then reach the exit (radius 4). Seed 19 command-only win is 20.33 sim seconds. The 8.9 s report teleported.
- Exit bearing uses `headingDegrees` (the helm tape). Steering from the raw compass angle as a sim heading sails away from the exit.
- Quick-start v2 (`silent-depths-tutorial-v2`): Steer, Fire, and Survive run the clock and block Next until the action. Depth & stealth pauses. The dodge pattern is ahead on the bow track. Help does not spawn charges.

## Assets and gates

- Production GLBs: `public/assets/models/v2/`. Import from `artifacts/fleet-sources/sources.json`. Never download or commit cookies. Do not edit `.archive/`.
- Do not self-approve GPU FPS, lighting, fleet look, audio listen, soak, fun/feel, world default, hull contrast, or `solo-production`. Plan 017 owns the tag.
- `npm run verify` is typecheck, lint, test, and build. E2E is separate: `npm run test:e2e -- <url>`, `test:e2e:strike`, `test:e2e:tutorial`.
- Commit explicit paths. Do not `git add` `.claude/` or `ambush-bow-forward.png`.
