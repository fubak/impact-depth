# Silent Depths — agent memory

**Last sync:** 2026-09-26. Rolling status is `tasks/state.md`. Release claims are `docs/release/solo-production-status.md`.

## Architecture

- Gameplay truth is `src/game/sim/**` and `src/game/commands/**`. No Three.js, DOM, or `Math.random`.
- `src/render/**` draws snapshots. `src/core/` still feeds cameras and waves. One canvas, one rAF.
- World default stays `legacy-v1`. Ocean empty-URL default is spectral (`?ocean=gerstner` rolls back). `?quality=` locks the governor.
- HUD clicks must not plot waypoints (`shouldDispatchWorldInteract`). A canvas click is pointer-up within 3px of pointer-down. Playwright `locator.click` on `#scene` stalls; e2e uses `page.mouse.click`.

## Weapons

- Tubes aim within 60° of the bow. Fish launch from the bow tube (`sub + heading·0.9`), start at `sub.speed + 2`, and accelerate 7 u/s² to `runSpeed`.
- Mk-14 holds heading and chases target depth. Mk-18 and enemy fish run a passive seeker: ±0.6 rad cone, Mk-18 picks the noisiest ship inside 11 u (fire-control target preferred), enemy fish acquire inside `5 + 12·sub.noise`. No lock → run straight. Lead pursuit, turn-rate limited. A hit needs `|dz| <= 0.2`.
- Deck gun fires real ballistic shells inside 8.5 units and shallower than 0.14 — shell arcs exist and `shellLaunch` is a CombatEvent. Depth charges sink to their pistol depth and detonate there (not the launch depth); hedgehogs are contact-fuzed pattern drops.
- Ships flood, burn (fire decays 0.03/s and bleeds hp), lose propulsion on stern hits (`speedFactor`), and sink over class `sinkDuration` — kills count only at removal; sinking hulls stay on the plots while they go down.
- Escorts listen for the boat's *realized* speed (`ship.actualSpeed`), not the helm order: baffles ×0.3 astern, flow noise ×0.5 above 0.7 of class max, deep blind zone inside 1.3 u. Doctrine: `screen → prosecute → attackRun → reattack → search` with a smoothed predicted datum and max two runners.
- Rudder authority scales with way made — a stopped boat barely turns; dive planes lag depth-rate orders; emergency blow drives a 6 s powered ascent.
- Assistance auto-fire spends ammo only when `assistanceAutoFire` is on. Patrol defaults on. Convoy strike defaults off.
- Quiet escort sweep cap is 18. Loud alert stays ≤15 s. Do not restore the old 60–150 s passive band by raising the cap.
- Bloom ships on the high quality profile only; `?bloom=0` forces off, `?bloom=1` forces on at any quality.
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
