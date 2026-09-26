# Plan 025 phase 1 — input and deploy binding

Commit under test: the commit that adds this note. Environment: local Chrome via Playwright `channel: chrome` was used to reproduce the stall; the three patrol runs below used the repository Playwright Chromium against `http://127.0.0.1:8105/` (production `vite preview`, viewport 1440×900 and compact 1024×700). Invocation: `npm run test:e2e -- http://127.0.0.1:8105/`, three times, no rebuild between runs.

## Cause

`locator.click` on `#scene` never reaches "performing click". After "done scrolling" the actionability loop stalls, the waypoint stays null, and a 30s timeout is reported as a canvas click that then waits on a navigation the page never starts. A `page.mouse.click` at the same pixel delivers pointerdown/pointerup and plots (`PLOT 65,63` in the reproduction). Water clicks do not change `location`.

The input gate also treated any in-gesture jitter over 3px as a drag, so a click that wiggled and came back up on the press point was dropped. Release distance is now measured from the pointer-down point. HUD presses still do not plot: they never set the canvas drag flag.

## Patrol runs

All seven journeys passed on each attempt. Logs: `artifacts/plan-025/phase-1/e2e-1.log`, `e2e-2.log`, `e2e-3.log` (gitignored).

| Run | Result                       |
| --- | ---------------------------- |
| 1   | ok, including targeting-fire |
| 2   | ok, including targeting-fire |
| 3   | ok, including targeting-fire |

## Deploy

`.github/workflows/pages.yml` checks out `workflow_run.head_sha`, writes `dist/BUILD_SHA`, and skips publish when that SHA is no longer `origin/master`. Manual dispatch runs verify, smoke, and patrol E2E on the selected revision before the same build. Failed or cancelled CI does not satisfy the success condition, so it does not deploy. Overlapping commits A and B: only the run whose SHA is still the master tip publishes; `cancel-in-progress` aborts an in-flight pages job when a newer one starts. The same matrix is asserted in `tests/release/pages-publish.test.ts` (`scripts/pages-publish-decision.mjs`). No untested build was published from this session.
