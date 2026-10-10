# Plan 025 Phase 5 — consistent worlds and return-to-base (machine evidence)

Status: machine work done, uncommitted. Operator gates untouched. Phase 6 and 7 not started.

## Worlds
- `createScenario` / `rerunScenario` (`src/game/sim/scenarios/factory.ts`) are the only creation path; `app.ts` no longer builds a legacy game and relabels `worldVersion`.
- `createConvoyStrike(seed, worldVersion)` now snaps contacts and exit to v2 water.
- Matrix: `tests/game/scenario-factory.test.ts` (patrol and strike, both worlds: valid spawn/base/exit, determinism, retry, new seed).
- Root cause of the long-standing "seed 7 exfil" failure: legacy seed 7 put the FOB in a sealed 632-cell lagoon, unreachable from the boat's 10,633-cell water. `snapToReachable` now moves a disconnected base to the nearest planner-reachable cell. Reachable seeds are unchanged. 14 legacy seeds and v2 seeds 7/19/42 are tested for a route.

## Retreat progress
- Replaced the absolute `time > 170` check with `retreat-progress.ts`: stall clock from last measured progress, paused while a warship is within 14 units (`contested`), one replan after 20 s, blocked after 45 s more. Blocked ends the order, says why, and tells the player to order Home again.
- Tests: `exfil-progress.test.ts` (late order, five-seed arrival in empty ocean, cancel/re-order, repeated low-hp trigger, walled-off base).

## Combat run (healthy boat ordered Home at t=0, live wave 1)
| Seed | Arrived | Survived | Note |
| --- | --- | --- | --- |
| 1 | no | no | weapon, ~79 s |
| 7 | no | no | cruiser hedgehog pattern, 3x34 hp, dead 11.9 s |
| 19 | yes | yes | 99 s |
| 42 | yes | yes (16 hp) | 102 s |
| 91 | no | no | same pattern, dead 12.5 s |

Seeds 7/91 are encounter pressure plus a control gap: the Home helm does not react to ordnance in the water. Not changed here (Phase 6 tuning; no invulnerability added). Pinned in `exfil-combat-outcomes.test.ts`.

## Follow-ups checked (round 2)
- `littoral-v2` Home routing: `exfil-v2.test.ts` arrives on 14 seeds with zero ticks off navigable water, so the suspected legacy-terrain planning problem is not demonstrated. Left as is.
- Strike and patrol contacts, base and exit share the boat's water on seeds 1-60 (`scenario-reachability.test.ts`).
- Evade seeds 7/42/91 pass in `doctrines.test.ts`; the earlier "still failing" note was stale.

## Not done
- Combat deaths on seeds 1/7/91 (Phase 6 tuning).
- Phases 6-7 and operator gates.
