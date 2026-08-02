# Plan 001: Establish the production and Cursor execution baseline

> **Executor instructions:** Follow this plan step by step. Run every verification command before moving on. Modify only the in-scope files. If a STOP condition occurs, report it instead of improvising. When complete, update this plan's row in `plans/README.md`.
>
> **Drift check:** Run `sha256sum -c plans/BASELINE.sha256`. Every listed file must report `OK` before the first source edit. If it does not, stop and report which files changed.

## Status

- **Priority:** P1
- **Effort:** M (2–4 days)
- **Risk:** LOW
- **Depends on:** none
- **Category:** DX, tests, architecture
- **Planned at:** unversioned filesystem snapshot, 2026-08-02

## Why this matters

The current prototype has a useful `typecheck`, 34 unit tests, and a production build, but no Git history, lint/format check, browser smoke test, deterministic replay test, CI, or agent-specific operating contract. Every later plan touches high-risk simulation or rendering code; Cursor needs a machine-checkable baseline before those changes begin.

## Current state

- `package.json:7-14` defines dev, build, typecheck, and Vitest only.
- `tests/sim.test.ts:20-153` covers movement, pause, fixed stepping, and contact recycling, but not a browser or replay.
- `src/app.ts:135-168` is the production loop and already uses a bounded fixed-step accumulator.
- The archive contains useful patterns at `scripts/browser-smoke.mjs:14-41` and `scripts/fps-bench.mjs:3-45`; inspect them with `unzip -p`, never by modifying the archive.
- Code style is strict TypeScript, single quotes, semicolons, two-space indentation; match existing `src/core/sim.ts` and `tests/sim.test.ts`.

## Commands

| Purpose | Command | Expected |
|---------|---------|----------|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Unit tests | `npm test` | 34 current tests plus new baseline tests pass |
| Build | `npm run build` | exit 0; chunk warning may remain for now |

## Scope

**In scope:** `.gitignore`, `package.json`, `package-lock.json`, `eslint.config.js`, `.prettierrc`, `AGENTS.md`, `.github/workflows/ci.yml`, `scripts/browser-smoke.mjs`, `scripts/fps-bench.mjs`, `tests/replay.test.ts`, `tests/e2e/**`, and plan status metadata.

**Out of scope:** `docs/prd.md`, `.archive/**`, gameplay behavior, visual changes, React/TanStack migration, deployment, multiplayer.

## Steps

### Step 1: Establish local version control and the agent contract

If `.git` is absent, run `git init`, add a private/local baseline commit, and do not add a remote or publish anything. Add `AGENTS.md` with: architectural boundaries, exact commands, `.archive` read-only rule, no secrets rule, one-plan-per-session rule, performance target, and requirement to preserve a playable build after each milestone. Record the baseline commit SHA in `plans/README.md`.

**Verify:** `git status --short` is empty after the baseline commit; `git log -1 --oneline` returns one local commit.

### Step 2: Add deterministic code-quality commands

Add ESLint and Prettier in check mode, without auto-formatting unrelated files. Add scripts: `lint`, `format:check`, `test:coverage`, and `verify` (`typecheck`, lint, tests, build). Keep `test:watch`. Configure generated output and archive exclusions.

**Verify:** `npm run lint && npm run format:check && npm run typecheck` exits 0.

### Step 3: Add browser smoke and performance probes

Adapt the archived Playwright scripts to this app. Browser smoke must load the local production preview, assert one WebGL canvas, switch tactical/periscope/sonar with Digit1–3, fail on page/console errors, and store artifacts under an ignored `artifacts/` directory. The performance probe must report median and p95 frame time over a fixed interval; it is informational until Plan 008.

**Verify:** `npm run build`; start `npm run preview`; `npm run test:smoke` exits 0 in Chromium and records no application console errors.

### Step 4: Add a deterministic replay seed test

Create a headless test that applies a timestamped command sequence twice to the fixed-step sim and compares canonical snapshots. It can cover only current movement state now, but must establish the reusable replay fixture and stable serializer.

**Verify:** `npm test -- tests/replay.test.ts` passes and fails when a deliberate non-seeded value is temporarily introduced.

### Step 5: Add CI

Add a GitHub Actions workflow for Node 20 that runs `npm ci`, `npm run verify`, and the headless browser smoke test. Cache npm downloads, not build output. Do not deploy or publish.

**Verify:** validate workflow YAML locally if a validator is available; otherwise `npm run verify` and `npm run test:smoke` must pass before completion.

## Verification

- `npm ci && npm run verify` exits 0 from a clean install.
- `npm run test:smoke` passes tactical, periscope, and sonar in Chromium with no application console errors.
- `npm test -- tests/replay.test.ts` proves identical command streams reproduce identical snapshots.

## Test plan

- Replay equality after 600 fixed steps.
- Replay divergence when one input command differs.
- Browser mode switching, canvas presence, no page errors, and viewport 1440×900.
- Model new tests after `tests/sim.test.ts` and archived `scripts/browser-smoke.mjs`.

## Done criteria

- [x] Local Git baseline exists with no remote created.
- [x] `npm run verify` exits 0.
- [x] Browser smoke covers all three current modes with zero application console errors.
- [x] Deterministic replay fixture exists and passes.
- [x] CI runs the same gates.
- [x] No changes under `.archive/` or `docs/prd.md`.

## STOP conditions

- Any baseline hash differs before work starts.
- A credential or committed environment file is found; report its location/type only.
- Playwright requires weakening browser security flags beyond normal headless Chromium operation.
- Establishing the baseline would publish code or create a remote.

## Maintenance notes

All later plans add cases to replay and browser smoke. A green build alone never constitutes completion. Keep generated screenshots, traces, coverage, and benchmark output ignored.
