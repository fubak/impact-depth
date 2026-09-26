# Product Requirements Document (PRD)

# Silent Depths — Three.js Ultra-Realistic Rebuild

Current scope is `docs/release/current-scope.md`. React, TanStack, and mobile sections below are historical.

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| **Product**         | Silent Depths                                                             |
| **Version**         | 2.0 (Three.js rebuild)                                                    |
| **Status**          | Draft for implementation                                                  |
| **Source of truth** | Feature parity with current 2D isometric Canvas game + visual/POV upgrade |
| **Platform**        | Web (desktop + mobile), Vercel deploy, live preview on `0.0.0.0:8080`     |
| **Engine**          | Three.js (WebGL2) + TypeScript + React/TanStack Start shell               |
| **Multiplayer**     | P2P late-join mesh (host-authoritative AI)                                |
| **Auth**            | Optional X (Twitter) / better-auth login for callsign                     |

---

## 1. Vision & Goals

### 1.1 Elevator pitch

**Silent Depths** is a single-player–first, optional co-op submarine combat sim set in a Pacific-theater ocean sector. The player commands **USS Nautilus**, hunting surface convoys and enemy U-boats while avoiding ASW (depth charges, Hedgehog, aircraft, hydrophones). The rebuild replaces the 2D isometric Canvas presentation with a **Three.js** world: ultra-realistic water, volumetric depth, PBR vessels, and **selectable camera POV** (tactical, external chase, periscope, free look).

### 1.2 Rebuild goals

1. **Feature parity** — every system listed in this PRD from the current game must ship (no “phase 2” omissions of core combat/UI).
2. **Ultra-realistic presentation** — water, lighting, atmosphere, VFX, and audio that sell mass, depth, and danger.
3. **Multiple POVs** — not locked to classic 2:1 iso; support at least the modes in §8.
4. **Playable performance** — 60 FPS target on mid-tier desktop; adaptive quality; mobile playable at reduced settings.
5. **Same deploy path** — works under Vite/TanStack Start, production build clean, no sandbox-only hacks.

### 1.3 Non-goals (v2.0)

- Full multiplayer server authority / dedicated matchmaking (keep P2P).
- Real-time physics soft-body water (Gerstner/FFT + foam is enough).
- Full naval campaign map / career mode (wave-based sector remains the loop).
- Voice chat.

### 1.4 Success criteria

| Metric             | Target                                                            |
| ------------------ | ----------------------------------------------------------------- |
| Feature checklist  | 100% of §3–§17 systems present                                    |
| Visual             | Water + land + vessels read as 3D with clear surface vs submerged |
| Combat readability | Torpedoes, DC, contacts, FOB safe zone still clear at a glance    |
| Performance        | ≥55 FPS desktop high; ≥30 FPS mobile medium                       |
| Multiplayer        | Late join + host ticks still work                                 |
| Tutorial           | All 11 steps ported with 3D-appropriate spotlights                |

---

## 2. Product Identity

| Item        | Spec                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| Title       | **Silent Depths**                                                                       |
| Subtitle    | Pacific Theater · co-op submarine command                                               |
| Player boat | **USS Nautilus**                                                                        |
| Home base   | **FOB Argus**                                                                           |
| Setting     | Procedural ocean sector with islands, seamounts, trenches                               |
| Tone        | Tense ASW thriller; semi-realistic WWII–early Cold War tactics, arcade-readable numbers |
| Modes       | Solo + open P2P co-op (anyone can join mid-patrol)                                      |

### 2.1 Game phases

| Phase      | Behavior                                               |
| ---------- | ------------------------------------------------------ |
| `menu`     | Title, callsign, Begin Patrol, optional Sign in with X |
| `playing`  | Full sim + HUD + tutorial optional                     |
| `paused`   | Sim frozen, overlay                                    |
| `gameover` | Reason string + score + restart                        |
| `victory`  | Sector cleared when sinks ≥ victory target             |

### 2.2 Mission flavors (randomized on start)

| Type     | Modifier                                                           |
| -------- | ------------------------------------------------------------------ |
| `patrol` | Standard briefing                                                  |
| `ambush` | Start near night (`timeOfDay ≈ 0.05`); emphasize silent approach   |
| `exfil`  | Damaged start: HP cap 55, battery 35; priority RTB to FOB          |
| `hunter` | Flavor only / harder spawn bias (preserve wave rules unless tuned) |

### 2.3 Win / lose / wave loop

- **Victory target:** `shipsSunk >= 8` when a wave fully clears → `victory`, **+1000** score, message “Sector cleared.”
- **Wave clear (not yet win):** all ships dead and sinks < 8 → `wave++`, restock (+4 Mk-14, +2 Mk-18, +40 battery, +20 HP), spawn next wave + 3 powerups.
- **Game over:** sub HP ≤ 0 (hull damage, flooding drain, DC, Hedgehog, enemy torpedo, shells, seamount crush).

---

## 3. World & Navigation

### 3.1 World parameters

| Constant       | Value                 | Notes                                                              |
| -------------- | --------------------- | ------------------------------------------------------------------ |
| `WORLD_SIZE`   | **96** tiles          | Square ocean sector                                                |
| `LAND_LEVEL`   | **0.78**              | Height ≥ this → dry land (impassable)                              |
| Tile metaphor  | 1 world unit ≈ 1 tile | Keep sim units; only presentation changes                          |
| Terrain        | FBM multi-octave      | Ridges, trenches, islands, seamounts, edge land bias               |
| Biomes         | 0–6                   | Beach, rock, jungle, deep floor, sand, vegetation, mixed           |
| Plants         | Density + type seed   | Coral, kelp-like, trees on land (3D props)                         |
| Land collision | **Hard**              | Player and AI **cannot enter land tiles**; snap to navigable water |
| Seamount crush | **18 dmg/s**          | If sub collides with high seafloor / extrusion while too deep      |

### 3.2 Coordinate & depth model (sim — keep)

| Concept                   | Spec                                                       |
| ------------------------- | ---------------------------------------------------------- |
| Horizontal                | `x, y` in [0, WORLD_SIZE)                                  |
| Sub depth `z`             | **0** = surface … **~0.95** max order; **1** deep band     |
| Thermocline               | **0.48**                                                   | Sonar layer boundary |
| World vertical for render | Map sim `z` to meters for Three.js (e.g. 0 → 0m, 1 → −55m) |
| Surface ships             | Depth ≈ 0.02                                               |
| Enemy sub                 | Default depth ≈ 0.35                                       |

### 3.3 Pathfinding

| System       | Spec                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Coarse A*    | Grid step **2**, max nodes **700–900**, 8-connected                                          |
| Clearance    | Class hull radii: BB **1.05**, … patrol **0.45**; sub depth-aware                            |
| Local avoid  | Multi-ray feelers (default **11**) `steerAvoid`                                              |
| Player order | Click/plot sets waypoint; A* path optional                                                   |
| AI patrol    | Freighter **4** waypoints rad **10** (linear reverse); escorts **5** pts rad **7–12** (loop) |
| Land         | Paths never cross land; goals snap to open water                                             |

### 3.4 Camera follow / pan (behavior parity)

- Default follow player; detach on drag-pan; reattach timer optional.
- Zoom range **0.45–2.2** (map to FOV / dolly in 3D).
- Shake on explosions (deterministic preferred).

---

## 4. Player Submarine — USS Nautilus

### 4.1 Baseline stats

| Stat          | Default                     | Notes                                 |
| ------------- | --------------------------- | ------------------------------------- |
| maxSpeed      | **2.4**                     | +**0.18** per speed tier (max tier 3) |
| hp / maxHp    | **100 / 100**               | +**20** maxHp per hull tier           |
| battery / max | **100 / 100**               |                                       |
| Mk-14         | **8 / 8**                   | Straight / light-wire                 |
| Mk-18         | **4 / 4**                   | Acoustic seeker                       |
| Foxer decoys  | **3**                       |                                       |
| Bubble CM     | **3 / 3**                   | Cooldown **6s**                       |
| Start depth   | **0.45**                    | Attack band                           |
| Start heading | **−π/2**                    |                                       |
| invuln        | After dock / spawn optional | Preserve current behavior             |

### 4.2 Depth orders (HUD sticky)

| Order | targetDepth | UI label                    |
| ----- | ----------- | --------------------------- |
| Surf  | **0.05**    | SURFACE if z < 0.12         |
| Peri  | **0.28**    | PERISCOPE if z < 0.40       |
| Atk   | **0.50**    | ATTACK if z < 0.70          |
| Deep  | **0.82**    | DEEP else                   |
| Clamp | 0–0.95      | Floor clearance vs seamount |

**Sticky:** UI highlights **order**, not instantaneous `z` (prevents flicker while transitioning).

### 4.3 Speed orders (sticky)

| Order | Fraction of maxSpeed |
| ----- | -------------------- |
| Stop  | **0**                |
| 1/3   | **0.33**             |
| 2/3   | **0.66**             |
| Flank | **1.0**              |

**Depth speed multipliers:** surface z<0.2 → **×1.05**; mid → **×0.9**; deep z>0.7 → **×0.72**.  
**Default cruise** when plotting with idle speed: **1.6**.

### 4.4 Caps (apply after order)

| Condition                             | Cap                                                     |
| ------------------------------------- | ------------------------------------------------------- |
| Silent running                        | speed ≤ **28%** max; noise ≤ **0.16–0.18**              |
| Battery empty (submerged, no snorkel) | speed ≤ **0.35**                                        |
| Damaged propulsion                    | speed ≤ max × (0.45 + sysPropulsion×0.55)               |
| Intent preserved                      | `speedOrder` / `targetDepth` never auto-cleared by caps |

### 4.5 Systems damage (0–1 integrity)

| System        | Effect                                                             |
| ------------- | ------------------------------------------------------------------ |
| sysSonar      | Damage worsens noise / detection; repaired at FOB                  |
| sysPropulsion | Speed cap; floor after damage **0.2**                              |
| sysTubes      | Fire blocked if **< 0.35**; damage mul = 0.7 + tubes×0.3           |
| sysFlood      | HP drain **4.5 × flood × dt**; auto-pump if flood<0.5 & battery>10 |
| crewStress    | Rises on damage; decays **0.02/s**                                 |

### 4.6 Modes

| Mode                  | Rules                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| **Silent running**    | Speed/noise caps; toggle sticky                                                |
| **Scope (periscope)** | Only meaningful near peri depth; auto lower if too deep; raises mast signature |
| **Snorkel**           | Usable roughly z **0.12–0.42**; charges battery; raises noise/signature        |
| Tiers                 | hullTier, weaponTier, speedTier **0–3**                                        |

### 4.7 Battery model

| Situation           | Rate                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Submerged drain     | **0.8 + speed² × (silent ? 1.1 : 4.2)** + scope **0.35** + ballast work **0.6**; × (1 + seaState×0.15) |
| Snorkel (peri band) | Charge **+4.5**/s (+ noise)                                                                            |
| Surface             | Charge **+9**/s                                                                                        |
| Empty submerged     | Crawl cap                                                                                              |

### 4.8 Mast / visual signature (for aircraft & visual detection)

| State      | Signature             |
| ---------- | --------------------- |
| Surfaced   | **0.95**              |
| Scope up   | **0.55**              |
| Snorkel    | **0.70**              |
| Sail awash | **0.25**              |
| Night      | Reduced visual factor |

---

## 5. Weapons & Ordnance

### 5.1 Player weapon modes

| Mode      | Name      | Magazine | Role                                    |
| --------- | --------- | -------- | --------------------------------------- |
| `torpedo` | **Mk-14** | 8        | Straight / light wire; lead aim on lock |
| `seeker`  | **Mk-18** | 4        | Acoustic seeker; better turn            |
| `decoy`   | **Foxer** | 3        | Noisemaker decoy (not a torpedo)        |

### 5.2 Fire gating

- Depth window: **z 0.08–0.85** (cannot fire too shallow/deep as today).
- Tubes jammed if **sysTubes < 0.35**.
- Noise spike on launch: **+0.35**.
- Auto-acquire nearest ship within **~6** tiles of aim if no target.
- Spread mode: if enabled and ≥2 fish → **2–3** Mk-14 with offsets **±0.08** or **[-0.12, 0, 0.12]**.

### 5.3 Player torpedo physics

|             | Mk-14                                                       | Mk-18                             |
| ----------- | ----------------------------------------------------------- | --------------------------------- |
| Speed       | **9.5**                                                     | **8.2**                           |
| Life        | **8s**                                                      | **10s**                           |
| Base damage | **48**                                                      | **58**                            |
| Damage mult | ×(1 + weaponTier×**0.18**) × tubeFactor                     | same                              |
| Arm delay   | life < **7.6**                                              | life < **9.4**                    |
| Reload      | **2.5s** single / **3.8s** spread − tier×0.22 (min **1.4**) | **3.4** − tier×0.22 (min **1.4**) |
| Turn rate   | **2.2** rad/s                                               | **2.8** rad/s                     |

### 5.4 Aspect damage bonus (torpedo vs ship)

| Aspect  | Multiplier |
| ------- | ---------- |
| BEAM    | **1.35**   |
| QUARTER | **1.10**   |
| STERN   | **0.85**   |
| BOW     | **0.72**   |

### 5.5 Hit radii (player torp)

| Target     | Radius   |
| ---------- | -------- |
| Enemy sub  | **1.55** |
| Battleship | **1.25** |
| Default    | **0.95** |

### 5.6 Enemy torpedoes (U-boat)

| Param                | Value                                              |
| -------------------- | -------------------------------------------------- |
| Speed                | **7.5**                                            |
| Damage               | **42**                                             |
| Life                 | **9s**                                             |
| Seek chance          | **45%**                                            |
| Cooldown             | **7–10s**                                          |
| Range band           | **2.5–14** tiles                                   |
| Hit player           | dist < **0.95** and \|Δz\| < **0.4**               |
| Seek vs quiet player | turn **1.1** if noise<0.22 or silent; else **2.4** |

### 5.7 Depth charges (surface battleships + aircraft bombs)

| Param             | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| Who               | **Battleships** (primary); aircraft bomb variant                 |
| Engage range (BB) | **≤ 3.25** tiles, target z > 0.12                                |
| Drop              | ~**2–3** tiles ahead of BB                                       |
| vz                | **1.4–1.9**                                                      |
| Fuse              | **1.2–1.8+** s                                                   |
| Radius            | **2.2** (aircraft bomb **1.8**)                                  |
| Damage            | **38–52** (aircraft **28**)                                      |
| Falloff           | Horizontal + vertical separation                                 |
| Bubble CM         | Damage ×**0.75** near bubble                                     |
| Random DCs        | **Forbidden** — only from valid shooters with range/target logic |

### 5.8 Hedgehog (destroyer / patrol / cruiser)

| Param            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Pattern          | **6** contact bombs, ellipse ~2 tiles ahead                  |
| Damage           | **22–32**                                                    |
| Radius           | **0.85**                                                     |
| Fuse             | **0.85–1.1** s                                               |
| Cooldown         | **~5.5–6.5** s                                               |
| Contact criteria | d < **0.95**, \|setDepth − sub.z\| < **0.22**, dmg ×**1.15** |
| Gate             | z>0.12, d<5.5, alert>0.6, holdContact>1.5s                   |

### 5.9 Deck guns / shells

| Source            | Condition                  | Damage    |
| ----------------- | -------------------------- | --------- |
| Battleship shells | sub z < 0.18, d < 10, ~45% | **16–28** |
| Escort deck guns  | shallow sub                | **10–20** |

### 5.10 Countermeasures

| Kind              | Mag / source          | Life            | Radius  | Effect                                                                   |
| ----------------- | --------------------- | --------------- | ------- | ------------------------------------------------------------------------ |
| **Bubble screen** | CM charges, key **C** | **10s**         | **4.5** | Masks passive; DC dmg ×0.75                                              |
| **Foxer**         | decoy mode            | **14s**         | **3.5** | Spoofs seekers; false “NOISE” contact; −alert on nearby ships (range 20) |
| Bubble deploy     | −1 charge             | Cooldown **6s** |         |                                                                          |

---

## 6. Enemy Units

### 6.1 Classes & sim stats

| Class        | maxSpeed | maxHp                           | turnRate | Primary threat                 |
| ------------ | -------- | ------------------------------- | -------- | ------------------------------ |
| patrol       | 2.6      | **50**                          | 1.05     | Deck gun + Hedgehog            |
| destroyer    | 2.35     | **120**                         | 0.82     | ASW / Hedgehog                 |
| freighter    | 1.15     | **95**                          | 0.40     | Merchant (no fire)             |
| cruiser      | 1.9      | **200**                         | 0.55     | Screen + Hedgehog              |
| battleship   | 1.35     | **420**                         | 0.32     | Depth charges + shells         |
| sub (U-boat) | 1.7      | **260** (spawn ×1.35 ≈ **351**) | 0.70     | Torpedoes; larger visual scale |

### 6.2 Roles

| Role       | Behavior                                        |
| ---------- | ----------------------------------------------- |
| `merchant` | Freighter convoy lanes                          |
| `screen`   | Escort formation offsets via convoyScreenOffset |
| `hunter`   | Aggressive ASW / BB / U-boat                    |

### 6.3 Wave composition (`seedWave`)

| Element           | Count                                                 |
| ----------------- | ----------------------------------------------------- |
| Merchants         | `2 + min(3, wave)` freighters                         |
| Screen            | `2 + min(3, wave)` from destroyer/patrol/cruiser pool |
| Battleship hunter | 1 if wave ≥ 2                                         |
| Enemy subs        | 1; **2** if wave ≥ 3                                  |

### 6.4 Sink scores

| BB      | Sub     | Cruiser | Destroyer | Patrol/Freighter |
| ------- | ------- | ------- | --------- | ---------------- |
| **700** | **550** | **400** | **300**   | **150**          |

### 6.5 AI combat loadout matrix

| Class                        | Weapons                                               |
| ---------------------------- | ----------------------------------------------------- |
| battleship                   | DC if boat submerged & d≤3.25; shells if boat shallow |
| destroyer / patrol / cruiser | Hedgehog + deck guns                                  |
| sub                          | Torpedoes only (not DC)                               |
| freighter                    | None                                                  |

### 6.6 Hold-down / alert

- Ships accumulate `holdContact` while tracking player.
- Alert 0–1 drives fire permission and hydrophone visibility.
- Active player sonar spikes nearby alerts.

### 6.7 Aircraft patrol

| Param            | Value                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| Respawn cooldown | **55–95s** after life ends                                                             |
| Life             | **28s**                                                                                |
| Speed            | **7.5**                                                                                |
| Hunt             | Mast + noise                                                                           |
| Bomb             | if d<6, mast>0.35, z<0.35 → alert fleet; bomb dmg **28**, fuse **1.1**, radius **1.8** |

### 6.8 Sinking

- On 0 HP: `sinking` animation **~3s**, then dead; score + float text “SUNK”.

---

## 7. Sonar & Detection

### 7.1 Constants

| Name                    | Value                                                 |
| ----------------------- | ----------------------------------------------------- |
| ACTIVE_PING_RANGE       | **22** tiles (class variants: destroyer **24**, etc.) |
| ACTIVE_PING_DURATION    | **4.8s**                                              |
| ACTIVE_COOLDOWN         | **6.5s**                                              |
| THERMOCLINE             | **0.48**                                              |
| Active ping noise spike | **+0.62**                                             |

### 7.2 Passive listen base radii

| player | destroyer | cruiser | sub    | BB     | patrol | freighter |
| ------ | --------- | ------- | ------ | ------ | ------ | --------- |
| **18** | **20**    | **17**  | **16** | **14** | **11** | **7**     |

### 7.3 Layer factor

| Geometry                        | Factor                |
| ------------------------------- | --------------------- |
| Same side of thermocline        | **1.0**               |
| Surface listener vs deep target | **0.42 − depth×0.18** |
| Deep listener vs surface        | **0.78**              |

### 7.4 Contacts (player picture)

| Field                    | Use                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------- |
| bearing, range, strength | UI + world blips                                                                   |
| label                    | CONTACT → MERCHANT?/SUB? → U-BOAT / CAPITAL / ESCORT / CRUISER / MERCHANT / PATROL |
| source                   | `passive` \| `active`                                                              |
| age / maxAge             | Smooth decay (passive ~1.15s sticky; active longer)                                |
| jitter                   | Low when strong; reduced thrash for UI                                             |

### 7.5 Active ping side effects

- Ships within **30** tiles: alert +**0.35×(1−d/30)**.
- Loud: reveals player.

### 7.6 CM mask

- Bubble / foxer reduce passive SNR in radius.

---

## 8. Presentation — Three.js Ultra-Realistic + POV

### 8.1 Why Three.js

Full 3D vessels, true free surface mesh, lighting, post-FX, and camera modes that Canvas 2D cannot deliver at this fidelity. **Sim stays unit-based**; only view layer is replaced.

### 8.2 Recommended stack

| Layer      | Choice                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Renderer   | Three.js r170+ WebGL2                                                                                |
| Water      | Custom FFT/Gerstner mesh + foam + shore crash; optional `three-stdlib` Water only if quality bar met |
| Atmosphere | Sky + fog + day/night sun                                                                            |
| Post       | Bloom (restrained), God rays optional, color grade, underwater fog when deep                         |
| Models     | PBR glTF: sub, each ship class, torpedo, DC, aircraft, FOB, powerup crates                           |
| Terrain    | Heightmap mesh from same FBM seed as sim land mask                                                   |
| Audio      | Existing WebAudio procedural bus + optional spatial listener                                         |

### 8.3 Camera / POV modes (new product requirement)

| Mode ID     | Description                                                   | Default bindings             |
| ----------- | ------------------------------------------------------------- | ---------------------------- |
| `tactical`  | Elevated 3/4 “command” view (spiritual successor to iso)      | Default for new players      |
| `chase`     | External stern chase of own sub                               | Cinematic combat             |
| `bridge`    | Near sail, external                                           | Immersion                    |
| `periscope` | First-person through scope when scope up / peri depth         | Locked heading + small sweep |
| `free`      | Orbit + pan debug / photo                                     | Hold alt                     |
| `map`       | Top-down orthographic sector map (minimap full-screen toggle) | M                            |

**Requirements:**

- Smooth blend between modes (0.4–0.8s).
- Periscope: limited FOV, water droplets, compass, stadimeter-style target if locked.
- Underwater (own z deep in chase/bridge): blue absorption, caustics, reduced visibility — **optional** full refraction; must not tank FPS.
- Land always occludes correctly; waves **must not** render over dry land; **shore breakers** required.

### 8.4 Water visual requirements

1. Directional swell + chop (not cloud blobs).
2. Dark troughs / thin specular ridges.
3. Shore crash foam + spray at land boundary.
4. Land mask from terrain (R=land, G=shore distance).
5. Depth-dependent look (surface vs deep camera).
6. Sea state 0–1 drives whitecaps / battery drain coupling.
7. Target: “reads as ocean,” not fog volume.

### 8.5 Vessel visuals

- Unique silhouette per class; U-boats **noticeably larger**.
- Wake, prop wash, dive planes, periscope mast when raised.
- Damage: listing on sink, smoke, fire optional on surface kills.
- Correct heading in all POVs (no inverted A/D; bow = velocity).

### 8.6 VFX

| FX            | Spec                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| Torpedo trail | Bubbles + wake ribbon                                                      |
| Explosion     | Multi-ring boom, debris, camera shake, SFX stack                           |
| Impact hit    | Speed-line / flash (readable, not pure anime spam)                         |
| DC detonation | Underwater sphere + surface plume if shallow                               |
| Hedgehog      | Cluster small bursts                                                       |
| Powerup       | Pickup ring + sparkle                                                      |
| Particles     | bubble, wake, spark, smoke, debris, splash, trail, flash, ember (cap ~120) |

### 8.7 Lighting & atmosphere

- Day cycle **480s** full: night light **0.28**, dawn/dusk **0.55**, day **0.92**.
- Phases: night <0.22 or >0.88; dawn <0.3; dusk >0.78.
- Thermocline haze optional below 0.48.
- Soft shadows from sun (cascaded or contact).

### 8.8 Adaptive quality

| Level             | Effects                                            |
| ----------------- | -------------------------------------------------- |
| High              | Full water, shadows, particles 110, post           |
| Med               | Reduced foam/particles 80, simpler water           |
| Low               | Flat water tint, particles 45, no shadows          |
| Sticky hysteresis | No thrash every frame (same philosophy as current) |

---

## 9. FOB Argus (Naval Base)

| Param     | Value                                    |
| --------- | ---------------------------------------- |
| Name      | **FOB Argus**                            |
| Radius    | **4.2** tiles                            |
| Placement | Near navigable start / seed center water |

### 9.1 Safe zone

- While `isAtFob` or `docked > 0`: **no enemy fire**, **no damage** to player.
- Enemies must not engage into the ring.

### 9.2 Repair / reload (speed < **0.6** inside radius)

| Resource        | Rate                         |
| --------------- | ---------------------------- |
| HP              | **+12**/s                    |
| Battery         | **+18**/s                    |
| Mk-14           | **+0.35**/s (to max)         |
| Mk-18           | **+0.2**/s (to max)          |
| Decoys / CM     | Random restock ticks         |
| Systems + flood | Repair toward 1 / 0          |
| docked flag     | ~**0.5s** hold while in zone |
| stats.repairs   | Accumulates                  |

---

## 10. Powerups

### 10.1 Kinds & effects

| Kind    | Effect                                                                                  |
| ------- | --------------------------------------------------------------------------------------- |
| health  | +**35** HP                                                                              |
| ammo    | Full Mk-14; +**2** seekers (capped)                                                     |
| hull    | hullTier+1 (max 3), maxHp+**20**, heal 20; hull dmg reduction **8%**/tier (max **28%**) |
| weapon  | weaponTier+1 → damage & faster reloads                                                  |
| speed   | speedTier+1, maxSpeed+**0.18**                                                          |
| counter | Full CM + 3 decoys                                                                      |

### 10.2 Spawn rules

| Rule          | Value           |
| ------------- | --------------- |
| Pickup range  | **1.3**         |
| Lifetime      | **90–130s**     |
| Max on map    | **10**          |
| Respawn timer | **14–24s**      |
| Initial seed  | **7** crates    |
| Wave clear    | +**3** powerups |

---

## 11. Autopilot / Doctrine AI

### 11.1 Tactics

`manual` | `ambush` | `stalk` | `intercept` | `evade` | `exfil` (UI: **RTB**)

### 11.2 Phases

`idle` | `approach` | `setup` | `attack` | `breakaway` | `hold` | `dock`

### 11.3 Doctrine

| Tactic          | Behavior                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Ambush**      | Leave FOB if needed → silent deep (~0.65) → beam standoff **~5.5u** → peri **0.28** → Mk-14 **spread** → deep breakaway |
| **Stalk**       | Trail **~10u** quarter, silent; fire d 4–9, aspect>0.55; seekers on fast/sub                                            |
| **Intercept**   | Aggressive close; seeker or spread; breakaway                                                                           |
| **Evade**       | Silent deep **0.78–0.86**, crawl 25%, away **14u**; auto-off after **12s** clear                                        |
| **Exfil / RTB** | Path to FOB; snorkel if battery<30; dock stop at radius×0.9                                                             |

### 11.4 Engagement UX

- Select target → select tactic → AI owns helm until cancelled.
- **Cancel:** Stop AI, Clear target badge, click water (plot course), toggle same ship, Off button.
- **Sticky:** speed/depth orders and tactic selection must not auto-unselect due to caps.
- **FOB:** combat tactics **leave** the base (do not freeze as “docked”).
- Emergency: flood>0.45 or HP<28 → exfil; battery<12 → evade/exfil.
- Threat CM: alert>0.7 within 10 → bubble; alert>0.85 → foxer chance.

### 11.5 Update order

`updateAutopilot` **before** `updateSub` so AI heading is not overwritten.

---

## 12. Multiplayer & Auth

### 12.1 Model

| Item     | Spec                                                                      |
| -------- | ------------------------------------------------------------------------- |
| Topology | P2P mesh; late join anytime                                               |
| Host     | Lowest peer id; host runs world AI                                        |
| Clients  | Apply host ticks; own sub local                                           |
| Messages | `ps` player snap, `hs` host snap, `hw` dense tick, `req` sync, `hi` hello |
| Tick     | **0.1–0.2s** by load; fingerprint skips redundant                         |
| Remotes  | Interpolate (exp k≈10); prune after **8s**                                |
| Auth     | better-auth + X callsign optional; displayName on hull                    |

### 12.2 Visual multiplayer

- Remote allies as distinct hull paint / nameplates.
- No shared magazine (each player own sub).

---

## 13. HUD / UX (feature parity)

### 13.1 Panels

1. **Status** — Hull, Battery %, Noise %, Depth band, day phase, layer (thermocline), flood %, upgrade pips
2. **Score** — score, sunk/target, time survived, wave
3. **Hydrophone** — up to **6** contacts: label, bearing, range (integer u)
4. **Magazine** — Mk-14 count + reload (integer seconds), Mk-18 same, Foxer, Screen, Spread/Single toggle, Sonar, Fire
5. **Tactics** — Silent, Scope, Snorkel, Ambush/Stalk/Intercept/Evade/RTB, Stop AI, Clear target
6. **Depth** — Surf / Peri / Atk / Deep (sticky highlight)
7. **Speed** — Stop / 1/3 / 2/3 / Flank (sticky)
8. **Minimap** — self, contacts, FOB, crates, land silhouette; click to plot
9. **Chrome** — Pause, Mute, Help/Tutorial, Facing debug (dev)
10. **Messages** — toast (reloads as **ceil integers**, no decimals)
11. **Layout** — No magazine overlay on minimap; mobile-safe (~390px)

### 13.2 Input map

| Input              | Action                                                 |
| ------------------ | ------------------------------------------------------ |
| LMB sea            | Plot course (cancels AP)                               |
| LMB ship           | Select / toggle target                                 |
| RMB / double-click | Fire at ship/point                                     |
| Drag               | Pan / detach follow                                    |
| Wheel / pinch      | Zoom                                                   |
| **C**              | Bubble screen                                          |
| **D**              | Facing debug (optional ship)                           |
| POV keys           | 1 tactical, 2 chase, 3 peri, 4 free (rebuild addition) |
| Touch              | Equivalent large targets ≥44px                         |

### 13.3 Tutorial (11 steps — keep content)

1. Welcome / theater
2. Plot course / pan / fire
3. Hull, battery, noise
4. Depth & speed
5. Silent / Scope / Snorkel + AI
6. Ambush doctrine
7. Magazine & sonar risk
8. Hydrophone picture
9. Minimap & FOB
10. Threats (Hedgehog, DC, U-boat, aircraft)
11. Win condition & co-op

Storage key: `silent-depths-tutorial-v1` (bump to v2 if needed). Dynamic DOM/3D spotlights.

---

## 14. Audio (parity + 3D option)

| API                                     | Use                           |
| --------------------------------------- | ----------------------------- |
| setMuted / unlockAudio                  | Master                        |
| startAmbient / stopAmbient              | Ocean + soft distant ping ~8s |
| sfxTorpedo                              | Mk-14                         |
| sfxSeekerLock                           | Mk-18                         |
| sfxExplosion / sfxSecondaryBoom         | Detonations                   |
| sfxHit / sfxAnimeImpact                 | Hits                          |
| sfxSonar                                | Active ping                   |
| sfxDepthCharge / sfxDepthChargeDetonate | DC                            |
| sfxClick                                | UI                            |
| sfxSplash / sfxShellSplash              | Water / shells                |
| sfxAlarm                                | Low hull                      |
| sfxDetect                               | Detection                     |
| sfxWaveClear / sfxVictory / sfxGameOver | Meta                          |
| sfxEnginePulse                          | Throttle (throttled ~90ms)    |
| sfxBubbleScreen / sfxFoxer              | CM                            |
| sfxPowerup                              | Pickup                        |
| sfxWhoosh                               | Generic                       |

**Rebuild:** attach listener to camera; spatialize explosions / ships optionally.

---

## 15. Simulation API (must re-export / preserve)

```
createGame, startMission, restartGame, setPhase,
setWeapon, toggleDebugFacing,
setDepthOrder, setSpeedOrder,
toggleSilentRunning, toggleScope, toggleSnorkel, toggleTorpedoSpread,
setAutopilot, cancelAutopilot,
orderMove, selectTarget, clearEngagement, detachCamera,
deployCountermeasure, fireWeapon, sonarPulse,
updateGame, pickShipAt, pickShipAtScreen, findShip,
snapToNavigable, applyHostSeed
```

---

## 16. Stats

```
score, shipsSunk, torpedoesFired, damageDealt,
timeSurvived, wave, powerupsTaken, repairs
```

- Victory bonus **+1000**
- Wave starts at **1**; victoryTarget **8**

---

## 17. Constants Quick Reference

| Constant             | Value    |
| -------------------- | -------- |
| WORLD_SIZE           | 96       |
| LAND_LEVEL           | 0.78     |
| FOB radius           | 4.2      |
| victoryTarget        | 8        |
| DEFAULT_CRUISE       | 1.6      |
| DC_ENGAGE_RANGE      | 3.25     |
| THERMOCLINE          | 0.48     |
| ACTIVE_PING_RANGE    | 22       |
| ACTIVE_PING_DURATION | 4.8      |
| ACTIVE_COOLDOWN      | 6.5      |
| Day length           | 480s     |
| Seamount crush       | 18 dmg/s |
| Particle cap         | ~120     |
| Camera zoom (legacy) | 0.45–2.2 |

---

## 18. Architecture Proposal (Rebuild)

```
src/
  game/
    sim/          # pure TS: engine, sonar, pathfinding, autopilot, types (NO three)
    net/          # P2P packing
    audio/        # WebAudio
  three/
    GameScene.ts  # scene graph, lights, water, terrain
    cameras/      # POV controllers
    entities/     # ship/sub/torpedo meshes
    vfx/          # particles, explosions
    post/         # composer
  components/     # React HUD, tutorial, auth (DOM)
  routes/         # TanStack Start
```

**Rule:** Simulation is deterministic and independent of Three.js so netcode and tests stay pure.

---

## 19. Implementation Phases

### Phase A — Vertical slice

- Three.js scene: ocean plane + land heightmap + player sub + one freighter
- Tactical camera + input plot course
- Port `updateGame` loop unchanged

### Phase B — Combat parity

- All weapons, DC, Hedgehog, CM, damage, FOB, powerups
- Sonar blips in 3D + HUD

### Phase C — AI & multiplayer

- Autopilot, patrols, aircraft
- P2P host ticks + remotes

### Phase D — Ultra visuals & POV

- Full water/shore, PBR fleet, day/night, VFX
- All camera modes + periscope

### Phase E — Polish

- Tutorial, adaptive quality, mobile, audio spatialize
- Production build + browser QA

---

## 20. Acceptance Test Checklist (non-exhaustive)

- [ ] Cannot drive onto land; AI path avoids land
- [ ] Depth/speed sticky; silent does not unselect order
- [ ] Ambush leaves FOB and closes range
- [ ] Clear target stops engagement drift
- [ ] Mk-14/Mk-18 counts exact; reload shows whole seconds
- [ ] DC only from BB in range; no random explosions
- [ ] U-boats fire torps (not DC); larger models
- [ ] Hedgehog from escorts under conditions
- [ ] FOB: safe + repair + full weapon restock
- [ ] Sonar passive/active + thermocline
- [ ] Powerups all 6 kinds
- [ ] Waves crash on shore; water not on land
- [ ] POV switch works; periscope usable near peri
- [ ] Late-join multiplayer
- [ ] Victory: clear two waves and at least 8 sinks; game over on 0 HP
- [ ] Tutorial 11 steps
- [ ] 60 FPS high desktop; quality sticky

---

## 21. Risks & Mitigations

| Risk               | Mitigation                                                            |
| ------------------ | --------------------------------------------------------------------- |
| Water looks cloudy | Directional Gerstner/FFT + hard land mask + foam only on crests/shore |
| POV breaks aiming  | Aim raycast always on sim plane; fire uses sim coordinates            |
| Perf collapse      | Adaptive quality, LOD ships, particle caps, water resolution scale    |
| Net desync         | Keep host-authoritative ticks; pure sim module                        |
| Scope creep        | Phase gates; parity checklist blocks “pretty only” merges             |

---

## 22. Open Decisions (for product)

1. **Default POV** on first launch: tactical vs chase?
2. **Historical fidelity** vs arcade numbers (keep current numbers unless redesign)?
3. **Co-op friendly fire** on? (currently separate subs — recommend off)
4. **Asset pipeline**: procedural low-poly PBR vs high-poly glTF packs?

---

## 23. Appendix — Entity Field Reference

### Submarine

x, y, z, heading, displayHeading, bank, speed, targetSpeed, speedOrder, maxSpeed, hp, maxHp, torpedoes, maxTorpedoes, seekers, maxSeekers, reload, reloadMk14, reloadMk18, reloadMk14Max, reloadMk18Max, decoys, cmCharges, maxCmCharges, cmCooldown, noise, waypoint, targetDepth, ballast, invuln, trailTimer, hullTier, weaponTier, speedTier, docked, battery, maxBattery, silentRunning, scopeUp, snorkel, sysSonar, sysPropulsion, sysTubes, sysFlood, crewStress

### Ship

id, class, x, y, heading, displayHeading, speed, maxSpeed, hp, maxHp, sinking, alert, fireCooldown, patrolAngle, dead, name, trailTimer, turnRate, patrolRoute, patrolIndex, patrolDir, patrolLoop, path?, repathTimer?, holdContact?, convoyId?, role?

### Torpedo / DC / CM / Powerup / Aircraft / Autopilot / SonarContact / Camera / Stats / GameState

— As defined in current `types.ts` (full fields must be preserved).

### ImpactFx kinds

shock | hit | pickup | spawn | splash | boom

### Particle kinds

bubble | wake | spark | smoke | debris | splash | trail | flash | ember

---

_End of PRD. This document is the implementation contract for the Silent Depths Three.js rebuild: all gameplay systems from the current product, plus multi-POV ultra-realistic presentation._
