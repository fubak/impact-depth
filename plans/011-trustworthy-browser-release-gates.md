# Plan 011: Make browser and release gates prove real gameplay

> **Executor instructions:** Follow this plan step by step. Execute only this plan in this
> Cursor session. Run every verification command and confirm the expected result before
> moving on. Do not mark any operator/GPU/manual criterion complete from agent automation.
> Update only this plan's row in `plans/README.md` when the machine gates pass.
>
> **Drift check (run first):** `git diff --stat 4da4d3f -- package.json scripts tests/e2e docs/release plans/008-solo-launch-gate.md plans/README.md`
> This plan was written against commit `4da4d3f` plus the dirty Plan 010 worktree on
> 2026-08-03. Preserve that work. If the files no longer match the current-state facts below,
> stop and report the drift rather than resetting or overwriting it.

## Status

- **Priority:** P1
- **Effort:** M (2–4 days)
- **Risk:** LOW
- **Depends on:** Plan 010 worktree preserved
- **Category:** tests, correctness, docs
- **Planned at:** commit `4da4d3f` + dirty Plan 010 snapshot, 2026-08-03

## Why this matters

The current release evidence can pass without entering a patrol. `test:e2e` aliases the
menu smoke, and the visual capture script changes camera modes behind the Begin Patrol
overlay. Plan 008 is marked complete even though its own release notes say GPU, wall-clock
soak, deployment, and human playthrough gates remain unproven. Every later polish plan needs
honest automation and honest status reporting first.

## Current state

- `package.json:24` defines `test:e2e` as `npm run test:smoke`.
- `scripts/browser-smoke.mjs` loads the menu and changes Digit1/4/7; it never clicks Begin.
- `scripts/visual-golden.mjs:29-34` captures five modes without starting or skipping the tutorial.
- `tests/e2e/` contains only `helpers.mjs`.
- `plans/008-solo-launch-gate.md:44-49` checks off GPU, two-hour soak, deploy/rollback,
  and ship readiness.
- `docs/release/solo-rc.md:29-37,50-52` says those same items are directional, missing,
  or operator-run.
- Browser automation conventions live in `scripts/browser-smoke.mjs`: shared viewport and
  Chromium arguments come from `tests/e2e/helpers.mjs`; errors are collected from both
  `console` and `pageerror`; JSON and screenshots go under ignored `artifacts/`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | 25+ files pass |
| Build | `npm run build` | exit 0 |
| E2E | `npm run test:e2e -- http://127.0.0.1:8080/` | real patrol journeys pass |
| Visual | `npm run test:visual -- http://127.0.0.1:8080/` | unobscured patrol captures and report |
| Full gate | `npm run verify` | exit 0 |

## Scope

**In scope:**

- `package.json`
- `scripts/browser-smoke.mjs`
- `scripts/visual-golden.mjs`
- `scripts/e2e-patrol.mjs` (create)
- `tests/e2e/helpers.mjs`
- `docs/release/solo-rc.md`
- `docs/release/solo-production-status.md`
- `plans/008-solo-launch-gate.md`
- `plans/README.md`

**Out of scope:** simulation balance, rendering implementation, production assets, audio,
co-op, deploying a site, and changing `.archive/`.

## Git workflow

- Preserve all pre-existing dirty files; do not reset, clean, or reformat unrelated work.
- Use a branch such as `cursor/011-browser-release-gates` if the operator requests a branch.
- Match the repository's imperative commit style, for example `Prove patrol journeys in browser gates`.
- Do not push, tag, deploy, or open a PR unless explicitly requested.

## Steps

### Step 1: Separate smoke from real E2E

Keep `test:smoke` as a fast boot/WebGL/menu sanity check. Create
`scripts/e2e-patrol.mjs` and point `test:e2e` directly at it. The E2E runner must:

1. load the production preview and record response status, console errors, and page errors;
2. click Begin Patrol, assert `game phase` is observable through UI text, and skip the tutorial;
3. verify tactical, chase, bridge, periscope, map, and sonar modes by their visible UI state;
4. exercise pause/resume, depth and speed controls, keyboard target cycling, and one legal fire;
5. verify the HUD changes rather than merely checking that a button exists;
6. restart from a result if a deterministic journey reaches one, or run a separate bounded
   restart journey without adding production-only test hooks;
7. run at both 1440x900 and 1024x700 and assert critical controls are visible and clickable;
8. fail on any console/page error or failed network request for a required first-party asset.

Use multiple short named journeys so a failure identifies the broken behavior. Do not sleep
for long combat outcomes; use deterministic existing UI flows and bounded polling.

**Verify:** `npm run lint && npm run test:e2e -- http://127.0.0.1:8080/` -> all named
journeys pass after a production preview is running.

### Step 2: Make visual capture enter gameplay

Update `scripts/visual-golden.mjs` to click Begin Patrol, wait for required assets, skip the
tutorial, and confirm neither `#patrol-overlay` nor the tutorial modal obscures the canvas.
Capture tactical, chase, bridge, periscope, map, and sonar. Include viewport, mode, quality,
overlay visibility, console errors, and renderer string in `artifacts/visual/report.json`.
Screenshots remain human-review artifacts, not self-approved visual PASS results.

**Verify:** inspect `artifacts/visual/report.json`; it must report `phase: playing`, no blocking
overlay, six modes, and zero errors. `npm run test:visual -- http://127.0.0.1:8080/` exits 0.

### Step 3: Correct historical release status

Reconcile Plan 008 and release docs. Distinguish:

- automated technical RC gates that passed;
- directional software-renderer measurements;
- operator-only GPU, visual, wall-clock soak, playthrough, deploy, and rollback gates;
- final content gaps being handled by Plans 011–017.

Uncheck or label as unproven any criterion that lacks evidence. Never rewrite git history or
move the existing `solo-rc` tag. Describe it as a technical RC, not `solo-production`.

**Verify:** `rg -n "PASS|DONE|\[x\]" plans/008-solo-launch-gate.md docs/release/solo-rc.md docs/release/solo-production-status.md`
must show no unconditional PASS for a gate still documented as operator-required.

### Step 4: Run the complete machine gate

Run a clean production preview for browser tests, then run all repository verification.
Record exact command, commit/worktree identity, Chromium version, viewport, and result in the
release notes. Do not record SwiftShader/llvmpipe as GPU proof.

**Verify:** `npm run verify`, `npm run test:e2e`, and `npm run test:visual` all exit 0.

## Test plan

- Named browser journeys: boot/start/tutorial, helm/navigation, targeting/fire, POV switching,
  pause/resume, restart, and 1024x700 keyboard/mouse reachability.
- Regression: `test:e2e` must fail if Begin Patrol is not clicked or a blocking modal remains.
- Regression: `test:visual` report must fail if it captures menu phase.
- Use `scripts/browser-smoke.mjs` as the structural error-collection pattern.

## Done criteria

- [x] `test:e2e` no longer aliases `test:smoke`.
- [x] E2E enters a patrol and exercises real commands at both required viewports.
- [x] Visual captures are unobscured in-patrol frames with a machine-readable report.
- [x] Release documents make unproven operator gates explicitly pending.
- [x] `npm run verify`, `npm run test:e2e`, and `npm run test:visual` exit 0.
- [x] No files outside scope were intentionally changed; `.archive/` is untouched.

## STOP conditions

- Browser journeys require a production-only debug mutation hook to pass.
- A test can only pass by increasing timeouts without identifying the slow operation.
- Existing dirty work would need to be reset or overwritten.
- An operator-only gate is requested to be marked PASS without operator evidence.

## Maintenance notes

Every future plan that changes input, render, audio, or assets must add or update an actual
patrol journey. Keep smoke fast, E2E behavioral, visual captures human-reviewed, and GPU
performance separately authoritative.

