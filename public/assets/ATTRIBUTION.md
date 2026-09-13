# Third-party 3D assets

Production meshes: **`public/assets/models/v2/`** (manifest v5).  
SSOT for license strings: `manifest.json` → `licenseLedger`.  
Staging contract: `config/fleet-source-manifest.json` (sources under `artifacts/fleet-sources/`).  
Re-import: stage local sources → `npm run assets:import-modern -- --validate` → import → `npm run assets:validate`.  
In-game credits: Look-dev panel → **ASSET CREDITS**.

| Entity | Model / pack | Author | License | Path |
|--------|----------------|--------|---------|------|
| `sub_nautilus` | [USS Los Angeles SSN-688](https://sketchfab.com/3d-models/uss-los-angeles-ssn-688-submarine-c297103b4e054be98c9a9c6803c5a196) | Muhamad Mirza Arrafi | CC BY 4.0 | `models/v2/sub_nautilus.glb` |
| `uboat` | [Low poly Akula Class Submarine](https://sketchfab.com/3d-models/low-poly-akula-class-submarine-f63019488c94474dbf60d59a7251dce8) | SIpriv | CC BY 4.0 | `models/v2/uboat.glb` |
| `destroyer` | [Visby Corvette](https://sketchfab.com/3d-models/visby-corvette-06d445dc90304c598286d63f52f2ff85) | Vavtrudner | CC BY 4.0 | `models/v2/destroyer.glb` (escort only) |
| `patrol` | Kenney Watercraft Kit (`boat-speed-e`) | Kenney.nl | CC0 1.0 | `models/v2/patrol.glb` |
| `cruiser` | Kenney Watercraft Kit (`ship-large`) | Kenney.nl | CC0 1.0 | `models/v2/cruiser.glb` |
| `battleship` | Kenney Watercraft Kit (`ship-ocean-liner`) | Kenney.nl | CC0 1.0 | `models/v2/battleship.glb` |
| `freighter` | Kenney Watercraft Kit (`ship-cargo-a`) | Kenney.nl | CC0 1.0 | `models/v2/freighter.glb` |
| `fob_argus` | Kenney Watercraft Kit (`boat-house-d`) | Kenney.nl | CC0 1.0 | `models/v2/fob_argus.glb` |
| `crate` | Kenney Watercraft Kit | Kenney.nl | CC0 1.0 | `models/v2/crate.glb` |
| `aircraft` | [Lowpoly Light Plane](https://opengameart.org/content/lowpoly-light-plane) | iPoly3D | CC0 1.0 | `models/v2/aircraft.glb` |
| `torpedo` | Project procedural export | Silent Depths | project-owned | `models/v2/torpedo.glb` |

Water normals / ripples: mqnc/cheapwater (MIT) — see manifest ledger.

Audio WAVs (`audio/*.wav`) are project-owned synthesized **fallback-generated**
banks (`scripts/generate-audio-banks.mjs`). They are not operator-accepted
production audio. Ledger: `manifest.json` → `audioBanks`. Listening checklist:
`docs/release/audio-banks.md`.

**Do not** re-use the Visby mesh as multi-class hulls. Older `models/v1/` copies remain for
importer fallbacks and historical path references; gameplay ships against **v2**.
