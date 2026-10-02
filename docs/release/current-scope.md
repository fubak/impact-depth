# Current scope

Silent Depths is a solo desktop game: Vite, TypeScript, and Three.js. The launch target is desktop Chromium with WebGL2.

Co-op, accounts, and auth are Plan 009, and they wait until Plan 017 tags `solo-production`. There is no mid-patrol save. Retry replays the same seed. A new patrol seed is chosen in the menu handler, not in the simulation.

The world default stays `legacy-v1`. The ocean rollback is `?ocean=gerstner`.

Plan 024 is the execution plan for the Plan 023 review. Phase 1 combat rules, the convoy-strike scenario, presentation hooks, and the CI patrol gate are in the working tree. They are not a production sign-off.

These operator gates stay pending:

- GPU at least 55 FPS at the reference scene
- Lighting eye-pass
- Fleet visual ACCEPT
- Audio listen
- Soak playthrough
- Fun and feel on pacing and on the strike
- World-default flip
- The `solo-production` tag

The React, TanStack, mobile, and co-op sections of `docs/prd.md` are historical. This page is the current scope.
