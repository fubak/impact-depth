# Plan 026 — Realism and action upgrade (munitions, dynamics, doctrine, FX, lighting)

Operator request (2026-09-26): action-oriented submarine game that is fun but has realistic
lighting, water interaction, munitions physics, particles, explosions, battle strategy and physics.
Operator decisions: **weighty but responsive** handling; **re-baseline seed-pinned tests** to encode
intent (keep documented invariants); **bloom on the high profile only** with `?bloom=0` kill switch.

Operator gates stay pending (GPU FPS, lighting eye-pass, fleet, soak, fun/feel). Do not flip the
world default. Do not tag. Invariants to keep: quiet sweep cap 18, loud alert ≤15 s, no
`Math.random` in sim, sim free of Three.js/DOM, HUD clicks never plot waypoints.

## Audit findings (baseline `artifacts/plan-026-baseline/`)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Torpedoes spawn at hull centre at full speed; no acceleration, no tube offset; pass through islands | `systems.ts` `makeTorpedo`, `ordnance` |
| 2 | Mk-18 and enemy fish home on ground truth with no seeker cone; evasion is only turn-rate luck | `ordnance` guidance |
| 3 | Depth-charge damage uses the launch-time depth, not the charge's real depth; charges fall 1.6 u/s so no dodge window; only battleships drop DCs | `makeThreat`, `ordnance` |
| 4 | Shells and deck gun are hitscan; enemy shells spawn on the firing ship | `makeThreat('shell')`, deck-gun branch |
| 5 | Ships are HP pools that vanish 0.05 s after lethal damage; no flooding, fire, list, or propulsion loss | `ordnance`, `damage` |
| 6 | Sub turns at full rate at zero speed, never banks (`bank` always 0), depth is a linear clamp, speed reaches order in ~1.5 s | `applyCommands` helm, `submarine` |
| 7 | Escort sonar has no baffles, flow noise, or close-range blind zone; no attack-run doctrine; merchants never zig-zag or scatter | `contact.ts`, `enemies` |
| 8 | VFX is 120 tinted sprites with one radial texture; a torpedo kill is nearly invisible; no underwater bubble/dome/plume | `vfx.ts`, `combat-fx.ts`, screenshot 06/07 |
| 9 | Two hit lights, no post-processing, no underwater light shafts, flat underwater exposure | `scene.ts`, `renderer.ts`, screenshot 04 |

## Phases (one handoff each, verify after each)

### Phase 1 — Munitions physics (sim)
- `GameState.detonations: Detonation[]` — reset at the start of every step; written by the sim when
  anything explodes. `Detonation = { id; kind: 'torpedo'|'depthCharge'|'hedgehog'|'shell'|'bomb';
  owner: 'player'|'enemy'; x; y; z; yield: number; hitId: string|null; surface: boolean }`.
  `deriveCombatEvents` maps them to a new `CombatEvent { type: 'detonation', ... }`. Render FX
  uses `detonation` exclusively for explosion bursts/lights; `torpedoHit`/`chargeBlast` remain for
  audio, shake and HUD.
- Torpedo: new fields `runSpeed`, `lockId`. Launch from the bow tube (`sub + heading*0.9`), initial
  speed `sub.speed + 2`, accelerate 7 u/s² to `runSpeed`. Run-distance arming unchanged.
- Passive seeker (Mk-18 and enemy fish): cone ±0.6 rad; Mk-18 range 11 u, scores ships by
  `shipMachineryNoise / distance`, prefers the fire-control `targetId` when in cone; enemy fish
  acquisition range `5 + 12 * sub.noise`; existing foxer seduction roll retained. No lock → run
  straight. Lead pursuit (half-time lead), turn-rate limited.
- Torpedoes (both owners) detonate on land or seabed contact (`hitId: null`).
- Depth charges: fields `vx, vy` (throw velocity, water drag 3/s). Sink rates: depthCharge 0.12 u/s,
  hedgehog 0.22, bomb 0.14. Hydrostatic pistol `targetDepth` = the ship's **estimate**
  (`sub.z ± 0.18 * (1 - min(1, holdContact/6))`, from `rngState`), clamped [0.08, 0.9]; detonate
  when `z >= targetDepth`, at the seabed, or on fuse (safety life). Damage uses the real 3D offset
  (`blastDamage` with actual `|z - sub.z|`).
- Hedgehog: contact fuse — detonates only if it passes within 0.45 u horizontally and 0.06 depth of
  the sub (damage 34); otherwise sinks to the seabed silently. Thrown pattern: 8 bombs on an
  ellipse of radius 0.7 centred 3 u ahead of the escort.
- DC pattern (destroyer/patrol/cruiser, not battleship): 3 stern rolls at −0.3/−0.9/−1.5 u along
  track + 2 K-gun throws (lateral velocity 3); per-charge depth offsets ±0.06; cooldown 9 s.
- `GameState.shells: Shell[]` `{ id; owner; sourceId; x; y; alt; vx; vy; valt; damage; radius }`,
  gravity 4 u/s², horizontal speed 9 u/s, aim at led target with dispersion
  `0.25 + 0.04*range` (reduced by contact hold). Enemy shell on splash damages the sub fully when
  `z < 0.14`, 35 % when `z < 0.3`. Deck gun becomes a player shell (range ≤10, `z < 0.14`,
  reload 1.6 s, damage 22) instead of hitscan.
- Aircraft bombs: dropped ahead of the plane at the predicted sub position; shallow setting.
- Near-blast knock: heading jolt ≤0.05 rad and speed ×0.85 scaled by damage taken.

### Phase 2 — Vessel dynamics and ship damage
- Sub rudder authority `0.25 + 0.75 * clamp(speed / (0.5*maxSpeed), 0, 1)` on all yaw (manual,
  waypoint, autopilot). `bank` driven by yaw rate × speed ratio, smoothed. Speed lag: accelerate
  0.55/s, coast-down 0.35/s. Depth: new `depthRate` with max rate `0.035 + 0.075*speedRatio`,
  vertical accel 0.08 u/s²; emergency blow gives +0.16 u/s ascent for its duration; flooding adds
  a downward bias `0.03*sysFlood`; below 0.9 hull-stress damage.
- Ship fields `flooding, fire, speedFactor, sinkDuration, sinkStyle ('bow'|'stern'|'list'|'break'),
  listSide`. Torpedo hit location along the hull axis: amidships ×1.2 damage, flooding +0.35,
  `break` if lethal; bow flooding +0.45 `bow`; stern `speedFactor ×0.4`, flooding +0.25 `stern`.
  Surface hits set `fire`. Flooding worsens `0.02*flooding/s`, damage control −0.015/s below 0.5,
  hp −`3*flooding`/s. Speed × `speedFactor * (1 - 0.6*flooding)`. Lethal → `sinking =
  sinkDuration` (merchant 16, battleship 22, cruiser 16, destroyer 11, patrol 8, sub 7), dead in the
  water, no weapons. "MORTALLY HIT" message at start; `SHIP SUNK`, score and wave logic at the end.
- Adapter passes `sinkProgress, sinkStyle, listSide, fire, flooding`; scene poses the live hull
  during sinking and the wreck continues from the final pose.

### Phase 3 — Battle doctrine
- `escort-doctrine.ts`: `screen → prosecute → attackRun → reattack → search`. Datum prediction from
  successive fixes. Attack run at 0.8 max speed; drop the Phase 1 pattern within 1.0 u of datum;
  max 2 escorts on runs at once, others hold contact at 4–6 u and may hedgehog (2–4.5 u ahead,
  ±25° of bow). Search an expanding circle for 45 s after 6 s without contact, then return.
- Escort hearing: baffles (stern ±40°) ×0.3, flow noise above 0.7 max speed ×0.5, blind inside
  1.3 u when `sub.z > 0.2`.
- Merchants: zig-zag when alerted, scatter away from the datum after a convoy hit.
- Aircraft circle a lost datum and cue nearby ships.
- Callouts: "DEPTH CHARGES IN THE WATER", "TORPEDO IN THE WATER".

### Phase 4 — Particles and explosions (render)
- Instanced billboard particle system (procedural atlas: puffs, smoke, fire, spark, bubble,
  droplet, debris) behind the existing `VfxPool` API. Per-particle gravity, drag, buoyancy,
  size/colour over life, spawn delay, water-surface kill → splash, underwater tint. Caps: high 3000,
  medium 1500, low 600.
- Presets: surface torpedo hit (flash, fireball, 40–60 m water column, smoke column, ballistic debris
  with trails, delayed secondaries); underwater detonation (pooled expanding/pulsing gas bubble mesh,
  bubble cloud, surface dome then plume scaled by depth, foam ring, silt near seabed); shell splash;
  muzzle flashes; burning/sinking ship emitters; oil slick.
- 4 pooled hit lights with colour-temperature decay (cyan when underwater), 2 flickering fire
  lights, pooled shock rings. Camera shake scaled by yield and distance (reduced-motion respected).

### Phase 5 — Lighting
- `PostPipeline` (EffectComposer → RenderPass → UnrealBloomPass half-res, threshold ~0.85 →
  OutputPass) on high only, `?bloom=0` disables; resize and context-restore wired; screenshots
  must show ocean/optics unchanged apart from glow.
- Underwater: fog colour/density and exposure by camera depth; sun-aligned animated light shafts
  near the camera; marine snow.

### Phase 6 — Feel, HUD, balance, proof
- Target card damage state (FLOODING / ON FIRE / DEAD IN WATER / SINKING); hit location in messages.
- Rebalance so patrol and strike stay winnable; `npm run verify`, `npm run test:e2e`,
  `test:e2e:strike`, `test:e2e:tutorial` green; after-screenshots in `artifacts/plan-026/`.
- Update `plans/README.md`, `tasks/state.md`, `memory/MEMORY.md`.
