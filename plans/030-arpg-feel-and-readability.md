# Plan 030 — ARPG feel and readability: night/fog/rain look, loot and elites you can see, longer progression, hit juice, a boat label that behaves

> **Status: PLANNED (2026-10-11).** Not started. Branch `plan-030-arpg-feel`. Machine verification only.
> Visual quality (night, fog, overcast, rain, swell), fun/feel, GPU FPS and every other operator gate stay
> **PENDING** and are never self-approved (AGENTS.md).

## 0. How to use this plan (read first)

- One executor agent per task (`P01` … `P21`). Each task is self-contained: it names every file, symbol,
  number and test. **Do exactly what the task says, nothing more.**
- An executor touches **only** the files in its "Files" list. If something outside that list looks wrong, write it in the
  hand-off report. Do not fix it.
- Tests come first. Write the listed tests, run them and watch them fail (or fail to compile). Then implement and run them
  again until they pass.
- Line numbers are from the 2026-10-11 tree (`2928457`). Earlier tasks shift them, so **always find the quoted anchor
  text** and use the line number only as a hint.
- Executors never commit. The orchestrator commits once after each wave (section 6).

## 1. What this plan fixes (playtest critique → tasks)

| # | Problem | Fix | Tasks |
| --- | --- | --- | --- |
| 1 | Storm+night is almost pure black. Fog leaves ships crisp. Overcast at dusk looks like a pink sunset. Rain is 1 px lines with no ripples. No swell or whitecaps show at tactical zoom. | Pure light grade (ambient/moon floor, moon rim, moon glint on water, sky floor at night, desaturation and golden-hour cut for overcast/fog). Fog density about 2.2× stronger. Procedural sky for overcast/fog/rain. Rain streaks drawn as camera-facing quads with a brightness floor. A separate ripple pool. Storm swell and whitecap gains. All parameter-driven, no new shaders. | P04, P06, P07, P08, P09, P14, P17 |
| 2 | Loot rarity and elites are invisible. | Pure rarity/elite style map. Rare/epic crates get size, glow, a light beam, a ring and a pulse. Elites get a gold star on the target card, a gold minimap dot and contact name, and a gold 3D label and beacon. Pickup toast "RARE CRATE: +60 hull". | P03, P11, P12, P18, P19, P20 |
| 3 | Progression is too short. | XP retune: 5 level-ups by the 8th kill. Optional ENDLESS mode ("Keep hunting") with escalating waves. | P01, P02, P10, P16, P21 |
| 4 | No hit juice. | Floating damage numbers (CRIT styled, kill "+XP"), hit-stop on crits and kills, big centred banners. | P11, P15, P18, P21 |
| 5 | The own-boat "NAUTILUS" label is a huge plate floating away from the boat. | Small label, centred on the hull, sized by camera distance with min/max, clamped into the HUD-safe middle of the screen. | P05, P13, P21 |

### Note on "8-kill mission" (honest arithmetic)

`VICTORY_TARGET = 8` (`src/game/sim/constants.ts:5`). Victory also needs `waveCleared` (`systems.ts` damage system,
`const victory = waveCleared && shipsSunk >= VICTORY_TARGET`). Wave 1 has 5 hulls and wave 2 has 10 (`seedWave`), so a patrol
victory really takes **15 kills**. The playtester's "8 kills → 2–4 level-ups" is the first 8 kills. With today's numbers those
give 500 XP, which is level 4 (3 level-ups). This plan therefore pins two reference runs:

- **R8** (the felt experience). Kill list `merchant×3, destroyer, sub, merchant×2, patrol` → **exactly 5 level-ups**.
- **R15** (a full patrol victory with no elite). Kill list
  `merchant×3, destroyer, sub, merchant×4, patrol, destroyer, cruiser, destroyer, battleship, sub` → **exactly 9 level-ups**.

The operator may later want R15 lower. That is a two-constant change (`XP_BASE`, `XP_STEP`) plus the two pinned reference tests.

## 2. Measurable acceptance (loop target)

| # | Criterion | Proof |
| --- | --- | --- |
| B1 | Storm/night: the light grade sets ambient floor ≥ 0.42, moon rim > 0, moon glint > 0, sky floor > 0 per channel; night exposure ×1.3 | `light-grade`, `atmosphere-grade`, `weather-model` unit tests |
| B2 | **Default clear day is the identity.** `presentationFor(DEFAULT)` returns the base settings and `INACTIVE_WEATHER_FX`; `lightGradeFor(DEFAULT) === IDENTITY_GRADE`; `Atmosphere.apply` gives identical lights with no grade; common crates are unchanged; no ripples or streaks when dry | unit tests + full suite unchanged |
| B3 | Fog weather fog density ≥ 0.0085; FogExp2 transmission at 150 m ≤ 0.25 | weather-model unit test |
| B4 | Overcast dusk: desaturate ≥ 0.5 and goldenScale ≤ 0.3; procedural (not HDR) sky for overcast/fog/rain/storm | light-grade + sky-source tests |
| B5 | Rain: quads 0.044 m wide, tint floor 0.32, ripples ≥ 60/s on high from their own pool (caps 96/48/0); low quality and reduced motion draw none | rain + rain-ripples tests |
| B6 | Storm sea: `swellGain ≥ 1.5` and `whitecapGain ≥ 2.5` at storm wind; both exactly 1 at the reference wind | weather-model + sea-gains tests |
| B7 | Rare/epic crates: scale 1.35/1.7, emissive, beam 14/26 m, ring, pulse; common untouched; minimap `crate rare`/`crate epic`; toast "RARE CRATE: +60 hull" | loot-style, loot-beacons, elite-marks, pickup-toasts tests |
| B8 | Elite: target card `★ ` prefix and class `engaged elite`; minimap `ship elite` r=2.0; contact `contact elite`; 3D gold label and beacon | elite-marks + lookdev tests; 3D is a diff review |
| B9 | XP: R8 → level 6, R15 → level 10, first merchant (60 XP) does not level | `xp-curve.test.ts` |
| B10 | Endless is opt-in only. It escalates (HP ×(1+0.15·tier) capped ×2.5, merchant→escort conversions, more elites, alert). It is deterministic and never re-enters `victory` | endless + endless-flow tests |
| B11 | Hit juice: numbers for hits/crits/kills, cap 16, crit hit-stop 0.09 s, kill 0.4 s, elite kill 0.55 s, zero under reduced motion; banners for DOUBLE/TRIPLE KILL, RAMPAGE, BROADSIDE, LEVEL UP; overlays use `pointer-events: none` | hit-numbers, hit-stop, floating-text, banner tests + CSS review |
| B12 | Own label: height = 2.8% of viewport height (clamped 0.35–3.0 m), no lateral offset, centre clamped to NDC x∈[−0.45,0.45], y∈[−0.35,0.55] | label-layout tests + scene diff review |
| B13 | CI green: smoke ×3 (default, storm/night, rain/dusk), Patrol E2E, HUD layout at 1280×720, 1366×768, 1920×1080, 1024×700 | GitHub Actions |

**Not in this table:** "looks good at night / in fog / in rain", "feels juicy" and GPU FPS. Those are operator gates.

## 3. Hard constraints (apply to every task)

1. **Sim purity.** `src/game/sim/**` stays deterministic and immutable: return new objects and never mutate inputs. No
   DOM/Three.js. Randomness comes only from `rngState` or the seeded hash `hashUnit` (`loot.ts`).
2. **No `Math.random` under `src/game/**`.** Do not even write that string in a comment. `tests/game/no-math-random.test.ts`
   greps the raw source of every file under `src/game/`, including `src/game/adapt/`.
3. **Default flow unchanged.** Clear-day default environment → identical render settings. A patrol without "Keep hunting" →
   identical sim. Pinned tests stay green. The **only** intentional pinned-test edits are in P01 (listed there, each with a
   one-line rationale comment).
4. **No browser locally.** Never run Playwright, `npm run preview`, `npm run test:smoke`, `test:e2e*` or any WebGL page.
   Verify with `npx vitest run <files> --maxWorkers=1`, `npm run typecheck` and `npm run lint`. CI runs the browser checks.
5. **No new shaders and no GLSL edits.** Use only built-in materials (`MeshBasicMaterial`, `MeshStandardMaterial`
   emissive, `SpriteMaterial`) and uniform/parameter values. Do not add or remove `THREE.Light`s at runtime: changing the light
   count recompiles every lit material. CI smoke fails on shader compile errors.
6. **E2E hooks unchanged.** Keep every existing `id`, `data-action`, `data-field`, `data-value`, `data-contact`,
   `data-ship-id`, `data-perk-*` and `data-tutorial*` attribute and its value. New hooks are additive only
   (`data-action="endless"`).
7. **Layout.** No new element may use the classes `.hud-block`, `.help-strip`, `.hud-chrome`, `.peri-range`,
   `.peri-bearing`, `.hud-mission`, `.hud-minimap` or `.tutorial-card` (that is the selector set of `scripts/e2e-hud-layout.mjs`).
   Every new overlay root and child has `pointer-events: none`. `tests/e2e/helpers.mjs` `canvasPointIsClear` uses
   `elementFromPoint`, so an overlay that catches the pointer breaks world clicks in E2E.
8. **Reduced motion.** Respect `reducedMotionGates(...)` (`src/ui/error-toast.ts`) or the `reducedMotion` flag passed in:
   no rise, pop or slide animation and no hit-stop, but text still shows.
9. **Size.** New modules stay under 400 lines with new logic in new modules. The large files (`scene.ts` 2163,
   `app.ts` 1247, `hud.ts` 1019, `systems.ts` 1394) only get wiring lines.
10. **Style.** TypeScript strict with `noUnusedLocals`/`noUnusedParameters`. Prettier: single quotes, 100 columns,
    trailing commas. No `console.log`. Export pure functions and constants so they can be tested.
11. Do not touch `.archive/`, `public/assets/`, `plans/` (except the orchestrator's status edits), CI workflows or `scripts/`.

## 4. Context map (verified symbols)

| Area | File | Symbols / anchors |
| --- | --- | --- |
| XP | `src/game/sim/progression.ts` | `XP_PER_KILL`, `xpToNext`, `xpForKill`, `awardXp`, `choosePerk` |
| Elites | `src/game/sim/elites.ts` | `ELITE_NAME_PREFIX = 'ELITE '`, `makeElite`, `applyElites`, `ELITE_XP_MULT = 3` |
| Loot | `src/game/sim/loot.ts` | `hashUnit(seed,tick,key,salt)`, `rarityOf`, `HEALTH_BY_RARITY`, `SEEKERS_BY_RARITY` |
| Waves | `src/game/sim/create.ts` | `seedWave(seed, wave, firstFreighter?, worldVersion?, player?)`, `const shipStats` (line 96) |
| Systems | `src/game/sim/systems.ts` | `applyCommands` chain (`else if (command.type === 'ultimate')` ~409), damage `const victory =` ~1237, pickupsWaves `boardEmpty` ~1319–1323, `seedWave(state.seed, nextWave, …)` ~1366 |
| Commands | `src/game/commands/types.ts` | `GameCommand` union |
| State | `src/game/sim/types.ts` | `GameState` (ends with `ultimateCharge: number;`), `Ship.elite?`, `Powerup.rarity?` |
| Combat events | `src/game/adapt/combat-events.ts` | `CombatEvent` (do **not** change its shape: tests use `toEqual`) |
| Crit message | `src/game/sim/ordnance-physics.ts` ~765 | message id `` `crit-${torpedo.id}-${tick}` ``; detonation id = torpedo id; `hitId` = ship id |
| Weather model | `src/render/environment/weather-model.ts` | `WeatherFx`, `INACTIVE_WEATHER_FX`, `fxFor`, `oceanFor`, `atmosphereFor`, `FOG_DENSITY_PER_VISIBILITY = 0.0045` |
| Sky source | `src/render/environment/sky-source.ts` | `pickSkyLightingSource` |
| IBL | `src/render/environment/outdoor-lighting.ts` | `OutdoorLightingInput`, `update()` (halves fog under HDR) |
| Atmosphere | `src/render/atmosphere.ts` | `evaluateAtmosphere`, `Atmosphere.apply(settings, scene, dt, presentation?)`, `placeRim`, `hemi/ambient/moon/rim` |
| Rain | `src/render/fx/rain.ts` | `RainLayer`, `rainStreakSegment`, `RAIN_RIPPLE_RATE`, `RainFrame` |
| Ocean | `src/render/ocean/spectral-backend.ts:438` `swell?.setGain(…)`; `src/render/ocean.ts:1063` `u.uFoamAmount.value = …` |
| Scene | `src/render/scene.ts` | `ensureLabel` ~1323, labels block ~1759–1806, `syncGame` powerups ~1187, ship beacon ~1579–1593, `updateRain` ~942, `emitRainRipple` ~959, `setQuality` ~618, `setReducedMotion` ~915, `resetEnvironment` ~963, `dispose` ~2064, `atmosphere.apply(` ~1387, `outdoorLighting.update(` ~1397, `environment.prepare(` ~1647 |
| Look-dev adapter | `src/game/adapt/lookdev.ts` ~96–118 | ship object literal |
| Core types | `src/core/types.ts` | `OceanSettings` (39–50), `SurfaceShipState` (92–111) |
| HUD | `src/ui/hud.ts` | `objectiveText` 94–113, `contactsMarkup` 237–246, render target ~522, ships ~725, crates ~731, patch target ~841, ships ~895, crates ~916 |
| Result card | `src/ui/overlays.ts` | `PatrolOverlay` constructor + `render` |
| App | `src/app.ts` | fields ~113–168, threats root ~280–283, `PatrolOverlay` ctor ~244, `beginPatrol` ~501, `restartPatrol` ~517, frame loop ~1007–1016, `cameras.update` ~1022, `updateRain` ~1032, `syncThreats()` ~1048, `projectThreat(x,y,z,w,h)` ~742, `dispose` ~1175 |
| Reduced motion | `src/ui/error-toast.ts` | `reducedMotionGates(reduced) → {shakeScale, freezeScale, emitFlash}` |
| Camera | `src/render/cameras.ts` | `camera: PerspectiveCamera \| OrthographicCamera`; chase radius 26 m fov 55°; tactical 72 m fov 42° |
| Test env | `vite.config.ts` | vitest `environment: 'node'` (no DOM). Test pure functions; DOM classes are reviewed, not unit-tested. Three.js math and constructing objects without WebGL work in node (`new Atmosphere()` is already tested). CSS imports from TS modules work (see `src/ui/tutorial.ts`). |

## 5. Execution order and parallel groups

Tasks in the same wave touch disjoint files and can run in parallel. A wave starts only after the previous wave passes the
gate (section 6).

| Wave | Tasks (parallel) | Depends on |
| --- | --- | --- |
| W1 | P01 XP retune · P02 Endless sim core · P03 Loot/elite style map · P04 Light-grade model · P05 Label layout math · P06 Rain quads · P07 Rain ripple pool | — |
| W2 | P08 Weather model + sky source (needs P04) · P09 Atmosphere grade (P04) · P10 Endless hooks + API (P02) · P11 Hit numbers / pickup toasts / hit-stop (P03) · P12 HUD elite & rarity marks (P03) · P13 Own label in scene (P05) | W1 |
| W3 | P14 Ocean sea gains (P08) · P15 Floating numbers layer (P11) · P16 Endless result card + objective (P10, P12) · P17 Scene weather/rain wiring (P06, P07, P08, P09, P13) | W2 |
| W4 | P18 Banners + juice coordinator (P11, P15) · P19 Loot beacons in scene (P03, P17) | W3 |
| W5 | P20 Elite in 3D (P03, P08, P19) · P21 App wiring (P10, P13, P16, P17, P18) | W4 |

File ownership per wave (no two tasks in one wave share a file):
- `scene.ts`: P13 (W2) → P17 (W3) → P19 (W4) → P20 (W5).
- `hud.ts`: P12 (W2) → P16 (W3).
- `core/types.ts`: P08 (W2) → P20 (W5).
- `app.ts`: P21 only.

Recommended executor models: Haiku for P03, P05, P07, P11, P12, P15, P16; Haiku or Sonnet for the rest. Use Sonnet for
the riskiest tasks: **P08, P09, P10, P13, P17, P21**.

---

## 6. Tasks

Every task's commands block assumes the working directory `C:\github\impact-depth`.

---

### P01 — XP curve and kill XP retune (sim)

**Depends:** none. **Files:** `src/game/sim/progression.ts`, `tests/game/progression.test.ts`,
`tests/game/elites.test.ts`, new `tests/game/xp-curve.test.ts`.
**Do not touch:** `perks.ts`, `elites.ts`, `systems.ts`, `api.ts`, any other test.

**Spec.** In `progression.ts`:
```ts
/** XP per sunk hull, by class. Plan 030: about 5 level-ups by the 8th kill. */
export const XP_PER_KILL: Record<ShipKind, number> = {
  merchant: 60, patrol: 80, destroyer: 120, cruiser: 180, sub: 160, battleship: 340,
};
/** XP to leave level n is XP_BASE + XP_STEP * (n - 1). */
export const XP_BASE = 65;
export const XP_STEP = 30;
export const xpToNext = (level: number): number => XP_BASE + XP_STEP * (level - 1);
/** Level reached from `totalXp` earned since level 1 (pure; same rule as awardXp). Non-finite or <= 0 → 1. */
export function levelForXp(totalXp: number): number
```
Change the doc comment above `xpToNext` to match. `awardXp`, `choosePerk` and `offerPerks` stay unchanged.

**Tests first.** New `tests/game/xp-curve.test.ts`:
- Use `R8 = ['merchant','merchant','merchant','destroyer','sub','merchant','merchant','patrol']` and
  `R15 = ['merchant','merchant','merchant','destroyer','sub','merchant','merchant','merchant','merchant','patrol','destroyer','cruiser','destroyer','battleship','sub']`.
- `'R8 pays 660 XP and reaches level 6 (5 level-ups)'`: the sum of `XP_PER_KILL` is 660 and `levelForXp(660) === 6`.
- `'R15 pays 1700 XP and reaches level 10 (9 level-ups)'`: sum 1700 and `levelForXp(1700) === 10`.
- `'the first merchant kill does not level up'`: `XP_PER_KILL.merchant < xpToNext(1)`, and `levelForXp(60) === 1`.
- `'levelForXp boundaries'`: `0→1, 64→1, 65→2, 159→2, 160→3, -5→1, NaN→1`.
- `'agrees with awardXp stepping'`: `let s = createGame(7); for (const k of R8) s = awardXp(s, XP_PER_KILL[k]);` then
  `s.stats.level === 6`. Do the same for R15, which must give 10.
- `'keeps hull classes ordered'`: merchant < patrol < destroyer < sub < cruiser < battleship.

**Pinned-test edits (intentional; put the rationale comment `// Plan 030 XP retune` on each edited line):**
`tests/game/progression.test.ts`:
1. `leveledOnce` comment → `// 60 + 80 = 140 XP -> level 2, 75 left`.
2. The test `'uses 80 + 60*(n-1) XP…'` → rename it to `'uses 65 + 30*(n-1) XP to leave level n'`. Expect
   `xpToNext(1)=65`, `xpToNext(2)=95`, `xpToNext(5)=185`.
3. `'pays the planned XP by hull class'` → the new table above.
4. `'awards the class XP when a hull goes under, below the level threshold'` → `expect(next.stats.xp).toBe(60)`. The level
   stays 1.
5. `'levels up at the threshold…'` → comment `// 60 + 80 = 140 -> level 2, 75 left`, and `expect(next.stats.xp).toBe(75)`.
6. `'queues further level-ups…'` → comment `// 340 XP: 65 -> L2 (275), 95 -> L3 (180), 125 -> L4 (55)`. Expect
   level 4, xp 55 and perkQueue 2.
7. `'keeps the offer when more XP arrives…'` → comment `// 75 + 200 = 275: 95 -> L3 (180), 125 -> L4 (55)`. Expect
   level 4 and perkQueue 2.
8. `'draws the next queued offer…'` → comment `// level 4, two queued` and `expect(next.perkQueue).toBe(1)`.

`tests/game/elites.test.ts`, test `'awards triple XP through the damage system'`: comments
`// 120 xp -> level 2, 55 left` / `// 360 xp -> level 4, 75 left`. Expect normal level 2 with xp 55, and elite level 4
with xp 75.

**Commands:** `npx vitest run tests/game/xp-curve.test.ts tests/game/progression.test.ts tests/game/elites.test.ts tests/ui/captain-panel.test.ts tests/ui/perk-overlay.test.ts --maxWorkers=1`, then `npm run typecheck`, then `npm run lint`.

**Acceptance:** [ ] the new constants and `levelForXp` are exported [ ] only the listed assertions changed, each with the
rationale comment [ ] the captain-panel and perk-overlay tests pass unchanged [ ] no other file is edited.

---

### P02 — Endless mode sim core (pure)

**Depends:** none. **Files:** new `src/game/sim/endless.ts`; `src/game/sim/types.ts`; `src/game/commands/types.ts`;
`src/game/sim/create.ts` (one word); new `tests/game/endless.test.ts`.
**Do not touch:** `systems.ts`, `api.ts`, `elites.ts`, `loot.ts`, `progression.ts`.

**Edits.**
- `types.ts`: after `ultimateCharge: number;` in `GameState` add
  `/** Plan 030: "Keep hunting" was chosen after victory; waves keep coming and escalate. Absent on a normal patrol. */ endless?: boolean;`
  The field stays **optional and absent** from `createGame` so replays and state equality are unchanged.
- `commands/types.ts`: add `| { type: 'continueEndless' }` with the doc comment
  `/** After a patrol victory: keep playing with escalating waves. Ignored otherwise. */`.
- `create.ts` line 96: `const shipStats` → `export const shipStats`. Change nothing else.

**`endless.ts` spec (all exported):**
```ts
export const ENDLESS_FIRST_WAVE = 3;
export const ENDLESS_HP_STEP = 0.15;
export const ENDLESS_HP_MAX_MULT = 2.5;
export const ENDLESS_MAX_CONVERSIONS = 3;
export const ENDLESS_MAX_ELITES = 3;
export const ENDLESS_ALERT_BASE = 0.5;
export const ENDLESS_ALERT_STEP = 0.1;
export const ENDLESS_ALERT_MAX = 0.85;
export const ENDLESS_MESSAGE = 'ENDLESS HUNT';
const SALT_ENDLESS_ELITE = 21;
const ESCORT_KINDS: ReadonlySet<ShipKind> = new Set(['destroyer', 'patrol', 'cruiser']);

export const endlessTier = (wave: number): number => Math.max(0, wave - (ENDLESS_FIRST_WAVE - 1)); // wave 3 → 1
export const endlessHpMultiplier = (tier: number): number => Math.min(ENDLESS_HP_MAX_MULT, 1 + ENDLESS_HP_STEP * Math.max(0, tier));
export const endlessConversions = (tier: number): number => tier <= 0 ? 0 : Math.min(ENDLESS_MAX_CONVERSIONS, Math.ceil(tier / 2));
export const endlessEliteTarget = (tier: number): number => tier <= 0 ? 0 : Math.min(ENDLESS_MAX_ELITES, 1 + Math.floor(tier / 2));
export const endlessAlert = (tier: number): number => Math.min(ENDLESS_ALERT_MAX, ENDLESS_ALERT_BASE + ENDLESS_ALERT_STEP * Math.max(0, tier - 1));
export function canContinueEndless(state: Pick<GameState, 'phase' | 'scenario' | 'endless'>): boolean // phase==='victory' && scenario==='patrol' && endless!==true
export function continueEndless(state: GameState): GameState
export function escalateWave(seed: number, wave: number, ships: readonly Ship[]): Ship[]
```
- `continueEndless`: if `!canContinueEndless(state)`, return `state` (the same reference). Otherwise return
  `{ ...state, endless: true, phase: 'playing', messages: [...state.messages, { id: \`endless-${state.tick}\`, text: ENDLESS_MESSAGE, ttl: 3 }] }`.
- `escalateWave` (pure; never mutates `ships`; returns `ships` itself, the same reference, when `endlessTier(wave) <= 0`):
  1. **Convert** the last `endlessConversions(tier)` merchants, counting from the **end** of the array and never index 0
     (the convoy anchor). For the k-th conversion (k = 0,1,2) set
     `kind = k % 2 === 0 ? 'destroyer' : 'patrol'` and
     `{ ...ship, kind, name: shipStats[kind].name, hp: shipStats[kind].hp, maxHp: shipStats[kind].hp, speed: shipStats[kind].speed, sinkDuration: SINK_DURATION[kind], formationRole: 'wing', formationAlong: 0, formationLateral: k % 2 === 0 ? 12 : -12 }`.
     Keep `id`, position, `formationAnchorId` and `path`. Import `shipStats` from `./create` and `SINK_DURATION` from
     `./ship-damage`.
  2. **HP**: for every ship with `kind !== 'merchant'`, set `const hp = Math.round(ship.maxHp * endlessHpMultiplier(tier))`
     and `{ ...ship, hp, maxHp: hp }`.
  3. **Alert**: every ship gets `alert: Math.max(ship.alert, endlessAlert(tier))`.
  4. **Elites**: `need = endlessEliteTarget(tier) - (count of ships with elite === true)`. Candidates are the indices whose
     kind is in `ESCORT_KINDS` and whose `elite !== true`. Sort them by `hashUnit(seed, wave, ship.id, SALT_ENDLESS_ELITE)`
     ascending, ties by index. Promote the first `max(0, need)` with `makeElite` (from `./elites`).

**Tests first** (`tests/game/endless.test.ts`; use `seedWave(7, wave)` from `create.ts`, legacy world):
- `'tier, HP, conversions, elites and alert scale as specified'`. Tier: `endlessTier(2)=0`, `(3)=1`, `(7)=5`.
  HP multiplier: tier 1 → 1.15, tier 5 → 1.75, tier 20 → 2.5. Conversions: tier 1→1, 2→1, 3→2, 5→3, 9→3. Elite target:
  tier 1→1, 2→2, 4→3, 9→3. Alert: tier 1→0.5, tier 3→0.7 (`toBeCloseTo`), tier 9→0.85.
- `'returns the same array before the first endless wave'`: `escalateWave(7, 2, ships)` `toBe(ships)`.
- `'wave 3 converts the last merchant, never the anchor'`: with `input = seedWave(7, 3)` and
  `out = escalateWave(7, 3, input)`: `out[0].kind === 'merchant'`, the merchant count is 4, and `out[4].kind === 'destroyer'`
  with `out[4].name.endsWith('DESTROYER')`.
- `'scales warship hull points'`: for every index `i` where `input[i].kind !== 'merchant'` and `out[i].elite !== true` and
  `input[i].elite !== true`: `out[i].maxHp === Math.round(input[i].maxHp * 1.15)` and `out[i].hp === out[i].maxHp`.
- `'promotes at least the elite target'`: wave 3 has ≥ 1 elite and wave 7 has ≥ 3.
- `'raises alert'`: every ship in wave 3 has `alert >= 0.5`.
- `'never mutates its input and is deterministic'`: compare `JSON.stringify(input)` before and after, and
  `escalateWave(7,5,a)` must `toEqual` `escalateWave(7,5,a)`.
- `'caps HP growth'`: at wave 40, non-elite warships have `maxHp === Math.round(base * 2.5)`, where base is the
  `seedWave(7,40)` value.
- `'continueEndless only from a patrol victory'`: build `const s = startMission(createGame(21))`. The function returns
  the same reference for `{...s, phase:'playing'}`, for `{...s, phase:'victory', scenario:'convoy-strike'}` and for
  `{...s, phase:'victory', endless:true}`. For `{...s, phase:'victory'}` it returns phase `'playing'`, `endless === true`
  and a message with text `'ENDLESS HUNT'`.
- `'is off by default'`: `createGame(7).endless === undefined` and `startMission(createGame(7)).endless === undefined`.

**Commands:** `npx vitest run tests/game/endless.test.ts tests/game/no-math-random.test.ts tests/game/elites.test.ts tests/game/scenario-factory.test.ts --maxWorkers=1`, then typecheck, then lint.

**Acceptance:** [ ] `endless` is optional and not set by `createGame` [ ] the escalation order is
convert → HP → alert → elites [ ] no mutation, no rngState read [ ] `create.ts` diff is exactly the one `export` word.

---

### P03 — Loot rarity and elite style map (pure presentation adapter)

**Depends:** none. **Files:** new `src/game/adapt/loot-style.ts`, new `tests/game/loot-style.test.ts`.
**Do not touch:** anything else.

**Spec:**
```ts
import { ELITE_NAME_PREFIX } from '../sim/elites';
import { HEALTH_BY_RARITY, SEEKERS_BY_RARITY } from '../sim/loot';
import type { PowerupKind, PowerupRarity } from '../sim/types';

export interface RarityStyle {
  readonly label: 'COMMON' | 'RARE' | 'EPIC';
  readonly color: number;        // hex for Three.js
  readonly css: string;          // same colour for CSS
  readonly crateScale: number;
  readonly emissive: number;     // MeshStandardMaterial.emissiveIntensity; 0 = leave the crate material alone
  readonly beamHeight: number;   // metres; 0 = no beam
  readonly beamOpacity: number;
  readonly ringRadius: number;   // metres; 0 = no ring
  readonly pulseHz: number;      // 0 = no pulse
}
export const RARITY_STYLES: Readonly<Record<PowerupRarity, RarityStyle>> = {
  common: { label: 'COMMON', color: 0xc8a46a, css: '#c8a46a', crateScale: 1, emissive: 0, beamHeight: 0, beamOpacity: 0, ringRadius: 0, pulseHz: 0 },
  rare:   { label: 'RARE', color: 0x3fa9ff, css: '#3fa9ff', crateScale: 1.35, emissive: 0.6, beamHeight: 14, beamOpacity: 0.32, ringRadius: 2.2, pulseHz: 0.8 },
  epic:   { label: 'EPIC', color: 0xc45bff, css: '#c45bff', crateScale: 1.7, emissive: 0.9, beamHeight: 26, beamOpacity: 0.48, ringRadius: 3.0, pulseHz: 1.3 },
};
export const PULSE_AMPLITUDE = 0.12;
export const rarityStyle = (rarity: PowerupRarity | undefined): RarityStyle => RARITY_STYLES[rarity ?? 'common'];
/** 1 + 0.12·sin(2π·hz·t); exactly 1 under reduced motion, for hz 0, or for non-finite t. */
export function pulseScale(style: RarityStyle, timeS: number, reducedMotion: boolean): number
export const ELITE_STYLE = { label: 'ELITE', color: 0xffc83d, css: '#ffc83d', star: '★', beaconScale: 1.35 } as const;
export const isElite = (ship: { elite?: boolean } | null | undefined): boolean => ship?.elite === true;
export const isEliteName = (name: string): boolean => name.startsWith(ELITE_NAME_PREFIX);
/** Toast for a collected crate, e.g. 'RARE CRATE: +60 hull'. Common/absent rarity has no rarity word: 'CRATE: +35 hull'. */
export function pickupToastText(kind: PowerupKind, rarity: PowerupRarity | undefined): string
```
`pickupToastText` texts (prefix `RARE CRATE: ` / `EPIC CRATE: ` / `CRATE: `):
`health` → `+${HEALTH_BY_RARITY[r]} hull`; `ammo` → `Mk-14 full, +${SEEKERS_BY_RARITY[r]} Mk-18`; `hull` →
`hull upgrade`; `weapon` → `weapon upgrade`; `speed` → `engine upgrade`; `counter` → `decoys and bubbles full`.

**Tests first:** `RARITY_STYLES` rows as above (common is all-neutral: scale 1, emissive 0, beam 0, ring 0, pulse 0); scale
rises common < rare < epic and so does beamHeight; `rarityStyle(undefined) === RARITY_STYLES.common`; `pulseScale`:
reduced → 1, common → 1, rare at t=0 → 1, rare at t = 1/(4·0.8) → 1.12 (`toBeCloseTo`, 6), stays within [0.88, 1.12] for
t in 0..10 step 0.37, NaN t → 1; `isElite({elite:true})` true, `{}` false, `undefined` false; `isEliteName('ELITE DESTROYER')` true,
`'DESTROYER'` false; `pickupToastText('health','rare') === 'RARE CRATE: +60 hull'`,
`('health', undefined) === 'CRATE: +35 hull'`, `('health','epic') === 'EPIC CRATE: +100 hull'`,
`('ammo','rare') === 'RARE CRATE: Mk-14 full, +3 Mk-18'`, `('counter','common') === 'CRATE: decoys and bubbles full'`.

**Commands:** `npx vitest run tests/game/loot-style.test.ts tests/game/no-math-random.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] pure, no DOM/Three.js import [ ] common style is neutral (identity) [ ] the exact toast strings.

---

### P04 — Light grade model (pure)

**Depends:** none. **Files:** new `src/render/environment/light-grade.ts`, new `tests/render/light-grade.test.ts`.
**Do not touch:** `weather-model.ts`, `atmosphere.ts`.

**Spec** (no Three.js import; import `DEFAULT_ENVIRONMENT` and `type Environment` from `../../game/sim/environment`):
```ts
export interface LightGrade {
  readonly ambientFloor: number;      // min HemisphereLight intensity
  readonly ambientAdd: number;        // added to AmbientLight intensity
  readonly moonIntensity: number;     // min moon DirectionalLight intensity at night
  readonly moonRim: number;           // rim light intensity from the moon side at night
  readonly moonGlint: number;         // 0..1 strength of moonlight used as the ocean key light at night
  readonly skyFloor: readonly [number, number, number]; // linear RGB floor for skyTop/skyHorizon/fogColor at night
  readonly desaturate: number;        // 0..1 toward luminance grey (sky, horizon, fog; sun at half)
  readonly goldenScale: number;       // multiplies AtmosphereState.golden (flattens overcast sunsets)
  readonly envIntensityFloor: number; // min scene.environmentIntensity at night
}
export const IDENTITY_GRADE: LightGrade = Object.freeze({ ambientFloor: 0, ambientAdd: 0, moonIntensity: 0, moonRim: 0,
  moonGlint: 0, skyFloor: [0, 0, 0] as const, desaturate: 0, goldenScale: 1, envIntensityFloor: 0 });
// Tuning (export each)
export const NIGHT_AMBIENT_FLOOR = 0.42, NIGHT_STORM_FLOOR_ADD = 0.06, NIGHT_AMBIENT_ADD = 0.08,
  NIGHT_MOON = 0.55, NIGHT_MOON_CLOUD_CUT = 0.25, NIGHT_RIM = 0.4, NIGHT_RIM_CLOUD_CUT = 0.18,
  NIGHT_GLINT_CLOUD_CUT = 0.6, NIGHT_ENV_FLOOR = 0.4, OVERCAST_AMBIENT_ADD = 0.1,
  DESAT_PER_CLOUD = 0.7, DESAT_PER_FOG = 0.6, DESAT_MAX = 0.85,
  GOLDEN_CUT_PER_CLOUD = 0.85, GOLDEN_CUT_PER_FOG = 0.7, GOLDEN_MIN = 0.1;
export const NIGHT_SKY_FLOOR: readonly [number, number, number] = [0.03, 0.045, 0.075];
/** Cloud cover above the clear-day reference, 0..1: clamp((cloud - DEFAULT_ENVIRONMENT.cloud) / (1 - DEFAULT_ENVIRONMENT.cloud), 0, 1). NaN → 0. */
export function cloudExcess(cloud: number): number
export function lightGradeFor(env: Environment): LightGrade
```
`lightGradeFor` works as follows, with `o = cloudExcess(env.cloud)`, `f = unit(env.fog)` and `night = env.timeOfDay === 'night'`:
- If `!night && o === 0 && f === 0`, return `IDENTITY_GRADE` (the same reference).
- `desaturate = min(DESAT_MAX, max(DESAT_PER_CLOUD*o, DESAT_PER_FOG*f))`;
  `goldenScale = clamp(1 - max(GOLDEN_CUT_PER_CLOUD*o, GOLDEN_CUT_PER_FOG*f), GOLDEN_MIN, 1)`;
  `ambientAdd = (night ? NIGHT_AMBIENT_ADD : 0) + OVERCAST_AMBIENT_ADD*o`.
- If not night, return `{ ...IDENTITY_GRADE, desaturate, goldenScale, ambientAdd }`.
- Night returns `{ ambientFloor: 0.42 + 0.06*o, ambientAdd, moonIntensity: 0.55 - 0.25*o, moonRim: 0.4 - 0.18*o, moonGlint: 1 - 0.6*o, skyFloor: NIGHT_SKY_FLOOR, desaturate, goldenScale, envIntensityFloor: 0.4 }`.

**Tests first** (use `environmentFor(weather, time)` and `toBeCloseTo(x, 3)`):
- The default and `clear/dawn`, `clear/dusk` all `toBe(IDENTITY_GRADE)`.
- `clear/night`: floor 0.42, moon 0.55, rim 0.4, glint 1, desaturate 0, goldenScale 1, ambientAdd 0.08, env floor 0.4.
- `storm/night`: floor 0.48, moon 0.30, rim 0.22, glint 0.4, desaturate 0.7, goldenScale 0.15, ambientAdd 0.18; every
  skyFloor channel > 0.
- `overcast/dusk`: desaturate 0.622 (≥ 0.5), goldenScale 0.244 (≤ 0.3), moonRim 0.
- `fog/day`: desaturate 0.48, goldenScale 0.44.
- `partly-cloudy/day`: desaturate 0.311, goldenScale 0.622.
- Monotone: goldenScale clear ≥ partly-cloudy ≥ overcast ≥ storm (day); desaturate the reverse.
- `cloudExcess(0.1) === 0`, `(1) === 1`, `(NaN) === 0`, `(0) === 0`.

**Commands:** `npx vitest run tests/render/light-grade.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] clear day and clear dawn/dusk are identity by reference [ ] numbers exactly as specified [ ] no Three.js import.

---

### P05 — Own-label layout math (pure)

**Depends:** none. **Files:** new `src/render/presentation/label-layout.ts`, new `tests/render/label-layout.test.ts`.
**Do not touch:** `scene.ts`.

**Spec:**
```ts
export const OWN_LABEL_ASPECT = 5;               // canvas 320×64
export const OWN_LABEL_SCREEN_FRACTION = 0.028;  // label height ≈ 2.8% of viewport height
export const OWN_LABEL_MIN_H = 0.35;             // metres
export const OWN_LABEL_MAX_H = 3.0;
export const OWN_LABEL_FALLBACK_H = 1.2;         // orthographic camera or bad input
export const OWN_LABEL_CLEARANCE_M = 0.8;        // gap above the sail
export const OWN_LABEL_SAFE_NDC = { xMin: -0.45, xMax: 0.45, yMin: -0.35, yMax: 0.55 } as const;
/** World height (m) so the sprite keeps a constant screen fraction: clamp(d·2·tan(fov/2)·fraction, min, max). */
export function ownLabelWorldHeight(distanceM: number, fovDeg: number): number // non-finite or <= 0 inputs → OWN_LABEL_FALLBACK_H
/** Sprite centre Y: keel + hull height + clearance + half the label. */
export function ownLabelAnchorY(hullKeelY: number, hullHeightM: number, labelHeightM: number): number
/** Clamp an NDC point into the HUD-safe box (HUD panels live along the screen edges). */
export function clampLabelNdc(x: number, y: number, box = OWN_LABEL_SAFE_NDC): { x: number; y: number }
```
**Tests first:** chase `ownLabelWorldHeight(26, 55)` ≈ 0.758 (2 decimals); tactical `(72, 42)` ≈ 1.548; `(1, 55)` → 0.35;
`(5000, 55)` → 3.0; `(NaN, 55)`, `(10, 0)` and `(-3, 55)` → 1.2; monotone non-decreasing over d = 1..400; the screen
fraction `h / (2·d·tan(fov/2))` is 0.028 for d = 30..80 at fov 55; chase width `0.758 × 5 < 9.6` (the old plate width,
documenting the shrink); `ownLabelAnchorY(-2, 3, 1) === 2.3`; clamp `(0,0)` unchanged, `(0.9,0.9)` → `(0.45,0.55)`,
`(-2,-2)` → `(-0.45,-0.35)`.

**Commands:** `npx vitest run tests/render/label-layout.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] pure, no Three.js [ ] numbers as specified.

---

### P06 — Rain streaks as quads, tint floor, denser ripples

**Depends:** none. **Files:** `src/render/fx/rain.ts`, `tests/render/rain.test.ts` (append only).
**Do not touch:** `scene.ts`, `surface-effects.ts`, `RAIN_STREAK_CAPS`, `rainStreakSegment`, `wrapAround`, `rainStreakCount`.

**Spec (edits in `rain.ts`):**
- Constants: `STREAK_LENGTH` 1.3 → 2.2; `BASE_OPACITY` 0.3 → 0.5; `RIPPLE_RADIUS` 22 → 28; `MAX_RIPPLES_PER_FRAME` 3 → 8;
  `RAIN_RIPPLE_RATE` → `{ high: 70, medium: 35, low: 0 }`. Add exports `RAIN_STREAK_HALF_WIDTH = 0.022`,
  `RAIN_TINT_FLOOR = 0.32`, `RAIN_NEAR_CLIP_M = 4`, and a local `QUAD_FLOATS = 18`.
- New pure exports:
  ```ts
  /** Max(RAIN_TINT_FLOOR, value): rain never darker than a visible grey, even at night. NaN → floor. */
  export function rainTintChannel(value: number): number
  /**
   * Camera-facing quad (two triangles, 6 vertices, 18 floats at out[o..]) around the segment seg = [hx,hy,hz,tx,ty,tz].
   * Side vector: horizontal, perpendicular to (head - camera) in XZ, length halfWidth; (1,0) when degenerate.
   * Order: h-s, h+s, t+s, h-s, t+s, t-s. A head within RAIN_NEAR_CLIP_M (3D) of the camera writes all 6 vertices at
   * the head (a zero-area quad) so lens-close streaks do not smear the screen. Returns false in that case, true otherwise.
   */
  export function rainStreakQuad(out: Float32Array, o: number, seg: ArrayLike<number>, camX: number, camY: number, camZ: number, halfWidth: number): boolean
  ```
- `RainFrame`: add optional `readonly focusX?: number; readonly focusZ?: number;` with the doc comment
  "Ripple centre (the boat); defaults to the camera".
- `RainLayer`: `readonly object: THREE.Mesh` (was `LineSegments`).
  `positions = new Float32Array(MAX_STREAKS * QUAD_FLOATS)`; add `private readonly segment = new Float32Array(6)`.
  The material becomes
  `new THREE.MeshBasicMaterial({ color: 0xbfd0dc, transparent: true, opacity: BASE_OPACITY, depthWrite: false, side: THREE.DoubleSide })`.
  The object becomes `new THREE.Mesh(geometry, this.material)` and keeps `name`, `frustumCulled`, `renderOrder`,
  `visible` and `excludeFromWaterCapture`.
- `writeStreaks`: call `rainStreakSegment(this.segment, 0, x, phase, z, time, p)`, then
  `rainStreakQuad(this.positions, i * QUAD_FLOATS, this.segment, frame.cameraX, frame.cameraY, frame.cameraZ, RAIN_STREAK_HALF_WIDTH)`.
- `update`: `setDrawRange(0, count * 6)` (both places). The colour is
  `this.material.color.setRGB(rainTintChannel(frame.tint.r), rainTintChannel(frame.tint.g), rainTintChannel(frame.tint.b))`
  (replacing `copy(frame.tint)`). The opacity formula stays the same.
- `emitRipples`: use `const cx = frame.focusX ?? frame.cameraX; const cz = frame.focusZ ?? frame.cameraZ;` as the centre,
  and strength `0.3 + this.rng() * 0.2`.

**Tests first (append to `rain.test.ts`):** `rainTintChannel(0.05) === 0.32`, `(0.8) === 0.8`, `(NaN) === 0.32`;
for `seg = [5,10,5, 5.3,12,5.2]` and camera `(0,20,0)`: returns true, 18 floats are written, the midpoint of vertex 0 and
vertex 1 equals the head, the distance between vertex 0 and vertex 1 is `2*0.022` (`toBeCloseTo`, 6), and the side vector
(v1 − v0) dotted with (head − camera) in XZ is ≈ 0; camera exactly above the head in XZ (camera `(5,30,5)`) → finite
vertices; head within 4 m of the camera → returns false and all 6 vertices equal the head;
`RAIN_RIPPLE_RATE.high >= 60` and `.low === 0`. The existing tests stay green **unchanged**.

**Commands:** `npx vitest run tests/render/rain.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] streak caps unchanged (`particleCap` test green) [ ] no `LineSegments` left in rain.ts
[ ] ripples default to the camera when focus is absent [ ] only built-in materials.

---

### P07 — Rain ripple pool (own instanced layer)

**Depends:** none. **Files:** new `src/render/fx/rain-ripples.ts`, new `tests/render/rain-ripples.test.ts`.
**Do not touch:** `rain.ts`, `surface-effects.ts`, `scene.ts`.

**Spec:**
```ts
export const RAIN_RIPPLE_CAPS: Readonly<Record<QualityName, number>> = { high: 96, medium: 48, low: 0 };
export const RIPPLE_LIFE_S = 0.9;
export const RIPPLE_MIN_RADIUS = 0.15;
export const RIPPLE_MAX_RADIUS = 1.4;   // reached at strength 0.5
export const RIPPLE_LIFT_M = 0.08;      // above the sampled water height
/** Ease-out growth: lerp(MIN, MAX·2·clamp(strength,0.1,0.5), 1-(1-t)^2), t = clamp(age/life). */
export function rippleRadius(ageS: number, strength: number): number
/** (1 - t)^1.5; 0 at or after the life, 1 at birth. */
export function rippleFade(ageS: number): number
export class RainRipples {
  readonly mesh: THREE.InstancedMesh; // capacity RAIN_RIPPLE_CAPS.high
  setQuality(quality: QualityName): void;   // cap = RAIN_RIPPLE_CAPS[quality]; kill slots >= cap
  setReducedMotion(value: boolean): void;   // true → kill all, spawn becomes a no-op
  spawn(x: number, z: number, strength: number): void; // first dead slot < cap, else overwrite the oldest; no-op when cap 0 or reduced
  update(dt: number, paused: boolean, waterY: number): void; // age += dt unless paused; write matrices/colours; dead → zero scale
  get active(): number;
  reset(): void;
  dispose(): void;
}
```
Implementation notes: geometry `new THREE.RingGeometry(0.86, 1, 28).rotateX(-Math.PI / 2)`; material
`new THREE.MeshBasicMaterial({ color: 0xdfefff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })`;
`mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'rain-ripples'; mesh.visible = false`. **In the constructor**
call `mesh.setColorAt(i, black)` and set a zero-scale matrix for every slot, so `instanceColor` exists before the first
render (otherwise the shader recompiles on the first spawn). In `update`, compose each live slot from position
`(x, waterY + RIPPLE_LIFT_M, z)` with scale `(r, 1, r)` and colour `(fade, fade, fade)`, then set
`instanceMatrix.needsUpdate` and `instanceColor.needsUpdate` and `mesh.visible = active > 0`. Store slot state in typed arrays.
No allocation per frame (reuse one `Matrix4`, `Vector3`, `Quaternion` and `Color`).

**Tests first:** caps (high > medium > low = 0); `rippleRadius(0,0.5) === 0.15`; it grows monotonically to 1.4 at the life;
strength 0.3 ends at 0.84; `rippleFade(0) === 1`, `(0.45)` in (0,1), `(0.9) === 0`, `(5) === 0`; class: at high, 200
spawns → `active <= 96`; `setQuality('low')` then spawn → 0; reduced → spawn no-op; `update(1.0, false, 0)` → `active === 0`;
paused updates keep slots alive; `reset()` → 0.

**Commands:** `npx vitest run tests/render/rain-ripples.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] no per-frame allocation [ ] instanceColor created in the constructor [ ] gated by quality and reduced motion.

---

### P08 — Weather model: fog, night exposure, storm sea gains, grade/overcast flags, procedural sky

**Depends:** P04. **Files:** `src/render/environment/weather-model.ts`, `src/core/types.ts` (OceanSettings only),
`src/render/environment/sky-source.ts`, `src/render/environment/outdoor-lighting.ts`, `tests/render/weather-model.test.ts`
(append), `tests/render/sky-lighting.test.ts` (append).
**Do not touch:** `weather.ts`, `atmosphere.ts`, `scene.ts`, the existing assertions in either test file, `isDefaultEnvironment`, `presentationFor`'s identity early return.

**Edits:**
1. `core/types.ts` `OceanSettings`: add (optional, so no preset changes)
   ```ts
   /** Plan 030: render-only swell cascade gain (absent = 1). */
   swellGain?: number;
   /** Plan 030: render-only whitecap/foam gain (absent = 1). */
   whitecapGain?: number;
   ```
2. `weather-model.ts`:
   - `FOG_DENSITY_PER_VISIBILITY` 0.0045 → **0.010**.
   - Add `export const NIGHT_EXPOSURE_LIFT = 1.3;`. In `atmosphereFor`, the exposure becomes
     `base.exposure * exposureDim * (env.timeOfDay === 'night' ? NIGHT_EXPOSURE_LIFT : 1)`.
   - Add `export const SWELL_GAIN_PER_ROUGH = 0.6; export const WHITECAP_GAIN_PER_ROUGH = 2.0;` and
     ```ts
     /** 0 at the reference (clear) wind or calmer, 1 at Beaufort 9: same scale as the sim's roughness. */
     export function seaRoughness(windMs: number): number // clamp((seaStateFromWind(w) - seaStateFromWind(REFERENCE_WIND_MS)) / (1 - seaStateFromWind(REFERENCE_WIND_MS)), 0, 1)
     export function seaVisualGains(windMs: number): { swellGain: number; whitecapGain: number } // 1 + 0.6·r, 1 + 2.0·r
     ```
     (import `REFERENCE_WIND_MS` from `../../game/sim/environment`). `oceanFor` adds `...seaVisualGains(windMs)` to the returned
     object.
   - `WeatherFx`: add optional `readonly grade?: LightGrade;` and `readonly overcast?: boolean;`, each with a doc comment.
     `INACTIVE_WEATHER_FX` is **unchanged** (no grade, no overcast). `fxFor`: after computing `visibilityFog`, add
     `grade: lightGradeFor(env)` and `overcast: unit(env.cloud) >= 0.8 || visibilityFog >= 0.3`. Compute `visibilityFog`
     once into a local first.
3. `sky-source.ts`: add `overcast?: boolean` to the opts and insert
   `if (opts.overcast) return 'procedural-sky-pmrem';` right after the `isNight` line, with the comment
   `// Overcast/fog: the partly-cloudy noon HDR would show blue sky through the murk.`
4. `outdoor-lighting.ts`: `OutdoorLightingInput` gets `overcast?: boolean`. In `update`, pass
   `overcast: input.overcast` inside the `pickSkyLightingSource({...})` call. Nothing else changes.

**Tests first (append):**
- weather-model: `'storm swell and whitecaps get visual gains; clear wind is exactly 1'`:
  `seaVisualGains(REFERENCE_WIND_MS)` → `{1, 1}`; storm (`environmentFor('storm','day').windMs`) `swellGain >= 1.5`,
  `whitecapGain >= 2.5`; strictly monotone over winds 5, 10, 15, 20; `presentationFor(DEFAULT_ENVIRONMENT, DEFAULT_SETTINGS).settings.ocean.swellGain === undefined`.
- `'fog weather hides a contact at 150 m'`: `d = presented('fog').settings.atmosphere.fogDensity`; `d >= 0.0085` and
  `Math.exp(-((d * 150) ** 2)) <= 0.25`.
- `'night lifts exposure by 1.3 on a clear night'`: `toBeCloseTo(DEFAULT_SETTINGS.atmosphere.exposure * 1.3, 6)`.
- `'fx carries a light grade and an overcast flag'`: `presented('clear','night').fx.grade?.ambientFloor === 0.42`;
  `presented('overcast').fx.overcast === true`, the same for fog, rain and storm; partly-cloudy and clear (day) → `false`;
  `INACTIVE_WEATHER_FX.grade === undefined`.
- sky-lighting: `pickSkyLightingSource({ hdrReady: true, hdrFailed: false, isNight: false, overcast: true })` →
  `'procedural-sky-pmrem'`; with `overcast: false` → `'hdr-pmrem'`.

**Commands:** `npx vitest run tests/render/weather-model.test.ts tests/render/sky-lighting.test.ts tests/render/weather.test.ts tests/render/environment.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] all pre-existing weather-model assertions pass untouched (identity, ordering, ranges) [ ] defaults return the
base object [ ] the new OceanSettings fields are optional.

---

### P09 — Apply the light grade in the atmosphere

**Depends:** P04. **Files:** new `src/render/environment/atmosphere-grade.ts`, `src/render/atmosphere.ts`, new
`tests/render/atmosphere-grade.test.ts`.
**Do not touch:** `evaluateAtmosphere` math, any GLSL string, `weather-model.ts`, `scene.ts`.

**`atmosphere-grade.ts` spec:**
```ts
import * as THREE from 'three';
import type { AtmosphereState } from '../atmosphere';
import { IDENTITY_GRADE, type LightGrade } from './light-grade';
/** New graded state (never mutates `state`). Identity or undefined grade → returns `state` itself. */
export function gradeAtmosphereState(state: AtmosphereState, grade: LightGrade | undefined): AtmosphereState
export interface GradeLights { hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight; moon: THREE.DirectionalLight; rim: THREE.DirectionalLight }
/** After Atmosphere.apply has set its intensities: floors and moon rim. Identity/undefined → no-op. */
export function applyGradeLights(lights: GradeLights, state: AtmosphereState, grade: LightGrade | undefined, scene: THREE.Scene): void
/** Ocean key light: the sun normally; dim cool moonlight at night when grade.moonGlint > 0. Plain objects. */
export function oceanKeyLight(state: AtmosphereState, grade: LightGrade | undefined): { dir: { x: number; y: number; z: number }; color: { r: number; g: number; b: number } }
export const MOON_GLINT_RGB = [0.32, 0.38, 0.55] as const;
export const MOON_RIM_RGB = [0.62, 0.72, 0.95] as const;
```
- `gradeAtmosphereState`: clone each colour. Desaturate with `lerp` toward luminance grey
  (`l = 0.2126r + 0.7152g + 0.0722b`), using the amount `grade.desaturate` for `skyTop`, `skyHorizon` and `fogColor` and
  `grade.desaturate * 0.5` for `sunColor`. If `state.isNight`, take the per-channel max with `grade.skyFloor` for `skyTop`,
  `skyHorizon` and `fogColor`. Set `golden: state.golden * grade.goldenScale` and clone `sunDir`/`moonDir`.
- `applyGradeLights`: `hemi.intensity = max(hemi.intensity, ambientFloor)`; `ambient.intensity += ambientAdd`. If night:
  `moon.intensity = max(moon.intensity, moonIntensity)`; `rim.intensity = moonRim`; `rim.color.setRGB(...MOON_RIM_RGB)`;
  `scene.environmentIntensity = max(scene.environmentIntensity, envIntensityFloor)`.
- `oceanKeyLight`: if `!grade || !state.isNight || grade.moonGlint <= 0`, return the sun dir/colour as plain objects.
  Otherwise return `dir = state.moonDir` and `color = MOON_GLINT_RGB × moonGlint`.

**Edits in `atmosphere.ts`** (keep them minimal and keep the identity path bit-for-bit):
1. Import `gradeAtmosphereState`, `applyGradeLights` and `type LightGrade`.
2. `apply(..., presentation?: { cloudCoverage?: number; lightning?: number; fogDensity?: number; grade?: LightGrade })`.
3. The first line of `apply`: `const state = gradeAtmosphereState(evaluateAtmosphere(settings), presentation?.grade);`
4. New field `private readonly rimDir = new THREE.Vector3(0.4, 0.8, 0.2);`. Right after `this.lastSunDir.copy(state.sunDir);`
   add `this.rimDir.copy(state.isNight && (presentation?.grade?.moonRim ?? 0) > 0 ? state.moonDir : state.sunDir);`.
   In `placeRim`, change `const d = this.lastSunDir;` → `const d = this.rimDir;`. This is identity when there is no grade,
   because `rimDir === sunDir`.
5. After the line `this.bounce.color.set(0x2fb5a0).lerp(...)` and before `this.skyMat.uniforms.uTop...` add
   `applyGradeLights({ hemi: this.hemi, ambient: this.ambient, moon: this.moon, rim: this.rim }, state, presentation?.grade, scene);`

**Tests first** (`new Atmosphere()` and `new THREE.Scene()` work in node; see `tests/render/atmosphere-stability.test.ts`):
- `night = { timeOfDay: 0, sunElevation: -10, sunAzimuth: 120, fogDensity: 0.001, sunIntensity: 1 } as unknown as AtmosphereSettings`.
- `'identity: no grade, undefined and IDENTITY_GRADE light the scene the same'`: three atmospheres applied to night and to a day
  base. The hemi, ambient, moon and rim intensities and `rim.position` are equal.
- `'night grade floors the ambient and adds a moon rim from above'`:
  `apply(night, scene, 0, { grade: lightGradeFor(environmentFor('clear','night')) })` → `hemi.intensity >= 0.42`,
  `moon.intensity >= 0.55`, `rim.intensity ≈ 0.4`, `rim.position.y > 6`, `scene.environmentIntensity >= 0.4`; without the
  grade, `rim.intensity === 0`.
- `'grading desaturates overcast dusk and cuts golden'`: `s0 = evaluateAtmosphere(presentationFor(environmentFor('overcast','dusk'), DEFAULT_SETTINGS).settings.atmosphere)`,
  `s1 = gradeAtmosphereState(s0, lightGradeFor(environmentFor('overcast','dusk')))` → `s1.golden < s0.golden * 0.3`; the
  HSL saturation of `s1.skyHorizon` is lower than that of `s0`; `s0` is unchanged (compare its colours captured before).
- `'night sky floor'`: storm/night graded state → every channel of skyTop, skyHorizon and fogColor ≥ the floor.
- `'oceanKeyLight uses the moon only at night with glint'`: night clear → `dir.y > 0` and `color.b ≈ 0.55`; a day state → it
  equals the sun.

**Commands:** `npx vitest run tests/render/atmosphere-grade.test.ts tests/render/atmosphere-stability.test.ts tests/render/atmosphere-light.test.ts tests/render/webgl-materials.test.ts tests/render/weather-model.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] identity path unchanged (test) [ ] no light added or removed [ ] no GLSL change [ ] `gradeAtmosphereState` immutable.

---

### P10 — Endless mode hooks in the sim and API

**Depends:** P02. **Files:** `src/game/sim/systems.ts`, `src/game/sim/api.ts`, new `tests/game/endless-flow.test.ts`.
**Do not touch:** anything else in `systems.ts` beyond the four edits; the pinned balance tests.

**Edits:**
1. `systems.ts` imports: `import { continueEndless, seedNextWave } from './endless';`. **Add `seedNextWave` to
   `endless.ts` in this task** (this one function only):
   ```ts
   /** Next wave's ships: exactly seedWave(...) on a normal patrol; escalated in endless mode. */
   export function seedNextWave(state: Pick<GameState, 'seed' | 'worldVersion' | 'endless'>, wave: number): Ship[] {
     const ships = seedWave(state.seed, wave, undefined, state.worldVersion);
     return state.endless === true ? escalateWave(state.seed, wave, ships) : ships;
   }
   ```
   (`endless.ts` imports `seedWave` from `./create`. There is no cycle: `create.ts` does not import `systems`/`endless`.)
2. `applyCommands`: after `else if (command.type === 'ultimate') next = launchBroadside(next);` insert
   `else if (command.type === 'continueEndless') next = continueEndless(next);`
3. damage system: `const victory = waveCleared && shipsSunk >= VICTORY_TARGET;` →
   `const victory = state.endless !== true && waveCleared && shipsSunk >= VICTORY_TARGET;`
4. pickupsWaves: the `boardEmpty` last condition `state.stats.shipsSunk < VICTORY_TARGET;` →
   `(state.stats.shipsSunk < VICTORY_TARGET || state.endless === true);` and
   `ships: spawnWave ? seedWave(state.seed, nextWave, undefined, state.worldVersion) : state.ships,` →
   `ships: spawnWave ? seedNextWave(state, nextWave) : state.ships,`. If `seedWave` is now unused in `systems.ts`, remove it
   from that import **only if** typecheck/lint report it unused (`seedPowerups` stays).
5. `api.ts`: add
   ```ts
   /** After a patrol victory: keep hunting escalating waves. No-op otherwise. */
   export const keepHunting = (state: GameState): GameState => stepGame(state, [{ type: 'continueEndless' }], 0);
   export { ENDLESS_FIRST_WAVE, canContinueEndless, endlessTier } from './endless';
   ```

**Tests first** (`tests/game/endless-flow.test.ts`, `FIXED_DT` from `src/core/sim`, `WAVE_BREATHER` from constants):
- Helper `victory(wave = 1)`: `let s = startMission(createGame(21)); s = { ...s, ships: [{ ...s.ships[0]!, sinking: 0 }], stats: { ...s.stats, shipsSunk: 7, wave } }; return updateGame(s, [], FIXED_DT);`
  The phase must be `'victory'`.
- `'without keepHunting a victory stays a victory'`: 60 `updateGame` steps → phase is still `'victory'` and `endless` is undefined.
- `'keepHunting resumes play in endless mode'`: phase `'playing'`, `endless === true`, a message `'ENDLESS HUNT'`.
- `'the next wave arrives after the breather, escalated from wave 3'`: from `keepHunting(victory(2))`, step up to
  `Math.round((WAVE_BREATHER + 2) / FIXED_DT)` ticks until `stats.wave === 3`. Then `phase === 'playing'`,
  `ships.length > 0`, and on the tick the wave changed
  `ships` `toEqual(escalateWave(s.seed, 3, seedWave(s.seed, 3, undefined, s.worldVersion)))`.
- `'endless never declares victory again'`: an endless playing state with one `sinking: 0` ship and `shipsSunk: 30` → after one
  step the phase is `'playing'`.
- `'convoy strike cannot continue'`: `createScenario({ scenario: 'convoy-strike', seed: 3 })` with `phase: 'victory'` →
  `keepHunting` keeps `'victory'` and `endless` undefined.
- `'restart clears endless'`: `restartGame(keepHunting(victory())).endless === undefined`.
- `'deterministic'`: two runs of 1500 ticks from `keepHunting(victory(2))` are `toEqual`.

**Commands:** `npx vitest run tests/game/endless-flow.test.ts tests/game/endless.test.ts tests/game/playtest/progression.test.ts tests/game/playtest/campaign-balance.test.ts tests/game/replay.10000.test.ts tests/game/api.exports.test.ts tests/game/no-math-random.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] exactly four edit sites in systems.ts [ ] a normal patrol is byte-identical (balance/replay tests green)
[ ] endless only through the command.

---

### P11 — Hit numbers, pickup toasts and hit-stop (pure adapters)

**Depends:** P03. **Files:** new `src/game/adapt/hit-numbers.ts`, `src/game/adapt/pickup-toasts.ts`,
`src/game/adapt/hit-stop.ts`, new `tests/game/hit-numbers.test.ts`, `tests/game/pickup-toasts.test.ts`,
`tests/game/hit-stop.test.ts`.
**Do not touch:** `combat-events.ts` (its event shapes are pinned by `toEqual` tests), the sim.

**Spec:**
```ts
// hit-numbers.ts
export type HitNumberKind = 'damage' | 'crit' | 'kill';
export interface HitNumber { readonly id: string; readonly kind: HitNumberKind; readonly x: number; readonly y: number; readonly amount: number; readonly elite: boolean }
/** Per fixed step. Positions in sim units. */
export function deriveHitNumbers(prev: GameState, next: GameState): HitNumber[]
```
- **Hits**: for each detonation in `next.detonations` whose `id` is not in `prev.detonations`, with `owner === 'player'`,
  `hitId !== null` and `hitId !== 'player'`: look up `before = prev.ships.find(id === hitId)` and skip it if missing; take
  `after = next.ships.find(...)`; `amount = Math.round(before.hp - Math.max(0, after?.hp ?? 0))`; skip if `amount < 1`;
  `crit = next.messages.some((m) => m.id.startsWith(\`crit-${det.id}-\`))`; push
  `{ id: \`hit-${det.id}\`, kind: crit ? 'crit' : 'damage', x: det.x, y: det.y, amount, elite: before.elite === true }`.
- **Kills**: for each ship in `prev.ships` that is absent from `next.ships`, push
  `{ id: \`kill-${ship.id}\`, kind: 'kill', x: ship.x, y: ship.y, amount: xpForKill(ship), elite: ship.elite === true }`.
- Order: hits first (detonation order), then kills (prev ship order).

```ts
// pickup-toasts.ts
export interface PickupToast { readonly id: string; readonly rarity: PowerupRarity; readonly text: string }
export function derivePickupToasts(prev: GameState, next: GameState): PickupToast[]
```
Mirror `collectedPickups` in `combat-events.ts`: `taken = next.stats.powerupsTaken - prev.stats.powerupsTaken`, return `[]`
if ≤ 0. Candidates are the prev powerups missing from next and within `PICKUP_RADIUS` of `next.submarine`, sorted by distance
then id, sliced to `taken`. Map each to `{ id: \`pickup-${p.id}\`, rarity: rarityOf(p), text: pickupToastText(p.kind, p.rarity) }`.

```ts
// hit-stop.ts
export const HIT_STOP_CRIT_S = 0.09;
export const HIT_STOP_KILL_S = 0.4;        // equals the existing app shipSunk freeze
export const HIT_STOP_ELITE_KILL_S = 0.55;
/** Max (never sum) over the numbers × clamp(freezeScale, 0, 1). Damage-only → 0. */
export function hitStopSeconds(numbers: readonly HitNumber[], freezeScale: number): number
```
**Tests first.** Build states from `const s = startMission(createGame(7))` with `ship = s.ships[0]!`.
`prev = { ...s, detonations: [] }`.
`next = { ...s, ships: s.ships.map((x) => x.id === ship.id ? { ...x, hp: x.hp - 42 } : x), detonations: [{ id: 'mk14-9', kind: 'torpedo', owner: 'player', x: 10, y: 11, z: 0.3, yield: 60, hitId: ship.id, surface: false }], messages: [] }`
Cases:
- A plain hit → `[{ id: 'hit-mk14-9', kind: 'damage', x: 10, y: 11, amount: 42, elite: false }]`.
- With the message `{ id: 'crit-mk14-9-0', text: 'CRIT -84', ttl: 2.8 }` → kind `'crit'`.
- An enemy owner gives `[]`; so do `hitId: null`, `hitId: 'player'`, a detonation already present in prev, and an hp drop
  of 0.4.
- A ship removed in next → a kill with `amount === xpForKill(ship)`; an elite ship → `elite: true`.
- Pickups: prev has `{ id: 'loot-1', kind: 'health', x: sub.x, y: sub.y, life: 30, rarity: 'rare' }` and next drops it with
  `powerupsTaken + 1` → `[{ id: 'pickup-loot-1', rarity: 'rare', text: 'RARE CRATE: +60 hull' }]`; no taken delta → `[]`;
  a far pickup that vanished (expired) → `[]`.
- Hit-stop: `[]` → 0; damage → 0; crit → 0.09; kill → 0.4; elite kill → 0.55; crit + kill → 0.4; freezeScale 0 → 0;
  freezeScale 0.5 on a kill → 0.2.

**Commands:** `npx vitest run tests/game/hit-numbers.test.ts tests/game/pickup-toasts.test.ts tests/game/hit-stop.test.ts tests/game/no-math-random.test.ts tests/game/combat-events.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] combat-events untouched [ ] pure, no DOM [ ] crit detected by the message id prefix only.

---

### P12 — HUD elite and rarity marks

**Depends:** P03. **Files:** new `src/ui/elite-marks.ts`, new `src/styles/loot-elite.css`, `src/ui/hud.ts`, new
`tests/ui/elite-marks.test.ts`.
**Do not touch:** `objectiveText` (P16 owns it), any `data-*` attribute, `chromeKey`, `formatScorePops`, `targetCardText`
itself, `main.css`.

**`elite-marks.ts`** (its first line is `import '../styles/loot-elite.css';`):
```ts
export function targetCardClass(ship: { elite?: boolean } | undefined): string // undefined → '', normal → 'engaged', elite → 'engaged elite'
export function eliteTargetText(ship: { elite?: boolean }, text: string): string // elite → `★ ${text}` (ELITE_STYLE.star + ' '), else text
export function mapShipClass(ship: { id: string; kind: ShipKind; elite?: boolean }, selectedId: string | null): string // 'ship' + ' selected' + ' sub' + ' elite' in that order
export function mapShipRadius(ship: { kind: ShipKind; elite?: boolean }): number // sub 1.7, elite 2.0, else 1.4 (sub checked first)
export function crateClass(pickup: { rarity?: PowerupRarity }): string // 'crate' | 'crate rare' | 'crate epic'
export function contactClass(contact: { id: string; name: string }, selectedId: string | null): string // 'contact' + ' active' + ' elite'(isEliteName)
```
**`loot-elite.css`:**
```css
.order-row b.engaged.elite { color: #ffc83d; text-shadow: 0 0 6px rgba(255, 200, 61, 0.45); }
.map .ship.elite { fill: #ffc83d; stroke: #fff3c4; stroke-width: 0.5; }
.crate.rare { fill: #3fa9ff; }
.crate.epic { fill: #c45bff; }
.contact.elite b { color: #ffc83d; }
```
**`hud.ts` edits** (search for the quoted text; each appears in both `render` and `patchDynamic` where noted):
1. Import the six functions from `./elite-marks`.
2. `contactsMarkup`: `class="contact${active}"` → `class="${contactClass(contact, selectedTargetId)}"`, then delete the
   now-unused `active` const.
3. render target: `class="${target ? 'engaged' : ''}"` → `class="${targetCardClass(target)}"`, and the text
   `target ? targetCardText(target, targetRange) : …` → `target ? eliteTargetText(target, targetCardText(target, targetRange)) : …`.
4. patchDynamic `set('target', …)`: the text becomes
   `extras.target ? eliteTargetText(extras.target, targetCardText(extras.target, extras.targetRange)) : 'None — map / list / T'`
   and the class becomes `targetCardClass(extras.target)`.
5. Map ships (render **and** patch): `class="ship${…selected…}${…sub…}"` → `class="${mapShipClass(ship, game.selectedTargetId)}"`
   and `r="${ship.kind === 'sub' ? 1.7 : 1.4}"` → `r="${mapShipRadius(ship)}"`. Keep `data-ship-id`, `cx` and `cy`.
6. Crates (render **and** patch): `class="crate"` → `class="${crateClass(pickup)}"`.

**Tests first:** each function's outputs for normal, elite, selected, sub and undefined inputs. Non-elite outputs must equal the
old strings exactly: `mapShipClass({id:'a',kind:'destroyer'}, 'a') === 'ship selected'`,
`mapShipClass({id:'u',kind:'sub'}, null) === 'ship sub'`, `crateClass({}) === 'crate'`,
`contactClass({id:'a',name:'DESTROYER'}, 'a') === 'contact active'`, `targetCardClass(undefined) === ''`,
`targetCardClass({}) === 'engaged'`. Elite: `'ship elite'`, radius 2.0, `'contact elite'`, `'engaged elite'`,
`eliteTargetText({elite:true}, 'X') === '★ X'`.

**Commands:** `npx vitest run tests/ui/elite-marks.test.ts tests/game/hud-score-pops.test.ts tests/game/hud-clearance.test.ts tests/game/hud-commands.test.ts tests/game/convoy-strike.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] non-elite/common markup is byte-identical [ ] no new always-visible element [ ] `data-*` unchanged.

---

### P13 — Own-boat label: small, on the hull, distance-scaled, HUD-safe (scene)

**Depends:** P05. **Files:** `src/render/scene.ts` only.
**Do not touch:** contact label code paths, `labelsRoot.visible` logic, `subBeacon`, `app.ts` (P21 adds the call).

**Edits:**
1. Import `OWN_LABEL_ASPECT, OWN_LABEL_FALLBACK_H, clampLabelNdc, ownLabelAnchorY, ownLabelWorldHeight` from
   `'./presentation/label-layout'`.
2. Field: `private readonly ownLabelNdc = new THREE.Vector3();`
3. In `ensureLabel`'s `if (own)` drawing branch: `ctx.lineWidth = 3;` → `ctx.lineWidth = 2;`. Replace
   `if (own) sprite.scale.set(9.6, 1.92, 1);` with
   `if (own) sprite.scale.set(OWN_LABEL_FALLBACK_H * OWN_LABEL_ASPECT, OWN_LABEL_FALLBACK_H, 1);`
4. In `sync`'s label block: delete the two lines `const ownOffX = …` and `const ownOffZ = …`. The `'own'` entry becomes
   `x: v.x, y: ownLabelAnchorY(subY, hullHeight, OWN_LABEL_FALLBACK_H), z: v.z,` (`subY` and `hullHeight` are already
   in scope in `sync`).
5. New public method, placed right after `updateRain`:
   ```ts
   /**
    * Plan 030: size the own-boat label by camera distance (constant ~2.8% of screen height, clamped) and keep it in the
    * HUD-safe middle of the screen. Call once per frame after the camera has moved.
    */
   updateOwnLabel(camera: THREE.Camera): void {
     const sprite = this.labelSprites.get('own');
     if (!sprite || !sprite.visible || !this.labelsRoot.visible) return;
     camera.updateMatrixWorld();
     const hullHeight = (this.sub.userData.hullHeight as number | undefined) ?? DEFAULT_SUB_HULL_HEIGHT_M;
     const height =
       camera instanceof THREE.PerspectiveCamera
         ? ownLabelWorldHeight(camera.position.distanceTo(this.sub.position), camera.fov)
         : OWN_LABEL_FALLBACK_H;
     sprite.scale.set(height * OWN_LABEL_ASPECT, height, 1);
     sprite.position.set(this.sub.position.x, ownLabelAnchorY(this.sub.position.y, hullHeight, height), this.sub.position.z);
     const ndc = this.ownLabelNdc.copy(sprite.position).project(camera);
     if (ndc.z <= -1 || ndc.z >= 1) return;
     const clamped = clampLabelNdc(ndc.x, ndc.y);
     if (clamped.x === ndc.x && clamped.y === ndc.y) return;
     sprite.position.copy(ndc.set(clamped.x, clamped.y, ndc.z).unproject(camera));
   }
   ```
   (`DEFAULT_SUB_HULL_HEIGHT_M` is already imported in scene.ts. Check this, and import it only if it is missing.)

**Tests:** scene.ts has no unit tests. The math is covered by P05. Run the full suite once in this task.
**Commands:** `npm run typecheck`, `npm run lint`, `npx vitest run tests/render --maxWorkers=1`.
**Acceptance:** [ ] no lateral offset left [ ] the method is not yet called (P21 calls it) [ ] contact labels untouched
[ ] no allocation in `updateOwnLabel`.

---

### P14 — Ocean: wire swell and whitecap gains

**Depends:** P08. **Files:** new `src/render/ocean/sea-gains.ts`, `src/render/ocean/spectral-backend.ts`,
`src/render/ocean.ts`, new `tests/render/sea-gains.test.ts`.
**Do not touch:** any GLSL, the wind/detail cascade gains, `foam.ts`.

**Spec:**
```ts
// sea-gains.ts (pure)
export function swellCascadeGain(seaState: number, swellGain: number | undefined): number // 0.72 * (0.35 + seaState * 0.65) * (finite(swellGain) ? swellGain : 1)
export function foamUniform(foamAmount: number, whitecapGain: number | undefined, foamScale: number, spectral: boolean): number // foamAmount * (finite(whitecapGain) ? whitecapGain : 1) * foamScale * (spectral ? 0.22 : 1)
```
Edits: `spectral-backend.ts` `swell?.setGain(0.72 * (0.35 + sea * 0.65));` →
`swell?.setGain(swellCascadeGain(sea, frame.ocean.swellGain));`. `ocean.ts`
`u.uFoamAmount.value = ocean.foamAmount * this.foamScale * (spectral ? 0.22 : 1);` →
`u.uFoamAmount.value = foamUniform(ocean.foamAmount, ocean.whitecapGain, this.foamScale, spectral);`
**Tests first:** with `undefined` gains both functions equal the old formulas exactly (sea 0, 0.3, 0.93; foam 0.14 with scale
1 and 1.35, spectral true/false); gain 1.54 scales linearly; NaN gain → treated as 1.
**Commands:** `npx vitest run tests/render/sea-gains.test.ts tests/render/spectrum.test.ts tests/render/foam.test.ts tests/render/surface-eval.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] identity when the gains are absent [ ] two one-line call-site edits only.

---

### P15 — Floating damage numbers layer (DOM, pooled)

**Depends:** P11. **Files:** new `src/ui/floating-text.ts`, new `src/styles/floats.css`, new `tests/ui/floating-text.test.ts`.
**Do not touch:** `hud.ts`, `app.ts`, `threat-indicators.ts`.

**Spec (`floating-text.ts`, first line `import '../styles/floats.css';`):**
```ts
export const FLOAT_CAP = 16;
export const FLOAT_LIFE_S: Readonly<Record<HitNumberKind, number>> = { damage: 0.9, crit: 1.2, kill: 1.3 };
export const FLOAT_RISE_PX = 46;
export const FLOAT_START_OFFSET_PX = 34;   // starts above the waterline projection
export const FLOAT_JITTER_PX = 14;         // slot % 3 → -14, 0, +14 so stacked hits fan out
export const CRIT_POP_S = 0.15;
export const CRIT_POP_SCALE = 0.4;
export interface FloaterFrame { readonly visible: boolean; readonly risePx: number; readonly opacity: number; readonly scale: number }
/** t = age/life; rise = reduced ? 0 : RISE·(1-(1-t)^2); opacity 1 until t=0.6 then linear to 0; crit pop 1+0.4·max(0,1-age/0.15) unless reduced. age<0 or >= life → visible false. */
export function floaterFrame(kind: HitNumberKind, ageS: number, reducedMotion: boolean): FloaterFrame
export function hitNumberText(n: Pick<HitNumber, 'kind' | 'amount'>): string // damage '-42', crit 'CRIT 84!', kill '+180 XP'
export function hitNumberClass(n: Pick<HitNumber, 'kind' | 'elite'>): string // 'fx-num is-damage' | 'fx-num is-crit' | 'fx-num is-kill', plus ' is-elite'
/** First slot that is not live; else the live slot with the smallest born (oldest). */
export function pickSlot(slots: readonly { live: boolean; born: number }[]): number
export type FloatProjector = (x: number, y: number) => { sx: number; sy: number; onScreen: boolean };
export class FloatingTextLayer {
  constructor(root: HTMLElement, reducedMotion: boolean); // root.classList.add('fx-layer'); aria-hidden; FLOAT_CAP divs 'fx-num' hidden
  spawn(numbers: readonly HitNumber[], nowS: number): void;
  update(nowS: number, project: FloatProjector): void; // hidden when invisible/offscreen; transform `translate(${sx + jitter}px, ${sy - START - rise}px) translate(-50%, -50%) scale(s)`; opacity
  clear(): void;
}
```
Use `root.ownerDocument.createElement('div')`. Never use `innerHTML` (the text is set through `textContent`).
**`floats.css`:**
```css
.fx-layer { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; }
.fx-num { position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap; will-change: transform, opacity;
  font-family: var(--font-data); font-weight: 800; font-size: 18px; color: #f4f7f8; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); }
.fx-num.is-crit { font-size: 28px; color: #ffd34d; letter-spacing: 0.04em; }
.fx-num.is-kill { font-size: 20px; color: #7fe3ff; }
.fx-num.is-elite { color: #ffc83d; }
```
(z-index 5 together with P21 inserting the root **before** `#hud` makes HUD panels paint over the numbers.)
**Tests first:** `floaterFrame`: age 0 damage → visible, rise 0, opacity 1, scale 1; age 0.45 → rise ≈ 46·0.75 = 34.5;
age 0.8 damage → opacity ≈ (1 − (0.889−0.6)/0.4) (`toBeCloseTo`, 3); age 0.9 → invisible; crit age 0 → scale 1.4, and
reduced → 1 with rise 0 at any age; negative age → invisible. The text and class strings as specified. `pickSlot`: the first dead
slot; all live → the index of the min `born`.
**Commands:** `npx vitest run tests/ui/floating-text.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] `pointer-events: none` on the layer and on `.fx-num` [ ] a pool of 16, no per-hit element creation
[ ] reduced motion → no movement or pop.

---

### P16 — Endless UI: "Keep hunting" on the result card, endless objective

**Depends:** P10, P12. **Files:** `src/ui/overlays.ts`, `src/ui/hud.ts` (`objectiveText` only), new
`tests/ui/result-card.test.ts`.
**Do not touch:** menu card markup, `data-action="restart"`, the existing result-card strings, other parts of `hud.ts`.

**Edits:**
1. `overlays.ts`: add an exported pure function and use it in `render` for the victory/gameover branch
   (`this.root.innerHTML = renderResultCard(game);`):
   ```ts
   export function renderResultCard(game: GameState): string
   ```
   It produces exactly today's markup. Two differences: (a) when `game.scenario !== 'convoy-strike'` and
   `game.endless === true`, the goal line is `` `Endless hunt · reached wave ${game.stats.wave}` ``; (b) when
   `canContinueEndless(game)` (import from `../game/sim/endless`), append
   `<button class="btn" data-action="endless">Keep hunting</button>` **after** the restart button and inside the section.
2. `PatrolOverlay` constructor: add a 6th optional parameter `private readonly onEndless?: () => void`. In the click
   handler, before `if (action === 'restart') this.onRestart();`, add
   `if (action === 'endless') { this.onEndless?.(); return; }`.
3. `hud.ts` `objectiveText`: widen the param type with `endless?: boolean;` and `stats?: { shipsSunk: number; wave?: number };`.
   As the **first** statement of the function, add
   `if (game?.endless === true && game.scenario !== 'convoy-strike') return \`Endless · wave ${game.stats?.wave ?? 1}\`;`

**Tests first:** a patrol victory (from `startMission(createGame(21))` with `phase:'victory'`) → it contains `SECTOR CLEARED`,
`Clear two waves`, `data-action="restart"`, `data-action="endless"` and `Keep hunting`, with restart's index < endless's
index; a convoy-strike victory → `Merchant sunk` and no `data-action="endless"`; a patrol gameover → no endless button and
the string equals the pre-change markup (hard-code the expected string for one case in the test); an endless gameover with
`stats.wave = 5` → `Endless hunt · reached wave 5`;
`objectiveText({ scenario: 'patrol', endless: true, stats: { shipsSunk: 9, wave: 4 } }) === 'Endless · wave 4'`;
`objectiveText()` stays `'Clear two waves'`.
**Commands:** `npx vitest run tests/ui/result-card.test.ts tests/game/hud-clearance.test.ts tests/game/convoy-strike.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] the strike E2E strings (`SECTOR CLEARED`, `Merchant sunk`, the restart button) are unchanged [ ] the button
shows only for a patrol victory that is not already endless.

---

### P17 — Scene wiring: light grade, overcast sky, moon glint, rain quads and ripples

**Depends:** P06, P07, P08, P09, P13. **Files:** `src/render/scene.ts` only.
**Do not touch:** anything not listed; `surfaceEffects.emitRipple` stays as an (unused-by-rain) public method.

**Edits:**
1. Imports: `RainRipples` from `'./fx/rain-ripples'`; `oceanKeyLight` from `'./environment/atmosphere-grade'`.
2. Field next to `rain`: `private readonly rainRipples = new RainRipples();`
3. Constructor: after `this.scene.add(this.rain.object);` add
   `this.scene.add(this.rainRipples.mesh); excludeFromWaterCapture(this.rainRipples.mesh);`
4. `setQuality`: after `this.rain.setQuality(profile.name);` add `this.rainRipples.setQuality(profile.name);`
5. `setReducedMotion`: add `this.rainRipples.setReducedMotion(value);`
6. `updateRain`: add `focusX: this.sub.position.x, focusZ: this.sub.position.z,` to the frame object. After the
   `this.rain.update(...)` call, add `this.rainRipples.update(dt, this.presentationPaused, this.lastWaterHeight ?? 0);`
7. `emitRainRipple` body → `this.rainRipples.spawn(x, z, strength);`
8. `resetEnvironment`: add `this.rainRipples.reset();` and `dispose`: add `this.rainRipples.dispose();` next to
   `this.rain.dispose();`
9. `sync` → `this.atmosphere.apply(..., { cloudCoverage: …, lightning: …, fogDensity: …, grade: this.weatherFx.grade })`.
10. `sync` → `this.outdoorLighting.update({ …, weatherPreset: weather.preset, overcast: this.weatherFx.overcast === true })`.
11. `sync` → before `this.environment.prepare({`, add `const key = oceanKeyLight(atmo, this.weatherFx.grade);`. In the object,
    replace `sunDir: { x: atmo.sunDir.x, … }` with `sunDir: key.dir,` and `sunColor: { r: atmo.sunColor.r, … }` with
    `sunColor: key.color,`.
At the default environment `weatherFx` is `INACTIVE_WEATHER_FX` (no grade, no overcast). Every edit is then identity: the
grade is undefined, overcast is false, `oceanKeyLight` returns the sun, and there are no ripples (rain 0).
**Commands:** `npm run typecheck`, `npm run lint`, `npx vitest run tests/render --maxWorkers=1`.
**Acceptance:** [ ] every edit is identity at the default environment (verifier reads each) [ ] rain ripples no longer go to
`surfaceEffects` [ ] no new lights, no GLSL.

---

### P18 — Big banners, loot toasts and the juice coordinator

**Depends:** P11, P15. **Files:** new `src/ui/banner-overlay.ts`, new `src/styles/banners.css`, new `src/ui/juice-layer.ts`,
new `tests/ui/banner-overlay.test.ts`.
**Do not touch:** `hud.ts` (the HUD toast stays as it is), `app.ts`.

**`banner-overlay.ts`** (first line `import '../styles/banners.css';`):
```ts
export type BannerTier = 'combo' | 'epic' | 'level' | 'wave' | 'loot';
export interface BannerSpec { readonly id: string; readonly tier: BannerTier; readonly text: string; readonly ttl: number; readonly rarity?: PowerupRarity }
export const BANNER_QUEUE_MAX = 3;
export const LOOT_TOAST_TTL = 2.2;
/** Message → banner, or null. */
export function bannerSpecFor(message: { id: string; text: string }): BannerSpec | null
export interface BannerQueue { readonly current: (BannerSpec & { readonly shownAt: number }) | null; readonly pending: readonly BannerSpec[] }
export const EMPTY_BANNER_QUEUE: BannerQueue;
/** Append fresh specs (keep only the newest BANNER_QUEUE_MAX pending), expire current after its ttl, promote the next. Pure. */
export function advanceBannerQueue(queue: BannerQueue, nowS: number, fresh: readonly BannerSpec[]): BannerQueue
/** Banner-able messages not yet seen; `seen` becomes the ids of the banner-able messages still present. Pure. */
export function freshBanners(messages: readonly { id: string; text: string }[], seen: ReadonlySet<string>): { fresh: BannerSpec[]; seen: ReadonlySet<string> }
export function lootBanner(toast: PickupToast): BannerSpec // { id: toast.id, tier: 'loot', text: toast.text, ttl: LOOT_TOAST_TTL, rarity: toast.rarity }
export class BannerLayer { constructor(root: HTMLElement, reducedMotion: boolean); render(banners: BannerQueue, loot: BannerQueue): void; dispose(): void }
```
`bannerSpecFor` table (the id is the message id):

| message text | tier | banner text | ttl |
| --- | --- | --- | --- |
| `DOUBLE KILL` | combo | `DOUBLE KILL` | 1.6 |
| `TRIPLE KILL` | combo | `TRIPLE KILL` | 1.8 |
| `RAMPAGE` | epic | `RAMPAGE` | 2.2 |
| `CHAIN REACTION` | combo | `CHAIN REACTION` | 1.4 |
| `BROADSIDE!` | epic | `BROADSIDE!` | 1.8 |
| `/^LEVEL (\d+)$/` | level | `LEVEL UP · ${n}` | 2.0 |
| `SECTOR CLEARED` | epic | `SECTOR CLEARED` | 2.6 |
| `ENDLESS HUNT` | epic | `ENDLESS HUNT` | 2.2 |
| `/^WAVE (\d+) INBOUND$/` | wave | `WAVE ${n}` | 2.0 |
| anything else | null | | |

`BannerLayer`: `root.className = 'fx-banner-layer'`, `aria-hidden="true"`, `data-reduced="1"` when reduced. Two children:
`div.fx-banner` and `div.fx-loot`, both `hidden` initially. `render` shows `current` (sets `textContent`, `dataset.tier` and
`dataset.rarity`). It restarts the `is-in` class only when the current id changes (remove the class, read `offsetWidth`, add
it back). It hides an element when its current is null.
**`banners.css`:**
```css
.fx-banner-layer { position: absolute; inset: 0; z-index: 21; pointer-events: none; }
.fx-banner, .fx-loot { position: absolute; left: 50%; transform: translateX(-50%); white-space: nowrap; pointer-events: none;
  font-family: var(--font-data); text-shadow: 0 2px 12px rgba(0, 0, 0, 0.85); }
.fx-banner { top: 22%; font-weight: 900; letter-spacing: 0.08em; font-size: clamp(28px, 4.2vw, 56px); color: #e8f0f4; }
.fx-banner[data-tier='combo'] { color: #ffd34d; }
.fx-banner[data-tier='epic'] { color: #ff7a3d; }
.fx-banner[data-tier='level'] { color: #7fe3ff; }
.fx-banner[data-tier='wave'] { font-size: clamp(22px, 3vw, 40px); }
.fx-loot { top: 33%; font-weight: 800; font-size: 20px; color: #e8f0f4; }
.fx-loot[data-rarity='rare'] { color: #3fa9ff; }
.fx-loot[data-rarity='epic'] { color: #c45bff; }
.fx-banner.is-in, .fx-loot.is-in { animation: fx-pop-in 0.22s ease-out; }
@keyframes fx-pop-in { from { opacity: 0; transform: translateX(-50%) scale(1.35); } to { opacity: 1; transform: translateX(-50%) scale(1); } }
.fx-banner-layer[data-reduced='1'] .is-in { animation: none; }
@media (prefers-reduced-motion: reduce) { .fx-banner-layer .is-in { animation: none; } }
```
**`juice-layer.ts`:**
```ts
export class JuiceLayer {
  constructor(parent: HTMLElement, before: Element | null, reducedMotion: boolean);
  // creates div#fx-floats (FloatingTextLayer) inserted with parent.insertBefore(el, before) and div#fx-banners (BannerLayer) appended to parent
  observe(prev: GameState, next: GameState): void; // per fixed step: buffer deriveHitNumbers (keep the newest FLOAT_CAP), hitStop = max(hitStop, hitStopSeconds(numbers, 1)), buffer derivePickupToasts (keep the newest BANNER_QUEUE_MAX)
  takeHitStop(): number;                            // return and reset
  frame(game: GameState, nowS: number, project: FloatProjector): void; // spawn buffered floats, update floats, freshBanners → advance banner queue, loot buffer → advance loot queue, render
  reset(): void;                                    // clear buffers, floats, seen ids, queues; render empty
  dispose(): void;                                  // remove both roots
}
```
Replace arrays and sets rather than mutating them (immutability rule); the DOM nodes are the only mutable state.
**Tests first (pure only):** the full `bannerSpecFor` table, including `LEVEL 12` → `LEVEL UP · 12`, `WAVE 3 INBOUND` →
`WAVE 3`, and `HIT BOW · X` → null. `advanceBannerQueue`: an empty queue plus 1 fresh → current set with shownAt=now; after
ttl → next pending promoted or null; 5 fresh → pending keeps the newest 3 (by input order) after the first is promoted;
input queue not mutated. `freshBanners`: first call returns all banner-able messages; second call with the same messages →
none; a removed message drops from `seen`. `lootBanner` maps the fields.
**Commands:** `npx vitest run tests/ui/banner-overlay.test.ts tests/ui/floating-text.test.ts --maxWorkers=1`, then typecheck, then lint.
**Acceptance:** [ ] `pointer-events: none` on all banner nodes [ ] z-index 21 (below the perk card at 22) [ ] no class from the layout
selector set [ ] the HUD toast is not removed or changed.

---

### P19 — Rare/epic crates you can see (scene)

**Depends:** P03, P17. **Files:** new `src/render/fx/loot-beacons.ts`, new `tests/render/loot-beacons.test.ts`,
`src/render/scene.ts`.
**Do not touch:** `vessels.ts` `createCrate`, `assets.ts`, the HUD.

**`loot-beacons.ts`:**
```ts
export interface LootBeaconEntry { readonly id: string; readonly x: number; readonly y: number; readonly z: number; readonly rarity?: PowerupRarity }
/** Scale (with pulse) every frame; on first sight of a rare/epic crate set emissive on each MeshStandardMaterial (once, flagged in userData.rarityStyled). Common → scale 1, materials untouched. */
export function styleCrate(crate: THREE.Object3D, rarity: PowerupRarity | undefined, timeS: number, reducedMotion: boolean): void
export class LootBeacons {
  readonly group: THREE.Group; // name 'loot-beacons'
  get count(): number;
  /** One beam + ring per rare/epic entry, keyed by id; stale ids are removed. Common entries get nothing. */
  sync(entries: readonly LootBeaconEntry[], timeS: number, reducedMotion: boolean): void;
  dispose(): void;
}
```
Shared geometries: `CylinderGeometry(0.22, 0.22, 1, 10, 1, true).translate(0, 0.5, 0)` (beam, `scale.y = beamHeight`) and
`RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2)` (ring, scale `ringRadius × pulse`). There are four shared materials
(beam + ring for rare and epic): `MeshBasicMaterial({ color: style.color, transparent: true, opacity: beamOpacity (ring 0.7), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })`.
Each item is a `THREE.Group` positioned at the entry. **No `THREE.Light`.**
**Scene edits:**
1. Import `LootBeacons, styleCrate`. Field `private readonly lootBeacons = new LootBeacons();`
2. Constructor (next to the other `scene.add` calls): `this.scene.add(this.lootBeacons.group); excludeFromWaterCapture(this.lootBeacons.group);`
3. `syncGame` powerup loop: after `add(\`powerup:${powerup.id}\`, 'crate', …);` add
   `const crate = this.entities.get(\`powerup:${powerup.id}\`); if (crate) styleCrate(crate, powerup.rarity, game.time, this.reducedMotion);`.
   After the loop add
   `this.lootBeacons.sync(game.powerups.map((p) => { const w = simToWorldMeters(p.x, p.y); return { id: p.id, x: w.x, y: SURFACE_SPLASH_Y, z: w.z, rarity: p.rarity }; }), game.time, this.reducedMotion);`
4. `dispose`: `this.lootBeacons.dispose();`
**Tests first:** sync with common + rare + epic → `count === 2`; the epic beam has `scale.y === 26`; dropping the rare entry →
1; reduced motion → the ring scale is identical at t=0.3 and t=1.1; non-reduced → different. `styleCrate` on a group with
one `Mesh(BoxGeometry, MeshStandardMaterial)`: common → scale 1, emissive stays black; rare → emissive hex `0x3fa9ff` and
intensity 0.6, scale in [1.35·0.88, 1.35·1.12]; called twice → material changed once (spy on `emissive.setHex` or
check the userData flag).
**Commands:** `npx vitest run tests/render/loot-beacons.test.ts --maxWorkers=1`, `npm run typecheck`, `npm run lint`, `npx vitest run tests/render --maxWorkers=1`.
**Acceptance:** [ ] common crates are visually unchanged [ ] shared geometry and materials, nothing allocated per frame for existing ids [ ] disposed.

---

### P20 — Elites in 3D: gold label and beacon

**Depends:** P03, P08 (core/types), P19 (scene order). **Files:** `src/core/types.ts` (`SurfaceShipState`),
`src/game/adapt/lookdev.ts`, `src/render/scene.ts`, new `tests/game/lookdev-elite.test.ts`.
**Do not touch:** the own-label code (P13), contact label colours for non-elites.

**Edits:**
1. `SurfaceShipState`: add `/** Plan 030: elite hunt target (gold label/beacon). Absent on normal hulls. */ elite?: boolean;`
2. `lookdev.ts` ship literal: after `flooding: ship.flooding,` add `...(ship.elite === true ? { elite: true } : {}),`
3. `scene.ts`:
   - `type LabelKind = 'own' | 'contact' | 'elite';`. Add `const ELITE_LABEL_CANVAS = { width: 260, height: 36 } as const;`.
     Import `ELITE_STYLE` from `'../game/adapt/loot-style'`.
   - `ensureLabel`: an elite branch with the canvas sized by `ELITE_LABEL_CANVAS`, font
     `'800 16px ui-monospace, SFMono-Regular, Menlo, monospace'`. Draw dark shadow text `rgba(7,11,12,0.75)` offset +1/+1,
     then `ELITE_STYLE.css` text, `\`${ELITE_STYLE.star} ${text}\``. Sprite scale `(7.3, 1.0, 1)`. Restructure the existing
     `own` boolean into `kind === 'own'`/`kind === 'elite'` branches without changing the own or contact drawing.
   - The labels block ship entries: `kind: s.elite === true ? 'elite' : 'contact'`, `show: contactLabelsOn || s.elite === true`.
   - The opacity line: `e.kind === 'contact' ? 0.55 + dens * 0.35 : 1`.
   - The ship beacon block: scale
     `beaconScale * (selected ? 1.25 : submerged > 0 ? 1.15 : 1) * (ship.elite === true ? ELITE_STYLE.beaconScale : 1)`;
     after the existing colour/opacity setters add
     `if (ship.elite === true && !selected) { (entity.beacon.material as THREE.MeshBasicMaterial).color.setHex(ELITE_STYLE.color); (entity.beacon.material as THREE.MeshBasicMaterial).opacity = 0.95; }`
**Tests first** (`lookdev-elite.test.ts`): a game with one ship `elite: true` → `adaptToLookDevSim(game).ships[i].elite === true`;
a normal ship → `'elite' in sim.ships[j] === false`. The existing `lookdev-attitude` tests stay green.
**Commands:** `npx vitest run tests/game/lookdev-elite.test.ts tests/game/lookdev-attitude.test.ts tests/render/combat-event-fx.test.ts --maxWorkers=1`, `npm run typecheck`, `npm run lint`.
**Acceptance:** [ ] non-elite label and beacon paths unchanged [ ] an elite label always shows outside periscope [ ] no new light.

---

### P21 — App wiring: juice layer, hit-stop, own label, Keep hunting

**Depends:** P10, P13, P16, P17, P18. **Files:** `src/app.ts` only.
**Do not touch:** the existing `applyCombatFeel` shipSunk freeze (keep it), input handling, tutorial logic.

**Edits:**
1. Imports: `keepHunting` (add it to the existing `./game/sim/api` import list) and `import { JuiceLayer } from './ui/juice-layer';`
2. Field: `private readonly juice: JuiceLayer;`
3. Constructor, right after `this.threats = new ThreatIndicatorLayer(this.threatRoot);`:
   `this.juice = new JuiceLayer(this.appRoot, $('hud'), this.reducedMotion);`
4. `new PatrolOverlay(…)`: add the 6th argument `() => this.keepHunting()` after the environment object.
5. Fixed-step loop: after `combat.push(...deriveCombatEvents(prev, this.game));` add `this.juice.observe(prev, this.game);`
6. Right after the loop's closing `}` and the following `this.syncPerkOverlay();`, add
   `this.hitFreeze = Math.max(this.hitFreeze, this.juice.takeHitStop() * reducedMotionGates(this.reducedMotion).freezeScale);`
7. After `this.scene.updateRain(this.cameras.camera, renderDt);` add `this.scene.updateOwnLabel(this.cameras.camera);`
8. After `this.syncThreats();` add
   `this.juice.frame(this.game, now / 1000, (x, y) => this.projectThreat(x, y, 0, window.innerWidth, window.innerHeight));`
9. `beginPatrol` and `restartPatrol`: after `this.scene.resetEnvironment(this.missionGeneration);` add `this.juice.reset();`
10. New method:
    ```ts
    /** Result card "Keep hunting": continue a won patrol in endless mode. */
    private keepHunting(): void {
      this.game = keepHunting(this.game);
      this.sim = adaptToLookDevSim(this.game);
    }
    ```
11. `dispose`: after `this.threatRoot.remove();` add `this.juice.dispose();`
**Commands:** `npm run typecheck`, `npm run lint`, `npx vitest run --maxWorkers=2` (full suite).
**Acceptance:** [ ] 11 small edits only [ ] the hit-stop is zero under reduced motion (via `freezeScale`) [ ] the float layer is inserted
before `#hud` [ ] `updateOwnLabel` is called after the camera update and before render.

---

## 7. Verification

### 7.1 Orchestrator gate (after every wave)

1. Read the whole wave diff (`git diff`). Reject any file not in a task's list.
2. `npm run typecheck` → 0 errors.
3. `npm run lint` → 0 errors (warnings allowed only if they already existed).
4. `npx vitest run --maxWorkers=2` (full suite) → all green. Confirm that only P01's listed assertions changed in existing
   tests: `git diff --stat tests/` shows only the new files plus `progression.test.ts`, `elites.test.ts`,
   `rain.test.ts` (append), `weather-model.test.ts` (append) and `sky-lighting.test.ts` (append).
5. Run the source grep checks: `git grep -n "Math.random" -- src/game` → no hits;
   `git grep -n "new THREE.*Light(" -- src` → no new hits versus `main`.
6. `npm run build` (allowed: no browser).
7. Commit the wave on `plan-030-arpg-feel` with the message `feat: plan 030 wave N — <tasks>`.
8. After W5: merge to `main`, fast-forward `master`, push. CI must pass: Verify, Browser smoke (default, storm/night, rain/dusk),
   Patrol E2E, HUD layout. Then update the `plans/README.md` row for 030 ("Machine work landed; visual/fun gates pending"),
   the `tasks/state.md` "Now" paragraph, and this file's status line.

### 7.2 Per-task Sonnet verifier checklist

For each task, tick every item and report FAIL with file:line for any miss.
- [ ] **Scope:** the diff touches only the files listed for the task. No drive-by refactor, and no edits to the "do not touch" items.
- [ ] **Spec match:** names, signatures, constants and numbers equal the plan (diff against the task text).
- [ ] **Tests first and meaningful:** the listed test cases exist with the listed inputs and expected values. No `skip`/`only`.
  The assertions are not weakened.
- [ ] **Determinism (sim/adapt tasks):** no `Math.random` string, no wall clock, no `rngState` advance. `hashUnit` is used for new
  seeded choices. Inputs are not mutated (look for `push`/`splice`/assignment on parameters).
- [ ] **Identity at defaults:** for render tasks, trace the default path (clear day → `INACTIVE_WEATHER_FX`, no grade, common
  crates, no rain) and confirm the output values are unchanged. For sim tasks, confirm that a normal patrol never reads
  the new code (`endless` undefined).
- [ ] **Pinned tests:** only P01 edits existing assertions, each with the `// Plan 030 XP retune` comment. Everything else is
  additive.
- [ ] **Layout/E2E risk:** no new element with a layout-selector class; new overlays have `pointer-events: none`; no `data-*`
  hook renamed or removed; result-card strings for strike/restart are intact.
- [ ] **GPU safety:** no GLSL edits, no runtime light add/remove, built-in materials only, `instanceColor` pre-created,
  no per-frame allocation in render loops.
- [ ] **Commands:** the task's vitest files, typecheck and lint were run and pass (re-run them).
- [ ] **Size/style:** new modules under 400 lines, Prettier style, no `console.log`, exported pure helpers.

### 7.3 Left to CI and the operator (not self-approved)

- **CI (GitHub Actions):** shader compile and console errors in the default, storm/night and rain/dusk smokes; Patrol E2E
  (watch for the level-up card opening on the first destroyer kill, which already happened before this plan); HUD layout at
  1280×720, 1366×768, 1920×1080 and 1024×700.
- **Operator eye-pass (GPU):** night (clear and storm) readability of sea, boat and rain; fog haze falloff (the own boat at the
  tactical 72 m distance should still read); overcast greyness at dusk/day; rain streak thickness and ripple visibility;
  storm swell/whitecaps at tactical zoom (watch for spectral "plates"); crate beams and colours; elite gold; own-label size in
  chase and tactical; banner and number readability.
- **Operator feel:** the XP pace (5 level-ups by kill 8, 9 by a full patrol), the endless difficulty ramp, hit-stop lengths, and
  banner frequency.
- **GPU FPS ≥ 55** on the reference desktop with rain on high (quads + ripples + beams).

## 8. Risks (honest)

1. **Visual numbers are educated guesses.** Fog ×2.2, night floors, exposure ×1.3, desaturation and swell ×1.54 were
   tuned on paper with no GPU. Fog at 0.0087 leaves about 67% transmission to the own boat at tactical distance (72 m), which
   may read as too hazy. All of these are single constants in `weather-model.ts`/`light-grade.ts` for the operator to tune.
2. **Spectral swell gain** can fold the FFT mesh into "plates" (a code comment in `spectral-backend.ts` warns about chop).
   Only the swell cascade is scaled; chop is untouched. The mitigation is to lower `SWELL_GAIN_PER_ROUGH`.
3. **HDR → procedural sky switch** for overcast/fog/rain changes the IBL source mid-game when the weather changes. Expect a
   one-off PMREM regeneration hitch and a visible lighting change on that frame.
4. **Rain cost:** up to 1800 transparent quads (high) plus 96 additive ripples. Overdraw near the camera is mitigated by the
   4 m near clip, and medium halves it. GPU FPS is unverified.
5. **More level-ups → the perk card opens more often.** That is intended, but E2E journeys that sink a destroyer already hit
   the modal. If Patrol E2E regresses on CI, the fix belongs in a follow-up (E2E helper presses Esc), not in this plan's scope.
6. **XP target ambiguity:** "normal victory" here means the critique's 8 kills (5 level-ups). A full two-wave victory gives
   9, which is the top of the band. If the operator meant the full victory should give 5–6, change `XP_BASE`/`XP_STEP`
   and the two reference tests.
7. **Endless conversions reuse merchant ids** (`wave-3-merchant-4` becomes a destroyer). Nothing in `src` parses ship ids for
   kind (verified with grep), but debug probes may look odd.
8. **Hit-stop accumulation:** max-not-sum, but a Broadside that kills four ships still freezes 0.4–0.55 s, and crits add
   0.09 s. This is a feel question for the operator.
9. **Large files grow slightly** (`scene.ts`, `app.ts`, `hud.ts`, `systems.ts` were already over the size guideline). This
   plan adds wiring only. A refactor is out of scope.
10. **Own-label NDC clamp** uses project/unproject at the same depth. In free camera with the boat behind the camera
    (`ndc.z` outside (−1, 1)) the clamp is skipped by design.
11. **Parallel typecheck noise:** during a wave, `npm run typecheck` may show errors from a sibling task that is mid-edit.
    Executors report errors outside their files and do not fix them. The orchestrator gate is authoritative.

## 9. Out of scope

New shaders or GLSL edits, new assets, audio for the new events, a perk pool expansion for long endless runs, an E2E script
update, a HUD toast redesign, refactoring the oversized files, multiplayer. All operator gates stay PENDING.
