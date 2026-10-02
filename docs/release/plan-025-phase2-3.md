# Plan 025 phases 2 and 3 — local evidence

Recorded 2026-09-26 on top of `3a8012c`. Operator gates stay pending. These times are script and browser runs, not a human playtest.

## Phase 2

Autopilot spends a torpedo only when `assistanceAutoFire` is on. Ambush and intercept with the flag off fire nothing across 25 seconds. A manual `fireWeapon` still launches. Turning the flag off after the first automatic shot stops further automatic shots. Patrol still starts with the flag on. Convoy strike starts with it off.

The tube label says `TOO DEEP`, `RELOAD`, `NO MK-14`, `TUBES DAMAGED`, or `ARC LIMIT`. An out-of-arc target stays launchable; the shot is clamped to 60° of the bow.

Wreck age uses simulation seconds. The first timestamp is stored instead of treating 0 as "never started". Each presentation step ages at most one second. A wreck is still present at five seconds and gone at six. Reduced motion drops hit flashes and still emits `shipSunk`. At 4× the six-second sink is 1.5 seconds of wall clock, because the clock is simulation time.

The adopted hull keeps its mesh. A repeated-sink mesh budget is not separately measured.

## Phase 3

The exit bearing uses the same degrees as the helm tape and the heading readout (`headingDegrees`). The old cue was about 180° off that tape, and the script that treated the cue as a simulation heading sailed away from the exit.

Command-only seed 19, no position writes: victory at 20.33 simulation seconds, 4 shots, 100 HP, one ship sunk, final distance 3.98 (exit radius 4). The isolated "already inside the ring" test remains a rule check.

The objective says `Sink the merchant` until that ship is gone, then `Reach the exit` with bearing and distance. The minimap ring is dashed until then and solid after.

Chrome production preview `http://127.0.0.1:8110/?quality=low`: menu, Convoy strike, skip tutorial, fire with Key F, steer from the objective bearing and the heading readout, victory at simulation clock 0:25 with one ship sunk, one result card, Restart back to the menu, and a fresh strike at sunk 0. Wall clock for that whole journey was 301 seconds, most of it Chrome startup. No page or console errors.

Default quality on this headless Chrome advanced only 13 simulation seconds in 120 wall seconds (catch-up is capped at 12 steps per frame). The low-quality setting is a normal graphics option used so the journey could reach the exit inside the wait. It is not a simulation cheat.

Hull-zero defeat is covered by the convoy-strike unit test. The browser run did not take a loss. Pause and camera changes during the strike were not part of this journey. Phase 4 is next. Phases 6 and 7 are not done.
